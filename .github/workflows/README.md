# GitHub Actions Workflows

## Deploy Backend to AWS

This workflow automatically deploys the backend application to AWS when code changes are pushed to the `classla-backend` directory.

### Features

- **Automatic Docker Build & Push**: Builds and pushes Docker images to ECR
- **Terraform Plan & Apply**: Only applies changes if Terraform detects differences
- **Zero-Downtime Deployment**: Uses AWS Auto Scaling Group instance refresh
- **Path-Based Triggers**: Only runs when `classla-backend/**` files change

### Prerequisites

You need to configure the following GitHub Secrets:

1. **AWS_ACCESS_KEY_ID**: AWS access key with permissions for:
   - ECR (push/pull images)
   - Terraform state management (S3, DynamoDB if using remote state)
   - EC2, Auto Scaling, VPC, ALB, ElastiCache, Secrets Manager
   - CloudWatch Logs

2. **AWS_SECRET_ACCESS_KEY**: Corresponding AWS secret access key

### Workflow Steps

1. **Build and Push Docker Image**
   - Builds Docker image for `linux/amd64` platform
   - Tags with: `latest`, branch-SHA, and timestamp-SHA
   - Pushes to ECR with build cache

2. **Terraform Plan**
   - Initializes Terraform
   - Runs `terraform plan` to detect changes
   - Uploads plan as artifact for review

3. **Terraform Apply** (conditional)
   - Only runs if Terraform detected changes
   - Applies the plan automatically
   - Updates infrastructure as needed

4. **Instance Refresh** (zero-downtime)
   - Always runs after successful build
   - Triggers Auto Scaling Group instance refresh
   - Settings:
     - `MinHealthyPercentage=50`: Keeps at least 50% of instances healthy
     - `InstanceWarmup=300`: 5-minute warmup before adding to load balancer
     - Checkpoints at 25%, 50%, 75%, and 100%

### Zero-Downtime Deployment

The instance refresh ensures zero-downtime by:
- Rolling out new instances gradually
- Keeping old instances running until new ones are healthy
- Using ELB health checks to verify readiness
- Automatically draining connections from old instances

### Manual Trigger

You can manually trigger the workflow from the GitHub Actions tab using the "Run workflow" button.

### Monitoring

After the workflow completes, you can monitor the instance refresh progress:

```bash
aws autoscaling describe-instance-refreshes \
  --auto-scaling-group-name <ASG_NAME> \
  --region us-east-2
```

Replace `<ASG_NAME>` with the actual Auto Scaling Group name from Terraform outputs.
