# Classla LMS Terraform Infrastructure

This directory contains the Terraform configuration for deploying the Classla LMS application to AWS.

## Files Overview

- **main.tf**: Main configuration that orchestrates all modules
- **variables.tf**: Input variables for customizing the deployment
- **outputs.tf**: Output values after deployment (ALB DNS, Amplify URL, etc.)
- **backend.tf**: S3 backend configuration for state management
- **versions.tf**: Terraform and provider version constraints
- **terraform.tfvars.example**: Example variables file (copy to terraform.tfvars)

## Modules

- **networking**: VPC, subnets, NAT gateways, VPC endpoints
- **ecr**: Container registry for backend Docker images
- **secrets**: AWS Secrets Manager for credentials
- **alb**: Application Load Balancer with HTTPS
- **ecs**: ECS Fargate cluster and service
- **amplify**: Frontend hosting with CI/CD

## Quick Start

1. Copy the example variables file:

   ```bash
   cp terraform.tfvars.example terraform.tfvars
   ```

2. Edit `terraform.tfvars` with your values:

   - AWS region
   - Certificate ARN (create in ACM first)
   - GitHub repository URL
   - WorkOS client ID

3. Initialize Terraform backend (first time only):

   ```bash
   ../scripts/init-terraform.sh
   ```

4. Initialize Terraform:

   ```bash
   terraform init
   ```

5. Review the plan:

   ```bash
   terraform plan
   ```

6. Apply the configuration:
   ```bash
   terraform apply
   ```

## Important Notes

- **Certificate**: You must create an ACM certificate before deploying
- **Secrets**: After deployment, populate secrets in AWS Secrets Manager
- **Docker Image**: Build and push backend image to ECR after infrastructure is created
- **GitHub**: Connect your GitHub repository to Amplify for frontend deployment

## Module Dependencies

The modules are orchestrated in the following order:

1. Networking (VPC, subnets)
2. Secrets Manager
3. ALB (requires networking)
4. ECR (container registry)
5. ECS (requires networking, ALB, ECR, secrets)
6. Amplify (requires ALB for API URL)

## Outputs

After successful deployment, Terraform will output:

- **alb_dns_name**: Backend API endpoint
- **amplify_branch_url**: Frontend URL
- **ecr_repository_url**: Docker image repository
- **deployment_info**: Summary of all important URLs
- **next_steps**: Instructions for completing the deployment

## Cost Estimate

Approximate monthly costs for production environment:

- ECS Fargate (1 task): ~$15
- ALB: ~$20
- NAT Gateways (2): ~$65
- Amplify: ~$0 (free tier)
- **Total**: ~$100/month

For development, enable `single_nat_gateway = true` to reduce costs by ~$32/month.
