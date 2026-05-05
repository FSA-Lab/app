import { app, InvocationContext } from "@azure/functions";
import { Pool } from "pg";
import { BlobServiceClient } from "@azure/storage-blob";
import { ServiceBusClient } from "@azure/service-bus";

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/cicd",
});

const blobServiceClient = BlobServiceClient.fromConnectionString(process.env.AzureWebJobsStorage || "UseDevelopmentStorage=true");
const sbClient = new ServiceBusClient(process.env.SERVICEBUS_CONNECTION_STRING || "Endpoint=sb://localhost;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=key");

export async function dbImportHandler(message: any, context: InvocationContext): Promise<void> {
    context.log(`DB Import processing message`, message);
    const client = await pool.connect();
    try {
        // Create table if not exists
        await client.query(`
            CREATE TABLE IF NOT EXISTS transactions (
                id SERIAL PRIMARY KEY,
                amount DECIMAL,
                description TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        await client.query(
            "INSERT INTO transactions (amount, description) VALUES ($1, $2)",
            [message.amount || 0, message.description || "N/A"]
        );
        context.log("Inserted record into PostgreSQL.");
    } catch (err) {
        context.error("DB Error", err);
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
    const client = await pool.connect();
    try {
        const res = await client.query("SELECT * FROM transactions");
        
        // Generate CSV
        const header = "id,amount,description,created_at\n";
        const rows = res.rows.map((r: any) => `${r.id},${r.amount},${r.description},${r.created_at}`).join("\n");
        const csv = header + rows;
        
        // Upload to Blob Storage
        const containerClient = blobServiceClient.getContainerClient("exports");
        await containerClient.createIfNotExists();
        const blobName = `export-${Date.now()}.csv`;
        const blockBlobClient = containerClient.getBlockBlobClient(blobName);
        await blockBlobClient.upload(csv, csv.length);
        
        context.log(`Uploaded to blob storage: ${blobName}`);

        // Notify email service
        const sender = sbClient.createSender("email-queue");
        await sender.sendMessages({
            body: { subject: "Export Completed", file: blobName, status: "success" }
        });
        await sender.close();
        
    } catch (err: any) {
        context.error("DB/Blob Error", err);
        // Notify email service of error
        const sender = sbClient.createSender("email-queue");
        await sender.sendMessages({
            body: { subject: "Export Failed", error: err.message, status: "error" }
        });
        await sender.close();
    } finally {
        client.release();
    }
}

app.serviceBusQueue('dbExport', {
    connection: 'ServiceBusConnection',
    queueName: 'export-queue',
    handler: dbExportHandler
});
