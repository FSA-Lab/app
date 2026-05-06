import { beforeEach, describe, expect, it, vi } from "vitest";

const azureMocks = vi.hoisted(() => ({
    serviceBusQueue: vi.fn(),
}));

vi.mock("@azure/functions", () => ({
    app: {
        serviceBusQueue: azureMocks.serviceBusQueue,
    },
}));

const resendMocks = vi.hoisted(() => ({
    send: vi.fn(),
}));

vi.mock("resend", () => ({
    Resend: vi.fn().mockImplementation(function () {
        return {
            emails: {
                send: resendMocks.send,
            },
        };
    }),
}));

function setEmailEnv(): void {
    process.env.RESEND_API_KEY = "re_test";
    process.env.EMAIL_FROM = "sender@example.com";
}

function context() {
    return {
        log: vi.fn(),
        error: vi.fn(),
    } as any;
}

describe("emailHandler", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        setEmailEnv();
        resendMocks.send.mockResolvedValue({ id: "email-id" });
    });

    it("registers the email queue binding", async () => {
        await import("./index");

        expect(azureMocks.serviceBusQueue).toHaveBeenCalledWith(
            "emailQueue",
            expect.objectContaining({
                connection: "ServiceBusConnection",
                queueName: "email-queue",
            }),
        );
    });

    it("sends success emails to the requested recipient", async () => {
        const { emailHandler } = await import("./index");

        await emailHandler(
            {
                status: "success",
                subject: "Export Completed",
                file: "export.csv",
                recipientEmail: "user@example.com",
            },
            context(),
        );

        expect(resendMocks.send).toHaveBeenCalledWith({
            from: "sender@example.com",
            to: "user@example.com",
            subject: "Export Completed",
            html: "<p>Your export is ready. File: export.csv</p>",
        });
    });

    it("escapes success email HTML values", async () => {
        const { emailHandler } = await import("./index");

        await emailHandler(
            {
                status: "success",
                file: "<script>alert(1)</script>",
                recipientEmail: "user@example.com",
            },
            context(),
        );

        expect(resendMocks.send.mock.calls[0][0].html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    });

    it("escapes failure email HTML values", async () => {
        const { emailHandler } = await import("./index");

        await emailHandler(
            {
                status: "error",
                error: "<b>failed</b>",
                recipientEmail: "user@example.com",
            },
            context(),
        );

        expect(resendMocks.send.mock.calls[0][0].html).toContain("&lt;b&gt;failed&lt;/b&gt;");
    });

    it("rejects messages without a valid recipient email", async () => {
        const { emailHandler } = await import("./index");

        await expect(
            emailHandler(
                {
                    status: "success",
                    file: "export.csv",
                    recipientEmail: "not-an-email",
                },
                context(),
            ),
        ).rejects.toThrow("Email message requires a valid recipientEmail");

        expect(resendMocks.send).not.toHaveBeenCalled();
    });
});
