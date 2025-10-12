# Secrets Manager module - Secure storage for application secrets

# Secret for Supabase credentials
resource "aws_secretsmanager_secret" "supabase_credentials" {
  name        = "${var.environment}/classla/supabase/credentials"
  description = "Supabase credentials including URL, anon key, and service role key"

  tags = {
    Name        = "${var.environment}-supabase-credentials"
    Environment = var.environment
    ManagedBy   = "Terraform"
  }
}

# Placeholder version for Supabase credentials (to be updated manually)
resource "aws_secretsmanager_secret_version" "supabase_credentials" {
  secret_id = aws_secretsmanager_secret.supabase_credentials.id
  secret_string = jsonencode({
    url              = "PLACEHOLDER_UPDATE_AFTER_DEPLOYMENT"
    anon_key         = "PLACEHOLDER_UPDATE_AFTER_DEPLOYMENT"
    service_role_key = "PLACEHOLDER_UPDATE_AFTER_DEPLOYMENT"
  })

  lifecycle {
    ignore_changes = [secret_string]
  }
}

# Secret for WorkOS credentials
resource "aws_secretsmanager_secret" "workos_credentials" {
  name        = "${var.environment}/classla/workos/credentials"
  description = "WorkOS credentials including API key and client ID"

  tags = {
    Name        = "${var.environment}-workos-credentials"
    Environment = var.environment
    ManagedBy   = "Terraform"
  }
}

# Placeholder version for WorkOS credentials (to be updated manually)
resource "aws_secretsmanager_secret_version" "workos_credentials" {
  secret_id = aws_secretsmanager_secret.workos_credentials.id
  secret_string = jsonencode({
    api_key   = "PLACEHOLDER_UPDATE_AFTER_DEPLOYMENT"
    client_id = "PLACEHOLDER_UPDATE_AFTER_DEPLOYMENT"
  })

  lifecycle {
    ignore_changes = [secret_string]
  }
}

# Secret for application secrets
resource "aws_secretsmanager_secret" "app_secrets" {
  name        = "${var.environment}/classla/app/secrets"
  description = "Application secrets including session secret"

  tags = {
    Name        = "${var.environment}-app-secrets"
    Environment = var.environment
    ManagedBy   = "Terraform"
  }
}

# Placeholder version for application secrets (to be updated manually)
resource "aws_secretsmanager_secret_version" "app_secrets" {
  secret_id = aws_secretsmanager_secret.app_secrets.id
  secret_string = jsonencode({
    session_secret = "PLACEHOLDER_UPDATE_AFTER_DEPLOYMENT"
  })

  lifecycle {
    ignore_changes = [secret_string]
  }
}

# IAM policy for ECS task role to access secrets
resource "aws_iam_policy" "ecs_secrets_access" {
  name        = "${var.environment}-classla-ecs-secrets-access"
  description = "Allow ECS tasks to read secrets from Secrets Manager"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret"
        ]
        Resource = [
          aws_secretsmanager_secret.supabase_credentials.arn,
          aws_secretsmanager_secret.workos_credentials.arn,
          aws_secretsmanager_secret.app_secrets.arn
        ]
      }
    ]
  })

  tags = {
    Name        = "${var.environment}-ecs-secrets-access"
    Environment = var.environment
    ManagedBy   = "Terraform"
  }
}
