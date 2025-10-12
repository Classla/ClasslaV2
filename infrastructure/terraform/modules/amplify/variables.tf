# Amplify Module Variables

variable "app_name" {
  description = "Name of the Amplify application"
  type        = string
}

variable "github_repository" {
  description = "GitHub repository URL (e.g., https://github.com/username/repo)"
  type        = string
}

variable "branch_name" {
  description = "Git branch to deploy (e.g., main, master)"
  type        = string
  default     = "main"
}

variable "environment_variables" {
  description = "Environment variables for the build process"
  type        = map(string)
  default     = {}
}

variable "enable_auto_branch_creation" {
  description = "Enable automatic branch creation for feature branches"
  type        = bool
  default     = false
}

variable "auto_branch_creation_patterns" {
  description = "Patterns for automatic branch creation"
  type        = list(string)
  default     = []
}

variable "enable_pull_request_preview" {
  description = "Enable pull request preview deployments"
  type        = bool
  default     = false
}

variable "stage" {
  description = "Stage for the branch (PRODUCTION, BETA, DEVELOPMENT, EXPERIMENTAL)"
  type        = string
  default     = "PRODUCTION"

  validation {
    condition     = contains(["PRODUCTION", "BETA", "DEVELOPMENT", "EXPERIMENTAL"], var.stage)
    error_message = "Stage must be one of: PRODUCTION, BETA, DEVELOPMENT, EXPERIMENTAL"
  }
}

variable "tags" {
  description = "Tags to apply to all resources"
  type        = map(string)
  default     = {}
}
