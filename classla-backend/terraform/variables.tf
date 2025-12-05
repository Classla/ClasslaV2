variable "aws_region" {
  description = "AWS region for resources"
  type        = string
  default     = "us-east-2"
}

variable "environment" {
  description = "Environment name (e.g., production, staging, dev)"
  type        = string
  default     = "production"
}

variable "project_name" {
  description = "Project name for resource naming"
  type        = string
  default     = "classla-backend"
}

variable "vpc_cidr" {
  description = "CIDR block for VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "instance_type" {
  description = "EC2 instance type"
  type        = string
  default     = "t3.medium"
}

variable "min_size" {
  description = "Minimum number of instances in Auto Scaling Group"
  type        = number
  default     = 1
}

variable "max_size" {
  description = "Maximum number of instances in Auto Scaling Group"
  type        = number
  default     = 5
}

variable "desired_capacity" {
  description = "Desired number of instances in Auto Scaling Group"
  type        = number
  default     = 1
}

variable "acm_certificate_arn" {
  description = "ARN of ACM certificate for HTTPS listener (optional - leave empty to disable HTTPS)"
  type        = string
  default     = ""
}

variable "redis_node_type" {
  description = "ElastiCache Redis node type"
  type        = string
  default     = "cache.t3.micro"
}

variable "ecr_repository_url" {
  description = "ECR repository URL for Docker image"
  type        = string
}

variable "docker_image_tag" {
  description = "Docker image tag to deploy"
  type        = string
  default     = "latest"
}

variable "frontend_url" {
  description = "Frontend URL for CORS configuration"
  type        = string
}

variable "enable_https_redirect" {
  description = "Enable HTTP to HTTPS redirect"
  type        = bool
  default     = true
}

variable "secrets_manager_supabase_secret" {
  description = "Name of Secrets Manager secret for Supabase credentials"
  type        = string
  default     = "classla-backend/supabase"
}

variable "secrets_manager_workos_secret" {
  description = "Name of Secrets Manager secret for WorkOS credentials"
  type        = string
  default     = "classla-backend/workos"
}

variable "secrets_manager_app_secret" {
  description = "Name of Secrets Manager secret for app configuration"
  type        = string
  default     = "classla-backend/app"
}

variable "health_check_path" {
  description = "Path for health check endpoint"
  type        = string
  default     = "/health"
}

variable "log_retention_days" {
  description = "CloudWatch log retention in days"
  type        = number
  default     = 30
}

variable "enable_deletion_protection" {
  description = "Enable deletion protection for ALB"
  type        = bool
  default     = false
}

variable "alb_idle_timeout" {
  description = "ALB idle timeout in seconds"
  type        = number
  default     = 60
}

variable "target_group_deregistration_delay" {
  description = "Target group deregistration delay in seconds"
  type        = number
  default     = 30
}

variable "cpu_scaling_target" {
  description = "Target CPU utilization for auto-scaling"
  type        = number
  default     = 70.0
}

variable "memory_scaling_target" {
  description = "Target memory utilization for auto-scaling"
  type        = number
  default     = 80.0
}

variable "health_check_grace_period" {
  description = "Health check grace period in seconds"
  type        = number
  default     = 300
}

variable "redis_maintenance_window" {
  description = "Redis maintenance window (e.g., mon:05:00-mon:06:00)"
  type        = string
  default     = "mon:05:00-mon:06:00"
}

variable "redis_snapshot_retention_limit" {
  description = "Number of days to retain Redis snapshots"
  type        = number
  default     = 0
}

