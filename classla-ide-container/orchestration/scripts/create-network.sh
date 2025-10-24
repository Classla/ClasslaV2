#!/bin/bash

# Script to create the Docker overlay network for IDE containers
# This network spans all Swarm nodes and is attachable for services

set -e

NETWORK_NAME="ide-network"

echo "Creating Docker overlay network: ${NETWORK_NAME}"

# Check if network already exists
if docker network ls --format '{{.Name}}' | grep -q "^${NETWORK_NAME}$"; then
    echo "Network '${NETWORK_NAME}' already exists."
    docker network inspect ${NETWORK_NAME}
    exit 0
fi

# Create overlay network
docker network create \
    --driver overlay \
    --attachable \
    --scope swarm \
    ${NETWORK_NAME}

echo "✓ Network '${NETWORK_NAME}' created successfully"
echo ""
echo "Network details:"
docker network inspect ${NETWORK_NAME}
