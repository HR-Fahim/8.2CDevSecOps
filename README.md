### SIT753: Professional Practice in IT and Task 7.3HD: DevSecOps Pipeline

This project implements a **Jenkins-based DevSecOps pipeline** for the Node.js Goof application.

## Pipeline Stages

1. **Build** – Builds and verifies the Docker image.
2. **Test** – Runs automated Node.js tests and publishes LCOV coverage.
3. **Code Quality** – Performs static code analysis using **SonarCloud** and waits for the quality gate.
4. **Security** – Scans dependencies using **Snyk** and fails the gate for high or critical vulnerabilities.
5. **Deploy** – Deploys the application to a **Docker Compose staging environment** on port `3001` and performs a health check.
6. **Release** – Promotes the tested image to a versioned `release-$BUILD_NUMBER` production image on port `3002`.
7. **Monitoring** – Starts **Uptime Kuma** on port `3003` for application monitoring and alert configuration.

## Technologies

* Jenkins
* Docker & Docker Compose
* Node.js
* SonarCloud
* Snyk
* GitHub

## DevSecOps Implementation

The pipeline automates **build, testing, code quality analysis, security scanning, staging deployment, production release, and monitoring** through Jenkins.

Security findings are reported by Snyk and archived as `snyk-report.json` for review and remediation documentation.

## Coverage Verification

Run `npm run test:coverage` to test TODO operations, login validation and redirects,
account details, text/ZIP imports, chat permissions, users, and utilities. The
database boundary is mocked; these tests do not require a running MongoDB server.
The command includes untested route files and enforces at least 80% line, branch,
function, and statement coverage for routes and utilities. It generates
`coverage/lcov.info` and a readable report at `coverage/lcov-report/index.html`.

Jenkins initializes mutable gate flags in a script so successful stages can update
them. SonarCloud runs only after passing tests and generation of the current
build's LCOV report. Commit and push the changes, then rerun Jenkins to update
SonarCloud; a local coverage result does not confirm the hosted quality gate.

## Resubmission Evidence Checklist

Show these in the updated video/report:

* Jenkins Build stage: image tag `goof:$BUILD_NUMBER`, non-root Dockerfile, and Docker `HEALTHCHECK`.
* Jenkins Test stage: console test output and archived `coverage/lcov.info`.
* SonarCloud stage: quality gate result. A failed gate blocks production release.
* Snyk stage: `snyk-report.json` artifact. High/critical vulnerabilities fail the pipeline.
* Staging: app running at `http://localhost:3001/`.
* Production: app running at `http://localhost:3002/` only after all gates pass, using the versioned Docker tag.
* Monitoring: Uptime Kuma dashboard at `http://localhost:3003/` with an HTTP monitor for the deployed app and a notification channel configured for alerts.
