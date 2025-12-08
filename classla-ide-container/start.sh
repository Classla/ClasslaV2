#!/bin/bash

# start.sh
# Complete setup and start script for IDE Container Orchestration
# Handles everything needed to get the system running on a fresh server

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}")" && pwd )"
ORCHESTRATION_DIR="$SCRIPT_DIR/orchestration"

echo "=========================================="
echo "IDE Container Orchestration - Complete Setup"
echo "=========================================="
echo ""

# Step 1: Check and install Docker
echo "Step 1: Checking Docker installation..."
echo ""

if ! command -v docker &> /dev/null; then
    echo -e "${YELLOW}Docker is not installed. Installing Docker...${NC}"
    curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
    sh /tmp/get-docker.sh
    rm /tmp/get-docker.sh
    echo -e "${GREEN}✓ Docker installed${NC}"
else
    echo -e "${GREEN}✓ Docker is installed${NC}"
fi

# Check if Docker daemon is running
if ! docker info &> /dev/null; then
    echo -e "${RED}Error: Docker daemon is not running${NC}"
    echo "Please start Docker and try again"
    exit 1
fi

echo ""

# Step 2: Initialize Docker Swarm
echo "Step 2: Initializing Docker Swarm..."
echo ""

if ! docker info 2>/dev/null | grep -q "Swarm: active"; then
    echo "Initializing Docker Swarm..."
    PRIMARY_IP=$(hostname -I | awk '{print $1}')
    docker swarm init --advertise-addr $PRIMARY_IP
    echo -e "${GREEN}✓ Docker Swarm initialized${NC}"
else
    echo -e "${GREEN}✓ Docker Swarm is already active${NC}"
fi

echo ""

# Step 3: Create overlay network
echo "Step 3: Creating overlay network..."
echo ""

if ! docker network ls | grep -q "ide-network"; then
    echo "Creating overlay network 'ide-network'..."
    docker network create \
        --driver overlay \
        --attachable \
        ide-network
    echo -e "${GREEN}✓ Network 'ide-network' created${NC}"
else
    echo -e "${GREEN}✓ Network 'ide-network' already exists${NC}"
fi

echo ""

# Step 4: Setup environment variables
echo "Step 4: Setting up environment variables..."
echo ""

if [ ! -f "$ORCHESTRATION_DIR/.env" ]; then
    echo -e "${YELLOW}Warning: .env file not found${NC}"
    echo "Creating .env file from example..."
    
    # Create a basic .env file
    cat > "$ORCHESTRATION_DIR/.env" << 'ENVEOF'
# Server Configuration
DOMAIN=
SERVER_IP=
API_KEY=test-api-key-12345
API_KEYS=test-api-key-12345

# AWS Configuration (use dummy values for testing)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=dummy-key
AWS_SECRET_ACCESS_KEY=dummy-secret

# Optional: Resource Limits
RESOURCE_CPU_LIMIT=2
RESOURCE_MEMORY_LIMIT=4294967296
RESOURCE_CPU_THRESHOLD=90
RESOURCE_MEMORY_THRESHOLD=90

# Optional: Health Check Settings
HEALTH_CHECK_INTERVAL=30000
HEALTH_CHECK_TIMEOUT=5000
HEALTH_CHECK_RETRIES=3

# Optional: Container Restart Policy
CONTAINER_RESTART_POLICY=on-failure
CONTAINER_RESTART_MAX_ATTEMPTS=3

# Optional: Logging
LOG_LEVEL=info
ENVEOF
    
    echo -e "${GREEN}✓ Created .env file${NC}"
    echo -e "${YELLOW}Please edit $ORCHESTRATION_DIR/.env to set your configuration${NC}"
    echo ""
fi

# Load environment variables
source "$ORCHESTRATION_DIR/.env"

# Auto-detect SERVER_IP if not set
if [ -z "$SERVER_IP" ]; then
    echo -e "${YELLOW}SERVER_IP not set, attempting to detect...${NC}"
    SERVER_IP=$(curl -s ifconfig.me || curl -s icanhazip.com || hostname -I | awk '{print $1}' || echo "localhost")
    echo "Detected IP: $SERVER_IP"
    # Update .env file
    if grep -q "^SERVER_IP=" "$ORCHESTRATION_DIR/.env"; then
        sed -i "s|^SERVER_IP=.*|SERVER_IP=$SERVER_IP|" "$ORCHESTRATION_DIR/.env"
    else
        echo "SERVER_IP=$SERVER_IP" >> "$ORCHESTRATION_DIR/.env"
    fi
    export SERVER_IP
fi

# Set DOMAIN to SERVER_IP if not set
if [ -z "$DOMAIN" ]; then
    DOMAIN="$SERVER_IP"
    if grep -q "^DOMAIN=" "$ORCHESTRATION_DIR/.env"; then
        sed -i "s|^DOMAIN=.*|DOMAIN=$DOMAIN|" "$ORCHESTRATION_DIR/.env"
    else
        echo "DOMAIN=$DOMAIN" >> "$ORCHESTRATION_DIR/.env"
    fi
    export DOMAIN
fi

# Ensure API_KEY is set (use API_KEYS if API_KEY is not set)
if [ -z "$API_KEY" ] && [ -n "$API_KEYS" ]; then
    API_KEY=$(echo $API_KEYS | cut -d',' -f1)
    if grep -q "^API_KEY=" "$ORCHESTRATION_DIR/.env"; then
        sed -i "s|^API_KEY=.*|API_KEY=$API_KEY|" "$ORCHESTRATION_DIR/.env"
    else
        echo "API_KEY=$API_KEY" >> "$ORCHESTRATION_DIR/.env"
    fi
    export API_KEY
fi

# Validate required variables
REQUIRED_VARS=("API_KEY" "API_KEYS" "AWS_ACCESS_KEY_ID" "AWS_SECRET_ACCESS_KEY")
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
    echo "Please set these variables in $ORCHESTRATION_DIR/.env"
    echo ""
    echo "Note: API_KEY is required by the application, API_KEYS is required by the deployment script."
    echo "They can be the same value or API_KEY can be the first value from API_KEYS."
    exit 1
fi

echo -e "${GREEN}✓ Environment variables configured${NC}"
echo ""

# Step 5: Fix docker-compose.http.yml if needed
echo "Step 5: Preparing docker-compose configuration..."
echo ""

cd "$ORCHESTRATION_DIR"

# Create resolved compose file
if [ -f "docker-compose.http.yml" ]; then
    # Fix Traefik version to v2.11
    if grep -q "traefik:v2.10" docker-compose.http.yml; then
        echo "Updating Traefik version to v2.11..."
        sed -i 's/traefik:v2.10/traefik:v2.11/g' docker-compose.http.yml
    fi
    
    # Remove platforms section (not compatible with Swarm)
    if grep -q "platforms:" docker-compose.http.yml; then
        echo "Removing platforms section (not compatible with Swarm)..."
        sed -i '/platforms:/,/linux\/amd64/d' docker-compose.http.yml
    fi
    
    # Check if user: root is set for management-api (should be in the pushed code)
    if ! grep -A 10 "management-api:" docker-compose.http.yml | grep -q "user: root"; then
        echo -e "${YELLOW}Warning: user: root not found in management-api service${NC}"
        echo "This may cause Docker socket permission issues."
        echo "Please ensure docker-compose.http.yml has 'user: root' in the management-api service"
    fi
    
    # Ensure API_KEY is in environment
    if ! grep -q "API_KEY=" docker-compose.http.yml; then
        echo "Adding API_KEY to management-api environment..."
        sed -i '/- API_KEYS=/a\      - API_KEY=${API_KEY}' docker-compose.http.yml
    fi
    
    # Resolve environment variables
    echo "Resolving environment variables..."
    source .env
    export DOMAIN SERVER_IP API_KEY API_KEYS AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_REGION
    envsubst < docker-compose.http.yml | sed "s|\${SERVER_IP:-localhost}|$SERVER_IP|g" > docker-compose.http.resolved.yml
    
    echo -e "${GREEN}✓ Docker Compose configuration prepared${NC}"
else
    echo -e "${RED}Error: docker-compose.http.yml not found${NC}"
    exit 1
fi

echo ""

# Step 6: Build Docker image
echo "Step 6: Building Docker image..."
echo ""

cd "$ORCHESTRATION_DIR"

# Check if image already exists
if docker images | grep -q "ide-orchestration-api.*latest"; then
    echo -e "${YELLOW}Image already exists. Rebuilding...${NC}"
fi

echo "Building management API image..."
docker build -t ide-orchestration-api:latest -f Dockerfile .

# Tag as local/ide-orchestration-api:latest for Swarm
docker tag ide-orchestration-api:latest local/ide-orchestration-api:latest

echo -e "${GREEN}✓ Docker image built and tagged${NC}"
echo ""

# Step 7: Deploy stack
echo "Step 7: Deploying stack..."
echo ""

# Remove existing stack if it exists
if docker stack ls | grep -q "ide-management"; then
    echo -e "${YELLOW}Existing stack found. Removing...${NC}"
    docker stack rm ide-management
    echo "Waiting for stack to be removed..."
    sleep 10
fi

# Deploy the stack
echo "Deploying stack..."
docker stack deploy -c docker-compose.http.resolved.yml ide-management

echo -e "${GREEN}✓ Stack deployed${NC}"
echo ""

# Step 8: Wait for services
echo "Step 8: Waiting for services to be ready..."
echo ""

MAX_WAIT=120
ELAPSED=0
CHECK_INTERVAL=5

while [ $ELAPSED -lt $MAX_WAIT ]; do
    RUNNING_SERVICES=$(docker stack services ide-management --format "{{.Replicas}}" 2>/dev/null | grep -c "1/1" || echo "0")
    TOTAL_SERVICES=$(docker stack services ide-management --format "{{.Name}}" 2>/dev/null | wc -l)
    
    if [ "$TOTAL_SERVICES" -gt 0 ] && [ "$RUNNING_SERVICES" -eq "$TOTAL_SERVICES" ]; then
        echo -e "${GREEN}✓ All services are running ($RUNNING_SERVICES/$TOTAL_SERVICES)${NC}"
        break
    fi
    
    if [ "$ELAPSED" -eq 0 ] || [ $((ELAPSED % 15)) -eq 0 ]; then
        echo "Waiting for services... ($RUNNING_SERVICES/$TOTAL_SERVICES ready)"
    fi
    
    sleep $CHECK_INTERVAL
    ELAPSED=$((ELAPSED + CHECK_INTERVAL))
done

if [ $ELAPSED -ge $MAX_WAIT ]; then
    echo -e "${YELLOW}Warning: Services may still be starting${NC}"
    echo "Check status with: docker stack services ide-management"
fi

echo ""

# Step 9: Verify health
echo "Step 9: Verifying health..."
echo ""

sleep 5

if curl -s -f "http://$SERVER_IP/api/health" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Health check passed${NC}"
else
    echo -e "${YELLOW}Warning: Health check failed or service not ready yet${NC}"
    echo "You can check logs with: docker service logs ide-management_management-api"
fi

echo ""

# Step 10: Display status
echo "=========================================="
echo "Setup Complete!"
echo "=========================================="
echo ""

echo -e "${BLUE}Service Status:${NC}"
docker stack services ide-management

echo ""
echo -e "${BLUE}Access URLs:${NC}"
echo ""
echo "  Management API:  http://$SERVER_IP/api"
echo "  Health Check:    http://$SERVER_IP/api/health"
echo "  Traefik Dashboard: http://$SERVER_IP:8080"
echo ""

if [ -n "$DOMAIN" ] && [ "$DOMAIN" != "$SERVER_IP" ]; then
    echo "  Management API:  http://api.$DOMAIN"
    echo "  Dashboard:       http://dashboard.$DOMAIN"
fi

echo ""
echo -e "${BLUE}API Authentication:${NC}"
echo ""
FIRST_API_KEY=$(echo $API_KEYS | cut -d',' -f1)
echo "  Authorization: Bearer $FIRST_API_KEY"
echo ""

echo -e "${BLUE}Example: Start a container${NC}"
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
echo "  Restart service:     docker service update --force ide-management_management-api"
echo ""

echo -e "${YELLOW}Note:${NC}"
echo "  - This deployment uses HTTP only (no HTTPS)"
echo "  - IDE containers will be accessible at: http://$SERVER_IP/vnc/<container-id>"
echo "  - Make sure your firewall allows traffic on ports 80 and 8080"
echo ""
