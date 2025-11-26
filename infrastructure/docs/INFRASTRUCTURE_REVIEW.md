# Infrastructure Review Summary

**Date**: October 23, 2025  
**Reviewed By**: Kiro AI  
**Project**: Classla LMS AWS Infrastructure

## Executive Summary

Your Terraform infrastructure setup is **fundamentally sound** and correctly configured for:

- ✅ Vite frontend on AWS Amplify
- ✅ Express.js backend on ECS Fargate (NOT EC2 instances)
- ✅ Application Load Balancer with auto-scaling
- ✅ Supabase integration (no DynamoDB for application data)

**Key Finding**: All DynamoDB references are ONLY for Terraform state locking (standard practice), not for your application.

## What's Correct

### 1. No Application DynamoDB ✅

- **Finding**: DynamoDB is only used for Terraform state locking
- **Location**: `infrastructure/terraform/backend.tf`
- **Purpose**: Prevents concurrent Terraform runs from corrupting state
- **Impact**: This is a best practice and does NOT affect your application
- **Your app correctly uses**: Supabase (PostgreSQL)

### 2. ECS Fargate (Not EC2) ✅

- **Finding**: Backend runs on ECS Fargate, not EC2 instances
- **Configuration**: `launch_type = "FARGATE"` in `modules/ecs/main.tf`
- **Benefits**:
  - No server management required
  - Automatic scaling (1-2 tasks based on CPU/memory)
  - Pay only for what you use
  - Easier to manage than EC2

### 3. Proper Architecture ✅

```
Internet
    ↓
Route53 (classla.org)
    ↓
┌─────────────────────────────────────────┐
│  Frontend: AWS Amplify                  │
│  - Vite/React app                       │
│  - CDN distribution                     │
│  - Auto-deploy from GitHub              │
│  - Domain: app.classla.org              │
└─────────────────────────────────────────┘
    ↓ API calls
┌─────────────────────────────────────────┐
│  Application Load Balancer (ALB)        │
│  - HTTPS termination                    │
│  - Health checks                        │
│  - Domain: api.classla.org              │
└─────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────┐
│  ECS Fargate (Private Subnets)          │
│  - Express.js backend                   │
│  - Auto-scaling: 1-2 tasks              │
│  - Pulls secrets from Secrets Manager   │
└─────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────┐
│  External Services                      │
│  - Supabase (PostgreSQL database)       │
│  - WorkOS (Authentication)              │
│  - S3 (File storage)                    │
└─────────────────────────────────────────┘
```

### 4. Supabase Integration ✅

- **Credentials stored in**: AWS Secrets Manager
- **Secrets**:
  - `classla/supabase/credentials` (URL, anon key, service role key)
  - `classla/workos/credentials` (API key, client ID)
  - `classla/app/secrets` (session secret)
- **Access**: ECS tasks pull secrets at runtime
- **Security**: Secrets never stored in code or environment variables

### 5. Auto-Scaling Configuration ✅

- **Min tasks**: 1
- **Max tasks**: 2
- **Scaling triggers**:
  - CPU utilization > 70%
  - Memory utilization > 80%
- **Cooldown**: 5 minutes scale-in, 1 minute scale-out

### 6. Networking ✅

- **VPC**: 10.0.0.0/16
- **Public subnets**: For ALB (internet-facing)
- **Private subnets**: For ECS tasks (no direct internet access)
- **NAT Gateways**: For ECS tasks to reach internet (Supabase, WorkOS)
- **VPC Endpoints**: For S3 and ECR (reduces NAT costs)

## What Needs Attention

### 1. Missing Route53 Configuration ⚠️

**Issue**: No Terraform module to create DNS records for your custom domain

**Current State**:

- Domain `classla.org` exists in Route53
- No automated DNS record creation
- Manual configuration required after deployment

**Solution**: See `DOMAIN_SETUP.md` for:

- Option A: Add Route53 Terraform module (recommended)
- Option B: Manual DNS configuration

**Recommended DNS Setup**:

- `app.classla.org` → Amplify (frontend)
- `api.classla.org` → ALB (backend)

### 2. ACM Certificate Required ⚠️

**Issue**: HTTPS requires SSL certificate, but none is created by Terraform

**Current State**:

- `certificate_arn` variable exists but is empty
- Must be manually created before deployment

**Action Required**:

```bash
# Request certificate for backend
aws acm request-certificate \
  --domain-name api.classla.org \
  --validation-method DNS \
  --region us-east-1

# Request certificate for frontend
aws acm request-certificate \
  --domain-name app.classla.org \
  --validation-method DNS \
  --region us-east-1
```

Then add the backend certificate ARN to `terraform.tfvars`:

```hcl
certificate_arn = "arn:aws:acm:us-east-1:ACCOUNT_ID:certificate/CERT_ID"
```

### 3. Amplify Custom Domain Not Configured ⚠️

**Issue**: Amplify module doesn't configure custom domain

**Current State**:

- Amplify will deploy to default domain: `main.d1234567890.amplifyapp.com`
- Custom domain must be added manually

**Solution**: See `DOMAIN_SETUP.md` for:

- Option A: Configure via Amplify Console (easier)
- Option B: Add to Terraform (more automated)

### 4. Missing ALB Zone ID Output ✅ FIXED

**Issue**: Route53 alias records need ALB zone ID

**Status**: Fixed - Added `alb_zone_id` output to ALB module

## Documentation Issues

### 1. Misleading DynamoDB References

**Files with DynamoDB mentions**:

- `infrastructure/docs/SETUP.md` (line 240, 263)
- `infrastructure/docs/DEPLOYMENT.md` (multiple lines)
- `infrastructure/docs/CONFIGURATION.md` (line 765)
- `infrastructure/scripts/init-terraform.sh`
- `infrastructure/scripts/destroy.sh`

**Context**: All references are for Terraform state locking, NOT application data

**Recommendation**: Add clarification note at the top of each doc:

```markdown
> **Note**: This infrastructure uses DynamoDB ONLY for Terraform state locking.
> Your application data is stored in Supabase (PostgreSQL), not DynamoDB.
```

### 2. EC2 vs ECS Confusion

**Your Question**: "backend to be hosted on ec2s that will scale"

**Reality**: Backend is on ECS Fargate, not EC2

**Clarification**:

- ECS Fargate = Serverless containers (no EC2 management)
- ECS on EC2 = You manage EC2 instances
- Your setup = ECS Fargate ✅

**Benefits of Fargate over EC2**:

- No server patching or maintenance
- Automatic scaling without managing instances
- Pay per task, not per instance
- Simpler architecture

## Cost Estimate

### Monthly Costs (Production)

| Service         | Configuration              | Estimated Cost  |
| --------------- | -------------------------- | --------------- |
| ECS Fargate     | 1 task (0.5 vCPU, 1GB RAM) | ~$15            |
| ALB             | Standard load balancer     | ~$20            |
| NAT Gateway     | 2 AZs                      | ~$65            |
| VPC Endpoints   | S3 + ECR                   | ~$15            |
| Amplify         | Build + hosting            | ~$0 (free tier) |
| Secrets Manager | 3 secrets                  | ~$1.20          |
| CloudWatch Logs | 5GB/month                  | ~$2.50          |
| Route53         | Hosted zone + queries      | ~$0.50          |
| **Total**       |                            | **~$119/month** |

### Cost Optimization Options

**Development Environment**:

```hcl
# In terraform.tfvars
single_nat_gateway = true  # Saves ~$32/month
ecs_max_count = 1          # No auto-scaling
```

**Production Optimizations**:

- VPC Endpoints already enabled (reduces NAT costs)
- Single NAT Gateway option available for dev
- Fargate Spot (not configured, could save 70%)

## Security Review

### ✅ Good Security Practices

1. **Secrets Management**

   - All credentials in AWS Secrets Manager
   - No secrets in code or environment variables
   - ECS tasks pull secrets at runtime

2. **Network Security**

   - ECS tasks in private subnets
   - Security groups restrict traffic
   - ALB in public subnets only

3. **Encryption**

   - HTTPS on ALB (when certificate configured)
   - Secrets Manager encryption at rest
   - S3 state bucket encryption enabled

4. **IAM Least Privilege**
   - Separate task execution and task roles
   - Minimal permissions for each role

### ⚠️ Security Recommendations

1. **Enable Container Insights**

   - Already configured: `containerInsights = "enabled"`
   - Monitor for security anomalies

2. **Add WAF to ALB** (Optional)

   - Protect against common web exploits
   - Rate limiting
   - IP blocking

3. **Enable VPC Flow Logs** (Not configured)

   - Monitor network traffic
   - Detect suspicious activity

4. **Rotate Secrets Regularly**
   - Set up automatic rotation in Secrets Manager
   - Update Supabase and WorkOS keys periodically

## Deployment Checklist

### Pre-Deployment

- [ ] AWS account configured
- [ ] AWS CLI installed and configured
- [ ] Terraform installed (v1.0+)
- [ ] Domain `classla.org` in Route53
- [ ] Supabase project created
- [ ] WorkOS account created
- [ ] GitHub repository access

### Certificate Setup

- [ ] Request ACM certificate for `api.classla.org`
- [ ] Request ACM certificate for `app.classla.org`
- [ ] Validate certificates via DNS
- [ ] Add backend certificate ARN to `terraform.tfvars`

### Secrets Configuration

- [ ] Create `classla/supabase/credentials` in Secrets Manager
- [ ] Create `classla/workos/credentials` in Secrets Manager
- [ ] Create `classla/app/secrets` in Secrets Manager
- [ ] Verify all secrets in correct region (us-east-1)

### Terraform Deployment

- [ ] Initialize Terraform backend (run `init-terraform.sh`)
- [ ] Copy `terraform.tfvars.example` to `terraform.tfvars`
- [ ] Fill in all required variables
- [ ] Run `terraform plan` and review
- [ ] Run `terraform apply`
- [ ] Save Terraform outputs

### DNS Configuration

- [ ] Create Route53 A record: `api.classla.org` → ALB
- [ ] Configure Amplify custom domain: `app.classla.org`
- [ ] Wait for DNS propagation (5-60 minutes)
- [ ] Verify DNS resolution

### Application Deployment

- [ ] Build backend Docker image
- [ ] Push image to ECR
- [ ] ECS service deploys automatically
- [ ] Verify backend health: `https://api.classla.org/health`
- [ ] Push frontend code to GitHub
- [ ] Amplify builds and deploys automatically
- [ ] Verify frontend loads: `https://app.classla.org`

### Post-Deployment

- [ ] Update WorkOS redirect URI to `https://api.classla.org/auth/callback`
- [ ] Update Amplify env vars with custom domain
- [ ] Test authentication flow end-to-end
- [ ] Set up CloudWatch alarms
- [ ] Configure billing alerts
- [ ] Document deployment for team

## Recommended Next Steps

### Immediate (Before Deployment)

1. **Read `DOMAIN_SETUP.md`** - Complete guide for custom domain configuration
2. **Request ACM certificates** - Required for HTTPS
3. **Create secrets in Secrets Manager** - Required for backend to start
4. **Decide on DNS approach** - Terraform module vs manual configuration

### Short-term (After Initial Deployment)

1. **Add Route53 Terraform module** - Automate DNS management
2. **Configure Amplify custom domain** - Use `app.classla.org` instead of default
3. **Set up monitoring** - CloudWatch dashboards and alarms
4. **Test auto-scaling** - Verify scaling policies work correctly

### Long-term (Production Hardening)

1. **Add WAF to ALB** - Protect against web attacks
2. **Enable VPC Flow Logs** - Network traffic monitoring
3. **Set up secret rotation** - Automatic credential rotation
4. **Implement backup strategy** - Terraform state backups
5. **Add staging environment** - Separate environment for testing
6. **Configure CI/CD** - GitHub Actions for automated deployments

## Files Modified

1. **Created**: `infrastructure/docs/DOMAIN_SETUP.md`

   - Complete guide for custom domain configuration
   - Step-by-step instructions for Route53 and Amplify

2. **Modified**: `infrastructure/terraform/modules/alb/outputs.tf`
   - Added `alb_zone_id` output for Route53 alias records

## Conclusion

Your infrastructure is **well-designed and ready for deployment** with minor additions:

1. ✅ **No DynamoDB for application** - Only used for Terraform state locking
2. ✅ **Correct architecture** - ECS Fargate (not EC2) with ALB and Amplify
3. ✅ **Supabase properly integrated** - Credentials in Secrets Manager
4. ⚠️ **Missing custom domain setup** - Follow `DOMAIN_SETUP.md` to configure
5. ⚠️ **Certificate required** - Request ACM certificates before deployment

The infrastructure was AI-generated but is fundamentally sound. The DynamoDB references in documentation are misleading but don't affect your application.

**Estimated time to production**: 2-3 hours (mostly waiting for certificate validation and DNS propagation)

## Questions?

If you have questions about:

- **Domain setup**: See `DOMAIN_SETUP.md`
- **Deployment process**: See `infrastructure/docs/DEPLOYMENT.md`
- **Configuration values**: See `infrastructure/docs/CONFIGURATION.md`
- **Troubleshooting**: See `infrastructure/docs/DEPLOYMENT.md` (Troubleshooting section)
