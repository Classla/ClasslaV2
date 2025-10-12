# ECS Module

This module creates an ECS Fargate cluster, task definition, and service for running the Classla backend application.

## Features

- **ECS Cluster**: Fargate cluster with Container Insights enabled
- **Task Definition**: Configures the Express.js backend container with:
  - CPU: 512 (0.5 vCPU) - configurable
  - Memory: 1024 MB - configurable
  - Port: 3001
  - Health checks on `/health` endpoint
  - Secrets from AWS Secrets Manager
  - CloudWatch Logs integration
- **ECS Service**:
  - Desired count: 1 task (minimum)
  - Launch type: FARGATE
  - Network mode: awsvpc (private subnets)
  - Rolling deployment strategy
  - Integration with ALB target group
- **Auto Scaling**:
  - Min: 1 task, Max: 2 tasks
  - CPU-based scaling (target: 70%)
  - Memory-based scaling (target: 80%)
  - Scale-out cooldown: 60 seconds
  - Scale-in cooldown: 300 seconds
- **IAM Roles**:
  - Task Execution Role: Pull images from ECR, write logs, read secrets
  - Task Role: Application-level permissions
- **Security Group**: Allows traffic from ALB on port 3001
- **CloudWatch Logs**: 90-day retention for ECS task logs

## Inputs

| Name                      | Description                             | Type         | Default | Required |
| ------------------------- | --------------------------------------- | ------------ | ------- | -------- |
| environment               | Environment name (e.g., dev, prod)      | string       | -       | yes      |
| vpc_id                    | ID of the VPC                           | string       | -       | yes      |
| private_subnet_ids        | IDs of private subnets for ECS tasks    | list(string) | -       | yes      |
| alb_security_group_id     | Security group ID of the ALB            | string       | -       | yes      |
| alb_target_group_arn      | ARN of the ALB target group             | string       | -       | yes      |
| ecr_repository_url        | URL of the ECR repository               | string       | -       | yes      |
| secrets_arns              | Map of secret ARNs from Secrets Manager | map(string)  | -       | yes      |
| secrets_access_policy_arn | ARN of IAM policy for accessing secrets | string       | -       | yes      |
| container_cpu             | CPU units for the container             | number       | 512     | no       |
| container_memory          | Memory for the container in MB          | number       | 1024    | no       |

## Outputs

| Name                    | Description                        |
| ----------------------- | ---------------------------------- |
| cluster_name            | Name of the ECS cluster            |
| cluster_arn             | ARN of the ECS cluster             |
| service_name            | Name of the ECS service            |
| task_definition_arn     | ARN of the task definition         |
| security_group_id       | Security group ID for ECS tasks    |
| task_execution_role_arn | ARN of the ECS task execution role |
| task_role_arn           | ARN of the ECS task role           |

## Environment Variables

The task definition configures the following environment variables:

### Static Environment Variables

- `PORT`: 3001
- `NODE_ENV`: production

### Secrets from AWS Secrets Manager

- `SUPABASE_URL`: From supabase_credentials secret
- `SUPABASE_ANON_KEY`: From supabase_credentials secret
- `SUPABASE_SERVICE_ROLE_KEY`: From supabase_credentials secret
- `WORKOS_API_KEY`: From workos_credentials secret
- `WORKOS_CLIENT_ID`: From workos_credentials secret
- `SESSION_SECRET`: From app_secrets secret

## Usage

```hcl
module "ecs" {
  source = "./modules/ecs"

  environment                = "prod"
  vpc_id                     = module.networking.vpc_id
  private_subnet_ids         = module.networking.private_subnet_ids
  alb_security_group_id      = module.alb.alb_security_group_id
  alb_target_group_arn       = module.alb.target_group_arn
  ecr_repository_url         = module.ecr.repository_url
  secrets_arns               = module.secrets.all_secret_arns
  secrets_access_policy_arn  = module.secrets.ecs_secrets_access_policy_arn
  container_cpu              = 512
  container_memory           = 1024
}
```

## Requirements

- The ALB module must be created first to provide the security group and target group
- The ECR module must be created first to provide the repository URL
- The Secrets Manager module must be created first to provide secret ARNs
- The networking module must be created first to provide VPC and subnet IDs
- A Docker image must be pushed to ECR before the service can start successfully

## Health Checks

The task definition includes a container health check that:

- Runs every 30 seconds
- Checks the `/health` endpoint on port 3001
- Allows 60 seconds for the container to start
- Requires 3 consecutive failures to mark as unhealthy

## Auto Scaling Behavior

The service will scale up to 2 tasks when:

- CPU utilization exceeds 70% for the scale-out cooldown period (60 seconds)
- Memory utilization exceeds 80% for the scale-out cooldown period (60 seconds)

The service will scale down to 1 task when:

- CPU and memory utilization drop below targets for the scale-in cooldown period (300 seconds)

## Deployment Strategy

The service uses a rolling deployment strategy:

- Maximum percent: 200% (allows 2 tasks during deployment)
- Minimum healthy percent: 100% (ensures at least 1 task is always running)
- Health check grace period: 60 seconds

This ensures zero-downtime deployments when updating the task definition.
