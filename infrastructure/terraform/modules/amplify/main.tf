# Amplify Module - Frontend Hosting
# This module creates an AWS Amplify app for hosting the React/Vite frontend
# with automatic CI/CD from GitHub

resource "aws_amplify_app" "frontend" {
  name       = var.app_name
  repository = var.github_repository

  # Build settings for Vite application in classla-frontend directory
  build_spec = <<-EOT
    version: 1
    frontend:
      phases:
        preBuild:
          commands:
            - cd classla-frontend
            - npm ci
        build:
          commands:
            - npm run build
      artifacts:
        baseDirectory: classla-frontend/dist
        files:
          - '**/*'
      cache:
        paths:
          - classla-frontend/node_modules/**/*
  EOT

  # Environment variables for the frontend build
  environment_variables = var.environment_variables

  # Enable auto branch creation for feature branches (optional)
  enable_auto_branch_creation   = var.enable_auto_branch_creation
  auto_branch_creation_patterns = var.auto_branch_creation_patterns

  # Custom rules for SPA routing
  custom_rule {
    source = "/<*>"
    status = "404-200"
    target = "/index.html"
  }

  # Platform: WEB for standard web apps
  platform = "WEB"

  tags = var.tags
}

# Connect to GitHub repository and configure main branch
resource "aws_amplify_branch" "main" {
  app_id      = aws_amplify_app.frontend.id
  branch_name = var.branch_name

  # Enable automatic builds on push
  enable_auto_build = true

  # Enable pull request previews (optional)
  enable_pull_request_preview = var.enable_pull_request_preview

  # Framework detection
  framework = "React"

  # Stage (PRODUCTION, BETA, DEVELOPMENT, EXPERIMENTAL)
  stage = var.stage

  tags = var.tags
}

# IAM role for Amplify service
resource "aws_iam_role" "amplify" {
  name = "${var.app_name}-amplify-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "amplify.amazonaws.com"
        }
      }
    ]
  })

  tags = var.tags
}

# Attach basic Amplify execution policy
resource "aws_iam_role_policy_attachment" "amplify_backend_deployment" {
  role       = aws_iam_role.amplify.name
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess-Amplify"
}
