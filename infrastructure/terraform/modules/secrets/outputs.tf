# Secrets Manager module outputs

output "supabase_credentials_arn" {
  description = "ARN of the Supabase credentials secret"
  value       = aws_secretsmanager_secret.supabase_credentials.arn
}

output "workos_credentials_arn" {
  description = "ARN of the WorkOS credentials secret"
  value       = aws_secretsmanager_secret.workos_credentials.arn
}

output "app_secrets_arn" {
  description = "ARN of the application secrets"
  value       = aws_secretsmanager_secret.app_secrets.arn
}

output "ecs_secrets_access_policy_arn" {
  description = "ARN of the IAM policy for ECS task access to secrets"
  value       = aws_iam_policy.ecs_secrets_access.arn
}

output "all_secret_arns" {
  description = "Map of all secret ARNs"
  value = {
    supabase_credentials = aws_secretsmanager_secret.supabase_credentials.arn
    workos_credentials   = aws_secretsmanager_secret.workos_credentials.arn
    app_secrets          = aws_secretsmanager_secret.app_secrets.arn
  }
}
