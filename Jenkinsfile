pipeline {
    agent any

    options {
        timestamps()
        disableConcurrentBuilds()
        timeout(time: 60, unit: 'MINUTES')
    }

    environment {
        IMAGE_NAME = 'goof'
        BUILD_OK = 'false'
        TESTS_OK = 'false'
        SONAR_OK = 'false'
        SNYK_OK = 'false'
        STAGING_OK = 'false'
        RELEASE_OK = 'false'
        MONITORING_OK = 'false'
    }

    stages {
        stage('Docker Diagnostics') {
            steps {
                script {
                    echo 'Diagnostics are informational and will not stop later stages.'
                    bat(returnStatus: true, script: 'whoami')
                    bat(returnStatus: true, script: 'docker version')
                    bat(returnStatus: true, script: 'docker info')
                    bat(returnStatus: true, script: 'docker image inspect node:18.13.0')
                }
            }
        }

        stage('Build') {
            steps {
                script {
                    echo "Building ${env.IMAGE_NAME}:${env.BUILD_NUMBER}..."
                    int buildResult = bat(returnStatus: true, script: 'docker build -t %IMAGE_NAME%:%BUILD_NUMBER% .')
                    if (buildResult == 0) {
                        int inspectResult = bat(returnStatus: true, script: 'docker image inspect %IMAGE_NAME%:%BUILD_NUMBER%')
                        env.BUILD_OK = inspectResult == 0 ? 'true' : 'false'
                    }
                    echo "BUILD_OK=${env.BUILD_OK}"
                }
            }
        }

        stage('Test') {
            steps {
                script {
                    if (env.BUILD_OK == 'true') {
                        echo 'Running unit tests and generating LCOV coverage. Test failures are recorded so later diagnostic stages can run.'
                        int testResult = powershell(returnStatus: true, script: '''
                            $containerName = "goof-test-$env:BUILD_NUMBER"
                            docker rm -f $containerName 2>$null | Out-Null

                            docker create --name $containerName --entrypoint npm "goof:$env:BUILD_NUMBER" run test:coverage | Out-Null
                            if ($LASTEXITCODE -ne 0) {
                                Write-Host 'TEST RESULT: FAILED - could not create test container.'
                                exit 1
                            }

                            docker start -a $containerName
                            $testExitCode = $LASTEXITCODE

                            if (Test-Path 'coverage') { Remove-Item 'coverage' -Recurse -Force }
                            docker cp "${containerName}:/usr/src/goof/coverage" 'coverage'
                            $copyExitCode = $LASTEXITCODE
                            docker rm -f $containerName | Out-Null

                            if ($testExitCode -ne 0) {
                                Write-Host "TEST RESULT: FAILED (exit code $testExitCode)."
                                exit 1
                            }
                            if ($copyExitCode -ne 0) {
                                Write-Host 'Tests passed, but coverage could not be copied.'
                                exit 1
                            }
                            Write-Host 'TEST RESULT: PASSED.'
                            exit 0
                        ''')
                        env.TESTS_OK = testResult == 0 ? 'true' : 'false'
                    } else {
                        echo 'Tests cannot run because the Docker image build failed.'
                        env.TESTS_OK = 'false'
                    }
                    echo "TESTS_OK=${env.TESTS_OK}"
                }
            }
            post {
                always {
                    archiveArtifacts artifacts: 'coverage/**', allowEmptyArchive: true
                }
            }
        }

        stage('Code Quality') {
            steps {
                script {
                    try {
                        withCredentials([string(credentialsId: 'SONAR_TOKEN', variable: 'SONAR_TOKEN')]) {
                            def scannerHome = tool 'SonarScanner'
                            int sonarResult = bat(returnStatus: true, script: "\"${scannerHome}\\bin\\sonar-scanner.bat\" -Dsonar.token=%SONAR_TOKEN% -Dsonar.qualitygate.wait=true -Dsonar.qualitygate.timeout=600")
                            env.SONAR_OK = sonarResult == 0 ? 'true' : 'false'
                        }
                    } catch (err) {
                        env.SONAR_OK = 'false'
                        echo "SonarCloud could not complete: ${err.getMessage()}"
                    }
                    echo "SONAR_OK=${env.SONAR_OK}. A failed quality gate is recorded; later stages will still run."
                }
            }
        }

        stage('Security') {
            steps {
                script {
                    try {
                        withCredentials([string(credentialsId: 'SNYK_TOKEN', variable: 'SNYK_TOKEN')]) {
                            echo 'Running Snyk. High/critical findings, authentication errors, and scan errors all fail this gate.'
                            int snykResult = bat(returnStatus: true, script: 'npx --yes snyk test --severity-threshold=high --json-file-output=snyk-report.json')
                            env.SNYK_OK = snykResult == 0 ? 'true' : 'false'
                        }
                    } catch (err) {
                        env.SNYK_OK = 'false'
                        echo "Snyk could not complete: ${err.getMessage()}"
                    }
                    echo "SNYK_OK=${env.SNYK_OK}"
                }
            }
            post {
                always {
                    archiveArtifacts artifacts: 'snyk-report.json', allowEmptyArchive: true
                }
            }
        }

        stage('Deploy to Staging') {
            steps {
                script {
                    if (env.BUILD_OK == 'true') {
                        try {
                            int deployResult = -1
                            withCredentials([string(credentialsId: 'SESSION_SECRET', variable: 'SESSION_SECRET')]) {
                                withEnv(["APP_IMAGE=${env.IMAGE_NAME}:${env.BUILD_NUMBER}", 'APP_PORT=3001']) {
                                    bat(returnStatus: true, script: 'docker compose -p goof-staging down --remove-orphans')
                                    deployResult = bat(returnStatus: true, script: 'docker compose -p goof-staging up -d')
                                }
                            }
                            if (deployResult == 0) {
                                int healthResult = powershell(returnStatus: true, script: '''
                                    $healthy = $false
                                    for ($i = 0; $i -lt 12; $i++) {
                                        try {
                                            $response = Invoke-WebRequest -Uri 'http://localhost:3001/' -UseBasicParsing -TimeoutSec 5
                                            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) {
                                                $healthy = $true
                                                Write-Host 'STAGING HEALTH CHECK: PASSED on port 3001.'
                                                break
                                            }
                                        } catch {
                                            Write-Host 'Staging is not ready; retrying in 5 seconds...'
                                            Start-Sleep -Seconds 5
                                        }
                                    }
                                    if (-not $healthy) { Write-Host 'STAGING HEALTH CHECK: FAILED.'; exit 1 }
                                    exit 0
                                ''')
                                env.STAGING_OK = healthResult == 0 ? 'true' : 'false'
                            } else {
                                env.STAGING_OK = 'false'
                                echo 'Staging Compose deployment failed.'
                            }
                        } catch (err) {
                            env.STAGING_OK = 'false'
                            echo "Staging deployment error: ${err.getMessage()}"
                        }
                    } else {
                        env.STAGING_OK = 'false'
                        echo 'Staging deployment skipped because the image build failed.'
                    }
                    echo "STAGING_OK=${env.STAGING_OK}"
                }
            }
        }

        stage('Release to Production') {
            steps {
                script {
                    boolean gatesPassed = env.BUILD_OK == 'true' && env.TESTS_OK == 'true' && env.SONAR_OK == 'true' && env.SNYK_OK == 'true' && env.STAGING_OK == 'true'
                    if (!gatesPassed) {
                        env.RELEASE_OK = 'false'
                        echo 'PRODUCTION RELEASE BLOCKED: Build, tests, SonarCloud, Snyk, and staging health must all pass.'
                    } else {
                        try {
                            int tagResult = bat(returnStatus: true, script: 'docker tag %IMAGE_NAME%:%BUILD_NUMBER% %IMAGE_NAME%:release-%BUILD_NUMBER%')
                            if (tagResult == 0) {
                                int deployResult = -1
                                withCredentials([string(credentialsId: 'SESSION_SECRET', variable: 'SESSION_SECRET')]) {
                                    withEnv(["APP_IMAGE=${env.IMAGE_NAME}:release-${env.BUILD_NUMBER}", 'APP_PORT=3002']) {
                                        // Keep staging running on 3001; production uses a separate project and port.
                                        deployResult = bat(returnStatus: true, script: 'docker compose -p goof-production up -d')
                                    }
                                }
                                if (deployResult == 0) {
                                    int healthResult = powershell(returnStatus: true, script: '''
                                        $healthy = $false
                                        for ($i = 0; $i -lt 12; $i++) {
                                            try {
                                                $response = Invoke-WebRequest -Uri 'http://localhost:3002/' -UseBasicParsing -TimeoutSec 5
                                                if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) {
                                                    $healthy = $true
                                                    Write-Host 'PRODUCTION HEALTH CHECK: PASSED on port 3002.'
                                                    break
                                                }
                                            } catch {
                                                Write-Host 'Production is not ready; retrying in 5 seconds...'
                                                Start-Sleep -Seconds 5
                                            }
                                        }
                                        if (-not $healthy) { Write-Host 'PRODUCTION HEALTH CHECK: FAILED.'; exit 1 }
                                        exit 0
                                    ''')
                                    env.RELEASE_OK = healthResult == 0 ? 'true' : 'false'
                                } else {
                                    env.RELEASE_OK = 'false'
                                    echo 'Production Compose deployment failed.'
                                }
                            } else {
                                env.RELEASE_OK = 'false'
                                echo 'Could not create the versioned Docker release tag.'
                            }
                        } catch (err) {
                            env.RELEASE_OK = 'false'
                            echo "Production release error: ${err.getMessage()}"
                        }
                    }
                    echo "RELEASE_OK=${env.RELEASE_OK}"
                }
            }
        }

        stage('Monitoring') {
            steps {
                script {
                    try {
                        int kumaResult = bat(returnStatus: true, script: 'docker compose -p goof-monitoring -f monitoring-compose.yml up -d')
                        if (kumaResult != 0) {
                            env.MONITORING_OK = 'false'
                            echo 'Uptime Kuma failed to start.'
                        } else {
                            String targetPort = env.RELEASE_OK == 'true' ? '3002' : (env.STAGING_OK == 'true' ? '3001' : '')
                            if (targetPort == '') {
                                env.MONITORING_OK = 'false'
                                echo 'No healthy application deployment is available to monitor.'
                            } else {
                                int healthResult = powershell(returnStatus: true, script: '''
                                    $healthy = $false
                                    for ($i = 0; $i -lt 12; $i++) {
                                        try {
                                            $response = Invoke-WebRequest -Uri 'http://localhost:PORT/' -UseBasicParsing -TimeoutSec 5
                                            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) {
                                                $healthy = $true
                                                Write-Host 'MONITORING HEALTH CHECK: PASSED.'
                                                break
                                            }
                                        } catch {
                                            Write-Host 'Application is not ready; retrying in 5 seconds...'
                                            Start-Sleep -Seconds 5
                                        }
                                    }
                                    if (-not $healthy) { Write-Host 'MONITORING HEALTH CHECK: FAILED.'; exit 1 }
                                    exit 0
                                '''.replace('PORT', targetPort))
                                env.MONITORING_OK = healthResult == 0 ? 'true' : 'false'
                            }
                        }
                    } catch (err) {
                        env.MONITORING_OK = 'false'
                        echo "Monitoring error: ${err.getMessage()}"
                    }
                    echo "MONITORING_OK=${env.MONITORING_OK}"
                    echo 'Uptime Kuma dashboard: http://localhost:3003. Configure an HTTP(s) monitor for the deployed app and configure notification delivery in the Uptime Kuma UI to enable alerts.'
                }
            }
        }

        stage('Final Pipeline Gate') {
            steps {
                script {
                    def failedChecks = []
                    if (env.BUILD_OK != 'true') failedChecks << 'Docker build'
                    if (env.TESTS_OK != 'true') failedChecks << 'automated tests/coverage'
                    if (env.SONAR_OK != 'true') failedChecks << 'SonarCloud quality gate'
                    if (env.SNYK_OK != 'true') failedChecks << 'Snyk security scan'
                    if (env.STAGING_OK != 'true') failedChecks << 'staging deployment/health check'
                    if (env.RELEASE_OK != 'true') failedChecks << 'production release (blocked or unhealthy)'
                    if (env.MONITORING_OK != 'true') failedChecks << 'monitoring/application health check'

                    if (failedChecks) {
                        echo "FINAL RESULT: FAILURE. Failed or blocked checks: ${failedChecks.join(', ')}"
                        error('One or more required DevSecOps gates failed. All diagnostic stages have run; production was blocked when release gates did not pass.')
                    }
                    echo 'FINAL RESULT: SUCCESS. All required gates passed and production is healthy.'
                }
            }
        }
    }

    post {
        success {
            echo 'All stages completed and all required gates passed.'
        }
        failure {
            echo 'Pipeline completed its diagnostic stages but one or more required gates failed. Review stage logs and archived reports; do not treat this build as a successful release.'
        }
        always {
            archiveArtifacts artifacts: 'snyk-report.json,coverage/**', allowEmptyArchive: true
        }
    }
}
