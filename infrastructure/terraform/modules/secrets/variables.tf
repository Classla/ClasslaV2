# Secrets Manager module variables

variable "environment" {
  description = "Environment name (e.g., dev, prod)"
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9-]+$", var.environment))
    error_message = "Environment must contain only lowercase letters, numbers, and hyphens."
  }
}
