# ALB Module

This module creates an Application Load Balancer (ALB) with HTTPS support and WebSocket compatibility for the Classla backend application.

## Features

- **Application Load Balancer**: Internet-facing ALB in public subnets
- **Target Group**:
  - Protocol: HTTP on port 3001
  - Health checks on configurable path (default: `/health`)
  - Deregistration delay: 30 seconds
  - Connection stickiness enabled for WebSocket support
- **HTTP Listener**: Redirects all HTTP (port 80) traffic to HTTPS (port 443)
- **HTTPS Listener**:
  - SSL/TLS termination with ACM certificate
  - Modern TLS policy (TLS 1.3 and 1.2)
  - Forwards traffic to target group
- **WebSocket Support**:
  - Idle timeout: 3600 seconds (1 hour)
  - Connection stickiness enabled
- **Security Group**:
  - Inbound: HTTP (80) and HTTPS (443) from anywhere
  - Outbound: Port 3001 to ECS tasks

## Inputs

| Name              | Description                        | Type         | Default | Required |
| ----------------- | ---------------------------------- | ------------ | ------- | -------- |
| environment       | Environment name (e.g., dev, prod) | string       | -       | yes      |
| vpc_id            | ID of the VPC                      | string       | -       | yes      |
| public_subnet_ids | IDs of public subnets for ALB      | list(string) | -       | yes      |
| certificate_arn   | ARN of ACM certificate for HTTPS   | string       | -       | yes      |
| health_check_path | Health check path for target group | string       | -       | yes      |

## Outputs

| Name                  | Description                  |
| --------------------- | ---------------------------- |
| alb_dns_name          | DNS name of the ALB          |
| alb_arn               | ARN of the ALB               |
| target_group_arn      | ARN of the target group      |
| alb_security_group_id | Security group ID of the ALB |

## Usage

```hcl
module "alb" {
  source = "./modules/alb"

  environment        = "prod"
  vpc_id             = module.networking.vpc_id
  public_subnet_ids  = module.networking.public_subnet_ids
  certificate_arn    = "arn:aws:acm:us-east-1:123456789012:certificate/abc123..."
  health_check_path  = "/health"
}
```

## Requirements

- The networking module must be created first to provide VPC and public subnet IDs
- An ACM certificate must be created and validated before deploying this module
- The certificate must be in the same region as the ALB

## ACM Certificate Setup

Before deploying this module, you need to create an ACM certificate:

1. **Request a certificate** in AWS Certificate Manager:

   ```bash
   aws acm request-certificate \
     --domain-name api.yourdomain.com \
     --validation-method DNS \
     --region us-east-1
   ```

2. **Validate the certificate** by adding the DNS records provided by ACM to your domain's DNS configuration

3. **Use the certificate ARN** as the `certificate_arn` input variable

## Health Check Configuration

The target group performs health checks with the following settings:

- **Path**: Configurable via `health_check_path` variable
- **Protocol**: HTTP
- **Port**: 3001 (traffic port)
- **Interval**: 30 seconds
- **Timeout**: 5 seconds
- **Healthy threshold**: 2 consecutive successes
- **Unhealthy threshold**: 3 consecutive failures
- **Success codes**: 200

## WebSocket Support

This module is configured to support WebSocket connections:

1. **Idle Timeout**: Set to 3600 seconds (1 hour) to prevent premature connection closure
2. **Connection Stickiness**: Enabled with 24-hour cookie duration to ensure WebSocket connections stay with the same target
3. **HTTP/2**: Enabled for improved performance

## Security Considerations

- The ALB is internet-facing and accepts traffic from anywhere (0.0.0.0/0) on ports 80 and 443
- All HTTP traffic is automatically redirected to HTTPS
- The security group only allows outbound traffic to port 3001 (ECS tasks)
- TLS policy uses modern encryption standards (TLS 1.3 and 1.2 only)

## Integration with ECS

The target group uses `target_type = "ip"` to work with ECS Fargate tasks in awsvpc network mode. The ECS service will automatically register tasks with this target group.

## Cost Considerations

- ALB costs approximately $20-25/month for the load balancer itself
- Additional costs for data processing (per GB)
- No additional cost for HTTPS/SSL termination

## Monitoring

The ALB automatically publishes metrics to CloudWatch:

- Request count
- Target response time
- HTTP 4xx/5xx error counts
- Active connection count
- Target health status

These metrics can be used to create CloudWatch alarms for monitoring application health.
