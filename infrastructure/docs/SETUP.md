# AWS Setup Guide

This guide walks you through setting up your AWS account and local environment to deploy the Classla LMS infrastructure.

## Table of Contents

1. [AWS Account Creation](#1-aws-account-creation)
2. [AWS CLI Installation and Configuration](#2-aws-cli-installation-and-configuration)
3. [Terraform Installation](#3-terraform-installation)
4. [IAM Permissions and Policies](#4-iam-permissions-and-policies)
5. [GitHub Actions AWS Credentials Setup](#5-github-actions-aws-credentials-setup)
6. [Amplify GitHub Connection](#6-amplify-github-connection)
7. [Next Steps](#next-steps)

---

## 1. AWS Account Creation

### 1.1 Create an AWS Account

If you don't already have an AWS account:

1. Go to [https://aws.amazon.com](https://aws.amazon.com)
2. Click "Create an AWS Account"
3. Follow the registration process:
   - Provide email address and account name
   - Enter contact information
   - Provide payment information (credit card required)
   - Verify your identity (phone verification)
   - Choose a support plan (Basic/Free is sufficient for getting started)

### 1.2 Enable Multi-Factor Authentication (MFA)

Secure your root account with MFA:

1. Sign in to the AWS Console as root user
2. Click on your account name (top right) → "Security credentials"
3. Under "Multi-factor authentication (MFA)", click "Assign MFA device"
4. Choose "Virtual MFA device" and follow the setup wizard
5. Use an authenticator app like Google Authenticator, Authy, or 1Password

### 1.3 Set Up Billing Alerts

To avoid unexpected charges:

1. Go to AWS Billing Console → "Billing preferences"
2. Enable "Receive Billing Alerts"
3. Go to CloudWatch → "Alarms" → "Billing"
4. Create an alarm for when charges exceed your threshold (e.g., $50)

---

## 2. AWS CLI Installation and Configuration

### 2.1 Install AWS CLI

#### macOS

```bash
# Using Homebrew
brew install awscli

# Verify installation
aws --version
```

#### Linux

```bash
# Download and install
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install

# Verify installation
aws --version
```

#### Windows

1. Download the AWS CLI MSI installer from [https://aws.amazon.com/cli/](https://aws.amazon.com/cli/)
2. Run the installer
3. Verify installation in Command Prompt:

```cmd
aws --version
```

### 2.2 Create IAM User for CLI Access

Do not use your root account for daily operations. Create an IAM user:

1. Sign in to AWS Console
2. Go to IAM → "Users" → "Add users"
3. User name: `classla-admin` (or your preferred name)
4. Select "Programmatic access" (for AWS CLI)
5. Click "Next: Permissions"
6. Attach policies (see [Section 4](#4-iam-permissions-and-policies) for required permissions)
7. Click through to "Create user"
8. **Important**: Download the CSV with Access Key ID and Secret Access Key
   - You won't be able to see the secret key again
   - Store it securely (password manager recommended)

### 2.3 Configure AWS CLI

Configure the CLI with your IAM user credentials:

```bash
aws configure
```

You'll be prompted for:

- **AWS Access Key ID**: From the CSV you downloaded
- **AWS Secret Access Key**: From the CSV you downloaded
- **Default region name**: `us-east-1` (or your preferred region)
- **Default output format**: `json`

Verify configuration:

```bash
# Test AWS CLI access
aws sts get-caller-identity

# Should return your user ARN and account ID
```

### 2.4 Configure Named Profiles (Optional)

If you manage multiple AWS accounts:

```bash
# Configure a named profile
aws configure --profile classla-prod

# Use the profile
aws s3 ls --profile classla-prod

# Or set as default
export AWS_PROFILE=classla-prod
```

---

## 3. Terraform Installation

### 3.1 Install Terraform

#### macOS

```bash
# Using Homebrew
brew tap hashicorp/tap
brew install hashicorp/tap/terraform

# Verify installation
terraform --version
```

#### Linux

```bash
# Download Terraform (check for latest version at terraform.io)
wget https://releases.hashicorp.com/terraform/1.6.0/terraform_1.6.0_linux_amd64.zip

# Unzip and install
unzip terraform_1.6.0_linux_amd64.zip
sudo mv terraform /usr/local/bin/

# Verify installation
terraform --version
```

#### Windows

1. Download Terraform from [https://www.terraform.io/downloads](https://www.terraform.io/downloads)
2. Extract the ZIP file
3. Add the directory to your PATH
4. Verify in Command Prompt:

```cmd
terraform --version
```

### 3.2 Install Terraform Extensions (Optional)

For better development experience:

- **VS Code**: Install "HashiCorp Terraform" extension
- **IntelliJ/PyCharm**: Install "Terraform and HCL" plugin

---

## 4. IAM Permissions and Policies

### 4.1 Required IAM Permissions

The IAM user deploying the infrastructure needs the following permissions:

#### Option 1: Use Managed Policies (Easier, Less Secure)

Attach these AWS managed policies to your IAM user:

- `AdministratorAccess` (simplest, but very broad)

**OR** for more granular control:

- `AmazonVPCFullAccess`
- `AmazonECS_FullAccess`
- `ElasticLoadBalancingFullAccess`
- `AmazonEC2ContainerRegistryFullAccess`
- `SecretsManagerReadWrite`
- `CloudWatchLogsFullAccess`
- `IAMFullAccess`
- `AWSAmplifyFullAccess`

#### Option 2: Custom Policy (Recommended for Production)

Create a custom policy with least-privilege access:

1. Go to IAM → "Policies" → "Create policy"
2. Use the JSON editor and paste the following policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ec2:*",
        "elasticloadbalancing:*",
        "ecs:*",
        "ecr:*",
        "logs:*",
        "iam:*",
        "secretsmanager:*",
        "amplify:*",
        "s3:*",
        "dynamodb:*",
        "acm:*",
        "route53:*"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": ["sts:GetCallerIdentity"],
      "Resource": "*"
    }
  ]
}
```

3. Name it `ClasslaInfrastructureDeployment`
4. Attach it to your IAM user

### 4.2 S3 Backend Permissions

For Terraform state management, ensure your user can:

- Create and manage S3 buckets
- Create and manage DynamoDB tables
- Read/write to the Terraform state bucket

These are included in the policies above.

---

## 5. GitHub Actions AWS Credentials Setup

To enable automated deployments via GitHub Actions:

### 5.1 Create IAM User for GitHub Actions

1. Go to IAM → "Users" → "Add users"
2. User name: `github-actions-classla`
3. Select "Programmatic access" only
4. Attach the same policies as your admin user (Section 4.1)
5. Create user and download credentials

### 5.2 Add Credentials to GitHub Secrets

1. Go to your GitHub repository
2. Navigate to "Settings" → "Secrets and variables" → "Actions"
3. Click "New repository secret"
4. Add the following secrets:

| Secret Name             | Value                                                    |
| ----------------------- | -------------------------------------------------------- |
| `AWS_ACCESS_KEY_ID`     | Access key from IAM user                                 |
| `AWS_SECRET_ACCESS_KEY` | Secret key from IAM user                                 |
| `AWS_REGION`            | `us-east-1` (or your region)                             |
| `ECR_REPOSITORY`        | Will be created by Terraform, add after first deployment |

### 5.3 Additional Secrets for Application

Add these secrets for the application runtime:

| Secret Name                 | Description                                                                    |
| --------------------------- | ------------------------------------------------------------------------------ |
| `SUPABASE_URL`              | Your Supabase project URL                                                      |
| `SUPABASE_ANON_KEY`         | Supabase anonymous key                                                         |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key                                                      |
| `WORKOS_API_KEY`            | WorkOS API key                                                                 |
| `WORKOS_CLIENT_ID`          | WorkOS client ID                                                               |
| `SESSION_SECRET`            | Random string for session encryption (generate with `openssl rand -base64 32`) |

### 5.4 Verify GitHub Actions Access

After adding secrets, trigger a workflow run to verify:

```bash
# Push to main branch or manually trigger workflow
git push origin main
```

Check the Actions tab in GitHub to see if the workflow runs successfully.

---

## 6. Amplify GitHub Connection

AWS Amplify needs access to your GitHub repository to automatically build and deploy the frontend.

### 6.1 Connect GitHub to AWS Amplify

#### Option 1: Through Terraform (Recommended)

The Terraform configuration will prompt you to connect GitHub:

1. Run `terraform apply`
2. When Amplify app is created, you'll see a message about connecting GitHub
3. Follow the AWS Console link to authorize GitHub access

#### Option 2: Manual Setup (If Needed)

1. Go to AWS Console → AWS Amplify
2. Click "Get Started" under "Amplify Hosting"
3. Choose "GitHub" as the repository service
4. Click "Authorize AWS Amplify"
5. Sign in to GitHub and authorize the AWS Amplify app
6. Select your repository and branch (`main`)

### 6.2 Configure Amplify Build Settings

The Terraform module automatically configures build settings, but you can verify:

1. Go to AWS Amplify → Your App → "Build settings"
2. Verify the build specification:

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

### 6.3 Set Amplify Environment Variables

After Terraform creates the infrastructure:

1. Go to AWS Amplify → Your App → "Environment variables"
2. Add the following variables:

| Variable Name           | Value                                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| `VITE_API_URL`          | ALB DNS name from Terraform output (e.g., `https://classla-alb-123456.us-east-1.elb.amazonaws.com`) |
| `VITE_WORKOS_CLIENT_ID` | Your WorkOS client ID                                                                               |

3. Redeploy the app to apply the new environment variables

### 6.4 Configure Custom Domain (Optional)

If you have a custom domain:

1. Go to AWS Amplify → Your App → "Domain management"
2. Click "Add domain"
3. Enter your domain name
4. Follow the DNS configuration instructions
5. Wait for SSL certificate provisioning (can take up to 24 hours)

---

## Next Steps

After completing this setup:

1. **Initialize Terraform Backend**: Follow [DEPLOYMENT.md](./DEPLOYMENT.md) Section 1
2. **Configure Secrets**: Add application secrets to AWS Secrets Manager
3. **Deploy Infrastructure**: Run Terraform to create all AWS resources
4. **Build and Deploy Backend**: Push code to trigger GitHub Actions
5. **Verify Deployment**: Test the application endpoints

## Troubleshooting

### AWS CLI Issues

**Problem**: `aws` command not found

- **Solution**: Ensure AWS CLI is in your PATH. Restart your terminal after installation.

**Problem**: Access denied errors

- **Solution**: Verify your IAM user has the required permissions (Section 4)

### Terraform Issues

**Problem**: Terraform state lock errors

- **Solution**: Ensure DynamoDB table exists and your user has permissions

**Problem**: Resource already exists errors

- **Solution**: Import existing resources or use `terraform import`

### GitHub Actions Issues

**Problem**: Workflow fails with authentication errors

- **Solution**: Verify GitHub secrets are correctly set (Section 5.2)

**Problem**: ECR push fails

- **Solution**: Ensure ECR repository exists and IAM user has ECR permissions

### Amplify Issues

**Problem**: Build fails

- **Solution**: Check build logs in Amplify console. Verify build commands and environment variables.

**Problem**: GitHub connection fails

- **Solution**: Revoke and re-authorize GitHub access in AWS Amplify settings

## Additional Resources

- [AWS CLI Documentation](https://docs.aws.amazon.com/cli/)
- [Terraform AWS Provider Documentation](https://registry.terraform.io/providers/hashicorp/aws/latest/docs)
- [AWS Amplify Documentation](https://docs.aws.amazon.com/amplify/)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [AWS IAM Best Practices](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html)

## Security Best Practices

1. **Never commit credentials**: Use `.gitignore` for sensitive files
2. **Rotate access keys**: Regularly rotate IAM user access keys (every 90 days)
3. **Use MFA**: Enable MFA for all IAM users with console access
4. **Principle of least privilege**: Grant only necessary permissions
5. **Monitor usage**: Set up CloudWatch alarms and billing alerts
6. **Use secrets management**: Store all secrets in AWS Secrets Manager, not in code
7. **Enable CloudTrail**: Track all API calls for audit purposes

---

**Ready to deploy?** Continue to [DEPLOYMENT.md](./DEPLOYMENT.md) for step-by-step deployment instructions.
