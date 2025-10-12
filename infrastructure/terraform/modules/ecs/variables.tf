# ECS module variables

variable "environment" {
  description = "Environment name"
  type        = string
}

variable "vpc_id" {
  description = "ID of the VPC"
  type        = string
}

variable "private_subnet_ids" {
  description = "IDs of private subnets for ECS tasks"
  type        = list(string)
}

variable "alb_security_group_id" {
  description = "Security group ID of the ALB"
  type        = string
}

variable "alb_target_group_arn" {
  description = "ARN of the ALB target group"
  type        = string
}

variable "ecr_repository_url" {
  description = "URL of the ECR repository"
  type        = string
}

variable "secrets_arns" {
  description = "ARNs of secrets in Secrets Manager"
  type        = map(string)
}

variable "secrets_access_policy_arn" {
  description = "ARN of the IAM policy for accessing secrets"
  type        = string
}

variable "container_cpu" {
  description = "CPU units for the container"
  type        = number
  default     = 512
}

variable "container_memory" {
  description = "Memory for the container in MB"
  type        = number
  default     = 1024
}
