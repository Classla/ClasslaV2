# GitHub Actions Workflows

## Deploy Backend to AWS

This workflow automatically deploys the backend application to AWS when code changes are pushed to the `classla-backend` directory.

### Features

- **Automatic Docker Build & Push**: Builds and pushes Docker images to ECR
- **Zero-Downtime Deployment**: Uses AWS Auto Scaling Group instance refresh
- **Path-Based Triggers**: Only runs when `classla-backend/**` files change
- **Fast Execution**: No Terraform steps - just build and deploy

### Prerequisites

You need to configure the following GitHub Secrets:

1. **AWS_ACCESS_KEY_ID**: AWS access key with permissions for:
   - ECR (push/pull images)
   - Auto Scaling (describe groups, start instance refresh)
   - EC2 (read instance information)

2. **AWS_SECRET_ACCESS_KEY**: Corresponding AWS secret access key

### Workflow Steps

1. **Build and Push Docker Image**
   - Builds Docker image for `linux/amd64` platform
   - Tags with: `latest`, branch-SHA, and timestamp-SHA
   - Pushes to ECR with build cache

2. **Instance Refresh** (zero-downtime)
   - Automatically finds the Auto Scaling Group (searches for `classla-backend*`)
   - Checks for existing in-progress refreshes
   - Triggers Auto Scaling Group instance refresh with zero-downtime settings:
     - `MinHealthyPercentage=50`: Keeps at least 50% of instances healthy
     - `InstanceWarmup=300`: 5-minute warmup before adding to load balancer
     - Checkpoints at 25%, 50%, 75%, and 100%

### Zero-Downtime Deployment

The instance refresh ensures zero-downtime by:
- Rolling out new instances gradually
- Keeping old instances running until new ones are healthy
- Using ELB health checks to verify readiness
- Automatically draining connections from old instances

### Infrastructure Changes

**Important**: This workflow does NOT handle Terraform infrastructure changes. If you need to update infrastructure:

1. Make your Terraform changes locally in `classla-backend/terraform/`
2. Run `terraform plan` to review changes
3. Run `terraform apply` to apply changes
4. The workflow will continue to deploy application code automatically

### Manual Trigger

You can manually trigger the workflow from the GitHub Actions tab using the "Run workflow" button.

### Monitoring

After the workflow completes, you can monitor the instance refresh progress:

```bash
# Get ASG name from Terraform
cd classla-backend/terraform
terraform output auto_scaling_group_name

# Monitor instance refresh
aws autoscaling describe-instance-refreshes \
  --auto-scaling-group-name <ASG_NAME> \
  --region us-east-2
```

Or find the ASG name directly:

```bash
aws autoscaling describe-auto-scaling-groups \
  --region us-east-2 \
  --query 'AutoScalingGroups[?contains(AutoScalingGroupName, `classla-backend`)].AutoScalingGroupName' \
  --output text
```
