import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { ServiceBusClient } from "@azure/service-bus";

const connectionString = process.env.SERVICEBUS_CONNECTION_STRING || "Endpoint=sb://localhost;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=key";
const queueName = "export-queue";

export async function exportHandler(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
    context.log(`Export function processed request`);
    
    const sbClient = new ServiceBusClient(connectionString);
    const sender = sbClient.createSender(queueName);

    try {
        await sender.sendMessages({
            body: { action: "export_transactions", timestamp: new Date().toISOString() }
        });
        context.log(`Export request sent to Service Bus.`);
    } catch (error) {
        context.error("Service Bus Error:", error);
        return { status: 500, body: "Failed to request export" };
    } finally {
        await sender.close();
        await sbClient.close();
    }

    return { status: 202, jsonBody: { message: `Export process initiated.` } };
}

app.http('export', {
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: exportHandler
});
