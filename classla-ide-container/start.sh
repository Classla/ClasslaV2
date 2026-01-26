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
  echo ""

  # Set production domain
  export DOMAIN=${DOMAIN:-ide.classla.org}

  # Set ACME email for Let's Encrypt
  export ACME_EMAIL=${ACME_EMAIL:-admin@classla.org}

  # Set NODE_ENV
  export NODE_ENV="production"

  echo "========================================="
  echo "Production Environment Validation"
  echo "========================================="
  echo ""

  # Track if we have errors
  HAS_ERRORS=false

  # ===== Required Environment Variables =====
  echo "📋 Checking required environment variables..."
  echo ""

  # API_KEY
  if [ -z "$API_KEY" ] || [ "$API_KEY" = "" ]; then
    echo "   ❌ API_KEY: NOT SET (required)"
    HAS_ERRORS=true
  else
    echo "   ✓ API_KEY: Set (${#API_KEY} characters)"
  fi

  # AWS Credentials - try AWS CLI if not set
  if [ -z "$AWS_ACCESS_KEY_ID" ] || [ "$AWS_ACCESS_KEY_ID" = "" ]; then
    echo "   🔍 AWS_ACCESS_KEY_ID: Not in env, checking AWS CLI..."
    AWS_CLI_ACCESS_KEY=$(aws configure get aws_access_key_id 2>/dev/null || echo "")
    if [ -n "$AWS_CLI_ACCESS_KEY" ] && [ "$AWS_CLI_ACCESS_KEY" != "" ]; then
      export AWS_ACCESS_KEY_ID="$AWS_CLI_ACCESS_KEY"
      export AWS_SECRET_ACCESS_KEY=$(aws configure get aws_secret_access_key 2>/dev/null || echo "")
      echo "   ✓ AWS_ACCESS_KEY_ID: Found in AWS CLI config"
    else
      echo "   ❌ AWS_ACCESS_KEY_ID: NOT SET (required)"
      HAS_ERRORS=true
    fi
  elif [ "$AWS_ACCESS_KEY_ID" = "dummy-key" ]; then
    echo "   ⚠️  AWS_ACCESS_KEY_ID: Using dummy credentials (S3 will fail)"
  else
    echo "   ✓ AWS_ACCESS_KEY_ID: Set"
  fi

  if [ -z "$AWS_SECRET_ACCESS_KEY" ] || [ "$AWS_SECRET_ACCESS_KEY" = "" ]; then
    echo "   ❌ AWS_SECRET_ACCESS_KEY: NOT SET (required)"
    HAS_ERRORS=true
  elif [ "$AWS_SECRET_ACCESS_KEY" = "dummy-secret" ]; then
    echo "   ⚠️  AWS_SECRET_ACCESS_KEY: Using dummy credentials (S3 will fail)"
  else
    echo "   ✓ AWS_SECRET_ACCESS_KEY: Set"
  fi

  # Backend API URL
  if [ -z "$BACKEND_API_URL" ] || [ "$BACKEND_API_URL" = "" ]; then
    echo "   ❌ BACKEND_API_URL: NOT SET (required for Y.js sync)"
    HAS_ERRORS=true
  else
    echo "   ✓ BACKEND_API_URL: $BACKEND_API_URL"
  fi

  # Container Service Token
  if [ -z "$CONTAINER_SERVICE_TOKEN" ] || [ "$CONTAINER_SERVICE_TOKEN" = "" ]; then
    echo "   ❌ CONTAINER_SERVICE_TOKEN: NOT SET (required for container auth)"
    HAS_ERRORS=true
  else
    echo "   ✓ CONTAINER_SERVICE_TOKEN: Set (${#CONTAINER_SERVICE_TOKEN} characters)"
  fi

  echo ""

  # ===== Domain and DNS Validation =====
  echo "🌐 Checking domain and DNS..."
  echo ""
  echo "   Domain: $DOMAIN"
  echo "   ACME Email: $ACME_EMAIL"
  echo ""

  # Get server's public IP
  SERVER_IP=$(curl -s --max-time 5 https://api.ipify.org 2>/dev/null || curl -s --max-time 5 https://ifconfig.me 2>/dev/null || echo "")
  if [ -n "$SERVER_IP" ]; then
    echo "   ✓ Server public IP: $SERVER_IP"
  else
    echo "   ⚠️  Could not determine server public IP (check internet connectivity)"
  fi

  # Check DNS resolution for domain
  DOMAIN_IP=$(dig +short "$DOMAIN" 2>/dev/null | head -1 || nslookup "$DOMAIN" 2>/dev/null | grep -A1 "Name:" | grep "Address:" | awk '{print $2}' | head -1 || echo "")
  if [ -n "$DOMAIN_IP" ]; then
    echo "   ✓ DNS lookup for $DOMAIN: $DOMAIN_IP"
    if [ "$SERVER_IP" = "$DOMAIN_IP" ]; then
      echo "   ✓ DNS matches server IP"
    elif [ -n "$SERVER_IP" ]; then
      echo "   ⚠️  DNS IP ($DOMAIN_IP) does not match server IP ($SERVER_IP)"
      echo "      SSL certificate generation may fail if DNS is incorrect"
    fi
  else
    echo "   ⚠️  Could not resolve DNS for $DOMAIN"
    echo "      Make sure DNS is configured and propagated"
    echo "      SSL certificate generation will fail without proper DNS"
  fi

  echo ""

  # ===== Port Availability =====
  echo "🔌 Checking port availability..."
  echo ""

  for PORT in 80 443; do
    if command -v ss &> /dev/null; then
      PORT_IN_USE=$(ss -tuln | grep -E ":${PORT}\s" | head -1 || echo "")
    elif command -v netstat &> /dev/null; then
      PORT_IN_USE=$(netstat -tuln | grep -E ":${PORT}\s" | head -1 || echo "")
    else
      PORT_IN_USE=""
    fi

    if [ -n "$PORT_IN_USE" ]; then
      echo "   ⚠️  Port $PORT: Already in use"
      echo "      $PORT_IN_USE"
    else
      echo "   ✓ Port $PORT: Available"
    fi
  done

  echo ""

  # ===== Exit if errors =====
  if [ "$HAS_ERRORS" = true ]; then
    echo "========================================="
    echo "❌ Production validation FAILED"
    echo "========================================="
    echo ""
    echo "Please fix the errors above before starting in production mode."
    echo ""
    echo "Required environment variables can be set in:"
    echo "  - orchestration/.env file"
    echo "  - Shell environment (export VAR=value)"
    echo ""
    exit 1
  fi

  echo "========================================="
  echo "✅ Production validation PASSED"
  echo "========================================="
  echo ""

  # Set Traefik configuration for production
  export TRAEFIK_INSECURE="false"
  # Traefik dashboard accessible at /traefik path on main domain
  export TRAEFIK_DASHBOARD_RULE="Host(\`${DOMAIN}\`) && PathPrefix(\`/traefik\`)"
  export TRAEFIK_DASHBOARD_ENTRYPOINT="websecure"
  export TRAEFIK_DASHBOARD_TLS="letsencrypt"
  export DASHBOARD_PORT=""
  # Enable HTTPS redirect in production
  export HTTPS_REDIRECT="true"

  # All routes use path-based routing under the main domain (no subdomains)
  # Management API at /api
  export MANAGEMENT_API_MAIN_RULE="Host(\`${DOMAIN}\`) && PathPrefix(\`/api\`)"
  export MANAGEMENT_API_MAIN_ENTRYPOINT="websecure"
  export MANAGEMENT_API_MAIN_TLS="letsencrypt"
  export MANAGEMENT_API_MAIN_SERVICE="management-api-main"
  export MANAGEMENT_API_MAIN_SERVICE_PORT="3001"
  # Disable subdomain routes by using invalid host
  export MANAGEMENT_API_SUBDOMAIN_RULE='Host(`invalid.internal`)'
  export MANAGEMENT_API_ENTRYPOINT="websecure"
  export MANAGEMENT_API_TLS=""
  export MANAGEMENT_API_SERVICE="management-api"
  export MANAGEMENT_API_SERVICE_PORT="3001"
  # Dashboard at /dashboard
  export DASHBOARD_RULE="Host(\`${DOMAIN}\`) && PathPrefix(\`/dashboard\`)"
  export DASHBOARD_ENTRYPOINT="websecure"
  export DASHBOARD_TLS="letsencrypt"
  export DASHBOARD_SERVICE="dashboard"
  export DASHBOARD_SERVICE_PORT="3001"

  echo "Production routes configured:"
  echo "  - API:       https://${DOMAIN}/api"
  echo "  - Dashboard: https://${DOMAIN}/dashboard"
  echo "  - Traefik:   https://${DOMAIN}/traefik"
  echo "  - Containers: https://${DOMAIN}/code/{id}, /vnc/{id}, /web/{id}, /terminal/{id}"
  echo ""
else
  # Local mode configuration
  echo "🔧 Configuring for LOCAL mode..."
  echo ""
  export DOMAIN=${DOMAIN:-localhost}
  export NODE_ENV="local"
  export TRAEFIK_INSECURE="true"
  # Traefik dashboard at port 8080 in local mode
  export TRAEFIK_DASHBOARD_RULE='Host(`localhost`)'
  export TRAEFIK_DASHBOARD_ENTRYPOINT="web"
  export TRAEFIK_DASHBOARD_TLS=""
  export DASHBOARD_PORT="8080"
  # Don't set HTTPS_REDIRECT in local mode - this prevents redirect flags from being added

  # Disable production routes by using invalid hosts (local uses ide-api router defined in compose)
  export MANAGEMENT_API_MAIN_RULE='Host(`invalid.localhost`)'
  export MANAGEMENT_API_MAIN_ENTRYPOINT="web"
  export MANAGEMENT_API_MAIN_TLS=""
  export MANAGEMENT_API_MAIN_SERVICE="management-api-main"
  export MANAGEMENT_API_MAIN_SERVICE_PORT="3001"
  export DASHBOARD_RULE='Host(`invalid.localhost`)'
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

  # Set CONTAINER_SERVICE_TOKEN for local if not set
  if [ -z "$CONTAINER_SERVICE_TOKEN" ] || [ "$CONTAINER_SERVICE_TOKEN" = "" ]; then
    export CONTAINER_SERVICE_TOKEN="test-container-token-12345"
    echo "ℹ️  Using test container service token for local development"
  fi

  # Set BACKEND_API_URL for local if not set
  if [ -z "$BACKEND_API_URL" ] || [ "$BACKEND_API_URL" = "" ]; then
    export BACKEND_API_URL="http://localhost:8000/api"
    echo "ℹ️  Using default backend API URL for local development: $BACKEND_API_URL"
  fi

  echo ""
  echo "Local routes configured:"
  echo "  - API:       http://localhost/api"
  echo "  - Dashboard: http://localhost/dashboard"
  echo "  - Traefik:   http://localhost:8080"
  echo "  - Containers: http://localhost/code/{id}, /vnc/{id}, /web/{id}, /terminal/{id}"
  echo ""
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
  # Get absolute path to orchestration directory for bind mounts
  ORCHESTRATION_DIR=$(pwd)
  # Copy the base compose file
  cp docker-compose.yml "$TEMP_COMPOSE"
  # Convert relative path to absolute path for traefik-dynamic.yml
  # Docker Swarm requires absolute paths for bind mounts
  # Match only the source path (before the colon) to avoid replacing the target path
  sed -i.bak "s|\\./traefik-dynamic.yml:|${ORCHESTRATION_DIR}/traefik-dynamic.yml:|g" "$TEMP_COMPOSE"
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
  echo "  - Dashboard:      https://${DOMAIN}/dashboard"
  echo "  - Traefik:        https://${DOMAIN}/traefik"
  echo ""
  echo "Container routes (after starting a container):"
  echo "  - Code/Terminal:  https://${DOMAIN}/code/{containerId}"
  echo "  - VNC Desktop:    https://${DOMAIN}/vnc/{containerId}"
  echo "  - Web Server:     https://${DOMAIN}/web/{containerId}"
  echo "  - Terminal:       https://${DOMAIN}/terminal/{containerId}"
else
  echo "Access points:"
  echo "  - Management API: http://localhost/api/health"
  echo "  - Dashboard:      http://localhost/dashboard"
  echo "  - Traefik:        http://localhost:8080"
  echo ""
  echo "Container routes (after starting a container):"
  echo "  - Code/Terminal:  http://localhost/code/{containerId}"
  echo "  - VNC Desktop:    http://localhost/vnc/{containerId}"
  echo "  - Web Server:     http://localhost/web/{containerId}"
  echo "  - Terminal:       http://localhost/terminal/{containerId}"
fi

echo ""
echo "To view logs:"
echo "  docker service logs ide-local_management-api -f"
echo "  docker service logs ide-local_traefik -f"
echo ""
echo "To stop services:"
echo "  docker stack rm ide-local"
