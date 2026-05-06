import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@azure/functions", () => ({
    app: {
        http: vi.fn(),
    },
}));

const pgMocks = vi.hoisted(() => ({
    query: vi.fn(),
}));

vi.mock("pg", () => ({
    Pool: vi.fn().mockImplementation(function () {
        return {
        query: pgMocks.query,
        };
    }),
}));

function setAuthEnv(): void {
    process.env.JWT_SECRET = "test-secret";
    process.env.JWT_ISSUER = "test-issuer";
    process.env.JWT_AUDIENCE = "test-audience";
    process.env.AUTH_PASSWORD = "correct-password";
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/test";
    process.env.AUTH_RATE_LIMIT_MAX = "2";
}

function context() {
    return {
        log: vi.fn(),
        error: vi.fn(),
    } as any;
}

function request(method: string, path: string, body?: unknown, token?: string) {
    const headers = new Map<string, string>();
    if (token) {
        headers.set("authorization", `Bearer ${token}`);
    }

    return {
        method,
        url: `http://localhost/api${path}`,
        headers: {
            get: (name: string) => headers.get(name.toLowerCase()) ?? null,
        },
        json: vi.fn(async () => body),
    } as any;
}

describe("authHandler", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        setAuthEnv();
        pgMocks.query.mockResolvedValue({ rows: [] });
    });

    it("issues and verifies a JWT for valid credentials", async () => {
        const { authHandler } = await import("./index");

        const issued = await authHandler(
            request("POST", "/auth/token", { email: "User@Example.com", password: "correct-password" }),
            context(),
        );

        expect(issued.status).toBe(200);
        expect(issued.jsonBody.tokenType).toBe("Bearer");

        const verified = await authHandler(
            request("POST", "/auth/verify", undefined, issued.jsonBody.token),
            context(),
        );

        expect(verified.status).toBe(200);
        expect(verified.jsonBody.user.email).toBe("user@example.com");
    });

    it("rejects invalid credentials without issuing a token", async () => {
        const { authHandler } = await import("./index");

        const response = await authHandler(
            request("POST", "/auth/token", { email: "user@example.com", password: "wrong" }),
            context(),
        );

        expect(response.status).toBe(401);
        expect(response.body).toBe("Invalid credentials");
    });

    it("returns 400 for invalid login JSON", async () => {
        const { authHandler } = await import("./index");
        const invalidRequest = request("POST", "/auth/token");
        invalidRequest.json.mockRejectedValue(new Error("bad json"));

        const response = await authHandler(invalidRequest, context());

        expect(response.status).toBe(400);
        expect(response.body).toBe("Invalid JSON body");
    });

    it("returns 401 for malformed bearer tokens", async () => {
        const { authHandler } = await import("./index");

        const response = await authHandler(
            request("POST", "/auth/verify", undefined, "not-a-jwt"),
            context(),
        );

        expect(response.status).toBe(401);
        expect(response.body).toBe("Invalid token");
    });

    it("rate limits repeated token attempts per email", async () => {
        const { authHandler } = await import("./index");
        const loginRequest = () => request("POST", "/auth/token", {
            email: "user@example.com",
            password: "wrong",
        });

        await authHandler(loginRequest(), context());
        await authHandler(loginRequest(), context());
        const response = await authHandler(loginRequest(), context());

        expect(response.status).toBe(429);
        expect(response.body).toBe("Too many login attempts");
    });

    it("checks PostgreSQL reachability on GET", async () => {
        const { authHandler } = await import("./index");

        const response = await authHandler(request("GET", "/auth"), context());

        expect(response.status).toBe(200);
        expect(pgMocks.query).toHaveBeenCalledWith("SELECT 1");
    });
});
