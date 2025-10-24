#!/bin/bash

# Script to remove Traefik deployment
# WARNING: This will remove all Traefik services and optionally the network and certificates

set -e

echo "=========================================="
echo "Traefik Removal Script"
echo "=========================================="
echo ""

# Check if Traefik stack exists
if ! docker stack ls | grep -q "traefik"; then
    echo "No Traefik stack found. Nothing to remove."
    exit 0
fi

echo "This will remove the Traefik stack."
echo ""
read -p "Are you sure you want to continue? (yes/no): " confirm

if [ "$confirm" != "yes" ]; then
    echo "Aborted."
    exit 0
fi

# Remove Traefik stack
echo ""
echo "Removing Traefik stack..."
docker stack rm traefik

echo "Waiting for services to stop..."
sleep 10

# Check if any services are still running
while docker service ls | grep -q "traefik_"; do
    echo "Waiting for Traefik services to stop..."
    sleep 5
done

echo "✓ Traefik stack removed"
echo ""

# Ask about network removal
echo "Do you want to remove the ide-network overlay network?"
echo "WARNING: This will affect any running IDE containers!"
read -p "Remove network? (yes/no): " remove_network

if [ "$remove_network" = "yes" ]; then
    if docker network ls | grep -q "ide-network"; then
        echo "Removing ide-network..."
        docker network rm ide-network || echo "⚠️  Could not remove network (may still be in use)"
    else
        echo "Network ide-network not found."
    fi
fi

echo ""

# Ask about volume removal
echo "Do you want to remove the traefik-certificates volume?"
echo "WARNING: This will delete all Let's Encrypt certificates!"
read -p "Remove certificates? (yes/no): " remove_volume

if [ "$remove_volume" = "yes" ]; then
    if docker volume ls | grep -q "traefik_traefik-certificates"; then
        echo "Removing traefik-certificates volume..."
        docker volume rm traefik_traefik-certificates || echo "⚠️  Could not remove volume (may still be in use)"
    else
        echo "Volume traefik_traefik-certificates not found."
    fi
fi

echo ""
echo "=========================================="
echo "Removal Complete"
echo "=========================================="
echo ""
echo "Traefik has been removed from your system."
