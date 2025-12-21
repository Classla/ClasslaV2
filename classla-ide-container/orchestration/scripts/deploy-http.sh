#!/bin/bash

# deploy-http.sh
# Build and deploy the IDE Container Orchestration management stack for HTTP-only deployment
# This is suitable for cloud deployments without HTTPS (e.g., Hetzner)

set -e

echo "=========================================="
echo "IDE Container Orchestration - HTTP Deployment"
echo "=========================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}")" && pwd )"
PROJECT_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"

# Check if .env file exists
if [ ! -f "$PROJECT_DIR/.env" ]; then
    echo -e "${RED}Error: .env file not found${NC}"
    echo "Please create a .env file with required environment variables"
    echo "Location: $PROJECT_DIR/.env"
    echo ""
    echo "Required variables:"
    echo "  - API_KEY (single API key, required by the application)"
    echo "  - API_KEYS (comma-separated list of API keys, required by deployment)"
    echo "  - AWS_ACCESS_KEY_ID (can be dummy for testing)"
    echo "  - AWS_SECRET_ACCESS_KEY (can be dummy for testing)"
    echo ""
    echo "Optional variables:"
    echo "  - DOMAIN (defaults to SERVER_IP if not set)"
    echo "  - SERVER_IP (auto-detected if not set)"
    echo "  - RESOURCE_CPU_LIMIT, RESOURCE_MEMORY_LIMIT, etc. (all have defaults)"
    exit 1
fi

# Load environment variables
source "$PROJECT_DIR/.env"

# Validate required environment variables
REQUIRED_VARS=("API_KEYS" "AWS_ACCESS_KEY_ID" "AWS_SECRET_ACCESS_KEY")
MISSING_VARS=()

for var in "${REQUIRED_VARS[@]}"; do
    if [ -z "${!var}" ]; then
        MISSING_VARS+=("$var")
    fi
done

if [ ${#MISSING_VARS[@]} -gt 0 ]; then
    echo -e "${RED}Error: Missing required environment variables:${NC}"
    for var in "${MISSING_VARS[@]}"; do
        echo "  - $var"
    done
    echo ""
    echo "Please set these variables in your .env file"
    exit 1
fi

# Detect server IP if not set
if [ -z "$SERVER_IP" ]; then
    echo -e "${YELLOW}Warning: SERVER_IP not set, attempting to detect...${NC}"
    SERVER_IP=$(curl -s ifconfig.me || curl -s icanhazip.com || echo "localhost")
    echo "Detected IP: $SERVER_IP"
    echo "You can set SERVER_IP in .env to override"
    echo ""
fi

echo "Step 1: Checking Docker Swarm status..."
echo ""

# Check if Swarm is initialized
if ! docker info 2>/dev/null | grep -q "Swarm: active"; then
    echo -e "${RED}Error: Docker Swarm is not initialized${NC}"
    echo "Please run ./scripts/init-swarm.sh first"
    exit 1
fi

echo -e "${GREEN}✓ Docker Swarm is active${NC}"
echo ""

echo "Step 2: Ensuring overlay network exists..."
echo ""

# Check if network exists, create if not
if ! docker network ls | grep -q "ide-network"; then
    echo "Creating overlay network..."
    docker network create \
        --driver overlay \
        --attachable \
        ide-network
    echo -e "${GREEN}✓ Network created${NC}"
else
    echo -e "${GREEN}✓ Network already exists${NC}"
fi
echo ""

echo "Step 3: Building Docker images..."
echo ""

# Build management API image for linux/amd64 (x86_64)
echo "Building management API image for linux/amd64..."
cd "$PROJECT_DIR"

# Check if buildx is available
if docker buildx version &> /dev/null; then
    echo "Using Docker Buildx for multi-platform build..."
    docker buildx build \
        --platform linux/amd64 \
        -t ide-orchestration-api:latest \
        -f Dockerfile \
        --load \
        .
else
    echo "Building with standard docker build..."
    echo -e "${YELLOW}Note: If you're on ARM (M1/M2 Mac), build on the Hetzner server instead${NC}"
    docker build -t ide-orchestration-api:latest -f Dockerfile .
fi

echo -e "${GREEN}✓ Management API image built${NC}"
echo ""

echo "Step 4: Deploying stack..."
echo ""

# Deploy the stack using unified compose file (HTTP mode)
# Set environment variables for HTTP-only mode
export TRAEFIK_INSECURE="true"
export DOMAIN=${DOMAIN:-$SERVER_IP}
export NODE_ENV="production"
docker stack deploy -c "$PROJECT_DIR/docker-compose.yml" ide-management

echo -e "${GREEN}✓ Stack deployed${NC}"
echo ""

echo "Step 5: Waiting for services to be ready..."
echo ""

# Wait for services to start
MAX_WAIT=60
ELAPSED=0

while [ $ELAPSED -lt $MAX_WAIT ]; do
    RUNNING_SERVICES=$(docker stack services ide-management --format "{{.Replicas}}" | grep -c "1/1" || true)
    TOTAL_SERVICES=$(docker stack services ide-management --format "{{.Name}}" | wc -l)
    
    if [ "$RUNNING_SERVICES" -eq "$TOTAL_SERVICES" ] && [ "$TOTAL_SERVICES" -gt 0 ]; then
        echo -e "${GREEN}✓ All services are running${NC}"
        break
    fi
    
    echo "Waiting for services... ($RUNNING_SERVICES/$TOTAL_SERVICES ready)"
    sleep 5
    ELAPSED=$((ELAPSED + 5))
done

if [ $ELAPSED -ge $MAX_WAIT ]; then
    echo -e "${YELLOW}Warning: Services may still be starting${NC}"
    echo "Check status with: docker stack services ide-management"
fi

echo ""
echo "Step 6: Service status"
echo ""

docker stack services ide-management

echo ""
echo "=========================================="
echo "Deployment Complete!"
echo "=========================================="
echo ""

# Display access URLs
echo -e "${BLUE}Access URLs:${NC}"
echo ""

if [ -n "$DOMAIN" ]; then
    echo "  Management API:  http://api.$DOMAIN"
    echo "  Dashboard:       http://dashboard.$DOMAIN"
    echo "  Traefik:         http://traefik.$DOMAIN"
fi

echo "  Management API:  http://$SERVER_IP"
echo "  Dashboard:       http://$SERVER_IP"
echo "  Traefik:         http://$SERVER_IP:8080"
echo "  Health Check:    http://$SERVER_IP/api/health"
echo ""

echo -e "${BLUE}API Authentication:${NC}"
echo ""
echo "  Use the following header for API requests:"
FIRST_API_KEY=$(echo $API_KEYS | cut -d',' -f1)
echo "  Authorization: Bearer $FIRST_API_KEY"
echo ""

echo -e "${BLUE}Example API Request:${NC}"
echo ""
echo "  curl -X POST http://$SERVER_IP/api/containers/start \\"
echo "    -H 'Authorization: Bearer $FIRST_API_KEY' \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"s3Bucket\": \"my-workspace-bucket\"}'"
echo ""

echo -e "${BLUE}Useful Commands:${NC}"
echo ""
echo "  View logs:           docker service logs ide-management_management-api -f"
echo "  List services:       docker stack services ide-management"
echo "  Remove stack:        docker stack rm ide-management"
echo "  View containers:     docker service ps ide-management_management-api"
echo ""

echo -e "${YELLOW}Security Note:${NC}"
echo "  This deployment uses HTTP only (no HTTPS)."
echo "  For production, consider setting up HTTPS with Let's Encrypt."
echo ""
