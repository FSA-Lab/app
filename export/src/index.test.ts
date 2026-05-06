import { createHmac } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@azure/functions", () => ({
    app: {
        http: vi.fn(),
    },
}));

const busMocks = vi.hoisted(() => ({
    sentMessages: [] as any[],
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

function setExportEnv(): void {
    process.env.ServiceBusConnection = "Endpoint=sb://servicebus;UseDevelopmentEmulator=true;";
    process.env.JWT_SECRET = "test-secret";
    process.env.JWT_ISSUER = "test-issuer";
    process.env.JWT_AUDIENCE = "test-audience";
}

function createToken(overrides: Record<string, unknown> = {}): string {
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(JSON.stringify({
        sub: "user-id",
        email: "user@example.com",
        iss: "test-issuer",
        aud: "test-audience",
        exp: Math.floor(Date.now() / 1000) + 60,
        ...overrides,
    })).toString("base64url");
    const signature = createHmac("sha256", "test-secret").update(`${header}.${body}`).digest("base64url");
    return `${header}.${body}.${signature}`;
}

function context() {
    return {
        log: vi.fn(),
        error: vi.fn(),
    } as any;
}

function request(headers: Record<string, string> = {}, body?: unknown) {
    const normalizedHeaders = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
    return {
        method: "POST",
        url: "http://localhost/api/export",
        headers: {
            get: (name: string) => normalizedHeaders.get(name.toLowerCase()) ?? null,
        },
        json: vi.fn(async () => body),
    } as any;
}

describe("exportHandler", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        setExportEnv();
        busMocks.sentMessages.length = 0;
        busMocks.createSender.mockReturnValue({
            sendMessages: busMocks.sendMessages,
            close: busMocks.closeSender,
        });
        busMocks.sendMessages.mockImplementation(async (message) => {
            busMocks.sentMessages.push(message);
        });
    });

    it("returns 401 for missing bearer tokens", async () => {
        const { exportHandler } = await import("./index");

        const response = await exportHandler(request(), context());

        expect(response.status).toBe(401);
        expect(response.body).toBe("Unauthorized");
    });

    it("rejects malformed JSON request bodies", async () => {
        const { exportHandler } = await import("./index");
        const invalidRequest = request({
            authorization: `Bearer ${createToken()}`,
            "content-type": "application/json",
        });
        invalidRequest.json.mockRejectedValue(new Error("bad json"));

        const response = await exportHandler(invalidRequest, context());

        expect(response.status).toBe(400);
        expect(response.body).toBe("Invalid JSON body");
    });

    it("sends authenticated export context to Service Bus", async () => {
        const { exportHandler } = await import("./index");

        const response = await exportHandler(request({
            authorization: `Bearer ${createToken()}`,
            "content-type": "application/json",
        }, { options: { format: "csv" } }), context());

        expect(response.status).toBe(202);
        expect(busMocks.createSender).toHaveBeenCalledWith("export-queue");
        expect(busMocks.sentMessages[0].body).toMatchObject({
            action: "export_transactions",
            requestedBy: "user-id",
            recipientEmail: "user@example.com",
            options: { format: "csv" },
        });
    });

    it("sanitizes infrastructure failures", async () => {
        const { exportHandler } = await import("./index");
        busMocks.sendMessages.mockRejectedValue(new Error("connection string leaked"));

        const response = await exportHandler(request({
            authorization: `Bearer ${createToken()}`,
        }), context());

        expect(response.status).toBe(503);
        expect(response.body).toBe("Export service is temporarily unavailable");
    });
});
