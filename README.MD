# CI/CD Lab

This repository contains the code for the CI/CD lab. The goal of this lab is to create a simple app and set up a CI/CD pipeline for it.

**Simple Inventory Management System**

# Business Logic

- Authentication: user registration, login, JWT token issuance.
- Order: create order
- Inventory: used by Order service to check stock and update inventory, not exposed externally
- Email: sends order confirmation

# Technical Details

1. Microservices

- Each service has its own codebase.
- One database per service, if required (instead of a shared database).
- Services communicate via Message Queue (RabbitMQ).

2. Containerization

- Each service is containerized with Docker.
- Deployed as Kubernetes pods in production.

# Problems

1. Zero Trust

- Implementing strict access controls between services.
- Using mutual TLS for service-to-service communication.

# Tech Stack

1. App

The app follows a microservices architecture, and each service introduces a different tech stack.

- Node.js

2. CI/CD

- Jenkins
- Argo CD

3. Infrastructure

- Terraform
- Ansible
- Azure

# Project Structure

- `app/`: the app and its services.
- `docs/`: documentation, including requirements and design decisions.
- `infra/`: infrastructure code, such as Terraform configurations.
- `config/`: configuration files for CI/CD pipelines and other tools.
- `scripts/`: deployment, testing, and other automation tasks.
