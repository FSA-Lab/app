import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { betterAuth } from "better-auth";
import { Pool } from "pg";

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/cicd",
});

const auth = betterAuth({
    database: {
        provider: "postgres",
        db: pool
    }
});

export async function authHandler(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
    context.log(`Auth function processing request for url "${request.url}"`);
    
    try {
        // Mocking the behavior for the lab
        return { 
            status: 200, 
            jsonBody: { message: "Auth service is running and connected to PostgreSQL", status: "success" } 
        };
    } catch (e) {
        return { status: 500, body: "Auth error" };
    }
}

app.http('auth', {
    route: 'auth/{*restOfPath}',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    authLevel: 'anonymous',
    handler: authHandler
});
