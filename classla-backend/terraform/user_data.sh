#!/bin/bash
# Don't exit on error immediately - we want to log everything
set +e

# Enable logging
exec > >(tee -a /var/log/classla-backend-user-data.log)
exec 2>&1

echo "=== User Data Script Started at $(date) ===" >> /var/log/classla-backend-user-data.log

# Variables from Terraform
AWS_REGION="${aws_region}"
ECR_REPOSITORY_URL="${ecr_repository_url}"
DOCKER_IMAGE_TAG="${docker_image_tag}"
REDIS_ENDPOINT="${redis_endpoint}"
REDIS_PORT="${redis_port}"
SECRETS_MANAGER_SUPABASE="${secrets_manager_supabase}"
SECRETS_MANAGER_WORKOS="${secrets_manager_workos}"
SECRETS_MANAGER_APP="${secrets_manager_app}"
FRONTEND_URL="${frontend_url}"
LOG_GROUP_NAME="${log_group_name}"
ASG_NAME="${asg_name}"

# Update system
yum update -y

# Install Docker
yum install -y docker
systemctl start docker
systemctl enable docker
usermod -a -G docker ec2-user

# Install AWS CLI v2 (if not already installed)
if ! command -v aws &> /dev/null; then
    curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
    yum install -y unzip
    unzip awscliv2.zip
    ./aws/install
    rm -rf aws awscliv2.zip
fi

# Install jq for JSON parsing
yum install -y jq

# Configure ECR login
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_REPOSITORY_URL

# Retrieve secrets from Secrets Manager
SUPABASE_SECRET=$(aws secretsmanager get-secret-value --secret-id $SECRETS_MANAGER_SUPABASE --region $AWS_REGION --query SecretString --output text)
WORKOS_SECRET=$(aws secretsmanager get-secret-value --secret-id $SECRETS_MANAGER_WORKOS --region $AWS_REGION --query SecretString --output text)
APP_SECRET=$(aws secretsmanager get-secret-value --secret-id $SECRETS_MANAGER_APP --region $AWS_REGION --query SecretString --output text)

# Parse secrets
SUPABASE_URL=$(echo $SUPABASE_SECRET | jq -r '.url // .SUPABASE_URL')
SUPABASE_SERVICE_ROLE_KEY=$(echo $SUPABASE_SECRET | jq -r '.service_role_key // .SUPABASE_SERVICE_ROLE_KEY')
WORKOS_CLIENT_ID=$(echo $WORKOS_SECRET | jq -r '.client_id // .WORKOS_CLIENT_ID')
WORKOS_API_KEY=$(echo $WORKOS_SECRET | jq -r '.api_key // .WORKOS_API_KEY')
WORKOS_REDIRECT_URI=$(echo $WORKOS_SECRET | jq -r '.redirect_uri // .WORKOS_REDIRECT_URI')
SESSION_SECRET=$(echo $APP_SECRET | jq -r '.session_secret // .SESSION_SECRET')
# Get FRONTEND_URL from app secret (preferred) or fall back to Terraform variable
FRONTEND_URL_FROM_SECRET=$(echo $APP_SECRET | jq -r '.frontend_url // .FRONTEND_URL // empty')
if [ -n "$FRONTEND_URL_FROM_SECRET" ]; then
  FRONTEND_URL="$FRONTEND_URL_FROM_SECRET"
  echo "Using FRONTEND_URL from Secrets Manager: $FRONTEND_URL" >> /var/log/classla-backend-deployment.log
else
  echo "FRONTEND_URL not found in secret, using Terraform variable: $FRONTEND_URL" >> /var/log/classla-backend-deployment.log
fi

# Parse AWS credentials from app secret (optional - IAM role is preferred)
BEDROCK_ACCESS_KEY_ID=$(echo $APP_SECRET | jq -r '.bedrock_access_key_id // .BEDROCK_ACCESS_KEY_ID // empty')
BEDROCK_SECRET_ACCESS_KEY=$(echo $APP_SECRET | jq -r '.bedrock_secret_access_key // .BEDROCK_SECRET_ACCESS_KEY // empty')
IDE_MANAGER_ACCESS_KEY_ID=$(echo $APP_SECRET | jq -r '.ide_manager_access_key_id // .IDE_MANAGER_ACCESS_KEY_ID // empty')
IDE_MANAGER_SECRET_ACCESS_KEY=$(echo $APP_SECRET | jq -r '.ide_manager_secret_access_key // .IDE_MANAGER_SECRET_ACCESS_KEY // empty')
CONTAINER_SERVICE_TOKEN=$(echo $APP_SECRET | jq -r '.container_service_token // .CONTAINER_SERVICE_TOKEN // empty')
TAVILY_API_KEY=$(echo $APP_SECRET | jq -r '.tavily_api_key // .TAVILY_API_KEY // empty')

# Parse IDE orchestration credentials
IDE_API_BASE_URL=$(echo $APP_SECRET | jq -r '.ide_api_base_url // .IDE_API_BASE_URL // empty')
IDE_API_KEY=$(echo $APP_SECRET | jq -r '.ide_api_key // .IDE_API_KEY // empty')

# Create directory for app
mkdir -p /opt/classla-backend

# Validate required variables
if [ -z "$FRONTEND_URL" ]; then
  echo "ERROR: FRONTEND_URL is not set" >> /var/log/classla-backend-deployment.log
  exit 1
fi

# Create environment file for Docker
cat > /opt/classla-backend/.env <<EOF
NODE_ENV=production
PORT=3001
AWS_REGION=$AWS_REGION
# Bedrock models (Claude) are typically available in us-east-1, even if infrastructure is in us-east-2
BEDROCK_REGION=us-east-1
SUPABASE_URL=$SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY
WORKOS_CLIENT_ID=$WORKOS_CLIENT_ID
WORKOS_API_KEY=$WORKOS_API_KEY
WORKOS_REDIRECT_URI=$WORKOS_REDIRECT_URI
SESSION_SECRET=$SESSION_SECRET
FRONTEND_URL=$FRONTEND_URL
REDIS_URL=redis://$REDIS_ENDPOINT:$REDIS_PORT
EOF

# Add AWS credentials if provided (optional - IAM role is preferred)
if [ -n "$BEDROCK_ACCESS_KEY_ID" ] && [ -n "$BEDROCK_SECRET_ACCESS_KEY" ]; then
  echo "BEDROCK_ACCESS_KEY_ID=$BEDROCK_ACCESS_KEY_ID" >> /opt/classla-backend/.env
  echo "BEDROCK_SECRET_ACCESS_KEY=$BEDROCK_SECRET_ACCESS_KEY" >> /opt/classla-backend/.env
  echo "Added Bedrock credentials to environment file" >> /var/log/classla-backend-deployment.log
else
  echo "Bedrock credentials not provided, will use IAM role credentials" >> /var/log/classla-backend-deployment.log
fi

if [ -n "$IDE_MANAGER_ACCESS_KEY_ID" ] && [ -n "$IDE_MANAGER_SECRET_ACCESS_KEY" ]; then
  echo "IDE_MANAGER_ACCESS_KEY_ID=$IDE_MANAGER_ACCESS_KEY_ID" >> /opt/classla-backend/.env
  echo "IDE_MANAGER_SECRET_ACCESS_KEY=$IDE_MANAGER_SECRET_ACCESS_KEY" >> /opt/classla-backend/.env
  echo "Added IDE Manager credentials to environment file" >> /var/log/classla-backend-deployment.log
else
  echo "IDE Manager credentials not provided, will use IAM role credentials" >> /var/log/classla-backend-deployment.log
fi

if [ -n "$CONTAINER_SERVICE_TOKEN" ]; then
  echo "CONTAINER_SERVICE_TOKEN=$CONTAINER_SERVICE_TOKEN" >> /opt/classla-backend/.env
  echo "Added Container Service Token to environment file" >> /var/log/classla-backend-deployment.log
else
  echo "WARNING: Container Service Token not provided, Y.js sync will fail" >> /var/log/classla-backend-deployment.log
fi

if [ -n "$TAVILY_API_KEY" ]; then
  echo "TAVILY_API_KEY=$TAVILY_API_KEY" >> /opt/classla-backend/.env
  echo "Added Tavily API Key to environment file" >> /var/log/classla-backend-deployment.log
else
  echo "WARNING: Tavily API Key not provided, AI web search will be disabled" >> /var/log/classla-backend-deployment.log
fi

# IDE Orchestration Service Configuration
if [ -n "$IDE_API_BASE_URL" ]; then
  echo "IDE_API_BASE_URL=$IDE_API_BASE_URL" >> /opt/classla-backend/.env
  echo "Added IDE API Base URL to environment file: $IDE_API_BASE_URL" >> /var/log/classla-backend-deployment.log
else
  echo "WARNING: IDE_API_BASE_URL not provided, using default https://ide.classla.org/api" >> /var/log/classla-backend-deployment.log
fi

if [ -n "$IDE_API_KEY" ]; then
  echo "IDE_API_KEY=$IDE_API_KEY" >> /opt/classla-backend/.env
  echo "Added IDE API Key to environment file" >> /var/log/classla-backend-deployment.log
else
  echo "WARNING: IDE_API_KEY not provided, admin IDE endpoints may fail" >> /var/log/classla-backend-deployment.log
fi

# Log environment setup
echo "Environment file created with FRONTEND_URL=$FRONTEND_URL" >> /var/log/classla-backend-deployment.log

# Pull Docker image
docker pull $ECR_REPOSITORY_URL:$DOCKER_IMAGE_TAG

# Stop any existing container
docker stop classla-backend || true
docker rm classla-backend || true

# Run Docker container
echo "Starting Docker container..." >> /var/log/classla-backend-deployment.log
echo "ECR Repository: $ECR_REPOSITORY_URL" >> /var/log/classla-backend-deployment.log
echo "Image Tag: $DOCKER_IMAGE_TAG" >> /var/log/classla-backend-deployment.log

# Verify .env file exists and has content
if [ ! -f /opt/classla-backend/.env ]; then
  echo "ERROR: .env file not found" >> /var/log/classla-backend-deployment.log
  exit 1
fi

echo "Environment file contents (without secrets):" >> /var/log/classla-backend-deployment.log
grep -v "SECRET\|KEY\|PASSWORD" /opt/classla-backend/.env >> /var/log/classla-backend-deployment.log

docker run -d \
  --name classla-backend \
  --restart unless-stopped \
  -p 3001:3001 \
  --env-file /opt/classla-backend/.env \
  $ECR_REPOSITORY_URL:$DOCKER_IMAGE_TAG 2>&1 | tee -a /var/log/classla-backend-deployment.log

CONTAINER_ID=$(docker ps -q -f name=classla-backend)
if [ -z "$CONTAINER_ID" ]; then
  echo "ERROR: Docker container failed to start" >> /var/log/classla-backend-deployment.log
  echo "Checking container status..." >> /var/log/classla-backend-deployment.log
  docker ps -a | grep classla-backend >> /var/log/classla-backend-deployment.log
  echo "Container logs:" >> /var/log/classla-backend-deployment.log
  docker logs classla-backend >> /var/log/classla-backend-deployment.log 2>&1
  exit 1
fi

echo "Container started with ID: $CONTAINER_ID" >> /var/log/classla-backend-deployment.log

# Wait for container to be ready
echo "Waiting for container to be ready..." >> /var/log/classla-backend-deployment.log
sleep 10

# Check if container is still running
if ! docker ps | grep -q classla-backend; then
  echo "ERROR: Docker container stopped after starting" >> /var/log/classla-backend-deployment.log
  docker logs classla-backend >> /var/log/classla-backend-deployment.log 2>&1
  exit 1
fi

# Verify container is responding
echo "Testing health endpoint..." >> /var/log/classla-backend-deployment.log
for i in {1..15}; do
  if curl -f http://localhost:3001/health > /dev/null 2>&1; then
    echo "Container health check passed on attempt $i" >> /var/log/classla-backend-deployment.log
    curl -s http://localhost:3001/health >> /var/log/classla-backend-deployment.log
    break
  fi
  if [ $i -eq 15 ]; then
    echo "WARNING: Container health check failed after 15 attempts" >> /var/log/classla-backend-deployment.log
    echo "Container status:" >> /var/log/classla-backend-deployment.log
    docker ps -a | grep classla-backend >> /var/log/classla-backend-deployment.log
    echo "Container logs:" >> /var/log/classla-backend-deployment.log
    docker logs classla-backend >> /var/log/classla-backend-deployment.log 2>&1
    echo "Environment variables:" >> /var/log/classla-backend-deployment.log
    docker exec classla-backend env | grep -E "FRONTEND_URL|PORT|NODE_ENV" >> /var/log/classla-backend-deployment.log 2>&1 || echo "Could not exec into container" >> /var/log/classla-backend-deployment.log
  fi
  sleep 2
done

# Install and configure CloudWatch agent
wget https://s3.amazonaws.com/amazoncloudwatch-agent/amazon_linux/amd64/latest/amazon-cloudwatch-agent.rpm
rpm -U ./amazon-cloudwatch-agent.rpm

# Create CloudWatch agent configuration
cat > /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json <<EOF
{
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          {
            "file_path": "/var/lib/docker/containers/*/*-json.log",
            "log_group_name": "$LOG_GROUP_NAME",
            "log_stream_name": "{instance_id}-docker",
            "timezone": "UTC"
          }
        ]
      }
    }
  },
  "metrics": {
    "namespace": "ClasslaBackend",
    "append_dimensions": {
      "AutoScalingGroupName": "$ASG_NAME"
    },
    "metrics_collected": {
      "cpu": {
        "measurement": [
          "cpu_usage_idle",
          "cpu_usage_iowait",
          "cpu_usage_user",
          "cpu_usage_system"
        ],
        "totalcpu": false
      },
      "disk": {
        "measurement": [
          "used_percent"
        ],
        "resources": [
          "*"
        ]
      },
      "diskio": {
        "measurement": [
          "io_time"
        ],
        "resources": [
          "*"
        ]
      },
      "mem": {
        "measurement": [
          "mem_used_percent"
        ]
      },
      "netstat": {
        "measurement": [
          "tcp_established",
          "tcp_time_wait"
        ]
      },
      "processes": {
        "measurement": [
          "running",
          "sleeping",
          "dead"
        ]
      }
    }
  }
}
EOF

# Start CloudWatch agent
/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
  -a fetch-config \
  -m ec2 \
  -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json \
  -s

# Log successful deployment
echo "Classla backend deployed successfully at $(date)" >> /var/log/classla-backend-deployment.log

