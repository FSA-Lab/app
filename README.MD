# CI/CD Lab

This repository contains the code for the CI/CD lab. The goal of this lab is to create a simple app and set up a CI/CD pipeline for it.

**Simple Inventory Management System**

# Business Logic

- JWT authentication for all services.
- Import single or multiple transactions from CSV file.
- Export transactions to CSV file.
- Send email notifications to users when their transactions are exported or on error.

# Technical Details

1. Microservices

- Each service has its own codebase.

2. Containerization

- Each service is containerized with Docker.

# Problems

# Tech Stack

1. App

The app follows a microservices architecture, and each service introduces a different tech stack.

deploy as serverless function

2. CI/CD

- GitHub Actions
- Jenkins
- SonarQube
- Trivy

3. Infrastructure

- Terraform
- Azure CLI

# Project Structure

- `services/`: the app and its services.
- `docs/`: documentation, including requirements and design decisions.