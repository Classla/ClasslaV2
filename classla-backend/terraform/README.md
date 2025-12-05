# Classla Backend Infrastructure

This directory contains Terraform configuration for deploying the Classla backend on AWS EC2 with auto-scaling, load balancing, and Redis session storage.

## Architecture

- **VPC**: Custom VPC with public and private subnets
- **Application Load Balancer**: HTTPS-enabled ALB in public subnets
- **EC2 Instances**: Auto-scaling group of EC2 instances running Docker containers
- **ElastiCache Redis**: Redis cluster for session storage
- **AWS Secrets Manager**: Secure storage for application secrets
- **CloudWatch**: Logging and monitoring

## Prerequisites

1. **AWS Account** with appropriate permissions
2. **Terraform** >= 1.5.0 installed
3. **AWS CLI** configured with credentials
4. **Docker** installed locally (for building images)
5. **ECR Repository** created for Docker images
6. **ACM Certificate** for HTTPS (or create one via AWS Certificate Manager)
7. **Secrets in AWS Secrets Manager** (see below)

## Required Secrets in AWS Secrets Manager

Before deploying, create the following secrets in AWS Secrets Manager:

### 1. Supabase Credentials (`classla-backend/supabase`)

```json
{
  "url": "https://your-project.supabase.co",
  "service_role_key": "your-service-role-key"
}
```

Create with:
```bash
aws secretsmanager create-secret \
  --name classla-backend/supabase \
  --secret-string '{"url":"https://your-project.supabase.co","service_role_key":"your-key"}' \
  --region us-east-2
```

### 2. WorkOS Credentials (`classla-backend/workos`)

```json
{
  "client_id": "client_xxxxx",
  "api_key": "sk_live_xxxxx",
  "redirect_uri": "https://your-frontend-domain.com/callback"
}
```

Create with:
```bash
aws secretsmanager create-secret \
  --name classla-backend/workos \
  --secret-string '{"client_id":"client_xxxxx","api_key":"sk_live_xxxxx","redirect_uri":"https://your-frontend-domain.com/callback"}' \
  --region us-east-2
```

### 3. App Configuration (`classla-backend/app`)

```json
{
  "session_secret": "generate-a-random-secret-here",
  "frontend_url": "https://your-frontend-domain.com"
}
```

Generate session secret:
```bash
openssl rand -base64 32
```

Create with:
```bash
aws secretsmanager create-secret \
  --name classla-backend/app \
  --secret-string '{"session_secret":"your-generated-secret","frontend_url":"https://your-frontend-domain.com"}' \
  --region us-east-2
```

## Setup

1. **Copy the example variables file:**
   ```bash
   cp terraform.tfvars.example terraform.tfvars
   ```

2. **Edit `terraform.tfvars`** with your values:
   - `acm_certificate_arn`: Your ACM certificate ARN
   - `ecr_repository_url`: Your ECR repository URL
   - `frontend_url`: Your frontend URL
   - Adjust other values as needed

3. **Initialize Terraform:**
   ```bash
   terraform init
   ```

4. **Review the deployment plan:**
   ```bash
   terraform plan
   ```

5. **Deploy the infrastructure:**
   ```bash
   terraform apply
   ```

## Building and Pushing Docker Image

Before deploying, build and push your Docker image to ECR:

```bash
# Authenticate Docker to ECR
aws ecr get-login-password --region us-east-2 | \
  docker login --username AWS --password-stdin <ECR_REPOSITORY_URL>

# Build the image
cd ..
docker build -t classla-backend:latest .

# Tag the image
docker tag classla-backend:latest <ECR_REPOSITORY_URL>:latest

# Push to ECR
docker push <ECR_REPOSITORY_URL>:latest
```

## Updating the Deployment

When you push a new Docker image:

1. **Push new image to ECR** (see above)

2. **Update the launch template** (Terraform will handle this):
   ```bash
   terraform apply
   ```

3. **Force instance refresh** (optional, instances will gradually update):
   ```bash
   aws autoscaling start-instance-refresh \
     --auto-scaling-group-name <ASG_NAME> \
     --preferences MinHealthyPercentage=50,InstanceWarmup=300
   ```

## Outputs

After deployment, get important values:

```bash
# Get ALB DNS name
terraform output alb_dns_name

# Get Redis endpoint
terraform output redis_endpoint

# Get all outputs
terraform output
```

## Scaling

The Auto Scaling Group is configured to scale based on CPU utilization (default: 70%). You can adjust:

- `min_size`: Minimum number of instances
- `max_size`: Maximum number of instances
- `desired_capacity`: Desired number of instances
- `cpu_scaling_target`: Target CPU utilization for scaling

Edit `terraform.tfvars` and run `terraform apply` to update.

## Monitoring

CloudWatch alarms are configured for:
- High CPU utilization
- ALB 5xx errors
- Target health check failures
- High response time

View logs:
```bash
aws logs tail /aws/ec2/classla-backend-production --follow
```

## Troubleshooting

### Instance not starting

1. Check EC2 instance logs:
   ```bash
   aws ec2 get-console-output --instance-id <INSTANCE_ID>
   ```

2. Check CloudWatch logs:
   ```bash
   aws logs tail /aws/ec2/classla-backend-production --follow
   ```

3. Verify secrets exist:
   ```bash
   aws secretsmanager describe-secret --secret-id classla-backend/supabase
   ```

### Health checks failing

1. Check target group health:
   ```bash
   aws elbv2 describe-target-health --target-group-arn <TG_ARN>
   ```

2. Verify security groups allow traffic from ALB to EC2

3. Check application logs for errors

### Docker container not running

SSH into the instance and check:
```bash
# Check Docker status
sudo systemctl status docker

# Check container logs
sudo docker logs classla-backend

# Check if container is running
sudo docker ps -a
```

## Cleanup

To destroy all resources:

```bash
terraform destroy
```

**Warning**: This will delete all infrastructure including the VPC, ALB, EC2 instances, and Redis cluster.

## Security Notes

- EC2 instances run in private subnets (no direct internet access)
- Secrets are retrieved from Secrets Manager at instance startup
- IAM roles are used (no hardcoded credentials)
- Redis is only accessible from EC2 instances
- ALB handles SSL/TLS termination

## Cost Optimization

- Use `t3.micro` or `t3.small` for development
- Set `min_size` and `desired_capacity` to 1 for dev environments
- Use `cache.t3.micro` for Redis in development
- Enable deletion protection only in production

## Additional Resources

- [Terraform AWS Provider Documentation](https://registry.terraform.io/providers/hashicorp/aws/latest/docs)
- [AWS Auto Scaling Documentation](https://docs.aws.amazon.com/autoscaling/)
- [AWS Application Load Balancer Documentation](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/)

