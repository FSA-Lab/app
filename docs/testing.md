# Testing Guide

This guide explains how to spin up the local environment and test the microservices using Docker Compose and curl.

## Prerequisites
- Docker & Docker Compose
- cURL installed on your machine

## 1. Start the Environment
Navigate to the root of the project (where `docker-compose.yml` is located) and run:
```bash
docker-compose up --build
```
This command builds the Node.js functions and starts Kong, PostgreSQL, Azurite, and the Service Bus Emulator.

> **Note:** Wait a moment for all containers, especially the Service Bus Emulator and Azure Functions, to initialize.

## 2. Test the API Endpoints

### A. Auth Service Test
Verify the auth service is running:
```bash
curl -X GET http://localhost:7071/api/auth/test
```
*Expected Output:* `{"message":"Auth service is running and connected to PostgreSQL","status":"success"}`

### B. Import Service Test (JSON)
Send a single JSON transaction to the import service:
```bash
curl -X POST http://localhost:7072/api/import \
  -H "Content-Type: application/json" \
  -d '{"amount": 150.50, "description": "Office Supplies"}'
```
*Expected Output:* `{"message":"Import initiated for 1 records.","count":1}`

### C. Import Service Test (CSV)
Send a CSV payload to the import service:
```bash
curl -X POST http://localhost:7072/api/import \
  -H "Content-Type: text/csv" \
  -d $'amount,description\n50.00,Coffee\n200.00,Software License'
```
*Expected Output:* `{"message":"Import initiated for 2 records.","count":2}`

### D. Export Service Test
Trigger an export job:
```bash
curl -X POST http://localhost:7073/api/export
```
*Expected Output:* `{"message":"Export process initiated."}`

## 3. Verify Background Processing
Check the docker-compose terminal output to see logs from:
1. `db-service` confirming it inserted records and generated the CSV.
2. `db-service` confirming it uploaded the CSV to Azurite blob storage.
3. `email-service` confirming it received the message and sent the email via Resend.
