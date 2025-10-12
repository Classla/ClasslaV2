# Amplify Module Outputs

output "app_id" {
  description = "The unique ID of the Amplify app"
  value       = aws_amplify_app.frontend.id
}

output "app_arn" {
  description = "The ARN of the Amplify app"
  value       = aws_amplify_app.frontend.arn
}

output "default_domain" {
  description = "The default domain for the Amplify app"
  value       = aws_amplify_app.frontend.default_domain
}

output "branch_url" {
  description = "The URL for the deployed branch"
  value       = "https://${var.branch_name}.${aws_amplify_app.frontend.default_domain}"
}

output "app_name" {
  description = "The name of the Amplify app"
  value       = aws_amplify_app.frontend.name
}

output "iam_role_arn" {
  description = "The ARN of the IAM role used by Amplify"
  value       = aws_iam_role.amplify.arn
}
