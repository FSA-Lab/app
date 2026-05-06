import { app, InvocationContext } from "@azure/functions";
import { Pool } from "pg";
import { BlobServiceClient } from "@azure/storage-blob";
import { ServiceBusClient } from "@azure/service-bus";

type TransactionMessage = {
    amount: number;
    description: string;
};

type ExportMessage = {
    recipientEmail?: string;
    requestedBy?: string;
};

function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}

const pool = new Pool({
    connectionString: requireEnv("DATABASE_URL"),
    max: Number(process.env.POSTGRES_POOL_MAX || 5),
});

const blobServiceClient = BlobServiceClient.fromConnectionString(requireEnv("AzureWebJobsStorage"));
const sbClient = new ServiceBusClient(requireEnv("ServiceBusConnection"));
let schemaReady: Promise<void> | undefined;

async function ensureSchema(): Promise<void> {
    if (!schemaReady) {
        schemaReady = pool.query(`
            CREATE TABLE IF NOT EXISTS transactions (
                id SERIAL PRIMARY KEY,
                amount DECIMAL NOT NULL,
                description TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `).then(() => undefined).catch((error) => {
            schemaReady = undefined;
            throw error;
        });
    }

    return schemaReady;
}

function validateImportMessage(message: any): TransactionMessage {
    const amount = Number(message?.amount);
    const description = String(message?.description || "").trim();

    if (!Number.isFinite(amount)) {
        throw new Error("Import message requires a numeric amount");
    }
    if (!description || description.length > 1000) {
        throw new Error("Import message requires a description up to 1000 characters");
    }

    return { amount, description };
}

function neutralizeFormula(value: string): string {
    return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

function csvField(value: unknown): string {
    const stringValue = neutralizeFormula(String(value ?? ""));
    return `"${stringValue.replace(/"/g, '""')}"`;
}

async function notifyEmail(body: Record<string, unknown>): Promise<void> {
    const sender = sbClient.createSender("email-queue");
    try {
        await sender.sendMessages({ body });
    } finally {
        await sender.close();
    }
}

export async function dbImportHandler(message: any, context: InvocationContext): Promise<void> {
    context.log(`DB Import processing message`, message);
    const record = validateImportMessage(message);
    const client = await pool.connect();

    try {
        await ensureSchema();
        await client.query(
            "INSERT INTO transactions (amount, description) VALUES ($1, $2)",
            [record.amount, record.description]
        );
        context.log("Inserted record into PostgreSQL.");
    } catch (err) {
        context.error("DB Error", err);
        throw err;
    } finally {
        client.release();
    }
}

app.serviceBusQueue('dbImport', {
    connection: 'ServiceBusConnection',
    queueName: 'import-queue',
    handler: dbImportHandler
});

export async function dbExportHandler(message: any, context: InvocationContext): Promise<void> {
    context.log(`DB Export processing request`, message);
    const exportMessage = message as ExportMessage;
    const client = await pool.connect();

    try {
        await ensureSchema();
        const res = await client.query("SELECT id, amount, description, created_at FROM transactions ORDER BY id");
        const header = ["id", "amount", "description", "created_at"].map(csvField).join(",");
        const rows = res.rows.map((row: any) => [
            row.id,
            row.amount,
            row.description,
            row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
        ].map(csvField).join(","));
        const csv = [header, ...rows].join("\n");

        const containerClient = blobServiceClient.getContainerClient("exports");
        await containerClient.createIfNotExists();
        const blobName = `export-${Date.now()}.csv`;
        const blockBlobClient = containerClient.getBlockBlobClient(blobName);
        await blockBlobClient.upload(csv, Buffer.byteLength(csv));

        context.log(`Uploaded to blob storage: ${blobName}`);

        await notifyEmail({
            subject: "Export Completed",
            file: blobName,
            status: "success",
            recipientEmail: exportMessage.recipientEmail,
            requestedBy: exportMessage.requestedBy,
        });

    } catch (err: any) {
        context.error("DB/Blob Error", err);
        try {
            await notifyEmail({
                subject: "Export Failed",
                error: "The export could not be completed. Please try again later.",
                status: "error",
                recipientEmail: exportMessage.recipientEmail,
                requestedBy: exportMessage.requestedBy,
            });
        } catch (notifyError) {
            context.error("Failed to send export failure notification", notifyError);
        }
        throw err;
    } finally {
        client.release();
    }
}

app.serviceBusQueue('dbExport', {
    connection: 'ServiceBusConnection',
    queueName: 'export-queue',
    handler: dbExportHandler
});
