# Assignment: Create CI/CD workflow proposal and POC

- Create a diagram to illustrate your CI/CD idea.
- Create slides to present your idea.
- Provide source code for applications (e.g., front-end application, back-end application) and infrastructure code.

# Objectives

- Motivate learners to combine their archived knowledge and set up their own Continuous Integration/Continuous Deployment (CI/CD) workflow, also known as a CI/CD pipeline; this can be a rewarding and educational experience.
- Learners will learn how to integrate components in a typical CI/CD pipeline to achieve the goals defined below.

# Problem Descriptions

Our project needs CI/CD pipelines: one for infrastructure (written in Terraform) and two for applications (front-end and back-end). The CI/CD pipeline(s) must be:

- Secure: no secret or value variables should appear in the CI/CD configuration.
- Fast: the CI/CD pipeline should be optimized for speed.
- Reusable: the CI/CD should be written as a template that can be reused.

The recommended tech stack (you may propose alternatives) includes:

- Git
- Terraform
- GitLab CI / Jenkins
- Ansible
- Docker
- Cloud providers: AWS, Azure, GCP
- Prometheus / Grafana or ELK

# Requirements

In this section we show options for each component (these are recommended; you can add more):

- The first option is the base—your lab must meet this base requirement.
- Other options are optional; the deeper you go, the harder it gets.
- You may propose alternatives, but they should be better than the base option.
- Everything should work (i.e., website, backend, database).
- Provide diagrams for the system you are building.
- Pipelines should handle update processes.
- You should be able to complete the basic option for every component.
- Any non-basic options are considered bonuses.

## Git

- One `master` branch
  ◦ Whenever you push new code to `master`, its pipeline should start immediately.
- Feature branches
  ◦ Feature branches should be checked out from `master` when developing a new feature.
  ◦ When a feature branch is pushed, its pipeline should not include the `release` stage; only the `master` pipeline has the `release` stage.

## Terraform

- Centralized configuration
  ◦ Everything can go into a single `main.tf` file.
- Basic module configuration
  ◦ Divide into modules; each module has its own responsibility (e.g., network).
  ◦ A module’s configs and values can be stored in the `main.tf` within the module’s folder.
- Not-so-basic configuration
  ◦ Divide into modules; each module has its own responsibility (e.g., network).
  ◦ A module’s configs and values can reference `var.value`, which is defined in the module’s `variables.tf` via the `default` option.
- Reusable format
  ◦ Similar to the not-so-basic configuration, but variables in the module’s `variables.tf` do not include `default`; instead, defaults are defined in the root `main.tf` that calls the modules.
  ◦ Module config values reference `var.value`, and these values are defined in a root `variables.tf` file (without defaults) outside the module folders.
  ◦ A `.tfvars` file (e.g., `something.tfvars`) will store the variable values defined in the root `variables.tf` file.

## GitLab CI / Jenkins

- Basic stages:
  ◦ Checkout source
  ◦ Build image from source code with Docker / Buildah
  ◦ Push to an image registry (e.g., Docker Hub, Harbor, JFrog, Nexus, …)
  ◦ Release (pull the latest image and perform deployment). This stage should not be active for feature branch pushes (only for `master`).
- Not-so-basic stages:

```
Basic stages:
1. Git & IDE
- GitHub, GitLab, Bitbucket, Azure DevOps, etc.
- Visual Studio Code, IntelliJ IDEA, Eclipse, etc.
2. Code Quality
- SonarQube, ESLint, Pylint, etc.
3. Build
- Docker, Buildah, Kaniko, etc.
- Maven, npm, pip, etc.
4. SAST (Static Application Security Testing), DAST (Dynamic Application Security Testing), and SCA (Software Composition Analysis)
- SAST: Checkmarx, Veracode, Fortify, etc.
- DAST: OWASP ZAP, Burp Suite, etc.
- SCA: Snyk, WhiteSource, etc.
5. Testing
- Unit Testing: JUnit, NUnit, etc.
- Integration Testing: Postman, SoapUI, etc.
- E2E Testing: Selenium, Cypress, etc.
- Performance / Load Testing: JMeter, Gatling, etc.
6. Deployment
- Kubernetes, Docker Swarm, AWS ECS, Azure AKS, GCP GKE, etc.
7. RASP (Runtime Application Self-Protection)
- Twistlock, Dynatrace, etc.
8. Monitoring and Logging
- Prometheus, Grafana, ELK Stack, etc.
```

- Contain all the basic stages
- Consider GitOps for deployments
- Enhanced integrations
  ▪ SonarQube for code quality scanning
  ▪ Trivy for image vulnerability scanning
  ▪ Unit tests and E2E testing
  ▪ Performance/load testing with JMeter/Gatling
- Final stage: add a `Tagging` stage (tag images using, for example, the commit ID), then notify admins via email or messaging (Telegram, Slack, etc.).

## Ansible

◦ All-in-one file configurations
◦ Use `roles` folders and a `group_vars` folder to store configurations and values.

## Docker

◦ Basic:
▪ Simple web image
▪ Web image with values that change based on the branch used to build the image
▪ Upload to Docker Hub
◦ Not-so-basic:
▪ Web application integrated with a back end
▪ Include a database when possible
▪ Upload to ECR or another native cloud registry

## Grafana

◦ Use the default dashboard provided
◦ Customize your own dashboard (with metrics you consider useful or meaningful)
◦ Add alerts and notifications to third-party applications (e.g., Gmail, Slack, Mattermost, Discord)

# Design requirements

- Infra diagram requirements:
  ◦ Applications and databases should be highly available (HA).
  ◦ Databases should be placed in a secure location.
  ◦ Provide a bastion/jump host to debug applications.
- Workflow diagram requirements:
  ◦ Separate the CI/CD workflows for infrastructure and for applications.
  ◦ Integrate notifications into CI/CD steps where appropriate.

# Sample design

Technical requirements:

- Linux
- AWS / Azure / GCP
- Docker / K8s
- Git
- Terraform
- Ansible
- Grafana / Prometheus
- GitLab CI / Jenkins

Questions to answer:
Estimated time to complete: 7 days
