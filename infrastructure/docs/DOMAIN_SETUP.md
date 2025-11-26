# Domain Setup Guide for app.classla.org

This guide explains how to configure your custom domain `app.classla.org` for the Classla LMS application.

## Overview

Your infrastructure will have two main components:

- **Backend API**: Hosted on ECS Fargate behind an ALB → `api.classla.org` (recommended) or `app.classla.org/api`
- **Frontend**: Hosted on AWS Amplify → `app.classla.org`

## Prerequisites

- Domain `classla.org` is already in Route53 in your AWS account
- You have access to modify DNS records

## Step 1: Request ACM Certificates

You need SSL certificates for both the backend and frontend.

### Backend Certificate (for ALB)

```bash
# Request certificate for API subdomain
aws acm request-certificate \
  --domain-name api.classla.org \
  --validation-method DNS \
  --region us-east-1

# Note the CertificateArn from the output
```

### Frontend Certificate (for Amplify)

```bash
# Request certificate for app subdomain
# IMPORTANT: Amplify requires certificates in us-east-1
aws acm request-certificate \
  --domain-name app.classla.org \
  --validation-method DNS \
  --region us-east-1

# Note the CertificateArn from the output
```

### Validate Certificates

1. Go to AWS Certificate Manager console
2. Click on each certificate
3. Click "Create records in Route 53" button
4. Wait 5-30 minutes for validation to complete

## Step 2: Update Terraform Configuration

Add the certificate ARN to your `terraform.tfvars`:

```hcl
# Add this line with your actual certificate ARN
certificate_arn = "arn:aws:acm:us-east-1:YOUR_ACCOUNT_ID:certificate/YOUR_CERT_ID"
```

## Step 3: Create Route53 Records for Backend

After Terraform creates the ALB, you need to create a DNS record pointing to it.

### Option A: Add Route53 Module to Terraform (Recommended)

Create a new file `infrastructure/terraform/modules/route53/main.tf`:

```hcl
# Route53 DNS records for custom domain

data "aws_route53_zone" "main" {
  name         = var.domain_name
  private_zone = false
}

# A record for API subdomain pointing to ALB
resource "aws_route53_record" "api" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = "api.${var.domain_name}"
  type    = "A"

  alias {
    name                   = var.alb_dns_name
    zone_id                = var.alb_zone_id
    evaluate_target_health = true
  }
}

# Optional: AAAA record for IPv6
resource "aws_route53_record" "api_ipv6" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = "api.${var.domain_name}"
  type    = "AAAA"

  alias {
    name                   = var.alb_dns_name
    zone_id                = var.alb_zone_id
    evaluate_target_health = true
  }
}
```

Create `infrastructure/terraform/modules/route53/variables.tf`:

```hcl
variable "domain_name" {
  description = "Base domain name (e.g., classla.org)"
  type        = string
}

variable "alb_dns_name" {
  description = "DNS name of the ALB"
  type        = string
}

variable "alb_zone_id" {
  description = "Zone ID of the ALB"
  type        = string
}
```

Create `infrastructure/terraform/modules/route53/outputs.tf`:

```hcl
output "api_domain" {
  description = "API domain name"
  value       = aws_route53_record.api.fqdn
}
```

Then add to `infrastructure/terraform/main.tf`:

```hcl
# Add this module after the ALB module
module "route53" {
  source = "./modules/route53"

  domain_name  = "classla.org"
  alb_dns_name = module.alb.alb_dns_name
  alb_zone_id  = module.alb.alb_zone_id

  depends_on = [module.alb]
}
```

### Option B: Manual DNS Configuration

If you prefer not to use Terraform for DNS:

1. Get the ALB DNS name after deployment:

   ```bash
   cd infrastructure/terraform
   terraform output alb_dns_name
   ```

2. Go to Route53 console
3. Select your hosted zone `classla.org`
4. Click "Create record"
5. Configure:
   - Record name: `api`
   - Record type: `A - Routes traffic to an IPv4 address and some AWS resources`
   - Toggle "Alias" to ON
   - Route traffic to: "Alias to Application and Classic Load Balancer"
   - Region: `us-east-1` (or your region)
   - Select your ALB from the dropdown
6. Click "Create records"

## Step 4: Configure Amplify Custom Domain

After Terraform creates the Amplify app:

### Option A: Via AWS Console (Easier)

1. Go to AWS Amplify console
2. Select your app (`classla-frontend`)
3. Click "Domain management" in the left menu
4. Click "Add domain"
5. Select `classla.org` from the dropdown (it should auto-detect your Route53 domain)
6. For subdomain, enter: `app`
7. Click "Configure domain"
8. Amplify will automatically:
   - Create the necessary DNS records in Route53
   - Provision an SSL certificate
   - Configure the domain

### Option B: Via Terraform (More Complex)

Add to `infrastructure/terraform/modules/amplify/main.tf`:

```hcl
# Custom domain configuration
resource "aws_amplify_domain_association" "main" {
  count = var.custom_domain != "" ? 1 : 0

  app_id      = aws_amplify_app.frontend.id
  domain_name = var.custom_domain

  # Subdomain configuration
  sub_domain {
    branch_name = aws_amplify_branch.main.branch_name
    prefix      = var.custom_subdomain
  }

  # Wait for DNS propagation
  wait_for_verification = true
}
```

Add to `infrastructure/terraform/modules/amplify/variables.tf`:

```hcl
variable "custom_domain" {
  description = "Custom domain for Amplify app (e.g., classla.org)"
  type        = string
  default     = ""
}

variable "custom_subdomain" {
  description = "Subdomain prefix (e.g., app for app.classla.org)"
  type        = string
  default     = "app"
}
```

Then update `infrastructure/terraform/main.tf`:

```hcl
module "amplify" {
  source = "./modules/amplify"

  # ... existing configuration ...

  custom_domain    = "classla.org"
  custom_subdomain = "app"
}
```

## Step 5: Update Environment Variables

After setting up the custom domain, update your environment variables:

### Backend Environment Variables

Update the Amplify environment variables to use the custom domain:

```bash
aws amplify update-app \
  --app-id $(cd infrastructure/terraform && terraform output -raw amplify_app_id) \
  --environment-variables \
    VITE_API_URL=https://api.classla.org \
    VITE_WORKOS_CLIENT_ID=your_workos_client_id \
  --region us-east-1
```

### WorkOS Redirect URI

Update your WorkOS configuration:

1. Go to WorkOS dashboard
2. Navigate to your application settings
3. Update the redirect URI to: `https://api.classla.org/auth/callback`

### CORS Configuration

Ensure your backend CORS configuration allows requests from `https://app.classla.org`:

```typescript
// In your Express app
app.use(
  cors({
    origin: ["https://app.classla.org"],
    credentials: true,
  })
);
```

## Step 6: Verification

After everything is configured:

### Test Backend

```bash
# Test health endpoint
curl https://api.classla.org/health

# Should return: {"status":"healthy",...}
```

### Test Frontend

```bash
# Test frontend loads
curl -I https://app.classla.org

# Should return: HTTP/2 200
```

### Test End-to-End

1. Open `https://app.classla.org` in your browser
2. Open browser developer tools (F12)
3. Go to Network tab
4. Try to sign in
5. Verify API calls go to `https://api.classla.org` and succeed

## Troubleshooting

### Certificate Validation Stuck

**Problem**: Certificate stays in "Pending validation" status

**Solution**:

- Ensure DNS records were created in Route53
- Wait up to 30 minutes for DNS propagation
- Check that the CNAME records match exactly what ACM requires

### DNS Not Resolving

**Problem**: `nslookup api.classla.org` returns no results

**Solution**:

```bash
# Check Route53 records
aws route53 list-resource-record-sets \
  --hosted-zone-id YOUR_ZONE_ID \
  --query "ResourceRecordSets[?Name=='api.classla.org.']"

# Wait for DNS propagation (can take 5-60 minutes)
# Test with different DNS servers
nslookup api.classla.org 8.8.8.8
```

### Amplify Domain Shows "Failed"

**Problem**: Amplify domain association fails

**Solution**:

- Verify the domain is in Route53 in the same AWS account
- Check that no conflicting DNS records exist
- Try removing and re-adding the domain
- Ensure the certificate is in `us-east-1` region

### Mixed Content Errors

**Problem**: Frontend shows "Mixed Content" errors

**Solution**:

- Ensure `VITE_API_URL` uses `https://` not `http://`
- Verify both frontend and backend use HTTPS
- Check browser console for specific blocked resources

## Cost Implications

Adding custom domains has minimal cost impact:

- **ACM Certificates**: Free
- **Route53 Hosted Zone**: $0.50/month (you already have this)
- **Route53 Queries**: $0.40 per million queries (negligible for most apps)
- **Amplify Custom Domain**: Free

## Alternative Architecture: Single Domain

If you prefer to use a single domain with path-based routing:

- Frontend: `https://app.classla.org/`
- Backend: `https://app.classla.org/api`

This requires:

1. Using CloudFront in front of both Amplify and ALB
2. Path-based routing rules
3. More complex setup

The two-subdomain approach (api.classla.org + app.classla.org) is simpler and recommended.

## Summary

After completing these steps, your application will be accessible at:

- **Frontend**: https://app.classla.org
- **Backend API**: https://api.classla.org
- **Health Check**: https://api.classla.org/health

Both will have valid SSL certificates and proper DNS configuration.
