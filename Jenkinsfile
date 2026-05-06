// Required Jenkins credentials:
//   GHCR_TOKEN       — GitHub PAT (write:packages scope)
//   AZURE_SP         — Azure service principal (username=clientId, password=clientSecret)
//
// Required Jenkins global env vars (Manage Jenkins > System > Global properties):
//   AZURE_TENANT_ID, AZURE_SUBSCRIPTION_ID, AZURE_RG
//   FUNC_AUTH, FUNC_IMPORT, FUNC_EXPORT, FUNC_DB, FUNC_EMAIL  (Function App names)

pipeline {
    agent { label 'jenkins-agent' }

    environment {
        REGISTRY = 'ghcr.io/fsa-lab'
    }

    options {
        timeout(time: 30, unit: 'MINUTES')
        buildDiscarder(logRotator(numToKeepStr: '20'))
        disableConcurrentBuilds()
    }

    stages {
        stage('Init') {
            steps {
                script {
                    env.SHORT_SHA = sh(script: 'git rev-parse --short HEAD', returnStdout: true).trim()
                    env.IMAGE_TAG = "${env.BRANCH_NAME}-${env.SHORT_SHA}"

                    def base    = env.BRANCH_NAME == 'main' ? 'HEAD~1' : 'origin/main'
                    def changed = sh(script: "git diff --name-only ${base}...HEAD", returnStdout: true).trim()

                    env.BUILD_AUTH   = changed.contains('auth/')       ? 'true' : 'false'
                    env.BUILD_IMPORT = changed.contains('import/')     ? 'true' : 'false'
                    env.BUILD_EXPORT = changed.contains('export/')     ? 'true' : 'false'
                    env.BUILD_DB     = changed.contains('db-service/') ? 'true' : 'false'
                    env.BUILD_EMAIL  = changed.contains('email/')      ? 'true' : 'false'

                    echo "Branch: ${env.BRANCH_NAME} | Tag: ${env.IMAGE_TAG}"
                    echo "Changed → auth:${env.BUILD_AUTH} import:${env.BUILD_IMPORT} export:${env.BUILD_EXPORT} db:${env.BUILD_DB} email:${env.BUILD_EMAIL}"
                }
            }
        }

        stage('Install') {
            steps {
                sh 'npm ci'
                sh 'for svc in auth import export db-service email; do (cd $svc && npm ci) || exit 1; done'
            }
        }

        stage('Lint') {
            steps {
                sh 'npm run lint'
                sh 'npm run format:check'
            }
        }

        stage('Type Check') {
            parallel {
                stage('auth')       { when { environment name: 'BUILD_AUTH',   value: 'true' }; steps { dir('auth')       { sh 'npm run test:typecheck' } } }
                stage('import')     { when { environment name: 'BUILD_IMPORT', value: 'true' }; steps { dir('import')     { sh 'npm run test:typecheck' } } }
                stage('export')     { when { environment name: 'BUILD_EXPORT', value: 'true' }; steps { dir('export')     { sh 'npm run test:typecheck' } } }
                stage('db-service') { when { environment name: 'BUILD_DB',     value: 'true' }; steps { dir('db-service') { sh 'npm run test:typecheck' } } }
                stage('email')      { when { environment name: 'BUILD_EMAIL',  value: 'true' }; steps { dir('email')      { sh 'npm run test:typecheck' } } }
            }
        }

        stage('Unit Tests') {
            parallel {
                stage('auth')       { when { environment name: 'BUILD_AUTH',   value: 'true' }; steps { dir('auth')       { sh 'npm test' } } }
                stage('import')     { when { environment name: 'BUILD_IMPORT', value: 'true' }; steps { dir('import')     { sh 'npm test' } } }
                stage('export')     { when { environment name: 'BUILD_EXPORT', value: 'true' }; steps { dir('export')     { sh 'npm test' } } }
                stage('db-service') { when { environment name: 'BUILD_DB',     value: 'true' }; steps { dir('db-service') { sh 'npm test' } } }
                stage('email')      { when { environment name: 'BUILD_EMAIL',  value: 'true' }; steps { dir('email')      { sh 'npm test' } } }
            }
        }

        stage('SonarQube') {
            steps {
                withSonarQubeEnv('sonarqube') {
                    sh 'sonar-scanner'
                }
            }
        }

        stage('Quality Gate') {
            steps {
                timeout(time: 5, unit: 'MINUTES') {
                    waitForQualityGate abortPipeline: true
                }
            }
        }

        stage('Docker Build') {
            parallel {
                stage('auth')       { when { environment name: 'BUILD_AUTH',   value: 'true' }; steps { sh "docker build -t ${REGISTRY}/auth:${env.IMAGE_TAG} ./auth" } }
                stage('import')     { when { environment name: 'BUILD_IMPORT', value: 'true' }; steps { sh "docker build -t ${REGISTRY}/import:${env.IMAGE_TAG} ./import" } }
                stage('export')     { when { environment name: 'BUILD_EXPORT', value: 'true' }; steps { sh "docker build -t ${REGISTRY}/export:${env.IMAGE_TAG} ./export" } }
                stage('db-service') { when { environment name: 'BUILD_DB',     value: 'true' }; steps { sh "docker build -t ${REGISTRY}/db-service:${env.IMAGE_TAG} ./db-service" } }
                stage('email')      { when { environment name: 'BUILD_EMAIL',  value: 'true' }; steps { sh "docker build -t ${REGISTRY}/email:${env.IMAGE_TAG} ./email" } }
            }
        }

        stage('Trivy Scan') {
            parallel {
                stage('auth')       { when { environment name: 'BUILD_AUTH',   value: 'true' }; steps { sh "trivy image --exit-code 1 --severity HIGH,CRITICAL --no-progress ${REGISTRY}/auth:${env.IMAGE_TAG}" } }
                stage('import')     { when { environment name: 'BUILD_IMPORT', value: 'true' }; steps { sh "trivy image --exit-code 1 --severity HIGH,CRITICAL --no-progress ${REGISTRY}/import:${env.IMAGE_TAG}" } }
                stage('export')     { when { environment name: 'BUILD_EXPORT', value: 'true' }; steps { sh "trivy image --exit-code 1 --severity HIGH,CRITICAL --no-progress ${REGISTRY}/export:${env.IMAGE_TAG}" } }
                stage('db-service') { when { environment name: 'BUILD_DB',     value: 'true' }; steps { sh "trivy image --exit-code 1 --severity HIGH,CRITICAL --no-progress ${REGISTRY}/db-service:${env.IMAGE_TAG}" } }
                stage('email')      { when { environment name: 'BUILD_EMAIL',  value: 'true' }; steps { sh "trivy image --exit-code 1 --severity HIGH,CRITICAL --no-progress ${REGISTRY}/email:${env.IMAGE_TAG}" } }
            }
        }

        stage('Push GHCR') {
            when { branch 'main' }
            steps {
                withCredentials([string(credentialsId: 'GHCR_TOKEN', variable: 'GHCR_TOKEN')]) {
                    sh 'echo $GHCR_TOKEN | docker login ghcr.io -u fsa-lab --password-stdin'
                    script {
                        [
                            [svc: 'auth',       flag: env.BUILD_AUTH],
                            [svc: 'import',     flag: env.BUILD_IMPORT],
                            [svc: 'export',     flag: env.BUILD_EXPORT],
                            [svc: 'db-service', flag: env.BUILD_DB],
                            [svc: 'email',      flag: env.BUILD_EMAIL],
                        ].findAll { it.flag == 'true' }.each { item ->
                            sh "docker push ${REGISTRY}/${item.svc}:${env.IMAGE_TAG}"
                        }
                    }
                }
            }
        }

        stage('Deploy') {
            when { branch 'main' }
            steps {
                withCredentials([
                    usernamePassword(credentialsId: 'AZURE_SP', usernameVariable: 'AZ_CLIENT_ID', passwordVariable: 'AZ_CLIENT_SECRET')
                ]) {
                    sh '''
                        az login --service-principal \
                          -u $AZ_CLIENT_ID -p $AZ_CLIENT_SECRET \
                          --tenant $AZURE_TENANT_ID
                        az account set --subscription $AZURE_SUBSCRIPTION_ID
                    '''
                    script {
                        [
                            [svc: 'auth',       flag: env.BUILD_AUTH,   app: env.FUNC_AUTH],
                            [svc: 'import',     flag: env.BUILD_IMPORT, app: env.FUNC_IMPORT],
                            [svc: 'export',     flag: env.BUILD_EXPORT, app: env.FUNC_EXPORT],
                            [svc: 'db-service', flag: env.BUILD_DB,     app: env.FUNC_DB],
                            [svc: 'email',      flag: env.BUILD_EMAIL,  app: env.FUNC_EMAIL],
                        ].findAll { it.flag == 'true' }.each { item ->
                            sh """
                                az functionapp config container set \
                                  --name ${item.app} \
                                  --resource-group ${env.AZURE_RG} \
                                  --image ${REGISTRY}/${item.svc}:${env.IMAGE_TAG}
                            """
                        }
                    }
                }
            }
        }
    }

    post {
        failure {
            echo "Pipeline failed — branch: ${env.BRANCH_NAME}, commit: ${env.SHORT_SHA}"
        }
        cleanup {
            sh 'docker image prune -f || true'
        }
    }
}
