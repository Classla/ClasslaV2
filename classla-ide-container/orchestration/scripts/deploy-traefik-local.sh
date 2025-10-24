#!/bin/bash

# Script to deploy Traefik reverse proxy for LOCAL DEVELOPMENT
# This version:
# - Uses HTTP only (no SSL/TLS)
# - No Let's Encrypt configuration
# - Works with .localhost domains
# - Exposes dashboard on port 8080

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "=========================================="
echo "Traefik Local Development Deployment"
echo "=========================================="
echo ""

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Error: Docker is not installed"
    echo "Please install Docker first: https://docs.docker.com/engine/install/"
    exit 1
fi

# Check if Docker Swarm is initialized
if ! docker info 2>/dev/null | grep -q "Swarm: active"; then
    echo "❌ Error: Docker Swarm is not initialized"
    echo ""
    echo "Initialize Docker Swarm with:"
    echo "  docker swarm init"
    echo ""
    exit 1
fi

echo "✓ Docker Swarm is active"
echo ""

# Step 1: Create overlay network
echo "Step 1: Creating overlay network..."
"$SCRIPT_DIR/create-network.sh"
echo ""

# Step 2: Remove existing Traefik if present
if docker service ls | grep -q "traefik_traefik"; then
    echo "Step 2: Removing existing Traefik service..."
    docker service rm traefik_traefik
    echo "Waiting for service to be removed..."
    sleep 3
    echo ""
fi

# Step 3: Deploy Traefik
echo "Step 3: Deploying Traefik (local development mode)..."
cd "$PROJECT_DIR"
docker stack deploy -c docker-compose.traefik.local.yml traefik

echo ""
echo "✓ Traefik deployment initiated"
echo ""

# Wait for service to be ready
echo "Waiting for Traefik service to start..."
sleep 5

# Check service status
if docker service ls | grep -q "traefik_traefik"; then
    echo "✓ Traefik service is running"
    echo ""
    
    # Show service details
    echo "Service details:"
    docker service ps traefik_traefik --no-trunc
    echo ""
    
    echo "=========================================="
    echo "Deployment Complete!"
    echo "=========================================="
    echo ""
    echo "Traefik is now running in LOCAL DEVELOPMENT mode:"
    echo "  • HTTP only (no SSL/TLS)"
    echo "  • Works with .localhost domains"
    echo "  • Automatically discovers IDE containers"
    echo ""
    echo "Access Traefik dashboard at:"
    echo "  http://localhost:8080"
    echo "  or http://traefik.localhost"
    echo ""
    echo "View logs with:"
    echo "  docker service logs -f traefik_traefik"
    echo ""
    echo "Next steps:"
    echo "  1. Start the Management API"
    echo "  2. Create an IDE container"
    echo "  3. Access it at http://<container-id>-code.localhost"
    echo ""
else
    echo "❌ Error: Traefik service failed to start"
    echo ""
    echo "Check logs with:"
    echo "  docker service logs traefik_traefik"
    exit 1
fi
