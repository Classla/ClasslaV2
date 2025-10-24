#!/bin/bash

# Setup script for integration tests
# This script prepares the environment for running integration tests

set -e

echo "========================================="
echo "IDE Orchestration - Test Setup"
echo "========================================="
echo ""

# Check if Docker is running
echo "Checking Docker..."
if ! docker info > /dev/null 2>&1; then
    echo "❌ Error: Docker is not running"
    echo "Please start Docker and try again"
    exit 1
fi
echo "✅ Docker is running"

# Check if Swarm is initialized
echo ""
echo "Checking Docker Swarm..."
if ! docker info | grep -q "Swarm: active"; then
    echo "⚠️  Docker Swarm is not initialized"
    echo "Initializing Docker Swarm..."
    docker swarm init
    echo "✅ Docker Swarm initialized"
else
    echo "✅ Docker Swarm is already initialized"
fi

# Create overlay network if it doesn't exist
echo ""
echo "Checking overlay network..."
if ! docker network ls | grep -q "ide-network"; then
    echo "Creating ide-network overlay network..."
    docker network create --driver overlay --attachable ide-network
    echo "✅ Network created"
else
    echo "✅ Network already exists"
fi

# Set up environment variables
echo ""
echo "Setting up environment variables..."
export API_KEYS=test-api-key-12345
export DOMAIN=test.example.com
export AWS_REGION=us-east-1
export NODE_ENV=test

echo "✅ Environment variables set"

# Create data directory if it doesn't exist
echo ""
echo "Creating data directory..."
mkdir -p data
echo "✅ Data directory ready"

# Install dependencies if needed
echo ""
echo "Checking dependencies..."
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
    echo "✅ Dependencies installed"
else
    echo "✅ Dependencies already installed"
fi

# Build the project
echo ""
echo "Building project..."
npm run build
echo "✅ Project built"

# Display Swarm status
echo ""
echo "========================================="
echo "Docker Swarm Status"
echo "========================================="
docker node ls

# Display network status
echo ""
echo "========================================="
echo "Network Status"
echo "========================================="
docker network ls | grep ide-network

# Check for worker nodes
echo ""
WORKER_COUNT=$(docker node ls | grep -c "Ready" | tail -1)
MANAGER_COUNT=$(docker node ls | grep -c "Leader" | tail -1)

echo "========================================="
echo "Node Summary"
echo "========================================="
echo "Manager nodes: $MANAGER_COUNT"
echo "Worker nodes: $((WORKER_COUNT - MANAGER_COUNT))"

if [ $WORKER_COUNT -eq 1 ]; then
    echo ""
    echo "⚠️  Note: Only 1 node detected (manager only)"
    echo "Multi-node tests will be limited."
    echo ""
    echo "To add a worker node:"
    echo "1. Run: docker swarm join-token worker"
    echo "2. Copy the join command"
    echo "3. Run it on another machine/VM"
fi

echo ""
echo "========================================="
echo "Setup Complete!"
echo "========================================="
echo ""
echo "You can now run tests:"
echo "  npm test                  # Run all tests (except inactivity)"
echo "  npm run test:integration  # Run integration tests"
echo "  npm run test:multinode    # Run multi-node tests"
echo "  npm run test:dashboard    # Run dashboard tests"
echo "  npm run test:inactivity   # Run inactivity test (10+ min)"
echo ""
echo "For more information, see docs/INTEGRATION_TESTING.md"
echo ""
