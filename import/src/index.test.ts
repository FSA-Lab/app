import { createHmac } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@azure/functions", () => ({
    app: {
        http: vi.fn(),
    },
}));

const busMocks = vi.hoisted(() => ({
    sentMessages: [] as any[],
    createMessageBatch: vi.fn(),
    createSender: vi.fn(),
    sendMessages: vi.fn(),
    closeSender: vi.fn(),
    closeClient: vi.fn(),
}));

vi.mock("@azure/service-bus", () => ({
    ServiceBusClient: vi.fn().mockImplementation(function () {
        return {
            createSender: busMocks.createSender,
            close: busMocks.closeClient,
        };
    }),
}));

function setImportEnv(): void {
    process.env.ServiceBusConnection = "Endpoint=sb://servicebus;UseDevelopmentEmulator=true;";
    process.env.JWT_SECRET = "test-secret";
    process.env.JWT_ISSUER = "test-issuer";
    process.env.JWT_AUDIENCE = "test-audience";
    process.env.IMPORT_MAX_BYTES = "1024";
    process.env.IMPORT_MAX_RECORDS = "2";
}

function createToken(overrides: Record<string, unknown> = {}): string {
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(JSON.stringify({
        sub: "user@example.com",
        email: "user@example.com",
        iss: "test-issuer",
        aud: "test-audience",
        exp: Math.floor(Date.now() / 1000) + 60,
        ...overrides,
    })).toString("base64url");
    const signature = createHmac("sha256", "test-secret").update(`${header}.${body}`).digest("base64url");
    return `${header}.${body}.${signature}`;
}

function createBatch() {
    const messages: any[] = [];
    return {
        messages,
        get count() {
            return messages.length;
        },
        tryAddMessage: vi.fn((message) => {
            messages.push(message);
            return true;
        }),
    };
}

function setupBus(): void {
    busMocks.sentMessages.length = 0;
    busMocks.createSender.mockReturnValue({
        createMessageBatch: busMocks.createMessageBatch,
        sendMessages: busMocks.sendMessages,
        close: busMocks.closeSender,
    });
    busMocks.createMessageBatch.mockImplementation(async () => createBatch());
    busMocks.sendMessages.mockImplementation(async (batch) => {
        busMocks.sentMessages.push(...batch.messages);
    });
}

function context() {
    return {
        log: vi.fn(),
        error: vi.fn(),
    } as any;
}

function request(body: string, headers: Record<string, string> = {}) {
    const normalizedHeaders = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
    return {
        method: "POST",
        url: "http://localhost/api/import",
        headers: {
            get: (name: string) => normalizedHeaders.get(name.toLowerCase()) ?? null,
        },
        text: vi.fn(async () => body),
    } as any;
}

function authorizedHeaders(body: string, extra: Record<string, string> = {}) {
    return {
        authorization: `Bearer ${createToken()}`,
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(body)),
        ...extra,
    };
}

describe("importHandler", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        setImportEnv();
        setupBus();
    });

    it("requires Content-Length before parsing request bodies", async () => {
        const { importHandler } = await import("./index");

        const response = await importHandler(request("[]"), context());

        expect(response.status).toBe(411);
        expect(busMocks.sendMessages).not.toHaveBeenCalled();
    });

    it("rejects oversized request bodies", async () => {
        const { importHandler } = await import("./index");

        const response = await importHandler(request("{}", {
            authorization: `Bearer ${createToken()}`,
            "content-type": "application/json",
            "content-length": "2048",
        }), context());

        expect(response.status).toBe(413);
    });

    it("returns 401 for missing or malformed JWTs", async () => {
        const { importHandler } = await import("./index");
        const body = JSON.stringify({ amount: 10, description: "Lunch" });

        const response = await importHandler(request(body, {
            "content-type": "application/json",
            "content-length": String(Buffer.byteLength(body)),
        }), context());

        expect(response.status).toBe(401);
        expect(response.body).toBe("Unauthorized");
    });

    it("returns 400 for invalid JSON", async () => {
        const { importHandler } = await import("./index");

        const response = await importHandler(request("{bad", authorizedHeaders("{bad")), context());

        expect(response.status).toBe(400);
        expect(response.body).toBe("Invalid JSON body");
    });

    it("validates and sends JSON records in a Service Bus batch", async () => {
        const { importHandler } = await import("./index");
        const body = JSON.stringify([
            { amount: 10.5, description: "Lunch" },
            { amount: 20, description: "Taxi" },
        ]);

        const response = await importHandler(request(body, authorizedHeaders(body)), context());

        expect(response.status).toBe(202);
        expect(response.jsonBody.count).toBe(2);
        expect(busMocks.createSender).toHaveBeenCalledWith("import-queue");
        expect(busMocks.sentMessages.map((message) => message.body)).toEqual([
            { amount: 10.5, description: "Lunch" },
            { amount: 20, description: "Taxi" },
        ]);
    });

    it("parses valid CSV records and rejects invalid record counts", async () => {
        const { importHandler } = await import("./index");
        const body = "amount,description\n1,A\n2,B\n3,C";

        const response = await importHandler(request(body, authorizedHeaders(body, {
            "content-type": "text/csv",
        })), context());

        expect(response.status).toBe(400);
        expect(response.body).toBe("Import is limited to 2 records");
    });
});
