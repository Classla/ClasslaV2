# Design Document: AWS Deployment Infrastructure

## Overview

This design document outlines the complete AWS infrastructure for deploying the Classla LMS application using Terraform. The architecture follows AWS best practices for scalability, security, and cost-effectiveness. The backend Express.js application with WebSocket support will run on ECS Fargate (1 task normally, auto-scaling to 2 under load), while the React frontend will be hosted on AWS Amplify.

### Architecture Goals

- **Scalability**: Auto-scaling ECS tasks based on demand
- **High Availability**: Multi-AZ deployment for fault tolerance
- **Security**: Private subnets for backend and database, least-privilege access
- **Maintainability**: Infrastructure as Code with Terraform
- **Cost Optimization**: Fargate for serverless container management

## Architecture

### High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         Internet Users                           │
└────────────────┬────────────────────────┬───────────────────────┘
                 │                        │
                 │ HTTPS                  │ HTTPS
                 ▼                        ▼
        ┌────────────────┐      ┌─────────────────┐
        │      ALB       │      │  AWS Amplify    │
        │  (Port 80/443) │      │   (Frontend)    │
        │ Idle: 3600s    │      └─────────────────┘
        └────────┬───────┘
                 │
                 │ HTTP/WebSocket
                 ▼
    ┌────────────────────────────┐
    │      ECS Fargate Cluster   │
    │  ┌──────┐  ┌──────┐       │
    │  │Task 1│  │Task 2│       │
    │  │Express│  │(scales│      │
    │  │Socket │  │ up)   │      │
    │  └───┬──┘  └───┬──┘       │
    └──────┼─────────┼───────────┘
           │         │
           │         │ (HTTPS)
           ▼         ▼
    ┌──────────────────────┐
    │   Supabase           │
    │   (Managed Service)  │
    └──────────────────────┘
```

### Network Architecture

```
VPC (10.0.0.0/16)
├── Public Subnets (2 AZs)
│   ├── 10.0.1.0/24 (us-east-1a)
│   ├── 10.0.2.0/24 (us-east-1b)
│   ├── NAT Gateway (AZ-a)
│   ├── NAT Gateway (AZ-b)
│   └── Application Load Balancer
│
└── Private Subnets (2 AZs)
    ├── 10.0.11.0/24 (us-east-1a) - ECS Tasks
    └── 10.0.12.0/24 (us-east-1b) - ECS Tasks
```

## Components and Interfaces

### 1. Terraform Project Structure

```
infrastructure/
├── terraform/
│   ├── main.tf                 # Main Terraform configuration
│   ├── variables.tf            # Input variables
│   ├── outputs.tf              # Output values
│   ├── terraform.tfvars.example # Example variables file
│   ├── backend.tf              # S3 backend configuration
│   ├── versions.tf             # Provider versions
│   │
│   ├── modules/
│   │   ├── networking/         # VPC, subnets, NAT gateways
│   │   │   ├── main.tf
│   │   │   ├── variables.tf
│   │   │   └── outputs.tf
│   │   │
│   │   ├── ecs/                # ECS cluster, task definition, service
│   │   │   ├── main.tf
│   │   │   ├── variables.tf
│   │   │   └── outputs.tf
│   │   │
│   │   ├── alb/                # Application Load Balancer
│   │   │   ├── main.tf
│   │   │   ├── variables.tf
│   │   │   └── outputs.tf
│   │   │
│   │   ├── ecr/                # Container registry
│   │   │   ├── main.tf
│   │   │   ├── variables.tf
│   │   │   └── outputs.tf
│   │   │
│   │   ├── secrets/            # Secrets Manager
│   │   │   ├── main.tf
│   │   │   ├── variables.tf
│   │   │   └── outputs.tf
│   │   │
│   │   └── amplify/            # Amplify hosting
│   │       ├── main.tf
│   │       ├── variables.tf
│   │       └── outputs.tf
│   │
│   └── environments/
│       ├── dev.tfvars
│       └── prod.tfvars
│
├── docker/
│   ├── Dockerfile              # Backend container image
│   └── .dockerignore
│
├── scripts/
│   ├── init-terraform.sh       # Initialize Terraform backend
│   ├── deploy.sh               # Deploy infrastructure
│   └── destroy.sh              # Destroy infrastructure
│
└── docs/
    ├── SETUP.md                # AWS account setup guide
    ├── DEPLOYMENT.md           # Deployment instructions
    └── CONFIGURATION.md        # Configuration reference
```

### 2. VPC and Networking Module

**Purpose**: Create isolated network infrastructure with public and private subnets across multiple availability zones.

**Resources**:

- VPC with CIDR 10.0.0.0/16
- Internet Gateway
- 2 Public Subnets (10.0.1.0/24, 10.0.2.0/24)
- 4 Private Subnets (10.0.11.0/24, 10.0.12.0/24 for ECS, 10.0.21.0/24, 10.0.22.0/24 for RDS)
- 2 NAT Gateways (one per AZ for high availability)
- Route Tables for public and private subnets
- VPC Endpoints for S3 and ECR (cost optimization)

**Outputs**:

- VPC ID
- Public subnet IDs
- Private subnet IDs (ECS and RDS)
- NAT Gateway IPs

### 3. ECR Module

**Purpose**: Container registry for storing Docker images of the backend application.

**Resources**:

- ECR Repository with lifecycle policy (keep last 10 images)
- Repository policy for ECS task role access
- Image scanning on push

**Outputs**:

- Repository URL
- Repository ARN

### 4. ECS Module

**Purpose**: Run the Express.js backend application with WebSocket support on Fargate.

**Resources**:

- ECS Cluster
- Task Definition:
  - Container: Express.js app from ECR
  - CPU: 512 (0.5 vCPU)
  - Memory: 1024 MB
  - Port mappings: 3001
  - Environment variables from Secrets Manager
  - CloudWatch Logs configuration
- ECS Service:
  - Desired count: 1 (minimum)
  - Max count: 2
  - Launch type: FARGATE
  - Network mode: awsvpc
  - Health check grace period: 60 seconds
  - Deployment configuration: Rolling update
- Auto Scaling:
  - Target tracking on CPU (70%)
  - Target tracking on memory (80%)
  - Scale-in cooldown: 300 seconds
  - Scale-out cooldown: 60 seconds
- IAM Roles:
  - Task execution role (pull images, write logs)
  - Task role (access Secrets Manager, S3)

**Outputs**:

- Cluster ARN
- Service name
- Task definition ARN
- Security group ID

### 5. ALB Module

**Purpose**: Distribute traffic to ECS tasks with WebSocket support.

**Resources**:

- Application Load Balancer (internet-facing)
- Target Group:
  - Protocol: HTTP
  - Port: 3001
  - Health check: /health
  - Deregistration delay: 30 seconds
  - Stickiness: enabled (for WebSocket)
- Listeners:
  - HTTP (80): Redirect to HTTPS
  - HTTPS (443): Forward to target group
- Connection settings:
  - Idle timeout: 3600 seconds (for WebSocket)
- Security Group:
  - Inbound: 80, 443 from anywhere (0.0.0.0/0)
  - Outbound: 3001 to ECS tasks
- SSL Certificate (ACM) for HTTPS listener

**Outputs**:

- ALB DNS name
- ALB ARN
- Target group ARN
- Security group ID

### 6. Secrets Manager Module

**Purpose**: Securely store and manage application secrets.

**Resources**:

- Secrets:
  - `classla/supabase/credentials`: Supabase URL, anon key, and service role key
  - `classla/workos/credentials`: WorkOS API key and client ID
  - `classla/app/secrets`: Session secret and other application secrets
- Automatic rotation policy (optional)

**Outputs**:

- Secret ARNs

### 7. Amplify Module

**Purpose**: Host and deploy the React frontend with automatic CI/CD.

**Resources**:

- Amplify App:
  - Repository: GitHub
  - Branch: main
  - Build settings: Auto-detect (Vite)
  - Environment variables: API_URL, etc.
  - Custom domain (optional)
- Build specification:
  ```yaml
  version: 1
  frontend:
    phases:
      preBuild:
        commands:
          - cd classla-frontend
          - npm ci
      build:
        commands:
          - npm run build
    artifacts:
      baseDirectory: classla-frontend/dist
      files:
        - "**/*"
    cache:
      paths:
        - classla-frontend/node_modules/**/*
  ```
- IAM Service Role for Amplify

**Outputs**:

- Amplify app ID
- Default domain
- Branch URL

### 8. Backend Dockerfile

**Purpose**: Containerize the Express.js application for ECS deployment.

**Dockerfile**:

```dockerfile
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY classla-backend/package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY classla-backend/ ./

# Build TypeScript
RUN npm run build

# Production image
FROM node:20-alpine

WORKDIR /app

# Copy built application
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Run migrations on startup (optional, can be separate task)
COPY classla-backend/migrations ./migrations

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s \
  CMD node -e "require('http').get('http://localhost:3001/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start application
CMD ["node", "dist/server.js"]
```

## Data Models

### Terraform State

**Backend Configuration**:

- S3 bucket for state storage
- DynamoDB table for state locking
- Encryption at rest
- Versioning enabled

**State Structure**:

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

### Environment Variables

**ECS Task Environment Variables** (from Secrets Manager):

```json
{
  "PORT": "3001",
  "NODE_ENV": "production",
  "SUPABASE_URL": "<from-secrets>",
  "SUPABASE_ANON_KEY": "<from-secrets>",
  "SUPABASE_SERVICE_ROLE_KEY": "<from-secrets>",
  "WORKOS_API_KEY": "<from-secrets>",
  "WORKOS_CLIENT_ID": "<from-secrets>",
  "WORKOS_REDIRECT_URI": "<alb-url>/auth/callback",
  "FRONTEND_URL": "<amplify-url>",
  "SESSION_SECRET": "<from-secrets>"
}
```

**Amplify Environment Variables**:

```
VITE_API_URL=<alb-url>
VITE_WORKOS_CLIENT_ID=<workos-client-id>
```

## Error Handling

### Terraform Error Handling

1. **State Lock Conflicts**:

   - Use DynamoDB for state locking
   - Implement retry logic in deployment scripts
   - Force unlock only as last resort

2. **Resource Creation Failures**:

   - Use `depends_on` for proper resource ordering
   - Implement timeouts for long-running resources
   - Use `create_before_destroy` for zero-downtime updates

3. **Validation Errors**:
   - Validate variables with constraints
   - Use `terraform validate` in CI/CD
   - Pre-flight checks in deployment scripts

### Application Error Handling

1. **ECS Task Failures**:

   - Health checks with automatic task replacement
   - CloudWatch alarms for task failures
   - Auto-scaling to maintain desired count

2. **Supabase Connection Failures**:

   - Connection retry logic in application
   - Health check endpoint tests Supabase connectivity
   - Supabase handles high availability automatically

3. **Secrets Access Failures**:
   - IAM role validation before deployment
   - Graceful degradation if non-critical secrets missing
   - CloudWatch logs for debugging

## Testing Strategy

### Infrastructure Testing

1. **Terraform Validation**:

   - `terraform fmt -check` for formatting
   - `terraform validate` for syntax
   - `tflint` for best practices

2. **Plan Review**:

   - Review `terraform plan` output before apply
   - Use `-out` flag to save and apply exact plan
   - Peer review for production changes

3. **Smoke Tests**:
   - Health check endpoint after deployment
   - Verify ALB → ECS connectivity
   - Test WebSocket connections
   - Verify Supabase connectivity

### CI/CD Testing

1. **Backend Build**:

   - Docker build succeeds
   - Image size within limits
   - Security scanning with Trivy

2. **Frontend Build**:

   - Vite build succeeds
   - No TypeScript errors
   - Bundle size within limits

3. **Integration Tests**:
   - Deploy to staging environment first
   - Run smoke tests
   - Promote to production after validation

## Security Considerations

### Network Security

- Private subnets for ECS tasks
- Security groups with least-privilege rules
- VPC endpoints to avoid NAT gateway costs
- ALB with HTTPS for secure connections

### Access Control

- IAM roles with minimal permissions
- Secrets Manager for sensitive data
- No hardcoded credentials
- MFA for AWS console access

### Data Security

- SSL/TLS for all connections (ALB HTTPS)
- Secrets Manager encryption
- S3 bucket encryption for logs
- Supabase handles database encryption

### Compliance

- CloudWatch Logs retention (90 days)
- ALB access logs to S3
- VPC Flow Logs (optional)

## Deployment Process

### Initial Setup

1. **AWS Account Setup**:

   - Create AWS account
   - Enable MFA
   - Create IAM user with programmatic access
   - Configure AWS CLI

2. **Terraform Backend Setup**:

   - Create S3 bucket for state
   - Create DynamoDB table for locks
   - Initialize Terraform

3. **Secrets Configuration**:
   - Create secrets in Secrets Manager
   - Store Supabase credentials (URL, anon key, service role key)
   - Store WorkOS credentials (API key, client ID)
   - Store session secret

### Infrastructure Deployment

1. **Initialize Terraform**:

   ```bash
   cd infrastructure/terraform
   terraform init
   ```

2. **Plan Changes**:

   ```bash
   terraform plan -var-file=environments/prod.tfvars -out=tfplan
   ```

3. **Apply Changes**:

   ```bash
   terraform apply tfplan
   ```

4. **Verify Outputs**:
   - Note ALB DNS name
   - Update application configuration with ALB URL

### Application Deployment

1. **Backend**:

   - GitHub Actions builds Docker image
   - Pushes to ECR
   - Updates ECS service with new image
   - ECS performs rolling update

2. **Frontend**:
   - Push to main branch
   - Amplify auto-builds and deploys
   - Invalidates CDN cache

### Rollback Strategy

1. **Infrastructure**:

   - Revert Terraform changes
   - Apply previous state

2. **Backend**:

   - Deploy previous Docker image tag
   - ECS performs rolling update

3. **Frontend**:
   - Amplify rollback to previous deployment

## Monitoring and Observability

### CloudWatch Metrics

- ECS: CPU, memory, task count
- ALB: Request count, latency, error rate, target health

### CloudWatch Alarms

- ECS task failures
- ALB 5xx errors > threshold
- ECS CPU > 70%
- ECS memory > 80%

### Logging

- ECS task logs → CloudWatch Logs
- ALB access logs → S3
- VPC Flow Logs → CloudWatch Logs (optional)

### Dashboards

- Application health dashboard
- Infrastructure metrics dashboard
- Cost monitoring dashboard

## Cost Optimization

### Estimated Monthly Costs (Production)

- ECS Fargate (1 task normally): ~$15
- ALB: ~$20
- NAT Gateways (2): ~$65
- Amplify: ~$0 (free tier)
- Supabase: Managed externally (separate billing)
- **Total**: ~$100/month (scales to ~$115/month with 2 tasks under load)

### Cost Reduction Strategies

- Use VPC endpoints to reduce NAT gateway costs
- Single NAT gateway for dev environment
- S3 lifecycle policies for logs
- In-memory sessions (simple and reliable for most use cases)
- Right-size ECS tasks based on actual usage

## Future Enhancements

1. **Route 53**: Custom domain management
2. **CloudWatch Synthetics**: Automated testing
3. **AWS Backup**: Centralized backup management
4. **Multi-region**: Disaster recovery setup
5. **Blue/Green Deployments**: Zero-downtime deployments
6. **Container Insights**: Enhanced ECS monitoring
7. **ElastiCache Redis**: If session persistence across tasks becomes needed
8. **CloudFront**: If global CDN and DDoS protection becomes needed
