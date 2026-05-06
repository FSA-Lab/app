import { beforeEach, describe, expect, it, vi } from "vitest";

const azureMocks = vi.hoisted(() => ({
    serviceBusQueue: vi.fn(),
}));

vi.mock("@azure/functions", () => ({
    app: {
        serviceBusQueue: azureMocks.serviceBusQueue,
    },
}));

const pgMocks = vi.hoisted(() => ({
    poolQuery: vi.fn(),
    clientQuery: vi.fn(),
    release: vi.fn(),
    connect: vi.fn(),
}));

vi.mock("pg", () => ({
    Pool: vi.fn().mockImplementation(function () {
        return {
            query: pgMocks.poolQuery,
            connect: pgMocks.connect,
        };
    }),
}));

const blobMocks = vi.hoisted(() => ({
    upload: vi.fn(),
    createIfNotExists: vi.fn(),
}));

vi.mock("@azure/storage-blob", () => ({
    BlobServiceClient: {
        fromConnectionString: vi.fn(() => ({
            getContainerClient: vi.fn(() => ({
                createIfNotExists: blobMocks.createIfNotExists,
                getBlockBlobClient: vi.fn(() => ({
                    upload: blobMocks.upload,
                })),
            })),
        })),
    },
}));

const busMocks = vi.hoisted(() => ({
    sentMessages: [] as any[],
    createSender: vi.fn(),
    sendMessages: vi.fn(),
    closeSender: vi.fn(),
}));

vi.mock("@azure/service-bus", () => ({
    ServiceBusClient: vi.fn().mockImplementation(function () {
        return {
            createSender: busMocks.createSender,
        };
    }),
}));

function setDbEnv(): void {
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/test";
    process.env.AzureWebJobsStorage = "UseDevelopmentStorage=true";
    process.env.ServiceBusConnection = "Endpoint=sb://servicebus;UseDevelopmentEmulator=true;";
}

function setupDb(): void {
    pgMocks.connect.mockResolvedValue({
        query: pgMocks.clientQuery,
        release: pgMocks.release,
    });
    pgMocks.poolQuery.mockResolvedValue({ rows: [] });
    pgMocks.clientQuery.mockResolvedValue({ rows: [] });
    blobMocks.createIfNotExists.mockResolvedValue(undefined);
    blobMocks.upload.mockResolvedValue(undefined);
    busMocks.sentMessages.length = 0;
    busMocks.createSender.mockReturnValue({
        sendMessages: busMocks.sendMessages,
        close: busMocks.closeSender,
    });
    busMocks.sendMessages.mockImplementation(async (message) => {
        busMocks.sentMessages.push(message);
    });
}

function context() {
    return {
        log: vi.fn(),
        error: vi.fn(),
    } as any;
}

describe("db-service handlers", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        setDbEnv();
        setupDb();
    });

    it("registers import and export queue bindings", async () => {
        await import("./index");

        expect(azureMocks.serviceBusQueue).toHaveBeenCalledWith(
            "dbImport",
            expect.objectContaining({
                connection: "ServiceBusConnection",
                queueName: "import-queue",
            }),
        );
        expect(azureMocks.serviceBusQueue).toHaveBeenCalledWith(
            "dbExport",
            expect.objectContaining({
                connection: "ServiceBusConnection",
                queueName: "export-queue",
            }),
        );
    });

    it("rejects invalid import messages before opening a DB connection", async () => {
        const { dbImportHandler } = await import("./index");

        await expect(dbImportHandler({ amount: "bad", description: "x" }, context())).rejects.toThrow(
            "Import message requires a numeric amount",
        );

        expect(pgMocks.connect).not.toHaveBeenCalled();
    });

    it("creates schema once and inserts validated import messages", async () => {
        const { dbImportHandler } = await import("./index");

        await dbImportHandler({ amount: 12.5, description: "Invoice" }, context());

        expect(pgMocks.poolQuery).toHaveBeenCalledWith(
            expect.stringContaining("CREATE TABLE IF NOT EXISTS transactions"),
        );
        expect(pgMocks.clientQuery).toHaveBeenCalledWith(
            "INSERT INTO transactions (amount, description) VALUES ($1, $2)",
            [12.5, "Invoice"],
        );
        expect(pgMocks.release).toHaveBeenCalled();
    });

    it("retries schema initialization after a transient failure", async () => {
        const { dbImportHandler } = await import("./index");
        pgMocks.poolQuery.mockRejectedValueOnce(new Error("database starting"));

        await expect(dbImportHandler({ amount: 1, description: "First" }, context())).rejects.toThrow(
            "database starting",
        );

        pgMocks.poolQuery.mockResolvedValueOnce({ rows: [] });
        await dbImportHandler({ amount: 2, description: "Second" }, context());

        expect(pgMocks.poolQuery).toHaveBeenCalledTimes(2);
    });

    it("exports an empty CSV when no transactions exist", async () => {
        const { dbExportHandler } = await import("./index");

        await dbExportHandler({ recipientEmail: "user@example.com", requestedBy: "user-id" }, context());

        expect(blobMocks.upload).toHaveBeenCalledWith(
            '"id","amount","description","created_at"',
            Buffer.byteLength('"id","amount","description","created_at"'),
        );
        expect(busMocks.createSender).toHaveBeenCalledWith("email-queue");
        expect(busMocks.sentMessages[0].body).toMatchObject({
            status: "success",
            recipientEmail: "user@example.com",
        });
    });

    it("escapes CSV fields and neutralizes spreadsheet formulas", async () => {
        const { dbExportHandler } = await import("./index");
        pgMocks.clientQuery.mockResolvedValueOnce({
            rows: [
                {
                    id: 1,
                    amount: "9.99",
                    description: "=SUM(1,1)",
                    created_at: new Date("2026-05-06T00:00:00.000Z"),
                },
                {
                    id: 2,
                    amount: "3.5",
                    description: 'hello, "world"\nnext',
                    created_at: "2026-05-06",
                },
            ],
        });

        await dbExportHandler({ recipientEmail: "user@example.com" }, context());

        const csv = blobMocks.upload.mock.calls[0][0] as string;
        expect(csv).toContain(`"'=SUM(1,1)"`);
        expect(csv).toContain(`"hello, ""world""\nnext"`);
    });

    it("sends sanitized failure notifications and rethrows export failures", async () => {
        const { dbExportHandler } = await import("./index");
        pgMocks.clientQuery.mockRejectedValueOnce(new Error("postgres://secret"));

        await expect(dbExportHandler({ recipientEmail: "user@example.com" }, context())).rejects.toThrow(
            "postgres://secret",
        );

        expect(busMocks.sentMessages[0].body).toMatchObject({
            status: "error",
            error: "The export could not be completed. Please try again later.",
        });
    });
});
