# Data sources for Secrets Manager secrets
# These assume the secrets already exist in AWS Secrets Manager
# Users should create these secrets before deploying

data "aws_secretsmanager_secret" "supabase" {
  name = var.secrets_manager_supabase_secret
}

data "aws_secretsmanager_secret" "workos" {
  name = var.secrets_manager_workos_secret
}

data "aws_secretsmanager_secret" "app" {
  name = var.secrets_manager_app_secret
}

# Note: The actual secret values are retrieved at runtime by the EC2 instances
# using the IAM role permissions. We only need the secret ARNs for reference.

