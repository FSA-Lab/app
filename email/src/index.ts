import { app, InvocationContext } from "@azure/functions";
import { Resend } from "resend";

function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}

const resend = new Resend(requireEnv("RESEND_API_KEY"));
const senderEmail = requireEnv("EMAIL_FROM");

function escapeHtml(value: unknown): string {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function isValidEmail(value: unknown): value is string {
    return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function emailHandler(message: any, context: InvocationContext): Promise<void> {
    context.log(`Email Service processing message:`, message);

    try {
        if (!isValidEmail(message.recipientEmail)) {
            throw new Error("Email message requires a valid recipientEmail");
        }

        let html = `<p>Your export is ready. File: ${escapeHtml(message.file)}</p>`;
        if (message.status === "error") {
            html = `<p>Your export failed. Error: ${escapeHtml(message.error)}</p>`;
        }

        await resend.emails.send({
            from: senderEmail,
            to: message.recipientEmail,
            subject: String(message.subject || "Notification"),
            html: html,
        });
        context.log("Email sent successfully.");
    } catch (error) {
        context.error("Error sending email:", error);
        throw error;
    }
}

app.serviceBusQueue("emailQueue", {
    connection: "ServiceBusConnection",
    queueName: "email-queue",
    handler: emailHandler,
});
