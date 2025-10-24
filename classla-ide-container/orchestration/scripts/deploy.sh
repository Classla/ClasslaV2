#!/bin/bash

# deploy.sh
# Build and deploy the IDE Container Orchestration management stack

set -e

echo "=========================================="
echo "IDE Container Orchestration - Deployment"
echo "=========================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"

# Check if .env file exists
if [ ! -f "$PROJECT_DIR/.env" ]; then
    echo -e "${RED}Error: .env file not found${NC}"
    echo "Please create a .env file based on .env.example"
    echo "Location: $PROJECT_DIR/.env"
    exit 1
fi

# Load environment variables
source "$PROJECT_DIR/.env"

# Validate required environment variables
REQUIRED_VARS=("DOMAIN" "API_KEY")
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

echo "Step 2: Building Docker images..."
echo ""

# Build management API image
echo "Building management API image..."
cd "$PROJECT_DIR"

docker build -t ide-orchestration-api:latest -f Dockerfile .

echo -e "${GREEN}✓ Management API image built${NC}"
echo ""

echo "Step 3: Deploying stack..."
echo ""

# Deploy the stack
docker stack deploy -c "$PROJECT_DIR/docker-compose.yml" ide-management

echo -e "${GREEN}✓ Stack deployed${NC}"
echo ""

echo "Step 4: Waiting for services to be ready..."
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
echo "Step 5: Service status"
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
echo "  Management API:  https://api.$DOMAIN"
echo "  Dashboard:       https://api.$DOMAIN/dashboard"
echo "  Health Check:    https://api.$DOMAIN/api/health"
echo ""

echo -e "${BLUE}API Authentication:${NC}"
echo ""
echo "  Use the following header for API requests:"
echo "  Authorization: Bearer $API_KEY"
echo ""

echo -e "${BLUE}Example API Request:${NC}"
echo ""
echo "  curl -X POST https://api.$DOMAIN/api/containers/start \\"
echo "    -H 'Authorization: Bearer $API_KEY' \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"s3Bucket\": \"my-workspace-bucket\"}'"
echo ""

echo -e "${BLUE}Useful Commands:${NC}"
echo ""
echo "  View logs:           docker service logs ide-management_management-api -f"
echo "  List services:       docker stack services ide-management"
echo "  Remove stack:        ./scripts/cleanup.sh"
echo "  View containers:     docker service ps ide-management_management-api"
echo ""

echo "Note: It may take a few minutes for SSL certificates to be issued."
echo "Check Traefik logs if you have issues: docker service logs ide-management_traefik -f"
echo ""
