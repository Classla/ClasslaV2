#!/bin/bash

# setup-local.sh
# Complete local development setup script
# Initializes Docker Swarm, deploys Traefik, and sets up environment

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "=========================================="
echo "Local Development Setup"
echo "=========================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Step 1: Check Docker
echo "Step 1: Checking Docker..."
if ! command -v docker &> /dev/null; then
    echo -e "${RED}Error: Docker is not installed${NC}"
    echo "Please install Docker Desktop: https://www.docker.com/products/docker-desktop"
    exit 1
fi

if ! docker info &> /dev/null; then
    echo -e "${RED}Error: Docker daemon is not running${NC}"
    echo "Please start Docker Desktop and try again"
    exit 1
fi

echo -e "${GREEN}✓ Docker is running${NC}"
echo ""

# Step 2: Initialize Docker Swarm
echo "Step 2: Initializing Docker Swarm..."
if ! docker info 2>/dev/null | grep -q "Swarm: active"; then
    echo "Initializing Docker Swarm..."
    docker swarm init --advertise-addr 127.0.0.1
    echo -e "${GREEN}✓ Docker Swarm initialized${NC}"
else
    echo -e "${GREEN}✓ Docker Swarm is already active${NC}"
fi
echo ""

# Step 3: Create overlay network
echo "Step 3: Creating overlay network..."
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

# Step 4: Deploy Traefik
echo "Step 4: Deploying Traefik for localhost..."
cd "$PROJECT_DIR"
"$SCRIPT_DIR/deploy-traefik-local.sh"
echo ""

# Step 5: Check/create .env file
echo "Step 5: Checking environment configuration..."
if [ ! -f "$PROJECT_DIR/.env" ]; then
    echo -e "${YELLOW}Warning: .env file not found${NC}"
    echo "Creating .env file from template..."
    
    cat > "$PROJECT_DIR/.env" << 'ENVEOF'
# Server Configuration
DOMAIN=localhost
SERVER_IP=127.0.0.1

# API Keys
API_KEY=test-api-key-12345
API_KEYS=test-api-key-12345

# AWS Configuration (use dummy values for local testing)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=dummy-key
AWS_SECRET_ACCESS_KEY=dummy-secret

# Resource Limits
RESOURCE_CPU_LIMIT=2
RESOURCE_MEMORY_LIMIT=4294967296
RESOURCE_CPU_THRESHOLD=90
RESOURCE_MEMORY_THRESHOLD=90

# Health Check Settings
HEALTH_CHECK_INTERVAL=30000
HEALTH_CHECK_TIMEOUT=5000
HEALTH_CHECK_RETRIES=3

# Container Restart Policy
CONTAINER_RESTART_POLICY=on-failure
CONTAINER_RESTART_MAX_ATTEMPTS=3

# Logging
LOG_LEVEL=info

# Pre-warmed Queue
PRE_WARMED_QUEUE_SIZE=10
ENVEOF
    
    echo -e "${GREEN}✓ Created .env file${NC}"
    echo -e "${YELLOW}Please edit $PROJECT_DIR/.env if you need to change any settings${NC}"
else
    echo -e "${GREEN}✓ .env file exists${NC}"
    
    # Check if PRE_WARMED_QUEUE_SIZE is set
    if ! grep -q "^PRE_WARMED_QUEUE_SIZE=" "$PROJECT_DIR/.env"; then
        echo "Adding PRE_WARMED_QUEUE_SIZE to .env..."
        echo "PRE_WARMED_QUEUE_SIZE=10" >> "$PROJECT_DIR/.env"
        echo -e "${GREEN}✓ Added PRE_WARMED_QUEUE_SIZE to .env${NC}"
    fi
fi
echo ""

# Step 6: Build IDE container image (if needed)
echo "Step 6: Checking IDE container image..."
if ! docker images | grep -q "classla-ide-container.*latest"; then
    echo -e "${YELLOW}IDE container image not found${NC}"
    echo "You'll need to build it from the parent directory:"
    echo "  cd ../.."
    echo "  docker build -t classla-ide-container:latest classla-ide-container/"
    echo ""
    echo "For now, continuing with setup..."
else
    echo -e "${GREEN}✓ IDE container image found${NC}"
fi
echo ""

echo "=========================================="
echo "Local Setup Complete!"
echo "=========================================="
echo ""
echo -e "${BLUE}Next steps:${NC}"
echo ""
echo "1. Build the IDE container image (if not already built):"
echo "   cd $PROJECT_DIR/.."
echo "   docker build -t classla-ide-container:latest ."
echo ""
echo "2. Start the orchestration API:"
echo "   cd $PROJECT_DIR"
echo "   npm install"
echo "   npm start"
echo ""
echo "3. The queue maintainer will automatically spawn pre-warmed containers"
echo ""
echo -e "${BLUE}Access URLs:${NC}"
echo "  Management API:  http://localhost:3001/api"
echo "  Health Check:    http://localhost:3001/api/health"
echo "  IDE Containers:  http://localhost/code/<container-id>"
echo "  VNC Access:       http://localhost/vnc/<container-id>"
echo "  Traefik Dashboard: http://localhost:8080"
echo ""
echo -e "${BLUE}Useful Commands:${NC}"
echo "  View Traefik logs:  docker service logs -f traefik_traefik"
echo "  List services:      docker stack services traefik"
echo "  Remove Traefik:     docker stack rm traefik"
echo ""

