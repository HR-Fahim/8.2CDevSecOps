### SIT753: Professional Practice in IT and Task 7.3HD: DevSecOps Pipeline

This project implements a **Jenkins-based DevSecOps pipeline** for the Node.js Goof application.

## Pipeline Stages

1. **Build** – Builds and verifies the Docker image.
2. **Test** – Runs automated Node.js tests.
3. **Code Quality** – Performs static code analysis using **SonarCloud**.
4. **Security** – Scans dependencies using **Snyk** and archives the security report.
5. **Deploy** – Deploys the application to a **Docker Compose staging environment** and performs a health check.
6. **Release** – Promotes the tested image to the **production environment**.
7. **Monitoring** – Checks production application availability and reports failures.

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
