pipeline {

    agent any

    options {
        timestamps()
        disableConcurrentBuilds()

        timeout(
            time: 60,
            unit: 'MINUTES'
        )
    }

    environment {
        IMAGE_NAME = 'goof'
    }

    stages {

        stage('Build') {

            steps {

                echo 'Building Docker image...'

                bat '''
                    docker build ^
                    -t %IMAGE_NAME%:%BUILD_NUMBER% .
                '''

                bat '''
                    docker image inspect ^
                    %IMAGE_NAME%:%BUILD_NUMBER%
                '''
            }
        }

        stage('Test') {

            steps {

                echo 'Running automated tests...'

                bat '''
                    docker run --rm ^
                    --entrypoint node ^
                    %IMAGE_NAME%:%BUILD_NUMBER% ^
                    --test tests/pipeline.test.js
                '''
            }
        }

        stage('Code Quality') {

            steps {

                withCredentials([
                    string(
                        credentialsId: 'SONAR_TOKEN',
                        variable: 'SONAR_TOKEN'
                    )
                ]) {

                    script {

                        def scannerHome = tool 'SonarScanner'

                        bat """
                            "${scannerHome}\\bin\\sonar-scanner.bat" ^
                            -Dsonar.token=%SONAR_TOKEN%
                        """
                    }
                }
            }
        }

        stage('Security') {

            steps {

                withCredentials([
                    string(
                        credentialsId: 'SNYK_TOKEN',
                        variable: 'SNYK_TOKEN'
                    )
                ]) {

                    script {

                        echo 'Running Snyk security scan...'

                        int result = bat(
                            returnStatus: true,

                            script: '''
                                npx snyk test ^
                                --severity-threshold=high ^
                                --json-file-output=snyk-report.json
                            '''
                        )

                        archiveArtifacts(
                            artifacts: 'snyk-report.json',
                            allowEmptyArchive: true
                        )

                        if (result != 0) {

                            unstable(
                                'Snyk found vulnerabilities. See the security report.'
                            )
                        }
                    }
                }
            }
        }

        stage('Deploy') {

            steps {

                echo 'Deploying to STAGING...'

                withEnv([
                    "APP_IMAGE=${env.IMAGE_NAME}:${env.BUILD_NUMBER}"
                ]) {

                    bat """
                        docker compose ^
                        -p goof-staging ^
                        down ^
                        --remove-orphans
                    """

                    bat """
                        docker compose ^
                        -p goof-staging ^
                        up -d
                    """
                }

                echo 'Checking staging...'

                powershell '''
                    $healthy = $false

                    for ($i = 0; $i -lt 12; $i++) {

                        try {

                            $response = Invoke-WebRequest `
                                -Uri "http://localhost:3001/" `
                                -UseBasicParsing `
                                -TimeoutSec 5

                            if (
                                $response.StatusCode -ge 200 -and
                                $response.StatusCode -lt 400
                            ) {

                                $healthy = $true

                                Write-Host "STAGING is healthy."

                                break
                            }

                        } catch {

                            Write-Host "Staging is not ready. Retrying..."

                            Start-Sleep -Seconds 5
                        }
                    }

                    if (-not $healthy) {

                        Write-Error "DEPLOY ALERT: Staging application is not responding."

                        throw "Staging application is not responding."
                    }
                '''
            }
        }

        stage('Release') {

            steps {

                echo 'Releasing tested image to PRODUCTION...'

                bat """
                    docker tag ^
                    %IMAGE_NAME%:%BUILD_NUMBER% ^
                    %IMAGE_NAME%:production
                """

                echo 'Stopping staging environment...'

                bat """
                    docker compose ^
                    -p goof-staging ^
                    down ^
                    --remove-orphans
                """

                withEnv([
                    "APP_IMAGE=${env.IMAGE_NAME}:production"
                ]) {

                    echo 'Stopping previous production environment...'

                    bat """
                        docker compose ^
                        -p goof-production ^
                        down ^
                        --remove-orphans
                    """

                    echo 'Starting production environment...'

                    bat """
                        docker compose ^
                        -p goof-production ^
                        up -d
                    """
                }

                echo 'Production release completed.'
            }
        }

        stage('Monitoring') {

            steps {

                echo 'Monitoring production application...'

                powershell '''
                    $healthy = $false

                    for ($i = 0; $i -lt 12; $i++) {

                        try {

                            $response = Invoke-WebRequest `
                                -Uri "http://localhost:3001/" `
                                -UseBasicParsing `
                                -TimeoutSec 5

                            if (
                                $response.StatusCode -ge 200 -and
                                $response.StatusCode -lt 400
                            ) {

                                $healthy = $true

                                Write-Host "MONITORING: Production application is healthy."

                                break
                            }

                        } catch {

                            Write-Host "MONITORING: Production check failed. Retrying..."

                            Start-Sleep -Seconds 5
                        }
                    }

                    if (-not $healthy) {

                        Write-Error "MONITORING ALERT: Production application is DOWN."

                        throw "Production monitoring check failed."
                    }

                    Write-Host "MONITORING: Production application is healthy."
                '''
            }
        }
    }

    post {

        success {

            echo 'All 7 DevOps stages completed successfully.'
            echo 'Production monitoring check passed.'
        }

        unstable {

            echo 'SECURITY ALERT: Snyk found vulnerabilities.'
            echo 'Review the archived snyk-report.json file.'
        }

        failure {

            echo 'PIPELINE ALERT: DevSecOps pipeline failed.'
            echo 'Check the failed stage and Jenkins console log.'
        }

        always {

            archiveArtifacts(
                artifacts: 'snyk-report.json',
                allowEmptyArchive: true
            )
        }
    }
}