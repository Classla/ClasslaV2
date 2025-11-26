# Quick Start Guide - Classla LMS on AWS

**TL;DR**: Your infrastructure is correct. DynamoDB is only for Terraform state locking, not your app. You use Supabase. Backend runs on ECS Fargate (not EC2). Just need to add custom domain configuration.

## What You Have

```
✅ Vite frontend → AWS Amplify
✅ Express.js backend → ECS Fargate (auto-scaling 1-2 tasks)
✅ Application Load Balancer → HTTPS + health checks
✅ Supabase integration → PostgreSQL database
✅ No DynamoDB for app data (only Terraform state locking)
```

## What You Need to Do

### 1. Request SSL Certificates (15 minutes)

```bash
# Backend certificate
aws acm request-certificate \
  --domain-name api.classla.org \
  --validation-method DNS \
  --region us-east-1

# Frontend certificate
aws acm request-certificate \
  --domain-name app.classla.org \
  --validation-method DNS \
  --region us-east-1

# Go to ACM console and click "Create records in Route 53" for each
# Wait 5-30 minutes for validation
```

### 2. Create Secrets (5 minutes)

```bash
# Supabase credentials
aws secretsmanager create-secret \
  --name classla/supabase/credentials \
  --secret-string '{
    "url": "https://YOUR_PROJECT.supabase.co",
    "anon_key": "YOUR_ANON_KEY",
    "service_role_key": "YOUR_SERVICE_ROLE_KEY"
  }' \
  --region us-east-1

# WorkOS credentials
aws secretsmanager create-secret \
  --name classla/workos/credentials \
  --secret-string '{
    "api_key": "sk_live_YOUR_KEY",
    "client_id": "client_YOUR_ID"
  }' \
  --region us-east-1

# App secrets
aws secretsmanager create-secret \
  --name classla/app/secrets \
  --secret-string "{
    \"session_secret\": \"$(openssl rand -base64 32)\"
  }" \
  --region us-east-1
```

### 3. Configure Terraform (5 minutes)

```bash
cd infrastructure/terraform

# Copy example file
cp terraform.tfvars.example terraform.tfvars

# Edit terraform.tfvars and add:
# - certificate_arn (from step 1)
# - github_repository
# - workos_client_id
```

### 4. Deploy Infrastructure (15 minutes)

```bash
# Initialize Terraform backend
cd infrastructure/scripts
./init-terraform.sh

# Deploy
cd ../terraform
terraform init
terraform plan
terraform apply
```

### 5. Configure Custom Domain (10 minutes)

**Backend DNS (api.classla.org)**:

```bash
# Get ALB DNS name
ALB_DNS=$(terraform output -raw alb_dns_name)

# Go to Route53 console → classla.org hosted zone
# Create A record: api → Alias to ALB
```

**Frontend DNS (app.classla.org)**:

```bash
# Go to Amplify console → Domain management
# Add domain: classla.org
# Subdomain: app
# Amplify will auto-configure DNS
```

### 6. Deploy Application (10 minutes)

```bash
# Build and push backend
ECR_REPO=$(terraform output -raw ecr_repository_url)
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin $ECR_REPO

cd ../../classla-backend
docker build -t classla-backend .
docker tag classla-backend:latest $ECR_REPO:latest
docker push $ECR_REPO:latest

# Frontend deploys automatically via Amplify when you push to GitHub
```

### 7. Verify (5 minutes)

```bash
# Test backend
curl https://api.classla.org/health

# Test frontend
open https://app.classla.org
```

## Total Time: ~1 hour (plus 30 min waiting for certificates)

## Architecture

```
Internet
    ↓
┌─────────────────────────────────┐
│ app.classla.org (Amplify)       │  ← Frontend
│ - Vite/React                    │
│ - Auto-deploy from GitHub       │
└─────────────────────────────────┘
    ↓ API calls
┌─────────────────────────────────┐
│ api.classla.org (ALB)           │  ← Load Balancer
│ - HTTPS termination             │
│ - Health checks                 │
└─────────────────────────────────┘
    ↓
┌─────────────────────────────────┐
│ ECS Fargate (Private Subnets)   │  ← Backend
│ - Express.js                    │
│ - Auto-scaling: 1-2 tasks       │
│ - Pulls secrets at runtime      │
└─────────────────────────────────┘
    ↓
┌─────────────────────────────────┐
│ External Services               │
│ - Supabase (PostgreSQL)         │  ← Your Database
│ - WorkOS (Auth)                 │
│ - S3 (Files)                    │
└─────────────────────────────────┘
```

## Cost: ~$119/month

- ECS Fargate: $15
- ALB: $20
- NAT Gateways: $65
- VPC Endpoints: $15
- Other: $4

**Dev cost savings**: Set `single_nat_gateway = true` to save $32/month

## Important Notes

1. **DynamoDB is NOT used for your app** - Only for Terraform state locking
2. **Backend runs on ECS Fargate** - Not EC2 instances (no server management)
3. **Supabase is your database** - PostgreSQL, not DynamoDB
4. **Auto-scaling is configured** - 1-2 tasks based on CPU/memory

## Detailed Documentation

- **Full review**: `infrastructure/docs/INFRASTRUCTURE_REVIEW.md`
- **Domain setup**: `infrastructure/docs/DOMAIN_SETUP.md`
- **Deployment guide**: `infrastructure/docs/DEPLOYMENT.md`
- **Configuration**: `infrastructure/docs/CONFIGURATION.md`

## Troubleshooting

**ECS tasks won't start**:

```bash
aws logs tail /ecs/classla-backend --follow
```

**ALB returns 503**:

```bash
# Check target health
aws elbv2 describe-target-health --target-group-arn $(terraform output -raw alb_target_group_arn)
```

**Frontend can't reach backend**:

- Verify CORS allows `https://app.classla.org`
- Check `VITE_API_URL` in Amplify env vars

## Next Steps After Deployment

1. Set up CloudWatch alarms
2. Configure billing alerts
3. Test auto-scaling
4. Add WAF to ALB (optional)
5. Set up staging environment

## Questions?

Your infrastructure is solid. The AI did a good job. Just follow the steps above and you'll be live in about an hour.
