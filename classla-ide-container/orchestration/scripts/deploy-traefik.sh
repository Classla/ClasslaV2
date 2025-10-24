#!/bin/bash

# Script to deploy Traefik reverse proxy for IDE Container Orchestration
# This script:
# 1. Checks prerequisites
# 2. Creates the overlay network
# 3. Deploys Traefik as a Docker Swarm service

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "=========================================="
echo "Traefik Deployment Script"
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

# Check if .env file exists
if [ ! -f "$PROJECT_DIR/.env" ]; then
    echo "⚠️  Warning: .env file not found"
    echo ""
    echo "Creating .env from .env.traefik.example..."
    cp "$PROJECT_DIR/.env.traefik.example" "$PROJECT_DIR/.env"
    echo ""
    echo "❌ Please edit .env file with your configuration:"
    echo "  - DOMAIN: Your domain name"
    echo "  - ACME_EMAIL: Your email for Let's Encrypt"
    echo "  - TRAEFIK_DASHBOARD_AUTH: Dashboard password"
    echo ""
    echo "Then run this script again."
    exit 1
fi

echo "✓ Configuration file found"
echo ""

# Load environment variables
source "$PROJECT_DIR/.env"

# Validate required variables
if [ -z "$DOMAIN" ]; then
    echo "❌ Error: DOMAIN is not set in .env"
    exit 1
fi

if [ -z "$ACME_EMAIL" ]; then
    echo "❌ Error: ACME_EMAIL is not set in .env"
    exit 1
fi

echo "Configuration:"
echo "  Domain: $DOMAIN"
echo "  ACME Email: $ACME_EMAIL"
echo ""

# Step 1: Create overlay network
echo "Step 1: Creating overlay network..."
"$SCRIPT_DIR/create-network.sh"
echo ""

# Step 2: Deploy Traefik
echo "Step 2: Deploying Traefik..."
cd "$PROJECT_DIR"
docker stack deploy -c docker-compose.traefik.yml traefik

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
    echo "Traefik is now running and will:"
    echo "  • Automatically discover IDE containers"
    echo "  • Route traffic based on subdomains"
    echo "  • Generate SSL certificates via Let's Encrypt"
    echo ""
    echo "Access Traefik dashboard at:"
    echo "  https://traefik.$DOMAIN"
    echo ""
    echo "View logs with:"
    echo "  docker service logs -f traefik_traefik"
    echo ""
    echo "Next steps:"
    echo "  1. Verify DNS is configured (*.${DOMAIN} → your server IP)"
    echo "  2. Deploy the Management API"
    echo "  3. Start your first IDE container"
    echo ""
else
    echo "❌ Error: Traefik service failed to start"
    echo ""
    echo "Check logs with:"
    echo "  docker service logs traefik_traefik"
    exit 1
fi
