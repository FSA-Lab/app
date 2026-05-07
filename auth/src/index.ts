import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { createHmac, timingSafeEqual } from "crypto";
import { Pool } from "pg";

type TokenPayload = {
    sub: string;
    email: string;
    iss: string;
    aud: string;
    iat: number;
    exp: number;
};

function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}

const jwtSecret = requireEnv("JWT_SECRET");
const jwtIssuer = requireEnv("JWT_ISSUER");
const jwtAudience = requireEnv("JWT_AUDIENCE");
const authPassword = requireEnv("AUTH_PASSWORD");
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const loginWindowMs = Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS || 60_000);
const loginMaxAttempts = Number(process.env.AUTH_RATE_LIMIT_MAX || 10);

const pool = new Pool({
    connectionString: requireEnv("DATABASE_URL"),
    max: Number(process.env.POSTGRES_POOL_MAX || 5),
});

function base64UrlEncode(value: string | Buffer): string {
    return Buffer.from(value).toString("base64url");
}

function signJwt(payload: TokenPayload): string {
    const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const body = base64UrlEncode(JSON.stringify(payload));
    const signature = createHmac("sha256", jwtSecret).update(`${header}.${body}`).digest("base64url");
    return `${header}.${body}.${signature}`;
}

function verifyJwt(token: string): TokenPayload {
    try {
        const [header, body, signature] = token.split(".");
        if (!header || !body || !signature) {
            throw new Error("Invalid token format");
        }

        const expected = createHmac("sha256", jwtSecret).update(`${header}.${body}`).digest("base64url");
        const actualSignature = Buffer.from(signature);
        const expectedSignature = Buffer.from(expected);
        if (
            actualSignature.length !== expectedSignature.length ||
            !timingSafeEqual(actualSignature, expectedSignature)
        ) {
            throw new Error("Invalid token signature");
        }

        const parsedHeader = JSON.parse(Buffer.from(header, "base64url").toString("utf8"));
        if (parsedHeader.alg !== "HS256") {
            throw new Error("Unsupported token algorithm");
        }

        const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as TokenPayload;
        const now = Math.floor(Date.now() / 1000);
        if (payload.iss !== jwtIssuer || payload.aud !== jwtAudience || payload.exp <= now) {
            throw new Error("Invalid token claims");
        }

        return payload;
    } catch {
        throw new Error("Invalid token");
    }
}

function checkRateLimit(identifier: string): HttpResponseInit | null {
    const now = Date.now();
    const current = loginAttempts.get(identifier);
    if (!current || current.resetAt <= now) {
        loginAttempts.set(identifier, { count: 1, resetAt: now + loginWindowMs });
        return null;
    }

    current.count += 1;
    if (current.count > loginMaxAttempts) {
        return { status: 429, body: "Too many login attempts" };
    }

    return null;
}

async function issueToken(request: HttpRequest): Promise<HttpResponseInit> {
    let body: { email?: string; password?: string };
    try {
        body = (await request.json()) as { email?: string; password?: string };
    } catch {
        return { status: 400, body: "Invalid JSON body" };
    }

    const email = body.email?.trim().toLowerCase();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return { status: 400, body: "A valid email is required" };
    }

    const limited = checkRateLimit(email);
    if (limited) {
        return limited;
    }

    if (body.password !== authPassword) {
        return { status: 401, body: "Invalid credentials" };
    }

    const now = Math.floor(Date.now() / 1000);
    const token = signJwt({
        sub: email,
        email,
        iss: jwtIssuer,
        aud: jwtAudience,
        iat: now,
        exp: now + 60 * 60,
    });

    return { status: 200, jsonBody: { token, tokenType: "Bearer", expiresIn: 3600 } };
}

async function verifyToken(request: HttpRequest): Promise<HttpResponseInit> {
    const authorization = request.headers.get("authorization") || "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
    if (!token) {
        return { status: 401, body: "Missing bearer token" };
    }

    try {
        const payload = verifyJwt(token);
        return { status: 200, jsonBody: { authenticated: true, user: { id: payload.sub, email: payload.email } } };
    } catch {
        return { status: 401, body: "Invalid token" };
    }
}

async function healthCheck(): Promise<HttpResponseInit> {
    await pool.query("SELECT 1");
    return {
        status: 200,
        jsonBody: { message: "Auth service is running and PostgreSQL is reachable", status: "success" },
    };
}

export async function authHandler(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
    context.log(`Auth function processing request for url "${request.url}"`);

    try {
        const path = new URL(request.url).pathname.toLowerCase();
        if (request.method === "POST" && path.endsWith("/auth/token")) {
            return await issueToken(request);
        }

        if (request.method === "POST" && path.endsWith("/auth/verify")) {
            return await verifyToken(request);
        }

        if (request.method === "GET") {
            return await healthCheck();
        }

        return { status: 404, body: "Unknown auth endpoint" };
    } catch (error) {
        context.error("Auth error", error);
        return { status: 500, body: "Auth error" };
    }
}

app.http("auth", {
    route: "auth/{*restOfPath}",
    methods: ["GET", "POST", "PUT", "DELETE"],
    authLevel: "anonymous",
    handler: authHandler,
});
