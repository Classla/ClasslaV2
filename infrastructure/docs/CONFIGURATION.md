# Configuration Reference

This document provides a comprehensive reference for all configuration values, environment variables, Terraform variables, and secrets required to deploy and run the Classla LMS application on AWS.

## Table of Contents

- [Terraform Variables](#terraform-variables)
- [AWS Secrets Manager](#aws-secrets-manager)
- [Backend Environment Variables](#backend-environment-variables)
- [Frontend Environment Variables](#frontend-environment-variables)
- [GitHub Actions Secrets](#github-actions-secrets)
- [Troubleshooting](#troubleshooting)

---

## Terraform Variables

These variables are defined in `terraform/variables.tf` and should be set in your `terraform.tfvars` file or passed via command line.

### Required Variables

#### `project_name`

- **Type**: `string`
- **Description**: Name of the project, used as a prefix for all resources
- **Example**: `"classla"`
- **Usage**: Resource naming (e.g., `classla-vpc`, `classla-ecs-cluster`)

#### `environment`

- **Type**: `string`
- **Description**: Environment name (dev, staging, prod)
- **Example**: `"prod"`
- **Usage**: Resource tagging and naming differentiation

#### `aws_region`

- **Type**: `string`
- **Description**: AWS region where resources will be deployed
- **Example**: `"us-east-1"`
- **Default**: `"us-east-1"`
- **Usage**: All AWS resources will be created in this region

#### `vpc_cidr`

- **Type**: `string`
- **Description**: CIDR block for the VPC
- **Example**: `"10.0.0.0/16"`
- **Default**: `"10.0.0.0/16"`
- **Usage**: Defines the IP address range for your VPC

#### `availability_zones`

- **Type**: `list(string)`
- **Description**: List of availability zones to use for multi-AZ deployment
- **Example**: `["us-east-1a", "us-east-1b"]`
- **Usage**: High availability across multiple AZs

#### `github_repository`

- **Type**: `string`
- **Description**: GitHub repository in format `owner/repo`
- **Example**: `"your-org/classla-lms"`
- **Usage**: Amplify app connection to GitHub for frontend deployment

#### `github_branch`

- **Type**: `string`
- **Description**: GitHub branch to deploy from
- **Example**: `"main"`
- **Default**: `"main"`
- **Usage**: Amplify automatic deployments

#### `github_access_token`

- **Type**: `string`
- **Sensitive**: Yes
- **Description**: GitHub personal access token for Amplify
- **Example**: `"ghp_xxxxxxxxxxxxxxxxxxxx"`
- **Usage**: Amplify needs this to access your repository
- **How to get**: GitHub Settings → Developer settings → Personal access tokens → Generate new token (needs `repo` scope)

#### `domain_name`

- **Type**: `string`
- **Description**: Custom domain name for the application (optional)
- **Example**: `"classla.example.com"`
- **Default**: `""` (uses ALB DNS name)
- **Usage**: Custom domain configuration for ALB

#### `certificate_arn`

- **Type**: `string`
- **Description**: ARN of ACM certificate for HTTPS (required if using custom domain)
- **Example**: `"arn:aws:acm:us-east-1:123456789012:certificate/xxxxx"`
- **Default**: `""` (must be provided for HTTPS)
- **Usage**: ALB HTTPS listener
- **How to get**: Request certificate in AWS Certificate Manager for your domain

### ECS Configuration Variables

#### `ecs_task_cpu`

- **Type**: `number`
- **Description**: CPU units for ECS task (1024 = 1 vCPU)
- **Example**: `512`
- **Default**: `512`
- **Usage**: Fargate task sizing

#### `ecs_task_memory`

- **Type**: `number`
- **Description**: Memory in MB for ECS task
- **Example**: `1024`
- **Default**: `1024`
- **Usage**: Fargate task sizing

#### `ecs_desired_count`

- **Type**: `number`
- **Description**: Desired number of ECS tasks to run
- **Example**: `1`
- **Default**: `1`
- **Usage**: Normal operation task count

#### `ecs_max_count`

- **Type**: `number`
- **Description**: Maximum number of ECS tasks for auto-scaling
- **Example**: `2`
- **Default**: `2`
- **Usage**: Auto-scaling upper limit

#### `container_port`

- **Type**: `number`
- **Description**: Port the backend application listens on
- **Example**: `3001`
- **Default**: `3001`
- **Usage**: Container port mapping and target group configuration

### Example terraform.tfvars

```hcl
# Project Configuration
project_name = "classla"
environment  = "prod"
aws_region   = "us-east-1"

# Networking
vpc_cidr           = "10.0.0.0/16"
availability_zones = ["us-east-1a", "us-east-1b"]

# GitHub Configuration
github_repository    = "your-org/classla-lms"
github_branch        = "main"
github_access_token  = "ghp_xxxxxxxxxxxxxxxxxxxx"  # Keep this secret!

# Domain Configuration (optional)
domain_name     = "classla.example.com"
certificate_arn = "arn:aws:acm:us-east-1:123456789012:certificate/xxxxx"

# ECS Configuration
ecs_task_cpu      = 512
ecs_task_memory   = 1024
ecs_desired_count = 1
ecs_max_count     = 2
container_port    = 3001
```

---

## AWS Secrets Manager

Secrets are stored in AWS Secrets Manager and accessed by ECS tasks at runtime. You must create these secrets manually before deploying the application.

### Secret: `classla/supabase/credentials`

**Purpose**: Supabase database connection credentials

**Format**: JSON

**Required Fields**:

```json
{
  "url": "https://your-project.supabase.co",
  "anon_key": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "service_role_key": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**How to get**:

1. Log in to your Supabase project
2. Go to Settings → API
3. Copy the URL, anon key, and service_role key

**AWS CLI Command**:

```bash
aws secretsmanager create-secret \
  --name classla/supabase/credentials \
  --description "Supabase connection credentials" \
  --secret-string '{
    "url": "https://your-project.supabase.co",
    "anon_key": "your-anon-key",
    "service_role_key": "your-service-role-key"
  }' \
  --region us-east-1
```

### Secret: `classla/workos/credentials`

**Purpose**: WorkOS authentication credentials

**Format**: JSON

**Required Fields**:

```json
{
  "api_key": "sk_live_xxxxxxxxxxxxxxxxxxxx",
  "client_id": "client_xxxxxxxxxxxxxxxxxxxx"
}
```

**How to get**:

1. Log in to your WorkOS dashboard
2. Go to API Keys
3. Copy the API Key and Client ID

**AWS CLI Command**:

```bash
aws secretsmanager create-secret \
  --name classla/workos/credentials \
  --description "WorkOS authentication credentials" \
  --secret-string '{
    "api_key": "sk_live_xxxxxxxxxxxxxxxxxxxx",
    "client_id": "client_xxxxxxxxxxxxxxxxxxxx"
  }' \
  --region us-east-1
```

### Secret: `classla/app/secrets`

**Purpose**: Application-specific secrets

**Format**: JSON

**Required Fields**:

```json
{
  "session_secret": "your-random-session-secret-at-least-32-characters-long"
}
```

**How to generate session_secret**:

```bash
# Generate a secure random string
openssl rand -base64 32
```

**AWS CLI Command**:

```bash
aws secretsmanager create-secret \
  --name classla/app/secrets \
  --description "Application secrets" \
  --secret-string '{
    "session_secret": "your-generated-secret-here"
  }' \
  --region us-east-1
```

### Updating Secrets

To update an existing secret:

```bash
aws secretsmanager update-secret \
  --secret-id classla/supabase/credentials \
  --secret-string '{
    "url": "https://new-project.supabase.co",
    "anon_key": "new-anon-key",
    "service_role_key": "new-service-role-key"
  }' \
  --region us-east-1
```

After updating secrets, restart ECS tasks to pick up new values:

```bash
aws ecs update-service \
  --cluster classla-ecs-cluster \
  --service classla-backend-service \
  --force-new-deployment \
  --region us-east-1
```

---

## Backend Environment Variables

These environment variables are automatically injected into ECS tasks from Secrets Manager and Terraform outputs.

### Application Configuration

#### `PORT`

- **Source**: Hardcoded in task definition
- **Value**: `3001`
- **Description**: Port the Express.js server listens on

#### `NODE_ENV`

- **Source**: Hardcoded in task definition
- **Value**: `production`
- **Description**: Node.js environment mode

### Supabase Configuration

#### `SUPABASE_URL`

- **Source**: Secrets Manager (`classla/supabase/credentials.url`)
- **Example**: `https://your-project.supabase.co`
- **Description**: Supabase project URL

#### `SUPABASE_ANON_KEY`

- **Source**: Secrets Manager (`classla/supabase/credentials.anon_key`)
- **Description**: Supabase anonymous key for client-side operations

#### `SUPABASE_SERVICE_ROLE_KEY`

- **Source**: Secrets Manager (`classla/supabase/credentials.service_role_key`)
- **Description**: Supabase service role key for server-side operations (bypasses RLS)

### WorkOS Configuration

#### `WORKOS_API_KEY`

- **Source**: Secrets Manager (`classla/workos/credentials.api_key`)
- **Example**: `sk_live_xxxxxxxxxxxxxxxxxxxx`
- **Description**: WorkOS API key for authentication

#### `WORKOS_CLIENT_ID`

- **Source**: Secrets Manager (`classla/workos/credentials.client_id`)
- **Example**: `client_xxxxxxxxxxxxxxxxxxxx`
- **Description**: WorkOS client ID

#### `WORKOS_REDIRECT_URI`

- **Source**: Terraform output (ALB URL)
- **Example**: `https://classla-alb-123456789.us-east-1.elb.amazonaws.com/auth/callback`
- **Description**: OAuth callback URL for WorkOS

### Application URLs

#### `FRONTEND_URL`

- **Source**: Terraform output (Amplify URL)
- **Example**: `https://main.d1234567890abc.amplifyapp.com`
- **Description**: Frontend URL for CORS configuration

#### `SESSION_SECRET`

- **Source**: Secrets Manager (`classla/app/secrets.session_secret`)
- **Description**: Secret key for session encryption

### How ECS Tasks Get These Variables

The ECS task definition automatically pulls these values:

1. **From Secrets Manager**: Using `secrets` in task definition
2. **From Terraform**: Using `environment` in task definition with Terraform outputs
3. **Hardcoded**: Static values like `PORT` and `NODE_ENV`

---

## Frontend Environment Variables

These environment variables are configured in AWS Amplify and injected during the build process.

### Required Variables

#### `VITE_API_URL`

- **Source**: Terraform output (ALB DNS name)
- **Example**: `https://classla-alb-123456789.us-east-1.elb.amazonaws.com`
- **Description**: Backend API URL
- **How to set**: Amplify Console → App Settings → Environment variables

#### `VITE_WORKOS_CLIENT_ID`

- **Source**: WorkOS dashboard
- **Example**: `client_xxxxxxxxxxxxxxxxxxxx`
- **Description**: WorkOS client ID for frontend authentication
- **How to set**: Amplify Console → App Settings → Environment variables

### Setting Amplify Environment Variables

**Via AWS Console**:

1. Go to AWS Amplify Console
2. Select your app
3. Go to App Settings → Environment variables
4. Add key-value pairs

**Via Terraform** (already configured in amplify module):

```hcl
environment_variables = {
  VITE_API_URL           = module.alb.alb_dns_name
  VITE_WORKOS_CLIENT_ID  = var.workos_client_id
}
```

**Via AWS CLI**:

```bash
aws amplify update-app \
  --app-id d1234567890abc \
  --environment-variables \
    VITE_API_URL=https://your-alb-url.elb.amazonaws.com \
    VITE_WORKOS_CLIENT_ID=client_xxxxxxxxxxxxxxxxxxxx \
  --region us-east-1
```

---

## GitHub Actions Secrets

These secrets are required for the CI/CD pipeline to deploy the backend to ECS.

### Required Secrets

#### `AWS_ACCESS_KEY_ID`

- **Description**: AWS access key for GitHub Actions
- **How to get**: Create IAM user with programmatic access
- **Required Permissions**: ECR push, ECS update service
- **How to set**: GitHub repo → Settings → Secrets and variables → Actions → New repository secret

#### `AWS_SECRET_ACCESS_KEY`

- **Description**: AWS secret access key for GitHub Actions
- **How to get**: Created with IAM user
- **How to set**: GitHub repo → Settings → Secrets and variables → Actions → New repository secret

#### `AWS_REGION`

- **Description**: AWS region for deployments
- **Example**: `us-east-1`
- **How to set**: GitHub repo → Settings → Secrets and variables → Actions → New repository secret

### IAM Policy for GitHub Actions

Create an IAM user with this policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage",
        "ecr:PutImage",
        "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ecs:UpdateService",
        "ecs:DescribeServices",
        "ecs:DescribeTaskDefinition",
        "ecs:RegisterTaskDefinition"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": ["iam:PassRole"],
      "Resource": "arn:aws:iam::*:role/classla-*"
    }
  ]
}
```

---

## Troubleshooting

### Common Issues and Solutions

#### Issue: Terraform state lock error

**Symptom**:

```
Error: Error acquiring the state lock
```

**Cause**: Another Terraform process is running or a previous run didn't release the lock

**Solution**:

```bash
# Check if another process is running
# If not, force unlock (use with caution)
terraform force-unlock <LOCK_ID>
```

#### Issue: ECS tasks failing to start

**Symptom**: Tasks start and immediately stop

**Possible Causes**:

1. **Secrets not found**: Check CloudWatch Logs for "secret not found" errors
2. **Image pull errors**: Verify ECR repository exists and task execution role has permissions
3. **Application errors**: Check CloudWatch Logs for application startup errors

**Solution**:

```bash
# Check ECS task logs
aws logs tail /ecs/classla-backend --follow --region us-east-1

# Verify secrets exist
aws secretsmanager list-secrets --region us-east-1

# Check task execution role permissions
aws iam get-role --role-name classla-ecs-task-execution-role
```

#### Issue: Cannot connect to backend from frontend

**Symptom**: Frontend shows connection errors

**Possible Causes**:

1. **CORS misconfiguration**: Backend not allowing frontend origin
2. **ALB health check failing**: Target group shows unhealthy targets
3. **Security group rules**: ALB cannot reach ECS tasks

**Solution**:

```bash
# Check ALB target health
aws elbv2 describe-target-health \
  --target-group-arn <TARGET_GROUP_ARN> \
  --region us-east-1

# Test backend health endpoint
curl https://your-alb-url.elb.amazonaws.com/health

# Check security group rules
aws ec2 describe-security-groups \
  --group-ids <SECURITY_GROUP_ID> \
  --region us-east-1
```

#### Issue: Amplify build failing

**Symptom**: Amplify shows build failed status

**Possible Causes**:

1. **Missing environment variables**: `VITE_API_URL` not set
2. **Build errors**: TypeScript or dependency errors
3. **Wrong build directory**: Amplify looking in wrong location

**Solution**:

1. Check Amplify build logs in AWS Console
2. Verify environment variables are set
3. Check `amplify.yml` build specification
4. Test build locally: `cd classla-frontend && npm run build`

#### Issue: WebSocket connections dropping

**Symptom**: Real-time features not working

**Possible Causes**:

1. **ALB idle timeout too short**: Default is 60 seconds
2. **Connection stickiness not enabled**: Requests going to different tasks

**Solution**:

```bash
# Verify ALB idle timeout (should be 3600)
aws elbv2 describe-load-balancer-attributes \
  --load-balancer-arn <ALB_ARN> \
  --region us-east-1

# Verify target group stickiness
aws elbv2 describe-target-group-attributes \
  --target-group-arn <TARGET_GROUP_ARN> \
  --region us-east-1
```

#### Issue: High AWS costs

**Symptom**: Unexpected AWS bill

**Possible Causes**:

1. **NAT Gateway data transfer**: Most expensive component
2. **Multiple ECS tasks running**: Auto-scaling not scaling down
3. **ALB idle connections**: Keeping connections open

**Solution**:

```bash
# Check running ECS tasks
aws ecs list-tasks --cluster classla-ecs-cluster --region us-east-1

# Review CloudWatch metrics for scaling
aws cloudwatch get-metric-statistics \
  --namespace AWS/ECS \
  --metric-name CPUUtilization \
  --dimensions Name=ServiceName,Value=classla-backend-service \
  --start-time 2024-01-01T00:00:00Z \
  --end-time 2024-01-02T00:00:00Z \
  --period 3600 \
  --statistics Average \
  --region us-east-1

# Consider using VPC endpoints to reduce NAT costs
# Already configured in networking module
```

#### Issue: Cannot access secrets from ECS

**Symptom**: ECS tasks fail with "unable to retrieve secret" error

**Possible Causes**:

1. **IAM permissions**: Task execution role missing Secrets Manager permissions
2. **Secret doesn't exist**: Secret not created in correct region
3. **Secret name mismatch**: Task definition references wrong secret name

**Solution**:

```bash
# Verify secret exists
aws secretsmanager describe-secret \
  --secret-id classla/supabase/credentials \
  --region us-east-1

# Check task execution role policy
aws iam get-role-policy \
  --role-name classla-ecs-task-execution-role \
  --policy-name SecretsManagerAccess

# Verify task definition secret references
aws ecs describe-task-definition \
  --task-definition classla-backend \
  --region us-east-1
```

#### Issue: Terraform plan shows unexpected changes

**Symptom**: `terraform plan` shows changes when none were made

**Possible Causes**:

1. **Drift**: Manual changes made in AWS Console
2. **State out of sync**: State file doesn't match reality
3. **Provider version change**: Different Terraform/provider version

**Solution**:

```bash
# Refresh state
terraform refresh

# Import manually created resources
terraform import <resource_type>.<resource_name> <resource_id>

# If state is corrupted, restore from S3 versioning
aws s3api list-object-versions \
  --bucket classla-terraform-state \
  --prefix infrastructure/terraform.tfstate
```

### Getting Help

If you encounter issues not covered here:

1. **Check CloudWatch Logs**: Most issues show up in logs
2. **Review AWS Service Health Dashboard**: Check for AWS outages
3. **Terraform Documentation**: https://registry.terraform.io/providers/hashicorp/aws/latest/docs
4. **AWS Support**: Open a support ticket if you have a support plan

### Useful Commands

```bash
# View all Terraform outputs
terraform output

# Get specific output value
terraform output alb_dns_name

# List all secrets
aws secretsmanager list-secrets --region us-east-1

# View ECS service status
aws ecs describe-services \
  --cluster classla-ecs-cluster \
  --services classla-backend-service \
  --region us-east-1

# View Amplify app status
aws amplify get-app --app-id <APP_ID> --region us-east-1

# Tail ECS logs
aws logs tail /ecs/classla-backend --follow --region us-east-1

# Force new ECS deployment
aws ecs update-service \
  --cluster classla-ecs-cluster \
  --service classla-backend-service \
  --force-new-deployment \
  --region us-east-1
```

---

## Configuration Checklist

Use this checklist to ensure all configuration is complete before deployment:

### Pre-Deployment

- [ ] AWS account created and configured
- [ ] AWS CLI installed and configured with credentials
- [ ] Terraform installed (version 1.0+)
- [ ] GitHub personal access token created
- [ ] Supabase project created and credentials obtained
- [ ] WorkOS account created and credentials obtained
- [ ] ACM certificate requested and validated (if using custom domain)

### Terraform Configuration

- [ ] `terraform.tfvars` created with all required variables
- [ ] `github_access_token` set correctly
- [ ] `certificate_arn` set (if using custom domain)
- [ ] S3 bucket for Terraform state created
- [ ] DynamoDB table for state locking created

### AWS Secrets Manager

- [ ] `classla/supabase/credentials` secret created
- [ ] `classla/workos/credentials` secret created
- [ ] `classla/app/secrets` secret created
- [ ] All secrets created in correct region

### GitHub Actions

- [ ] `AWS_ACCESS_KEY_ID` secret set in GitHub
- [ ] `AWS_SECRET_ACCESS_KEY` secret set in GitHub
- [ ] `AWS_REGION` secret set in GitHub
- [ ] IAM user has required permissions

### Post-Deployment

- [ ] Terraform outputs recorded (ALB URL, Amplify URL, ECR repository)
- [ ] Amplify environment variables configured
- [ ] WorkOS redirect URI updated with ALB URL
- [ ] Backend health check responding
- [ ] Frontend can connect to backend
- [ ] Authentication flow working end-to-end

---

## Additional Resources

- [AWS ECS Documentation](https://docs.aws.amazon.com/ecs/)
- [AWS Amplify Documentation](https://docs.aws.amazon.com/amplify/)
- [Terraform AWS Provider](https://registry.terraform.io/providers/hashicorp/aws/latest/docs)
- [Supabase Documentation](https://supabase.com/docs)
- [WorkOS Documentation](https://workos.com/docs)
