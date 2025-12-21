#!/bin/bash
set -e

# Start script for Classla IDE Container system
# Initializes Docker Swarm, creates network, and starts all services

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Parse command line arguments
PRODUCTION=false
while [[ $# -gt 0 ]]; do
  case $1 in
    --production|-p)
      PRODUCTION=true
      shift
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: $0 [--production]"
      exit 1
      ;;
  esac
done

echo "========================================="
echo "Classla IDE Container - Start Script"
if [ "$PRODUCTION" = "true" ]; then
  echo "Mode: PRODUCTION"
else
  echo "Mode: LOCAL"
fi
echo "========================================="
echo ""

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
  echo "❌ Error: Docker is not running. Please start Docker and try again."
  exit 1
fi

# Check if images exist
if ! docker images | grep -q "classla-ide-container.*latest"; then
  echo "⚠️  Warning: IDE container image not found. Run ./build.sh first."
  exit 1
fi

if ! docker images | grep -q "ide-orchestration-api.*latest"; then
  echo "⚠️  Warning: Orchestration API image not found. Run ./build.sh first."
  exit 1
fi

# Initialize Docker Swarm if not already initialized
if ! docker info | grep -q "Swarm: active"; then
  echo "🐝 Initializing Docker Swarm..."
  docker swarm init 2>/dev/null || {
    echo "⚠️  Swarm already initialized or failed to initialize"
  }
else
  echo "✓ Docker Swarm is already active"
fi
echo ""

# Create network if it doesn't exist
NETWORK_NAME="ide-network"
if ! docker network ls | grep -q "$NETWORK_NAME"; then
  echo "🌐 Creating Docker network: $NETWORK_NAME..."
  docker network create --driver overlay --attachable "$NETWORK_NAME" || {
    echo "⚠️  Network may already exist or creation failed"
  }
else
  echo "✓ Network $NETWORK_NAME already exists"
fi
echo ""

# Load environment variables from .env file
ORCHESTRATION_ENV="$SCRIPT_DIR/orchestration/.env"
if [ -f "$ORCHESTRATION_ENV" ]; then
  echo "📄 Loading environment variables from .env file..."
  set -a  # automatically export all variables
  source "$ORCHESTRATION_ENV" 2>/dev/null || true
  set +a
fi

# Production mode configuration
if [ "$PRODUCTION" = "true" ]; then
  echo "🔧 Configuring for PRODUCTION mode..."
  
  # Set production domain
  export DOMAIN=${DOMAIN:-ide.classla.org}
  echo "✓ Domain: $DOMAIN"
  
  # Set ACME email for Let's Encrypt
  export ACME_EMAIL=${ACME_EMAIL:-admin@classla.org}
  echo "✓ ACME Email: $ACME_EMAIL"
  
  # Set Traefik configuration for production
  export TRAEFIK_INSECURE="false"
  # Use printf to safely construct the rule with backticks
  TRAEFIK_DASHBOARD_RULE_VALUE=$(printf 'Host(`traefik.%s`)' "$DOMAIN")
  export TRAEFIK_DASHBOARD_RULE="$TRAEFIK_DASHBOARD_RULE_VALUE"
  export TRAEFIK_DASHBOARD_ENTRYPOINT="websecure"
  export TRAEFIK_DASHBOARD_TLS="letsencrypt"
  export DASHBOARD_PORT=""
  # Enable HTTPS redirect in production
  export HTTPS_REDIRECT="true"
  
  # Set management API labels for production
  # Only match /api paths to avoid conflicting with container routes
  export MANAGEMENT_API_MAIN_RULE="Host(\`${DOMAIN}\`) && PathPrefix(\`/api\`)"
  export MANAGEMENT_API_MAIN_ENTRYPOINT="websecure"
  export MANAGEMENT_API_MAIN_TLS="letsencrypt"
  export MANAGEMENT_API_MAIN_SERVICE="management-api-main"
  export MANAGEMENT_API_MAIN_SERVICE_PORT="3001"
  export MANAGEMENT_API_SUBDOMAIN_RULE="Host(\`api.${DOMAIN}\`)"
  export MANAGEMENT_API_ENTRYPOINT="websecure"
  export MANAGEMENT_API_TLS="letsencrypt"
  export MANAGEMENT_API_SERVICE="management-api"
  export MANAGEMENT_API_SERVICE_PORT="3001"
  export DASHBOARD_RULE="Host(\`dashboard.${DOMAIN}\`)"
  export DASHBOARD_ENTRYPOINT="websecure"
  export DASHBOARD_TLS="letsencrypt"
  export DASHBOARD_SERVICE="dashboard"
  export DASHBOARD_SERVICE_PORT="3001"
  
  # Set NODE_ENV
  export NODE_ENV="production"
  
  # Validate required production variables
  if [ -z "$API_KEY" ] || [ "$API_KEY" = "" ]; then
    echo "❌ Error: API_KEY is required for production mode"
    echo "   Please set API_KEY in your .env file or environment"
    exit 1
  fi
  
  # Try to get AWS credentials from AWS CLI if not set
  if [ -z "$AWS_ACCESS_KEY_ID" ] || [ "$AWS_ACCESS_KEY_ID" = "" ]; then
    echo "🔍 Checking AWS CLI for credentials..."
    AWS_CLI_ACCESS_KEY=$(aws configure get aws_access_key_id 2>/dev/null || echo "")
    if [ -n "$AWS_CLI_ACCESS_KEY" ] && [ "$AWS_CLI_ACCESS_KEY" != "" ]; then
      export AWS_ACCESS_KEY_ID="$AWS_CLI_ACCESS_KEY"
      export AWS_SECRET_ACCESS_KEY=$(aws configure get aws_secret_access_key 2>/dev/null || echo "")
      echo "✓ Using AWS credentials from AWS CLI configuration"
    fi
  fi
  
  if [ -z "$AWS_ACCESS_KEY_ID" ] || [ "$AWS_ACCESS_KEY_ID" = "" ]; then
    echo "❌ Error: AWS_ACCESS_KEY_ID is required for production mode"
    echo "   Please set AWS_ACCESS_KEY_ID in your .env file or environment"
    exit 1
  fi
  
  if [ "$AWS_ACCESS_KEY_ID" = "dummy-key" ]; then
    echo "⚠️  Warning: Using dummy AWS credentials. S3 operations will fail."
    echo "   Please update AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in orchestration/.env"
  fi
  
  if [ -z "$AWS_SECRET_ACCESS_KEY" ] || [ "$AWS_SECRET_ACCESS_KEY" = "" ]; then
    echo "❌ Error: AWS_SECRET_ACCESS_KEY is required for production mode"
    echo "   Please set AWS_SECRET_ACCESS_KEY in your .env file or environment"
    exit 1
  fi
  
  if [ "$AWS_SECRET_ACCESS_KEY" = "dummy-secret" ]; then
    echo "⚠️  Warning: Using dummy AWS credentials. S3 operations will fail."
    echo "   Please update AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in orchestration/.env"
  fi
  
  echo "✓ Production environment variables validated"
else
  # Local mode configuration
  echo "🔧 Configuring for LOCAL mode..."
  export DOMAIN=${DOMAIN:-localhost}
  export NODE_ENV="local"
  export TRAEFIK_INSECURE="true"
  export TRAEFIK_DASHBOARD_RULE='Host(`traefik.localhost`) || Host(`localhost`)'
  export TRAEFIK_DASHBOARD_ENTRYPOINT="web"
  export TRAEFIK_DASHBOARD_TLS=""
  export DASHBOARD_PORT="8080"
  # Don't set HTTPS_REDIRECT in local mode - this prevents redirect flags from being added
  # (Docker Compose will skip flags with empty/unset variables)
  
  # Set production route rules to invalid hosts so they don't conflict in local mode
  export MANAGEMENT_API_MAIN_RULE="Host(`invalid.localhost`)"
  export MANAGEMENT_API_MAIN_ENTRYPOINT="web"
  export MANAGEMENT_API_MAIN_TLS=""
  export MANAGEMENT_API_MAIN_SERVICE="management-api-main"
  export MANAGEMENT_API_MAIN_SERVICE_PORT="3001"
  export MANAGEMENT_API_SUBDOMAIN_RULE="Host(`invalid-api.localhost`)"
  export MANAGEMENT_API_ENTRYPOINT="web"
  export MANAGEMENT_API_TLS=""
  export MANAGEMENT_API_SERVICE="management-api"
  export MANAGEMENT_API_SERVICE_PORT="3001"
  export DASHBOARD_RULE="Host(`invalid-dashboard.localhost`)"
  export DASHBOARD_ENTRYPOINT="web"
  export DASHBOARD_TLS=""
  export DASHBOARD_SERVICE="dashboard"
  export DASHBOARD_SERVICE_PORT="3001"
  
  # Use dummy credentials for local development if not set
  if [ -z "$AWS_ACCESS_KEY_ID" ] || [ "$AWS_ACCESS_KEY_ID" = "" ]; then
    export AWS_ACCESS_KEY_ID="dummy-key"
    echo "ℹ️  AWS_ACCESS_KEY_ID not found, using dummy credentials for local development"
  fi
  if [ -z "$AWS_SECRET_ACCESS_KEY" ] || [ "$AWS_SECRET_ACCESS_KEY" = "" ]; then
    export AWS_SECRET_ACCESS_KEY="dummy-secret"
    echo "ℹ️  AWS_SECRET_ACCESS_KEY not found, using dummy credentials for local development"
  fi
  
  # Use test API key for local if not set
  if [ -z "$API_KEY" ] || [ "$API_KEY" = "" ]; then
    export API_KEY="test-api-key-12345"
    echo "ℹ️  Using test API key for local development"
  fi
fi

echo ""

# Deploy stack
echo "🚀 Deploying services..."
cd "$SCRIPT_DIR/orchestration"

# For production mode, we need to add HTTPS redirect flags to docker-compose.yml
# Since Docker Compose doesn't support conditional command flags, we'll use a temporary file
if [ "$PRODUCTION" = "true" ]; then
  # Create a temporary compose file with HTTPS redirect enabled
  TEMP_COMPOSE=$(mktemp)
  # Copy the base compose file
  cp docker-compose.yml "$TEMP_COMPOSE"
  # Add HTTPS redirect flags after the web entrypoint line
  sed -i.bak '/--entrypoints.web.address=:80/a\
      - "--entrypoints.web.http.redirections.entryPoint.to=websecure"\
      - "--entrypoints.web.http.redirections.entryPoint.scheme=https"
' "$TEMP_COMPOSE"
  rm -f "$TEMP_COMPOSE.bak"
  COMPOSE_FILE="$TEMP_COMPOSE"
else
  COMPOSE_FILE="docker-compose.yml"
fi

docker stack deploy -c "$COMPOSE_FILE" ide-local

# Clean up temporary file if created
if [ "$PRODUCTION" = "true" ] && [ -n "$TEMP_COMPOSE" ]; then
  rm -f "$TEMP_COMPOSE"
fi

echo ""
echo "⏳ Waiting for services to start..."
sleep 5

# Check service status
echo ""
echo "📊 Service Status:"
docker service ls | grep "ide-local" || echo "No services found"

echo ""
echo "========================================="
echo "✅ Services started!"
echo "========================================="
echo ""

if [ "$PRODUCTION" = "true" ]; then
  echo "Access points:"
  echo "  - Management API: https://${DOMAIN}/api/health"
  echo "  - API Subdomain: https://api.${DOMAIN}"
  echo "  - Dashboard: https://dashboard.${DOMAIN}"
  echo "  - Traefik Dashboard: https://traefik.${DOMAIN}"
else
  echo "Access points:"
  echo "  - Management API: http://localhost/api/health"
  echo "  - Dashboard: http://localhost/dashboard"
  echo "  - Traefik Dashboard: http://localhost:8080"
fi

echo ""
echo "To view logs:"
echo "  docker service logs ide-local_management-api -f"
echo "  docker service logs ide-local_traefik -f"
echo ""
echo "To stop services:"
echo "  docker stack rm ide-local"
