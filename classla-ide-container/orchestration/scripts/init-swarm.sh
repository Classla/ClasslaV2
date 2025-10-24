#!/bin/bash

# init-swarm.sh
# Initialize Docker Swarm and create the overlay network for IDE containers

set -e

echo "=========================================="
echo "IDE Container Orchestration - Swarm Init"
echo "=========================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo -e "${RED}Error: Docker is not installed${NC}"
    echo "Please install Docker first: https://docs.docker.com/engine/install/"
    exit 1
fi

# Check if Docker daemon is running
if ! docker info &> /dev/null; then
    echo -e "${RED}Error: Docker daemon is not running${NC}"
    echo "Please start Docker and try again"
    exit 1
fi

echo "Step 1: Checking Docker Swarm status..."
echo ""

# Check if Swarm is already initialized
if docker info 2>/dev/null | grep -q "Swarm: active"; then
    echo -e "${YELLOW}Docker Swarm is already initialized${NC}"
    echo ""
    
    # Get current node info
    NODE_ID=$(docker info --format '{{.Swarm.NodeID}}')
    NODE_ROLE=$(docker node inspect $NODE_ID --format '{{.Spec.Role}}')
    
    echo "Current node role: $NODE_ROLE"
    echo ""
else
    echo "Initializing Docker Swarm..."
    
    # Get the primary IP address
    PRIMARY_IP=$(hostname -I | awk '{print $1}')
    
    # Initialize Swarm
    docker swarm init --advertise-addr $PRIMARY_IP
    
    echo -e "${GREEN}✓ Docker Swarm initialized successfully${NC}"
    echo ""
fi

echo "Step 2: Creating overlay network..."
echo ""

# Check if network already exists
if docker network ls | grep -q "ide-network"; then
    echo -e "${YELLOW}Network 'ide-network' already exists${NC}"
else
    # Create overlay network
    docker network create \
        --driver overlay \
        --attachable \
        ide-network
    
    echo -e "${GREEN}✓ Overlay network 'ide-network' created${NC}"
fi

echo ""
echo "Step 3: Swarm information"
echo ""

# Display node information
echo "Swarm Nodes:"
docker node ls

echo ""
echo "Networks:"
docker network ls | grep -E "NETWORK ID|ide-network"

echo ""
echo "=========================================="
echo "Initialization Complete!"
echo "=========================================="
echo ""

# Display join tokens
echo "To add worker nodes to this swarm, run the following command on the worker node:"
echo ""
echo -e "${GREEN}$(docker swarm join-token worker | grep 'docker swarm join')${NC}"
echo ""

echo "To add manager nodes to this swarm, run the following command on the manager node:"
echo ""
echo -e "${GREEN}$(docker swarm join-token manager | grep 'docker swarm join')${NC}"
echo ""

echo "Next steps:"
echo "1. Configure your .env file with required environment variables"
echo "2. Run ./scripts/deploy.sh to deploy the management stack"
echo ""
