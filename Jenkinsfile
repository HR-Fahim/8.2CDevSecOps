pipeline {
    agent any

    options {
        timestamps()
        disableConcurrentBuilds()
        timeout(time: 60, unit: 'MINUTES')
    }

    environment {
        IMAGE_NAME = 'goof'
    }

    stages {
        stage('Build') {
            steps {
                echo 'Building Docker image with the Jenkins build number...'
                bat 'docker build -t %IMAGE_NAME%:%BUILD_NUMBER% .'
                bat 'docker image inspect %IMAGE_NAME%:%BUILD_NUMBER%'
            }
        }

        stage('Test') {
            steps {
                echo 'Running automated unit tests and creating an LCOV coverage report...'
                powershell '''
                    $containerName = "goof-test-$env:BUILD_NUMBER"
                    docker rm -f $containerName 2>$null | Out-Null

                    docker create --name $containerName --entrypoint npm "goof:$env:BUILD_NUMBER" run test:coverage
                    if ($LASTEXITCODE -ne 0) { throw 'Could not create the test container.' }

                    docker start -a $containerName
                    $testExitCode = $LASTEXITCODE

                    if ($testExitCode -eq 0) {
                        if (Test-Path 'coverage') { Remove-Item 'coverage' -Recurse -Force }
                        docker cp "${containerName}:/usr/src/goof/coverage" 'coverage'
                        if ($LASTEXITCODE -ne 0) { docker rm -f $containerName | Out-Null; throw 'Could not copy coverage report from the test container.' }
                    }

                    docker rm -f $containerName | Out-Null
                    if ($testExitCode -ne 0) { throw "Automated tests failed with exit code $testExitCode." }
                '''
                archiveArtifacts artifacts: 'coverage/lcov.info', allowEmptyArchive: false
            }
        }

        stage('Code Quality') {
            steps {
                withCredentials([string(credentialsId: 'SONAR_TOKEN', variable: 'SONAR_TOKEN')]) {
                    script {
                        def scannerHome = tool 'SonarScanner'
                        bat "\"${scannerHome}\\bin\\sonar-scanner.bat\" -Dsonar.token=%SONAR_TOKEN% -Dsonar.qualitygate.wait=true -Dsonar.qualitygate.timeout=600"
                    }
                }
            }
        }

        stage('Security') {
            steps {
                withCredentials([string(credentialsId: 'SNYK_TOKEN', variable: 'SNYK_TOKEN')]) {
                    script {
                        echo 'Running Snyk scan; high and critical findings fail this stage.'
                        int result = bat(returnStatus: true, script: 'npx --yes snyk test --severity-threshold=high --json-file-output=snyk-report.json')
                        archiveArtifacts artifacts: 'snyk-report.json', allowEmptyArchive: true
                        if (result != 0) {
                            error('Snyk scan failed or found high/critical vulnerabilities. Review snyk-report.json; deployment has been blocked.')
                        }
                    }
                }
            }
        }

        stage('Deploy') {
            steps {
                echo 'Deploying the build to STAGING on port 3001...'
                withCredentials([string(credentialsId: 'SESSION_SECRET', variable: 'SESSION_SECRET')]) {
                    withEnv([
                        "APP_IMAGE=${env.IMAGE_NAME}:${env.BUILD_NUMBER}",
                        'APP_PORT=3001',
                        'DEBUG_PORT=9229'
                    ]) {
                        bat 'docker compose -p goof-staging down --remove-orphans'
                        bat 'docker compose -p goof-staging up -d'
                    }
                }

                powershell '''
                    $healthy = $false
                    for ($i = 0; $i -lt 12; $i++) {
                        try {
                            $response = Invoke-WebRequest -Uri 'http://localhost:3001/' -UseBasicParsing -TimeoutSec 5
                            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) {
                                $healthy = $true
                                Write-Host 'STAGING is healthy.'
                                break
                            }
                        } catch {
                            Write-Host 'Staging is not ready; retrying...'
                            Start-Sleep -Seconds 5
                        }
                    }
                    if (-not $healthy) { throw 'Staging health check failed; release blocked.' }
                '''
            }
        }

        stage('Release') {
            steps {
                echo 'Tagging the tested image with a versioned release tag...'
                bat 'docker tag %IMAGE_NAME%:%BUILD_NUMBER% %IMAGE_NAME%:release-%BUILD_NUMBER%'
                bat 'docker tag %IMAGE_NAME%:%BUILD_NUMBER% %IMAGE_NAME%:production'

                echo 'Stopping staging before switching production to port 3002...'
                bat 'docker compose -p goof-staging down --remove-orphans'

                withCredentials([string(credentialsId: 'SESSION_SECRET', variable: 'SESSION_SECRET')]) {
                    withEnv([
                        "APP_IMAGE=${env.IMAGE_NAME}:release-${env.BUILD_NUMBER}",
                        'APP_PORT=3002',
                        'DEBUG_PORT=9230'
                    ]) {
                        bat 'docker compose -p goof-production down --remove-orphans'
                        bat 'docker compose -p goof-production up -d'
                    }
                }
            }
        }

        stage('Monitoring') {
            steps {
                echo 'Starting Uptime Kuma and checking the production endpoint...'
                bat 'docker compose -p goof-monitoring -f monitoring-compose.yml up -d'
                powershell '''
                    $healthy = $false
                    for ($i = 0; $i -lt 12; $i++) {
                        try {
                            $response = Invoke-WebRequest -Uri 'http://localhost:3002/' -UseBasicParsing -TimeoutSec 5
                            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) {
                                $healthy = $true
                                Write-Host 'MONITORING: Production application is healthy on port 3002.'
                                break
                            }
                        } catch {
                            Write-Host 'Production is not ready; retrying...'
                            Start-Sleep -Seconds 5
                        }
                    }
                    if (-not $healthy) { throw 'Production monitoring health check failed.' }
                '''
            }
        }
    }

    post {
        success {
            echo 'All seven pipeline stages completed successfully.'
        }
        failure {
            echo 'DevSecOps pipeline failed. Review the failed stage and Jenkins console output.'
        }
        always {
            archiveArtifacts artifacts: 'snyk-report.json', allowEmptyArchive: true
        }
    }
}
