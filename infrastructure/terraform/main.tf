# Main Terraform Configuration for Classla LMS AWS Infrastructure

terraform {
  required_version = ">= 1.0"
}

# Local variables for common values
locals {
  common_tags = merge(
    var.tags,
    {
      Project     = var.project_name
      Environment = var.environment
      ManagedBy   = "Terraform"
    }
  )
}

# Networking Module - VPC, Subnets, NAT Gateways, VPC Endpoints
module "networking" {
  source = "./modules/networking"

  project_name       = var.project_name
  environment        = var.environment
  aws_region         = var.aws_region
  vpc_cidr           = var.vpc_cidr
  availability_zones = var.availability_zones

  public_subnet_cidrs  = var.public_subnet_cidrs
  private_subnet_cidrs = var.private_subnet_cidrs

  enable_nat_gateway   = var.enable_nat_gateway
  single_nat_gateway   = var.single_nat_gateway
  enable_vpc_endpoints = var.enable_vpc_endpoints

  tags = local.common_tags
}

# Data source to get current AWS account ID
data "aws_caller_identity" "current" {}

# ECR Module - Container Registry for Backend Docker Images
module "ecr" {
  source = "./modules/ecr"

  project_name    = var.project_name
  repository_name = "${var.project_name}-backend"

  # Use wildcard for initial creation, ECS task execution role will have permissions
  # via the AmazonECSTaskExecutionRolePolicy which includes ECR access
  ecs_task_execution_role_arn = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/classla-${var.environment}-ecs-task-execution"

  tags = local.common_tags
}

# Secrets Manager Module - Secure Storage for Credentials
module "secrets" {
  source = "./modules/secrets"

  environment = var.environment
}

# ALB Module - Application Load Balancer
module "alb" {
  source = "./modules/alb"

  environment       = var.environment
  vpc_id            = module.networking.vpc_id
  public_subnet_ids = module.networking.public_subnet_ids
  certificate_arn   = var.certificate_arn
  health_check_path = var.health_check_path
}

# ECS Module - Fargate Cluster and Service
module "ecs" {
  source = "./modules/ecs"

  environment               = var.environment
  vpc_id                    = module.networking.vpc_id
  private_subnet_ids        = module.networking.private_subnet_ids
  alb_security_group_id     = module.alb.alb_security_group_id
  alb_target_group_arn      = module.alb.target_group_arn
  ecr_repository_url        = module.ecr.repository_url
  secrets_arns              = module.secrets.all_secret_arns
  secrets_access_policy_arn = module.secrets.ecs_secrets_access_policy_arn

  container_cpu    = var.container_cpu
  container_memory = var.container_memory

  depends_on = [
    module.networking,
    module.alb,
    module.ecr,
    module.secrets
  ]
}

# Amplify Module - Frontend Hosting
module "amplify" {
  source = "./modules/amplify"

  app_name          = "${var.project_name}-frontend"
  github_repository = var.github_repository
  branch_name       = var.github_branch

  environment_variables = {
    VITE_API_URL          = "https://${module.alb.alb_dns_name}"
    VITE_WORKOS_CLIENT_ID = var.workos_client_id
  }

  enable_auto_branch_creation = var.enable_amplify_auto_branch
  enable_pull_request_preview = var.enable_amplify_pr_preview
  stage                       = var.amplify_stage

  tags = local.common_tags

  depends_on = [module.alb]
}
