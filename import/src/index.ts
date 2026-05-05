import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { parse } from "csv-parse/sync";
import { ServiceBusClient } from "@azure/service-bus";

const connectionString = process.env.SERVICEBUS_CONNECTION_STRING || "Endpoint=sb://localhost;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=key";
const queueName = "import-queue";

export async function importHandler(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
    context.log(`Import function processed request for url "${request.url}"`);
    
    let records = [];
    const contentType = request.headers.get("content-type");

    if (contentType?.includes("application/json")) {
        const jsonBody = await request.json() as any;
        records = Array.isArray(jsonBody) ? jsonBody : [jsonBody];
    } else {
        const csvContent = await request.text();
        if (csvContent) {
            records = parse(csvContent, { columns: true, skip_empty_lines: true });
        }
    }

    if (records.length === 0) {
        return { status: 400, body: "No records found" };
    }

    const sbClient = new ServiceBusClient(connectionString);
    const sender = sbClient.createSender(queueName);

    try {
        const messages = records.map(record => ({ body: record }));
        await sender.sendMessages(messages);
        context.log(`Sent ${records.length} messages to Service Bus.`);
    } catch (error) {
        context.error("Service Bus Error:", error);
        return { status: 500, body: "Failed to send to service bus" };
    } finally {
        await sender.close();
        await sbClient.close();
    }

    return { status: 202, jsonBody: { message: `Import initiated for ${records.length} records.`, count: records.length } };
}

app.http('import', {
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: importHandler
});
