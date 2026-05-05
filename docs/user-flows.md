# User Action Flows

This document details the data flow between the user, the API gateway, and the underlying microservices.

## 1. Authentication Flow
- **User** sends a request to the API Gateway.
- **Kong** (API Gateway) forwards the request to the **Auth Service** to validate the JWT.
- **Auth Service** validates the token using `better-auth` connected to PostgreSQL.
- **Kong** receives the status. If valid, the request proceeds; if not, a 401 Unauthorized is returned.

## 2. Import Transactions (JSON or CSV)
- **User** sends a POST request with JSON or CSV data to `/import` via API Gateway.
- **Kong** routes it to the **Import Service**.
- **Import Service**:
  1. Parses the JSON or CSV payload.
  2. Creates a message for each record.
  3. Pushes the messages to the `import-queue` in the Service Bus.
  4. Returns a 202 Accepted to the user.
- **DB Service** (Background):
  1. Triggered by messages on the `import-queue`.
  2. Inserts each transaction record into the `transactions` table in PostgreSQL.

## 3. Export Transactions
- **User** sends a POST request to `/export` via API Gateway.
- **Kong** routes it to the **Export Service**.
- **Export Service**:
  1. Pushes an export command to the `export-queue` in the Service Bus.
  2. Returns a 202 Accepted to the user.
- **DB Service** (Background):
  1. Triggered by messages on the `export-queue`.
  2. Retrieves all records from the PostgreSQL `transactions` table.
  3. Generates a CSV file in memory.
  4. Uploads the CSV to Blob Storage (Azurite).
  5. Sends a notification message containing the blob filename to the `email-queue`.
- **Email Service** (Background):
  1. Triggered by messages on the `email-queue`.
  2. Formats an email using the Resend SDK.
  3. Dispatches the email to the user indicating success or failure.
