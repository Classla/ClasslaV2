# Terraform Outputs for Classla LMS Infrastructure

# ============================================================================
# Networking Outputs
# ============================================================================

output "vpc_id" {
  description = "ID of the VPC"
  value       = module.networking.vpc_id
}

output "vpc_cidr" {
  description = "CIDR block of the VPC"
  value       = module.networking.vpc_cidr
}

output "public_subnet_ids" {
  description = "IDs of public subnets"
  value       = module.networking.public_subnet_ids
}

output "private_subnet_ids" {
  description = "IDs of private subnets"
  value       = module.networking.private_subnet_ids
}

output "nat_gateway_ips" {
  description = "Elastic IPs of NAT Gateways"
  value       = module.networking.nat_gateway_ips
}

# ============================================================================
# ECR Outputs
# ============================================================================

output "ecr_repository_url" {
  description = "URL of the ECR repository for backend Docker images"
  value       = module.ecr.repository_url
}

output "ecr_repository_name" {
  description = "Name of the ECR repository"
  value       = module.ecr.repository_name
}

# ============================================================================
# ALB Outputs
# ============================================================================

output "alb_dns_name" {
  description = "DNS name of the Application Load Balancer"
  value       = module.alb.alb_dns_name
}

output "alb_url" {
  description = "Full HTTPS URL of the Application Load Balancer"
  value       = "https://${module.alb.alb_dns_name}"
}

output "alb_arn" {
  description = "ARN of the Application Load Balancer"
  value       = module.alb.alb_arn
}

# ============================================================================
# ECS Outputs
# ============================================================================

output "ecs_cluster_name" {
  description = "Name of the ECS cluster"
  value       = module.ecs.cluster_name
}

output "ecs_cluster_arn" {
  description = "ARN of the ECS cluster"
  value       = module.ecs.cluster_arn
}

output "ecs_service_name" {
  description = "Name of the ECS service"
  value       = module.ecs.service_name
}

# ============================================================================
# Amplify Outputs
# ============================================================================

output "amplify_app_id" {
  description = "ID of the Amplify app"
  value       = module.amplify.app_id
}

output "amplify_default_domain" {
  description = "Default domain for the Amplify app"
  value       = module.amplify.default_domain
}

output "amplify_branch_url" {
  description = "URL for the deployed Amplify branch"
  value       = module.amplify.branch_url
}

# ============================================================================
# Secrets Manager Outputs
# ============================================================================

output "supabase_credentials_arn" {
  description = "ARN of the Supabase credentials secret"
  value       = module.secrets.supabase_credentials_arn
}

output "workos_credentials_arn" {
  description = "ARN of the WorkOS credentials secret"
  value       = module.secrets.workos_credentials_arn
}

output "app_secrets_arn" {
  description = "ARN of the application secrets"
  value       = module.secrets.app_secrets_arn
}

# ============================================================================
# Deployment Information
# ============================================================================

output "deployment_info" {
  description = "Important deployment information"
  value = {
    backend_url  = "https://${module.alb.alb_dns_name}"
    frontend_url = module.amplify.branch_url
    ecr_repo     = module.ecr.repository_url
    region       = var.aws_region
    environment  = var.environment
  }
}

output "next_steps" {
  description = "Next steps after infrastructure deployment"
  value       = <<-EOT
    
    ✅ Infrastructure deployed successfully!
    
    Next steps:
    
    1. Configure secrets in AWS Secrets Manager:
       - Supabase credentials: ${module.secrets.supabase_credentials_arn}
       - WorkOS credentials: ${module.secrets.workos_credentials_arn}
       - App secrets: ${module.secrets.app_secrets_arn}
    
    2. Build and push backend Docker image:
       aws ecr get-login-password --region ${var.aws_region} | docker login --username AWS --password-stdin ${module.ecr.repository_url}
       docker build -t ${module.ecr.repository_url}:latest -f docker/Dockerfile .
       docker push ${module.ecr.repository_url}:latest
    
    3. Update ECS service to deploy the image:
       aws ecs update-service --cluster ${module.ecs.cluster_name} --service ${module.ecs.service_name} --force-new-deployment --region ${var.aws_region}
    
    4. Access your application:
       - Backend API: https://${module.alb.alb_dns_name}
       - Frontend: ${module.amplify.branch_url}
    
    5. Configure custom domain (optional):
       - Add DNS records pointing to ALB: ${module.alb.alb_dns_name}
       - Add custom domain in Amplify console for frontend
    
  EOT
}
