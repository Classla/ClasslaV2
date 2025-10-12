# Amplify Module

This module creates an AWS Amplify application for hosting the React/Vite frontend with automatic CI/CD from GitHub.

## Features

- **Automatic Deployments**: Triggers builds on push to the main branch
- **GitHub Integration**: Connects directly to your GitHub repository
- **Vite Build Configuration**: Pre-configured for the classla-frontend directory
- **Environment Variables**: Injects build-time environment variables (VITE_API_URL, VITE_WORKOS_CLIENT_ID)
- **SPA Routing**: Custom rules for single-page application routing
- **HTTPS by Default**: Automatic SSL certificates for all deployments
- **Global CDN**: CloudFront distribution for fast global access

## Usage

```hcl
module "amplify" {
  source = "./modules/amplify"

  app_name          = "classla-frontend"
  github_repository = "https://github.com/your-org/classla-lms"
  branch_name       = "main"

  environment_variables = {
    VITE_API_URL          = "https://api.example.com"
    VITE_WORKOS_CLIENT_ID = "client_123456"
  }

  stage = "PRODUCTION"

  tags = {
    Environment = "production"
    Project     = "classla-lms"
  }
}
```

## Requirements

### GitHub Connection

Before using this module, you need to connect your GitHub account to AWS Amplify:

1. Go to the AWS Amplify Console
2. Click "Connect app" and authorize GitHub access
3. AWS will create an OAuth token for accessing your repositories

Alternatively, you can use a GitHub personal access token:

```hcl
resource "aws_amplify_app" "frontend" {
  # ... other configuration ...

  access_token = var.github_token  # Store in Secrets Manager or use environment variable
}
```

### Build Specification

The module includes a pre-configured build specification for Vite applications in the `classla-frontend` directory:

```yaml
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
      - "**/*"
  cache:
    paths:
      - classla-frontend/node_modules/**/*
```

## Inputs

| Name                          | Description                           | Type         | Default      | Required |
| ----------------------------- | ------------------------------------- | ------------ | ------------ | -------- |
| app_name                      | Name of the Amplify application       | string       | -            | yes      |
| github_repository             | GitHub repository URL                 | string       | -            | yes      |
| branch_name                   | Git branch to deploy                  | string       | "main"       | no       |
| environment_variables         | Environment variables for build       | map(string)  | {}           | no       |
| enable_auto_branch_creation   | Enable automatic branch creation      | bool         | false        | no       |
| auto_branch_creation_patterns | Patterns for auto branch creation     | list(string) | []           | no       |
| enable_pull_request_preview   | Enable PR preview deployments         | bool         | false        | no       |
| stage                         | Branch stage (PRODUCTION, BETA, etc.) | string       | "PRODUCTION" | no       |
| tags                          | Tags to apply to resources            | map(string)  | {}           | no       |

## Outputs

| Name           | Description                             |
| -------------- | --------------------------------------- |
| app_id         | The unique ID of the Amplify app        |
| app_arn        | The ARN of the Amplify app              |
| default_domain | The default domain for the Amplify app  |
| branch_url     | The URL for the deployed branch         |
| app_name       | The name of the Amplify app             |
| iam_role_arn   | The ARN of the IAM role used by Amplify |

## Environment Variables

The module expects the following environment variables to be passed for the frontend build:

- `VITE_API_URL`: The backend API URL (ALB DNS name)
- `VITE_WORKOS_CLIENT_ID`: WorkOS client ID for authentication

Example:

```hcl
environment_variables = {
  VITE_API_URL          = module.alb.dns_name
  VITE_WORKOS_CLIENT_ID = var.workos_client_id
}
```

## Deployment Process

1. **Initial Deployment**: When you apply this Terraform configuration, Amplify will:

   - Connect to your GitHub repository
   - Trigger an initial build
   - Deploy to the default domain

2. **Automatic Deployments**: After initial setup, Amplify will:

   - Monitor the main branch for changes
   - Automatically trigger builds on push
   - Deploy successful builds to production

3. **Build Status**: You can monitor build status in:
   - AWS Amplify Console
   - CloudWatch Logs
   - Amplify build notifications

## Custom Domain (Optional)

To use a custom domain, add the following after creating the app:

```hcl
resource "aws_amplify_domain_association" "custom" {
  app_id      = module.amplify.app_id
  domain_name = "app.example.com"

  sub_domain {
    branch_name = "main"
    prefix      = ""
  }
}
```

## Troubleshooting

### Build Failures

If builds fail, check:

1. Build logs in the Amplify Console
2. Ensure `package.json` has a `build` script
3. Verify environment variables are set correctly
4. Check that the build specification matches your project structure

### GitHub Connection Issues

If Amplify can't access your repository:

1. Verify GitHub OAuth connection in Amplify Console
2. Check repository permissions
3. Ensure the repository URL is correct

### Environment Variable Issues

If environment variables aren't available during build:

1. Verify they're prefixed with `VITE_` for Vite apps
2. Check they're set in the Amplify module configuration
3. Rebuild the application after updating variables

## Cost Considerations

- **Build Minutes**: Free tier includes 1,000 build minutes/month
- **Storage**: Free tier includes 15 GB storage
- **Data Transfer**: Free tier includes 15 GB/month
- **Hosting**: $0.01 per GB served after free tier

For most applications, Amplify hosting is very cost-effective, often staying within the free tier.
