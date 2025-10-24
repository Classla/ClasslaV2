#!/bin/bash

# cleanup.sh
# Remove the IDE Container Orchestration management stack and clean up resources

set -e

echo "=========================================="
echo "IDE Container Orchestration - Cleanup"
echo "=========================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo -e "${RED}Error: Docker is not installed${NC}"
    exit 1
fi

# Check if Docker daemon is running
if ! docker info &> /dev/null; then
    echo -e "${RED}Error: Docker daemon is not running${NC}"
    exit 1
fi

echo "This script will:"
echo "  1. Remove the ide-management stack"
echo "  2. Remove stopped IDE containers"
echo "  3. Optionally remove volumes (data will be lost)"
echo ""

# Confirm removal
read -p "Are you sure you want to continue? (yes/no): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
    echo "Cleanup cancelled"
    exit 0
fi

echo ""
echo "Step 1: Checking for ide-management stack..."
echo ""

# Check if stack exists
if docker stack ls | grep -q "ide-management"; then
    echo "Removing ide-management stack..."
    docker stack rm ide-management
    
    echo -e "${GREEN}✓ Stack removal initiated${NC}"
    echo ""
    
    # Wait for stack to be fully removed
    echo "Waiting for services to shut down..."
    MAX_WAIT=60
    ELAPSED=0
    
    while [ $ELAPSED -lt $MAX_WAIT ]; do
        if ! docker stack ls | grep -q "ide-management"; then
            echo -e "${GREEN}✓ Stack fully removed${NC}"
            break
        fi
        
        sleep 2
        ELAPSED=$((ELAPSED + 2))
    done
    
    if [ $ELAPSED -ge $MAX_WAIT ]; then
        echo -e "${YELLOW}Warning: Stack removal may still be in progress${NC}"
    fi
else
    echo -e "${YELLOW}Stack 'ide-management' not found${NC}"
fi

echo ""
echo "Step 2: Removing stopped IDE containers..."
echo ""

# Find and remove stopped IDE container services
STOPPED_CONTAINERS=$(docker service ls --filter "label=app=ide-container" --format "{{.Name}}" 2>/dev/null || true)

if [ -n "$STOPPED_CONTAINERS" ]; then
    echo "Found IDE container services:"
    echo "$STOPPED_CONTAINERS"
    echo ""
    
    read -p "Remove these IDE container services? (yes/no): " REMOVE_CONTAINERS
    
    if [ "$REMOVE_CONTAINERS" = "yes" ]; then
        echo "$STOPPED_CONTAINERS" | xargs -r docker service rm
        echo -e "${GREEN}✓ IDE container services removed${NC}"
    else
        echo "Skipping IDE container removal"
    fi
else
    echo "No IDE container services found"
fi

echo ""
echo "Step 3: Volume cleanup..."
echo ""

# List volumes
VOLUMES=$(docker volume ls --filter "label=com.docker.stack.namespace=ide-management" --format "{{.Name}}" 2>/dev/null || true)

if [ -n "$VOLUMES" ]; then
    echo -e "${YELLOW}Warning: The following volumes contain persistent data:${NC}"
    echo "$VOLUMES"
    echo ""
    echo "Removing volumes will delete:"
    echo "  - Container metadata database"
    echo "  - Traefik SSL certificates"
    echo "  - Application logs"
    echo ""
    
    read -p "Remove volumes? This cannot be undone! (yes/no): " REMOVE_VOLUMES
    
    if [ "$REMOVE_VOLUMES" = "yes" ]; then
        echo "$VOLUMES" | xargs -r docker volume rm
        echo -e "${GREEN}✓ Volumes removed${NC}"
    else
        echo "Volumes preserved"
    fi
else
    echo "No volumes found"
fi

echo ""
echo "Step 4: Cleaning up unused resources..."
echo ""

# Remove dangling images
echo "Removing dangling images..."
docker image prune -f > /dev/null 2>&1 || true

# Remove unused networks (excluding ide-network)
echo "Removing unused networks..."
docker network prune -f > /dev/null 2>&1 || true

echo -e "${GREEN}✓ Cleanup complete${NC}"

echo ""
echo "=========================================="
echo "Cleanup Summary"
echo "=========================================="
echo ""

# Show remaining resources
echo "Remaining Docker Swarm services:"
docker service ls

echo ""
echo "Remaining networks:"
docker network ls | grep -E "NETWORK ID|ide-network" || echo "No ide-network found"

echo ""
echo "Remaining volumes:"
docker volume ls --filter "label=com.docker.stack.namespace=ide-management" 2>/dev/null || echo "No volumes found"

echo ""
echo -e "${BLUE}Next steps:${NC}"
echo ""
echo "  To redeploy:     ./scripts/deploy.sh"
echo "  To remove Swarm: docker swarm leave --force"
echo "  To remove network: docker network rm ide-network"
echo ""
