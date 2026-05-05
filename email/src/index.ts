import { app, InvocationContext } from "@azure/functions";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY || 're_123456789');

export async function emailHandler(message: any, context: InvocationContext): Promise<void> {
    context.log(`Email Service processing message:`, message);
    
    try {
        let html = `<p>Your export is ready. File: ${message.file}</p>`;
        if (message.status === "error") {
            html = `<p>Your export failed. Error: ${message.error}</p>`;
        }

        await resend.emails.send({
            from: 'onboarding@resend.dev',
            to: 'user@example.com',
            subject: message.subject || 'Notification',
            html: html
        });
        context.log('Email sent successfully.');
    } catch (error) {
        context.error('Error sending email:', error);
    }
}

app.serviceBusQueue('emailQueue', {
    connection: 'ServiceBusConnection',
    queueName: 'email-queue',
    handler: emailHandler
});
