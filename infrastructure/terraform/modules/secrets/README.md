# Secrets Manager Module

This Terraform module creates AWS Secrets Manager secrets for the Classla LMS application and configures IAM policies for ECS task access.

## Resources Created

1. **Supabase Credentials Secret** (`${environment}/classla/supabase/credentials`)
   - Stores Supabase URL, anon key, and service role key
2. **WorkOS Credentials Secret** (`${environment}/classla/workos/credentials`)
   - Stores WorkOS API key and client ID
3. **Application Secrets** (`${environment}/classla/app/secrets`)
   - Stores session secret and other application-specific secrets
4. **IAM Policy for ECS Task Access**
   - Grants ECS tasks permission to read all three secrets

## Usage

```hcl
module "secrets" {
  source = "./modules/secrets"

  environment = "prod"
}
```

## Inputs

| Name        | Description                        | Type   | Required |
| ----------- | ---------------------------------- | ------ | -------- |
| environment | Environment name (e.g., dev, prod) | string | yes      |

## Outputs

| Name                          | Description                               |
| ----------------------------- | ----------------------------------------- |
| supabase_credentials_arn      | ARN of the Supabase credentials secret    |
| workos_credentials_arn        | ARN of the WorkOS credentials secret      |
| app_secrets_arn               | ARN of the application secrets            |
| ecs_secrets_access_policy_arn | ARN of the IAM policy for ECS task access |
| all_secret_arns               | Map of all secret ARNs                    |

## Post-Deployment Configuration

After deploying this module, you must manually update the secret values using the AWS CLI or Console:

### Update Supabase Credentials

```bash
aws secretsmanager put-secret-value \
  --secret-id prod/classla/supabase/credentials \
  --secret-string '{
    "url": "https://your-project.supabase.co",
    "anon_key": "your-anon-key",
    "service_role_key": "your-service-role-key"
  }'
```

### Update WorkOS Credentials

```bash
aws secretsmanager put-secret-value \
  --secret-id prod/classla/workos/credentials \
  --secret-string '{
    "api_key": "your-workos-api-key",
    "client_id": "your-workos-client-id"
  }'
```

### Update Application Secrets

```bash
aws secretsmanager put-secret-value \
  --secret-id prod/classla/app/secrets \
  --secret-string '{
    "session_secret": "your-random-session-secret"
  }'
```

### Generate a Secure Session Secret

```bash
# Generate a random 64-character session secret
openssl rand -hex 32
```

## Security Features

- All secrets are encrypted at rest using AWS KMS (default encryption)
- IAM policy follows least-privilege principle (only GetSecretValue and DescribeSecret)
- Secret values use `ignore_changes` lifecycle to prevent Terraform from overwriting manual updates
- Placeholder values are set initially to allow Terraform to create the secrets

## Integration with ECS

To use these secrets in your ECS task definition, attach the IAM policy to your ECS task role:

```hcl
resource "aws_iam_role_policy_attachment" "ecs_secrets_access" {
  role       = aws_iam_role.ecs_task_role.name
  policy_arn = module.secrets.ecs_secrets_access_policy_arn
}
```

Then reference the secrets in your task definition:

```hcl
secrets = [
  {
    name      = "SUPABASE_URL"
    valueFrom = "${module.secrets.supabase_credentials_arn}:url::"
  },
  {
    name      = "SUPABASE_ANON_KEY"
    valueFrom = "${module.secrets.supabase_credentials_arn}:anon_key::"
  },
  {
    name      = "SUPABASE_SERVICE_ROLE_KEY"
    valueFrom = "${module.secrets.supabase_credentials_arn}:service_role_key::"
  },
  {
    name      = "WORKOS_API_KEY"
    valueFrom = "${module.secrets.workos_credentials_arn}:api_key::"
  },
  {
    name      = "WORKOS_CLIENT_ID"
    valueFrom = "${module.secrets.workos_credentials_arn}:client_id::"
  },
  {
    name      = "SESSION_SECRET"
    valueFrom = "${module.secrets.app_secrets_arn}:session_secret::"
  }
]
```

## Notes

- The `lifecycle { ignore_changes = [secret_string] }` block ensures that Terraform won't overwrite manually updated secret values
- Secret names include the environment prefix to support multiple environments
- All resources are tagged with Environment and ManagedBy for better organization
