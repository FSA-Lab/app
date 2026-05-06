import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { ServiceBusClient } from "@azure/service-bus";
import { createHmac, timingSafeEqual } from "crypto";

type TokenPayload = {
    sub: string;
    email: string;
    iss: string;
    aud: string;
    exp: number;
};

class HttpError extends Error {
    constructor(
        readonly status: number,
        readonly publicMessage: string,
    ) {
        super(publicMessage);
    }
}

function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}

const connectionString = requireEnv("ServiceBusConnection");
const queueName = "export-queue";
const jwtSecret = requireEnv("JWT_SECRET");
const jwtIssuer = requireEnv("JWT_ISSUER");
const jwtAudience = requireEnv("JWT_AUDIENCE");

function verifyAuthorization(request: HttpRequest): TokenPayload {
    try {
        const authorization = request.headers.get("authorization") || "";
        const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
        const [header, body, signature] = token.split(".");
        if (!header || !body || !signature) {
            throw new Error("Missing or invalid bearer token");
        }

        const expected = createHmac("sha256", jwtSecret).update(`${header}.${body}`).digest("base64url");
        const actualSignature = Buffer.from(signature);
        const expectedSignature = Buffer.from(expected);
        if (actualSignature.length !== expectedSignature.length || !timingSafeEqual(actualSignature, expectedSignature)) {
            throw new Error("Invalid token signature");
        }

        const parsedHeader = JSON.parse(Buffer.from(header, "base64url").toString("utf8"));
        if (parsedHeader.alg !== "HS256") {
            throw new Error("Unsupported token algorithm");
        }

        const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as TokenPayload;
        if (payload.iss !== jwtIssuer || payload.aud !== jwtAudience || payload.exp <= Math.floor(Date.now() / 1000)) {
            throw new Error("Invalid token claims");
        }

        return payload;
    } catch {
        throw new HttpError(401, "Unauthorized");
    }
}

async function readExportOptions(request: HttpRequest): Promise<Record<string, unknown>> {
    if (!request.headers.get("content-type")?.includes("application/json")) {
        return {};
    }

    try {
        const body = await request.json() as { options?: Record<string, unknown> };
        return body.options && typeof body.options === "object" ? body.options : {};
    } catch {
        throw new HttpError(400, "Invalid JSON body");
    }
}

export async function exportHandler(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
    context.log(`Export function processed request`);

    try {
        const user = verifyAuthorization(request);
        const options = await readExportOptions(request);
        const sbClient = new ServiceBusClient(connectionString);
        const sender = sbClient.createSender(queueName);

        try {
            await sender.sendMessages({
                body: {
                    action: "export_transactions",
                    requestedAt: new Date().toISOString(),
                    requestedBy: user.sub,
                    recipientEmail: user.email,
                    options,
                },
            });
        } finally {
            await sender.close();
            await sbClient.close();
        }

        context.log(`Export request sent to Service Bus.`);
        return { status: 202, jsonBody: { message: `Export process initiated.`, requestedBy: user.email } };
    } catch (error: any) {
        context.error("Export Error:", error);
        if (error instanceof HttpError) {
            return { status: error.status, body: error.publicMessage };
        }
        return { status: 503, body: "Export service is temporarily unavailable" };
    }
}

app.http('export', {
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: exportHandler
});
