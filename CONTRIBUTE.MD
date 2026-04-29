# Project Contributing Guide

This document outlines the guidelines for contributing to the CI/CD Lab project.

## Git Workflow

- Branch strategy:
  - Use `main` for tracking releases.
  - Use `test` for testing and running pipelines.
  - Use `prod` for production-ready code.
  - Use `dev` for ongoing development.
  - Code flow: `dev` → `test` → `main` → `prod`.
  - Feature branches must be created from `dev` and named `feature/<feature-name>`. Feature names must be in lowercase and use hyphens to separate words (e.g., `feature/add-auth-service`).

- Pull Requests (PRs):
  - PRs must be created from a feature branch to `dev`.
  - PRs must include a clear description of the changes made and the reason for the changes.
  - PRs must be reviewed and approved by at least one other team member before merging.
  - PRs must pass all CI/CD pipeline checks before merging. See the CI/CD section below for details on the required checks.
  - PRs can be created early in the development process, but they must be synced with the latest changes in `dev` to avoid merge conflicts.

# Roles

The project team consists of 4 members, each responsible for different aspects of the project. However, all members should have a good understanding of the entire project and be able to contribute to any part of it when needed.

Under each role below, tasks are divided into multiple parallel tracks. Each track can be worked on independently by each team member.

## Track 0: Project Setup

For this track only, a single team member will be responsible for setting up the initial project, including:

- Project structure
- Initial configurations: Git, Terraform, CI/CD pipelines, etc.
- Conduct a meeting to vote for the tech stack

## Track 1: App Development

- Design services: each team member handles the design of one or more services from auth, order, inventory, and email.
- Implement services: each team member implements the services they designed, ensuring they meet the requirements and integrate well with other services.
- Write tests: each team member writes unit and integration tests for their services.

## Track 2: CI/CD Pipeline

- Set up CI/CD pipelines:
  - Pre-build: linting, static code analysis, testing
  - Build: building Docker images, pushing to registry
  - Post-build: vulnerability scanning (Trivy\*)
  <!-- - Post-build: deployment -->

> \* Trivy is also used as a live scanning operator in the cluster, but it can also be used in the CI/CD pipeline to scan images before deployment.

## Track 3: Infrastructure

- Setup repositories for app and infrastructure code.
- Setup Azure Kubernetes Service (AKS) pods using Terraform:
  - Message Queue (RabbitMQ)
  - Databases for each service
  - Monitoring tools (Grafana, Loki, Prometheus, Jaeger, ...)
  - mTLS: Envoy & sidecar injection
  - Jenkins
  - SonarQube (on different region)
  - Trivy (operator): live scanning of cluster images

## Track 4: Monitoring (\*\*)

- Grafana: set up dashboards for monitoring the app and infrastructure.
- Loki: set up log aggregation for the app and infrastructure.
- Prometheus: set up metrics collection for the app and infrastructure.
- Jaeger: set up distributed tracing for the app.
- Set up alerts and notifications for critical issues.

> Ensure each service has its own monitoring and alerting setup (e.g. via agent/lib) to instrument the service and send metrics/logs/traces to the monitoring stack.

> \*\* Team members are responsible for monitoring their services. This does not apply to infrastructure monitoring.
