# Terraform Variables for Classla LMS Infrastructure

# ============================================================================
# General Configuration
# ============================================================================

variable "project_name" {
  description = "Name of the project, used for resource naming"
  type        = string
  default     = "classla"

  validation {
    condition     = can(regex("^[a-z0-9-]+$", var.project_name))
    error_message = "Project name must contain only lowercase letters, numbers, and hyphens."
  }
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Environment must be one of: dev, staging, prod."
  }
}

variable "aws_region" {
  description = "AWS region for all resources"
  type        = string
  default     = "us-east-1"
}

variable "tags" {
  description = "Additional tags to apply to all resources"
  type        = map(string)
  default     = {}
}

# ============================================================================
# Networking Configuration
# ============================================================================

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "availability_zones" {
  description = "List of availability zones to use"
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b"]
}

variable "public_subnet_cidrs" {
  description = "CIDR blocks for public subnets"
  type        = list(string)
  default     = ["10.0.1.0/24", "10.0.2.0/24"]
}

variable "private_subnet_cidrs" {
  description = "CIDR blocks for private subnets (ECS tasks)"
  type        = list(string)
  default     = ["10.0.11.0/24", "10.0.12.0/24"]
}

variable "enable_nat_gateway" {
  description = "Enable NAT Gateway for private subnet internet access"
  type        = bool
  default     = true
}

variable "single_nat_gateway" {
  description = "Use single NAT Gateway instead of one per AZ (cost optimization for dev)"
  type        = bool
  default     = false
}

variable "enable_vpc_endpoints" {
  description = "Enable VPC endpoints for S3 and ECR (reduces NAT Gateway costs)"
  type        = bool
  default     = true
}

# ============================================================================
# ECS Configuration
# ============================================================================

variable "container_cpu" {
  description = "CPU units for ECS task (256, 512, 1024, 2048, 4096)"
  type        = number
  default     = 512

  validation {
    condition     = contains([256, 512, 1024, 2048, 4096], var.container_cpu)
    error_message = "Container CPU must be one of: 256, 512, 1024, 2048, 4096."
  }
}

variable "container_memory" {
  description = "Memory for ECS task in MB"
  type        = number
  default     = 1024

  validation {
    condition     = var.container_memory >= 512 && var.container_memory <= 30720
    error_message = "Container memory must be between 512 and 30720 MB."
  }
}

# ============================================================================
# ALB Configuration
# ============================================================================

variable "certificate_arn" {
  description = "ARN of ACM certificate for HTTPS listener (must be created manually)"
  type        = string

  validation {
    condition     = can(regex("^arn:aws:acm:", var.certificate_arn))
    error_message = "Certificate ARN must be a valid ACM certificate ARN."
  }
}

variable "health_check_path" {
  description = "Health check path for ALB target group"
  type        = string
  default     = "/health"
}

# ============================================================================
# Amplify Configuration
# ============================================================================

variable "github_repository" {
  description = "GitHub repository URL (e.g., https://github.com/username/repo)"
  type        = string

  validation {
    condition     = can(regex("^https://github.com/[^/]+/[^/]+$", var.github_repository))
    error_message = "GitHub repository must be a valid GitHub URL."
  }
}

variable "github_branch" {
  description = "Git branch to deploy"
  type        = string
  default     = "main"
}

variable "workos_client_id" {
  description = "WorkOS client ID for frontend authentication"
  type        = string
  sensitive   = true
}

variable "enable_amplify_auto_branch" {
  description = "Enable automatic branch creation for feature branches"
  type        = bool
  default     = false
}

variable "enable_amplify_pr_preview" {
  description = "Enable pull request preview deployments"
  type        = bool
  default     = false
}

variable "amplify_stage" {
  description = "Amplify stage (PRODUCTION, BETA, DEVELOPMENT, EXPERIMENTAL)"
  type        = string
  default     = "PRODUCTION"

  validation {
    condition     = contains(["PRODUCTION", "BETA", "DEVELOPMENT", "EXPERIMENTAL"], var.amplify_stage)
    error_message = "Amplify stage must be one of: PRODUCTION, BETA, DEVELOPMENT, EXPERIMENTAL."
  }
}
