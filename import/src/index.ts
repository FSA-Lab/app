import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { parse } from "csv-parse/sync";
import { ServiceBusClient } from "@azure/service-bus";
import { createHmac, timingSafeEqual } from "crypto";

type ImportRecord = {
    amount: number;
    description: string;
};

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

function positiveNumberEnv(name: string, fallback: number): number {
    const value = Number(process.env[name] || fallback);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

const connectionString = requireEnv("ServiceBusConnection");
const queueName = "import-queue";
const jwtSecret = requireEnv("JWT_SECRET");
const jwtIssuer = requireEnv("JWT_ISSUER");
const jwtAudience = requireEnv("JWT_AUDIENCE");
const maxRecords = positiveNumberEnv("IMPORT_MAX_RECORDS", 1000);
const maxBytes = positiveNumberEnv("IMPORT_MAX_BYTES", 1024 * 1024);

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

function validateSize(request: HttpRequest): HttpResponseInit | null {
    const header = request.headers.get("content-length");
    const contentLength = Number(header);
    if (!header || !Number.isFinite(contentLength) || contentLength <= 0) {
        return { status: 411, body: "Content-Length is required" };
    }
    if (contentLength > maxBytes) {
        return { status: 413, body: `Request body exceeds ${maxBytes} bytes` };
    }
    return null;
}

function normalizeRecord(record: any): ImportRecord {
    const amount = Number(record?.amount);
    const description = String(record?.description || "").trim();

    if (!Number.isFinite(amount)) {
        throw new HttpError(400, "Each record requires a numeric amount");
    }
    if (!description || description.length > 1000) {
        throw new HttpError(400, "Each record requires a description up to 1000 characters");
    }

    return { amount, description };
}

async function readRecords(request: HttpRequest): Promise<ImportRecord[]> {
    const contentType = request.headers.get("content-type") || "";
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody) > maxBytes) {
        throw new HttpError(413, `Request body exceeds ${maxBytes} bytes`);
    }

    let rawRecords: any[] = [];

    if (contentType.includes("application/json")) {
        let jsonBody: any;
        try {
            jsonBody = JSON.parse(rawBody);
        } catch {
            throw new HttpError(400, "Invalid JSON body");
        }
        rawRecords = Array.isArray(jsonBody) ? jsonBody : [jsonBody];
    } else {
        try {
            rawRecords = rawBody ? parse(rawBody, { columns: true, skip_empty_lines: true, trim: true }) : [];
        } catch {
            throw new HttpError(400, "Invalid CSV body");
        }
    }

    if (rawRecords.length === 0) {
        throw new HttpError(400, "No records found");
    }
    if (rawRecords.length > maxRecords) {
        throw new HttpError(400, `Import is limited to ${maxRecords} records`);
    }

    return rawRecords.map(normalizeRecord);
}

async function sendRecords(records: ImportRecord[]): Promise<void> {
    const sbClient = new ServiceBusClient(connectionString);
    const sender = sbClient.createSender(queueName);

    try {
        let batch = await sender.createMessageBatch();
        for (const record of records) {
            if (!batch.tryAddMessage({ body: record })) {
                await sender.sendMessages(batch);
                batch = await sender.createMessageBatch();
                if (!batch.tryAddMessage({ body: record })) {
                    throw new Error("Record is too large for a Service Bus message");
                }
            }
        }

        if (batch.count > 0) {
            await sender.sendMessages(batch);
        }
    } finally {
        await sender.close();
        await sbClient.close();
    }
}

export async function importHandler(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
    context.log(`Import function processed request for url "${request.url}"`);

    try {
        const sizeError = validateSize(request);
        if (sizeError) {
            return sizeError;
        }

        const user = verifyAuthorization(request);
        const records = await readRecords(request);
        await sendRecords(records);
        context.log(`Sent ${records.length} messages to Service Bus.`);

        return {
            status: 202,
            jsonBody: { message: `Import initiated for ${records.length} records.`, count: records.length, requestedBy: user.email },
        };
    } catch (error: any) {
        context.error("Import Error:", error);
        if (error instanceof HttpError) {
            return { status: error.status, body: error.publicMessage };
        }
        return { status: 503, body: "Import service is temporarily unavailable" };
    }
}

app.http('import', {
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: importHandler
});
