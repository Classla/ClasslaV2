# Deployment Guide

This guide provides step-by-step instructions for deploying the Classla LMS infrastructure to AWS using Terraform.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Initialize Terraform Backend](#1-initialize-terraform-backend)
3. [Configure Secrets in AWS Secrets Manager](#2-configure-secrets-in-aws-secrets-manager)
4. [Configure Terraform Variables](#3-configure-terraform-variables)
5. [Deploy Infrastructure](#4-deploy-infrastructure)
6. [Deploy Backend Application](#5-deploy-backend-application)
7. [Configure Frontend Environment](#6-configure-frontend-environment)
8. [Verification Steps](#7-verification-steps)
9. [Troubleshooting](#troubleshooting)
10. [Rollback Procedures](#rollback-procedures)

---

## Prerequisites

Before starting deployment, ensure you have completed:

- ✅ AWS account setup (see [SETUP.md](./SETUP.md))
- ✅ AWS CLI installed and configured
- ✅ Terraform installed (version 1.5+)
- ✅ IAM user with required permissions
- ✅ GitHub repository access
- ✅ Supabase project created with credentials
- ✅ WorkOS account created with credentials

### Required Information Checklist

Gather the following information before proceeding:

| Item                         | Description                      | Example                             |
| ---------------------------- | -------------------------------- | ----------------------------------- |
| AWS Region                   | Target AWS region                | `us-east-1`                         |
| Supabase URL                 | Your Supabase project URL        | `https://xxx.supabase.co`           |
| Supabase Anon Key            | Public anonymous key             | `eyJhbGc...`                        |
| Supabase Service Role Key    | Service role key (keep secret)   | `eyJhbGc...`                        |
| WorkOS API Key               | WorkOS API key                   | `sk_live_...`                       |
| WorkOS Client ID             | WorkOS client ID                 | `client_...`                        |
| Session Secret               | Random string for sessions       | Generate: `openssl rand -base64 32` |
| GitHub Repository            | Full repository name             | `your-org/classla-lms`              |
| GitHub Personal Access Token | For Amplify (if using Terraform) | `ghp_...`                           |
| Domain Name (optional)       | Custom domain for application    | `classla.yourdomain.com`            |

---

## 1. Initialize Terraform Backend

The Terraform backend stores infrastructure state in S3 with DynamoDB for state locking. This must be set up before deploying infrastructure.

### 1.1 Review Backend Configuration

The backend configuration is defined in `infrastructure/terraform/backend.tf`:

```hcl
terraform {
  backend "s3" {
    bucket         = "classla-terraform-state"
    key            = "infrastructure/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "classla-terraform-locks"
  }
}
```

### 1.2 Run Initialization Script

We provide a script to create the S3 bucket and DynamoDB table:

```bash
# Navigate to scripts directory
cd infrastructure/scripts

# Make script executable (if not already)
chmod +x init-terraform.sh

# Run initialization script
./init-terraform.sh
```

The script will:

- Create S3 bucket `classla-terraform-state` with versioning and encryption
- Create DynamoDB table `classla-terraform-locks` for state locking
- Configure bucket policies for security

### 1.3 Verify Backend Resources

Verify the resources were created:

```bash
# Check S3 bucket
aws s3 ls | grep classla-terraform-state

# Check DynamoDB table
aws dynamodb describe-table --table-name classla-terraform-locks --query 'Table.TableStatus'
```

Expected output: `"ACTIVE"`

### 1.4 Initialize Terraform

Now initialize Terraform to configure the backend:

```bash
# Navigate to terraform directory
cd infrastructure/terraform

# Initialize Terraform
terraform init
```

Expected output:

```
Initializing the backend...
Successfully configured the backend "s3"!
Initializing provider plugins...
Terraform has been successfully initialized!
```

### 1.5 Troubleshooting Backend Initialization

**Problem**: S3 bucket already exists

- **Solution**: If the bucket exists in your account, the script will skip creation. If it exists in another account, choose a different bucket name in `backend.tf`.

**Problem**: DynamoDB table already exists

- **Solution**: Similar to S3, the script will skip if it exists. Verify it has the correct schema (primary key: `LockID`).

**Problem**: Permission denied errors

- **Solution**: Ensure your IAM user has permissions for S3 and DynamoDB (see [SETUP.md](./SETUP.md) Section 4).

---

## 2. Configure Secrets in AWS Secrets Manager

Application secrets must be stored in AWS Secrets Manager before deploying the ECS service.

### 2.1 Create Supabase Credentials Secret

```bash
# Create secret for Supabase credentials
aws secretsmanager create-secret \
  --name classla/supabase/credentials \
  --description "Supabase database credentials for Classla LMS" \
  --secret-string '{
    "url": "https://your-project.supabase.co",
    "anon_key": "your-anon-key-here",
    "service_role_key": "your-service-role-key-here"
  }' \
  --region us-east-1
```

Replace the placeholder values with your actual Supabase credentials.

### 2.2 Create WorkOS Credentials Secret

```bash
# Create secret for WorkOS credentials
aws secretsmanager create-secret \
  --name classla/workos/credentials \
  --description "WorkOS authentication credentials for Classla LMS" \
  --secret-string '{
    "api_key": "sk_live_your-api-key",
    "client_id": "client_your-client-id"
  }' \
  --region us-east-1
```

### 2.3 Create Application Secrets

```bash
# Generate a secure session secret
SESSION_SECRET=$(openssl rand -base64 32)

# Create secret for application configuration
aws secretsmanager create-secret \
  --name classla/app/secrets \
  --description "Application secrets for Classla LMS" \
  --secret-string "{
    \"session_secret\": \"$SESSION_SECRET\"
  }" \
  --region us-east-1
```

### 2.4 Verify Secrets

List all created secrets:

```bash
aws secretsmanager list-secrets \
  --filters Key=name,Values=classla/ \
  --query 'SecretList[*].[Name,Description]' \
  --output table
```

Expected output:

```
---------------------------------------------------------
|                     ListSecrets                       |
+-------------------------------+-----------------------+
|  classla/supabase/credentials |  Supabase database... |
|  classla/workos/credentials   |  WorkOS authentication|
|  classla/app/secrets          |  Application secrets  |
+-------------------------------+-----------------------+
```

### 2.5 Update Secrets (If Needed)

To update a secret value:

```bash
# Update Supabase credentials
aws secretsmanager update-secret \
  --secret-id classla/supabase/credentials \
  --secret-string '{
    "url": "https://new-project.supabase.co",
    "anon_key": "new-anon-key",
    "service_role_key": "new-service-role-key"
  }'
```

After updating secrets, restart ECS tasks to pick up new values:

```bash
# Force new deployment of ECS service
aws ecs update-service \
  --cluster classla-cluster \
  --service classla-backend-service \
  --force-new-deployment
```

### 2.6 Secrets Security Best Practices

- ✅ Never commit secrets to version control
- ✅ Use AWS Secrets Manager rotation for production
- ✅ Limit IAM access to secrets (principle of least privilege)
- ✅ Enable CloudTrail logging for secret access
- ✅ Regularly audit secret access logs

---

## 3. Configure Terraform Variables

### 3.1 Create terraform.tfvars File

Copy the example file and customize it:

```bash
cd infrastructure/terraform

# Copy example file
cp terraform.tfvars.example terraform.tfvars

# Edit with your values
nano terraform.tfvars  # or use your preferred editor
```

### 3.2 Required Variables

Edit `terraform.tfvars` with your values:

```hcl
# Project Configuration
project_name = "classla"
environment  = "production"  # or "dev", "staging"

# AWS Configuration
aws_region = "us-east-1"

# Networking
vpc_cidr = "10.0.0.0/16"

# ECS Configuration
ecs_task_cpu    = "512"   # 0.5 vCPU
ecs_task_memory = "1024"  # 1 GB
ecs_desired_count = 1
ecs_max_count     = 2

# Container Configuration
container_port = 3001
health_check_path = "/health"

# GitHub Configuration (for Amplify)
github_repository = "your-org/classla-lms"
github_branch     = "main"
github_token      = "ghp_your_github_personal_access_token"

# Domain Configuration (optional)
# domain_name = "classla.yourdomain.com"
# certificate_arn = "arn:aws:acm:us-east-1:123456789012:certificate/..."

# Tags
tags = {
  Project     = "Classla LMS"
  Environment = "Production"
  ManagedBy   = "Terraform"
}
```

### 3.3 Environment-Specific Configurations

For multiple environments, create separate variable files:

```bash
# Development environment
cp terraform.tfvars.example environments/dev.tfvars

# Production environment
cp terraform.tfvars.example environments/prod.tfvars
```

Edit each file with environment-specific values:

**dev.tfvars**:

```hcl
environment = "dev"
ecs_desired_count = 1
ecs_max_count = 1  # No auto-scaling in dev
```

**prod.tfvars**:

```hcl
environment = "production"
ecs_desired_count = 1
ecs_max_count = 2  # Auto-scaling enabled
```

### 3.4 Sensitive Variables

For sensitive values like GitHub tokens, use environment variables instead:

```bash
# Set environment variable
export TF_VAR_github_token="ghp_your_token_here"

# Terraform will automatically use this variable
```

Or use AWS Secrets Manager to store the token and reference it in Terraform.

---

## 4. Deploy Infrastructure

### 4.1 Validate Terraform Configuration

Before deploying, validate the configuration:

```bash
cd infrastructure/terraform

# Format Terraform files
terraform fmt -recursive

# Validate configuration
terraform validate
```

Expected output:

```
Success! The configuration is valid.
```

### 4.2 Plan Infrastructure Changes

Review what Terraform will create:

```bash
# Generate execution plan
terraform plan -out=tfplan

# For specific environment
terraform plan -var-file=environments/prod.tfvars -out=tfplan
```

Review the output carefully:

- Check resource counts (should create ~40-50 resources on first run)
- Verify resource names and configurations
- Look for any warnings or errors

### 4.3 Apply Infrastructure Changes

Deploy the infrastructure:

```bash
# Apply the plan
terraform apply tfplan

# Or apply directly (will prompt for confirmation)
terraform apply

# For specific environment
terraform apply -var-file=environments/prod.tfvars
```

Terraform will show a summary and ask for confirmation:

```
Plan: 45 to add, 0 to change, 0 to destroy.

Do you want to perform these actions?
  Terraform will perform the actions described above.
  Only 'yes' will be accepted to approve.

  Enter a value: yes
```

Type `yes` and press Enter.

### 4.4 Deployment Timeline

The deployment typically takes 10-15 minutes:

- VPC and networking: ~2 minutes
- ECR repository: ~30 seconds
- Secrets Manager: ~30 seconds
- ECS cluster: ~1 minute
- ALB and target groups: ~3 minutes
- ECS service (waiting for tasks): ~5 minutes
- Amplify app: ~2 minutes

### 4.5 Save Terraform Outputs

After successful deployment, save important outputs:

```bash
# Display all outputs
terraform output

# Save to file
terraform output -json > outputs.json

# Get specific output
terraform output alb_dns_name
terraform output amplify_default_domain
terraform output ecr_repository_url
```

### 4.6 Using Deployment Script

Alternatively, use the provided deployment script:

```bash
cd infrastructure/scripts

# Make script executable
chmod +x deploy.sh

# Run deployment
./deploy.sh

# For specific environment
./deploy.sh prod
```

The script will:

1. Validate Terraform configuration
2. Generate and display plan
3. Prompt for confirmation
4. Apply changes
5. Display outputs

---

## 5. Deploy Backend Application

### 5.1 Build and Push Docker Image

After infrastructure is deployed, build and push the backend Docker image:

```bash
# Navigate to project root
cd /path/to/classla-lms

# Get ECR repository URL from Terraform output
ECR_REPO=$(cd infrastructure/terraform && terraform output -raw ecr_repository_url)

# Authenticate Docker to ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin $ECR_REPO

# Build Docker image
docker build -f classla-backend/Dockerfile -t classla-backend:latest .

# Tag image for ECR
docker tag classla-backend:latest $ECR_REPO:latest
docker tag classla-backend:latest $ECR_REPO:$(git rev-parse --short HEAD)

# Push to ECR
docker push $ECR_REPO:latest
docker push $ECR_REPO:$(git rev-parse --short HEAD)
```

### 5.2 Deploy to ECS

After pushing the image, ECS will automatically deploy it:

```bash
# Check ECS service status
aws ecs describe-services \
  --cluster classla-cluster \
  --services classla-backend-service \
  --query 'services[0].{Status:status,Running:runningCount,Desired:desiredCount}' \
  --output table
```

Expected output:

```
-----------------------------------------
|           DescribeServices            |
+----------+----------+--------+--------+
| Desired  | Running  | Status |        |
+----------+----------+--------+--------+
|  1       |  1       |  ACTIVE|        |
+----------+----------+--------+--------+
```

### 5.3 Monitor Deployment

Watch the deployment progress:

```bash
# View ECS events
aws ecs describe-services \
  --cluster classla-cluster \
  --services classla-backend-service \
  --query 'services[0].events[0:5]' \
  --output table

# View task logs
aws logs tail /ecs/classla-backend --follow
```

### 5.4 Force New Deployment (If Needed)

If the service doesn't automatically update:

```bash
aws ecs update-service \
  --cluster classla-cluster \
  --service classla-backend-service \
  --force-new-deployment
```

### 5.5 Automated Deployment with GitHub Actions

For automated deployments, the GitHub Actions workflow will:

1. Trigger on push to `main` branch
2. Build Docker image
3. Push to ECR
4. Update ECS service

Verify the workflow file exists at `.github/workflows/backend-deploy.yml` and push to trigger:

```bash
git add .
git commit -m "Deploy backend"
git push origin main
```

Monitor the workflow in GitHub Actions tab.

---

## 6. Configure Frontend Environment

### 6.1 Get Backend URL

Get the ALB DNS name from Terraform outputs:

```bash
cd infrastructure/terraform
terraform output alb_dns_name
```

Example output: `classla-alb-1234567890.us-east-1.elb.amazonaws.com`

### 6.2 Update Amplify Environment Variables

Set environment variables in AWS Amplify:

#### Option 1: Using AWS Console

1. Go to AWS Amplify Console
2. Select your app (`classla-frontend`)
3. Go to "Environment variables" in the left menu
4. Add the following variables:

| Variable Name           | Value                                               |
| ----------------------- | --------------------------------------------------- |
| `VITE_API_URL`          | `https://your-alb-dns-name` (from Terraform output) |
| `VITE_WORKOS_CLIENT_ID` | Your WorkOS client ID                               |

5. Click "Save"

#### Option 2: Using AWS CLI

```bash
# Get Amplify app ID
APP_ID=$(cd infrastructure/terraform && terraform output -raw amplify_app_id)

# Get ALB DNS name
ALB_DNS=$(cd infrastructure/terraform && terraform output -raw alb_dns_name)

# Set environment variables
aws amplify update-app \
  --app-id $APP_ID \
  --environment-variables \
    VITE_API_URL=https://$ALB_DNS \
    VITE_WORKOS_CLIENT_ID=your_workos_client_id
```

### 6.3 Trigger Frontend Deployment

After setting environment variables, trigger a new deployment:

#### Option 1: Push to GitHub

```bash
# Make a commit to trigger deployment
git commit --allow-empty -m "Trigger Amplify deployment"
git push origin main
```

#### Option 2: Manual Deployment via Console

1. Go to AWS Amplify Console
2. Select your app
3. Click "Run build" on the main branch

### 6.4 Monitor Frontend Build

Watch the build progress:

```bash
# Get latest build status
aws amplify list-jobs \
  --app-id $APP_ID \
  --branch-name main \
  --max-results 1 \
  --query 'jobSummaries[0].{Status:status,StartTime:startTime}' \
  --output table
```

Or view in the Amplify Console:

1. Go to AWS Amplify Console
2. Select your app
3. View build logs in real-time

### 6.5 Get Frontend URL

After successful deployment:

```bash
# Get Amplify URL from Terraform
cd infrastructure/terraform
terraform output amplify_default_domain
```

Example output: `main.d1234567890.amplifyapp.com`

Visit this URL to access your deployed frontend.

---

## 7. Verification Steps

After deployment, verify that all components are working correctly.

### 7.1 Verify Infrastructure Resources

Check that all resources were created:

```bash
cd infrastructure/terraform

# List all resources
terraform state list

# Verify specific resources
terraform state show module.networking.aws_vpc.main
terraform state show module.ecs.aws_ecs_service.main
terraform state show module.alb.aws_lb.main
```

### 7.2 Verify Backend Health

Test the backend health endpoint:

```bash
# Get ALB DNS name
ALB_DNS=$(terraform output -raw alb_dns_name)

# Test health endpoint (HTTP)
curl http://$ALB_DNS/health

# Test health endpoint (HTTPS, if certificate configured)
curl https://$ALB_DNS/health
```

Expected response:

```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "uptime": 3600
}
```

### 7.3 Verify ECS Tasks

Check that ECS tasks are running:

```bash
# List running tasks
aws ecs list-tasks \
  --cluster classla-cluster \
  --service-name classla-backend-service

# Get task details
TASK_ARN=$(aws ecs list-tasks \
  --cluster classla-cluster \
  --service-name classla-backend-service \
  --query 'taskArns[0]' \
  --output text)

aws ecs describe-tasks \
  --cluster classla-cluster \
  --tasks $TASK_ARN \
  --query 'tasks[0].{Status:lastStatus,Health:healthStatus,Started:startedAt}' \
  --output table
```

Expected output:

```
---------------------------------------------------------
|                   DescribeTasks                       |
+----------+----------+------------------------------+
| Health   | Started  | Status                       |
+----------+----------+------------------------------+
| HEALTHY  | 2024-... | RUNNING                      |
+----------+----------+------------------------------+
```

### 7.4 Verify ALB Target Health

Check that the ALB can reach the ECS tasks:

```bash
# Get target group ARN
TG_ARN=$(terraform output -raw alb_target_group_arn)

# Check target health
aws elbv2 describe-target-health \
  --target-group-arn $TG_ARN \
  --query 'TargetHealthDescriptions[*].{Target:Target.Id,Health:TargetHealth.State,Reason:TargetHealth.Reason}' \
  --output table
```

Expected output:

```
---------------------------------------------------------
|              DescribeTargetHealth                     |
+----------+----------+------------------------------+
| Health   | Reason   | Target                       |
+----------+----------+------------------------------+
| healthy  | None     | 10.0.11.123:3001             |
+----------+----------+------------------------------+
```

### 7.5 Verify Secrets Access

Check that ECS tasks can access secrets:

```bash
# View task logs to verify secrets were loaded
aws logs tail /ecs/classla-backend --since 5m | grep -i "secret\|supabase\|workos"
```

Look for log entries indicating successful secret retrieval (no errors).

### 7.6 Verify Frontend Deployment

Test the frontend:

```bash
# Get Amplify URL
AMPLIFY_URL=$(terraform output -raw amplify_default_domain)

# Test frontend
curl -I https://$AMPLIFY_URL
```

Expected response:

```
HTTP/2 200
content-type: text/html
...
```

Visit the URL in a browser to verify the application loads.

### 7.7 Verify End-to-End Connectivity

Test that the frontend can communicate with the backend:

1. Open the frontend URL in a browser
2. Open browser developer tools (F12)
3. Go to Network tab
4. Try to sign in or access a protected route
5. Verify API calls to the backend succeed (200 status codes)

### 7.8 Verify WebSocket Connections (If Applicable)

If your application uses WebSockets:

```bash
# Test WebSocket connection
wscat -c ws://$ALB_DNS/socket.io/

# Or use a WebSocket testing tool
```

### 7.9 Verify Auto-Scaling Configuration

Check that auto-scaling is configured:

```bash
# List auto-scaling targets
aws application-autoscaling describe-scalable-targets \
  --service-namespace ecs \
  --resource-ids service/classla-cluster/classla-backend-service

# List auto-scaling policies
aws application-autoscaling describe-scaling-policies \
  --service-namespace ecs \
  --resource-id service/classla-cluster/classla-backend-service
```

### 7.10 Verify CloudWatch Logs

Check that logs are being collected:

```bash
# List log streams
aws logs describe-log-streams \
  --log-group-name /ecs/classla-backend \
  --order-by LastEventTime \
  --descending \
  --max-items 5

# View recent logs
aws logs tail /ecs/classla-backend --follow
```

### 7.11 Verification Checklist

Use this checklist to ensure everything is working:

- [ ] Terraform state is stored in S3
- [ ] All Terraform resources created successfully
- [ ] Secrets exist in AWS Secrets Manager
- [ ] ECR repository contains Docker image
- [ ] ECS tasks are running and healthy
- [ ] ALB health checks passing
- [ ] Backend `/health` endpoint responds
- [ ] Frontend deployed to Amplify
- [ ] Frontend loads in browser
- [ ] Frontend can communicate with backend
- [ ] CloudWatch logs are being collected
- [ ] Auto-scaling policies are configured
- [ ] GitHub Actions workflow runs successfully

---

## Troubleshooting

### Common Issues and Solutions

#### Terraform Issues

**Problem**: State lock error

```
Error: Error acquiring the state lock
```

**Solution**:

```bash
# Check if another process is running
# If not, force unlock (use with caution)
terraform force-unlock <LOCK_ID>

# Or wait for the lock to expire (usually 15 minutes)
```

**Problem**: Resource already exists

```
Error: resource already exists
```

**Solution**:

```bash
# Import existing resource
terraform import <resource_type>.<resource_name> <resource_id>

# Or remove from state and let Terraform recreate
terraform state rm <resource_type>.<resource_name>
```

**Problem**: Insufficient IAM permissions

```
Error: AccessDenied: User is not authorized to perform...
```

**Solution**:

- Verify IAM user has required permissions (see [SETUP.md](./SETUP.md) Section 4)
- Check AWS CLI is using correct profile: `aws sts get-caller-identity`

#### ECS Deployment Issues

**Problem**: ECS tasks fail to start

```
Task failed to start: CannotPullContainerError
```

**Solution**:

```bash
# Verify ECR image exists
aws ecr describe-images --repository-name classla-backend

# Check ECS task execution role has ECR permissions
aws iam get-role --role-name classla-ecs-task-execution-role

# Re-authenticate Docker and push image
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <ECR_URL>
docker push <ECR_URL>:latest
```

**Problem**: ECS tasks fail health checks

```
Task failed container health checks
```

**Solution**:

```bash
# Check task logs
aws logs tail /ecs/classla-backend --follow

# Verify health check endpoint
curl http://<ALB_DNS>/health

# Check security groups allow traffic on port 3001
aws ec2 describe-security-groups --group-ids <SG_ID>
```

**Problem**: ECS tasks can't access secrets

```
Error: Unable to fetch secret from Secrets Manager
```

**Solution**:

```bash
# Verify secrets exist
aws secretsmanager list-secrets --filters Key=name,Values=classla/

# Check ECS task role has Secrets Manager permissions
aws iam get-role-policy --role-name classla-ecs-task-role --policy-name SecretsAccess

# Verify secret ARNs in task definition match actual secrets
```

#### ALB Issues

**Problem**: ALB returns 503 Service Unavailable

```
HTTP/1.1 503 Service Temporarily Unavailable
```

**Solution**:

```bash
# Check target health
aws elbv2 describe-target-health --target-group-arn <TG_ARN>

# If unhealthy, check:
# 1. ECS tasks are running
# 2. Security groups allow ALB -> ECS traffic
# 3. Health check path is correct (/health)
# 4. Application is listening on correct port (3001)
```

**Problem**: ALB returns 502 Bad Gateway

```
HTTP/1.1 502 Bad Gateway
```

**Solution**:

- Application crashed or not responding
- Check ECS task logs for errors
- Verify application starts successfully
- Check health check configuration

#### Amplify Issues

**Problem**: Amplify build fails

```
Build failed: npm ERR! code ELIFECYCLE
```

**Solution**:

```bash
# Check build logs in Amplify Console
# Common issues:
# 1. Missing environment variables
# 2. Build command incorrect
# 3. Node version mismatch

# Verify build settings in amplify.yml or Amplify Console
# Ensure environment variables are set correctly
```

**Problem**: Frontend can't connect to backend

```
Network Error: Failed to fetch
```

**Solution**:

- Verify `VITE_API_URL` environment variable is set correctly
- Check CORS configuration in backend
- Verify ALB security group allows traffic from internet
- Check backend is running and healthy

#### Secrets Manager Issues

**Problem**: Secret not found

```
Error: ResourceNotFoundException: Secrets Manager can't find the specified secret
```

**Solution**:

```bash
# List all secrets
aws secretsmanager list-secrets

# Verify secret name matches exactly (case-sensitive)
# Create secret if missing (see Section 2)
```

**Problem**: Invalid secret format

```
Error: Unable to parse secret value
```

**Solution**:

- Ensure secret is valid JSON
- Check for trailing commas or syntax errors
- Update secret with correct format:

```bash
aws secretsmanager update-secret \
  --secret-id classla/supabase/credentials \
  --secret-string '{"url":"...","anon_key":"...","service_role_key":"..."}'
```

#### Network Issues

**Problem**: ECS tasks can't reach internet

```
Error: getaddrinfo ENOTFOUND
```

**Solution**:

- Verify NAT Gateways are running
- Check route tables for private subnets point to NAT Gateway
- Verify ECS tasks are in private subnets
- Check security groups allow outbound traffic

**Problem**: Can't access ALB from internet

```
Connection timeout
```

**Solution**:

- Verify ALB is in public subnets
- Check ALB security group allows inbound traffic on ports 80/443
- Verify Internet Gateway is attached to VPC
- Check route tables for public subnets

### Getting Help

If you encounter issues not covered here:

1. **Check CloudWatch Logs**: Most issues are logged

   ```bash
   aws logs tail /ecs/classla-backend --follow
   ```

2. **Review Terraform Plan**: Before applying, review what will change

   ```bash
   terraform plan
   ```

3. **Check AWS Service Health**: Verify AWS services are operational

   - Visit [AWS Service Health Dashboard](https://status.aws.amazon.com/)

4. **Enable Debug Logging**: For more detailed logs

   ```bash
   export TF_LOG=DEBUG
   terraform apply
   ```

5. **Consult Documentation**:
   - [Terraform AWS Provider Docs](https://registry.terraform.io/providers/hashicorp/aws/latest/docs)
   - [AWS ECS Documentation](https://docs.aws.amazon.com/ecs/)
   - [AWS Amplify Documentation](https://docs.aws.amazon.com/amplify/)

---

## Rollback Procedures

### When to Rollback

Consider rolling back if:

- New deployment causes critical errors
- Application is unavailable or severely degraded
- Data integrity issues are detected
- Security vulnerabilities are introduced

### Rollback Strategy

#### 1. Rollback Backend Application

**Option A: Deploy Previous Docker Image**

```bash
# List recent images
aws ecr describe-images \
  --repository-name classla-backend \
  --query 'sort_by(imageDetails,& imagePushedAt)[-5:].[imageTags[0],imagePushedAt]' \
  --output table

# Update ECS service to use previous image tag
aws ecs update-service \
  --cluster classla-cluster \
  --service classla-backend-service \
  --task-definition classla-backend:PREVIOUS_REVISION \
  --force-new-deployment

# Or update task definition with specific image tag
# Then update service to use that task definition
```

**Option B: Revert Git Commit and Redeploy**

```bash
# Revert to previous commit
git revert HEAD
git push origin main

# GitHub Actions will automatically build and deploy
```

#### 2. Rollback Frontend Application

**Option A: Amplify Console**

1. Go to AWS Amplify Console
2. Select your app
3. Go to "Deployments" tab
4. Find the previous successful deployment
5. Click "Redeploy this version"

**Option B: Git Revert**

```bash
# Revert frontend changes
git revert HEAD
git push origin main

# Amplify will automatically rebuild and deploy
```

#### 3. Rollback Infrastructure Changes

**Option A: Terraform Rollback**

```bash
# View Terraform state history
terraform state list

# Revert to previous Terraform configuration
git checkout <previous-commit> infrastructure/terraform/

# Plan and apply
terraform plan -out=rollback.tfplan
terraform apply rollback.tfplan

# Or use Terraform state manipulation
terraform state pull > backup.tfstate
# Edit state if needed
terraform state push backup.tfstate
```

**Option B: Destroy and Recreate**

```bash
# Destroy specific resources
terraform destroy -target=module.ecs.aws_ecs_service.main

# Recreate with previous configuration
terraform apply
```

#### 4. Rollback Secrets

If secrets were changed:

```bash
# Restore previous secret version
aws secretsmanager restore-secret \
  --secret-id classla/supabase/credentials

# Or update with previous values
aws secretsmanager update-secret \
  --secret-id classla/supabase/credentials \
  --secret-string '<previous-json-value>'

# Force ECS service to restart with new secrets
aws ecs update-service \
  --cluster classla-cluster \
  --service classla-backend-service \
  --force-new-deployment
```

### Rollback Verification

After rollback, verify:

```bash
# Check ECS service status
aws ecs describe-services \
  --cluster classla-cluster \
  --services classla-backend-service \
  --query 'services[0].deployments'

# Test health endpoint
curl http://$(cd infrastructure/terraform && terraform output -raw alb_dns_name)/health

# Check application logs
aws logs tail /ecs/classla-backend --follow

# Verify frontend
curl -I https://$(cd infrastructure/terraform && terraform output -raw amplify_default_domain)
```

### Preventing Issues

To minimize the need for rollbacks:

1. **Use Staging Environment**: Test changes in staging before production
2. **Gradual Rollouts**: Use blue/green or canary deployments
3. **Automated Testing**: Run tests before deployment
4. **Monitoring**: Set up alerts for errors and performance issues
5. **Backup Strategy**: Regular backups of critical data
6. **Documentation**: Keep deployment logs and change records

---

## Post-Deployment Tasks

### 1. Configure Monitoring

Set up CloudWatch alarms:

```bash
# Create alarm for ECS CPU usage
aws cloudwatch put-metric-alarm \
  --alarm-name classla-ecs-high-cpu \
  --alarm-description "Alert when ECS CPU exceeds 80%" \
  --metric-name CPUUtilization \
  --namespace AWS/ECS \
  --statistic Average \
  --period 300 \
  --threshold 80 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2 \
  --dimensions Name=ServiceName,Value=classla-backend-service Name=ClusterName,Value=classla-cluster

# Create alarm for ALB 5xx errors
aws cloudwatch put-metric-alarm \
  --alarm-name classla-alb-5xx-errors \
  --alarm-description "Alert on ALB 5xx errors" \
  --metric-name HTTPCode_Target_5XX_Count \
  --namespace AWS/ApplicationELB \
  --statistic Sum \
  --period 300 \
  --threshold 10 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1
```

### 2. Set Up Log Retention

Configure log retention policies:

```bash
# Set CloudWatch Logs retention to 90 days
aws logs put-retention-policy \
  --log-group-name /ecs/classla-backend \
  --retention-in-days 90
```

### 3. Enable Cost Monitoring

Set up cost allocation tags:

```bash
# Tag resources for cost tracking
aws resourcegroupstaggingapi tag-resources \
  --resource-arn-list <resource-arns> \
  --tags Project=Classla,Environment=Production,CostCenter=Engineering
```

### 4. Document Configuration

Create a configuration document with:

- All resource IDs and ARNs
- Environment variable values (non-sensitive)
- Access URLs and endpoints
- Monitoring dashboard links
- Runbook for common operations

### 5. Schedule Regular Maintenance

Plan for:

- Weekly: Review CloudWatch logs and metrics
- Monthly: Review and rotate access keys
- Quarterly: Review and update dependencies
- Annually: Review and optimize costs

---

## Next Steps

After successful deployment:

1. **Configure Custom Domain**: Set up Route 53 and ACM certificate (see [CONFIGURATION.md](./CONFIGURATION.md))
2. **Set Up CI/CD**: Ensure GitHub Actions workflows are running smoothly
3. **Configure Monitoring**: Set up CloudWatch dashboards and alarms
4. **Security Hardening**: Review security groups, IAM policies, and enable AWS GuardDuty
5. **Performance Testing**: Load test the application to verify auto-scaling
6. **Disaster Recovery**: Set up backup and recovery procedures
7. **Documentation**: Update team documentation with deployment details

---

## Additional Resources

- [AWS Well-Architected Framework](https://aws.amazon.com/architecture/well-architected/)
- [Terraform Best Practices](https://www.terraform-best-practices.com/)
- [ECS Best Practices](https://docs.aws.amazon.com/AmazonECS/latest/bestpracticesguide/)
- [AWS Security Best Practices](https://aws.amazon.com/security/best-practices/)
- [Configuration Reference](./CONFIGURATION.md)
- [Setup Guide](./SETUP.md)

---

**Deployment Complete!** 🎉

Your Classla LMS application is now running on AWS. Monitor the application and refer to this guide for maintenance and troubleshooting.
