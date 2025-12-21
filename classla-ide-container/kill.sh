#!/bin/bash
set -e

# Kill script for Classla IDE Container system
# Removes Docker Swarm stack and cleans up all resources

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "========================================="
echo "Classla IDE Container - Kill Script"
echo "========================================="
echo ""

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
  echo "❌ Error: Docker is not running. Please start Docker and try again."
  exit 1
fi

# Check if Swarm is active
if ! docker info | grep -q "Swarm: active"; then
  echo "ℹ️  Docker Swarm is not active. Nothing to clean up."
  exit 0
fi

echo "This script will:"
echo "  1. Remove the ide-local stack"
echo "  2. Remove all IDE container services"
echo "  3. Remove volumes (data will be lost)"
echo "  4. Remove the ide-network"
echo "  5. Clean up unused Docker resources"
echo ""

# Optional flags
FORCE=false
LEAVE_SWARM=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --force|-f)
      FORCE=true
      shift
      ;;
    --leave-swarm|-s)
      LEAVE_SWARM=true
      shift
      ;;
    *)
      shift
      ;;
  esac
done

if [ "$FORCE" = false ]; then
  read -p "Are you sure you want to continue? (yes/no): " CONFIRM
  if [ "$CONFIRM" != "yes" ]; then
    echo "Cleanup cancelled"
    exit 0
  fi
fi

echo ""
echo "Step 1: Removing ide-local stack..."
echo ""

# Remove the stack
if docker stack ls | grep -q "ide-local"; then
  echo "Removing stack..."
  docker stack rm ide-local
  
  echo "⏳ Waiting for stack to be fully removed..."
  MAX_WAIT=60
  ELAPSED=0
  
  while [ $ELAPSED -lt $MAX_WAIT ]; do
    if ! docker stack ls | grep -q "ide-local"; then
      echo "✓ Stack removed"
      break
    fi
    sleep 2
    ELAPSED=$((ELAPSED + 2))
  done
  
  if [ $ELAPSED -ge $MAX_WAIT ]; then
    echo "⚠️  Warning: Stack removal may still be in progress"
  fi
else
  echo "ℹ️  Stack 'ide-local' not found"
fi

echo ""
echo "Step 2: Removing IDE container services..."
echo ""

# Find and remove all IDE container services (they start with "ide-")
IDE_SERVICES=$(docker service ls --format "{{.Name}}" 2>/dev/null | grep "^ide-" | grep -v "^ide-local_" || true)

if [ -n "$IDE_SERVICES" ]; then
  echo "Found IDE container services:"
  echo "$IDE_SERVICES" | sed 's/^/  - /'
  echo ""
  
  # Use process substitution to avoid subshell issues
  while IFS= read -r service; do
    if [ -n "$service" ]; then
      echo "Removing service: $service"
      docker service rm "$service" 2>/dev/null || echo "  ⚠️  Service $service may already be removed"
    fi
  done <<< "$IDE_SERVICES"
  echo "✓ IDE container services removed"
else
  echo "ℹ️  No IDE container services found"
fi

echo ""
echo "Step 3: Removing volumes..."
echo ""

# Remove volumes associated with the stack
STACK_VOLUMES=$(docker volume ls --format "{{.Name}}" 2>/dev/null | grep -E "ide-local_|traefik_" || true)

if [ -n "$STACK_VOLUMES" ]; then
  echo "Found volumes:"
  echo "$STACK_VOLUMES" | sed 's/^/  - /'
  echo ""
  
  # Use process substitution to avoid subshell issues
  while IFS= read -r volume; do
    if [ -n "$volume" ]; then
      echo "Removing volume: $volume"
      docker volume rm "$volume" 2>/dev/null || echo "  ⚠️  Volume $volume may already be removed"
    fi
  done <<< "$STACK_VOLUMES"
  echo "✓ Volumes removed"
else
  echo "ℹ️  No volumes found"
fi

echo ""
echo "Step 4: Removing ide-network..."
echo ""

# Remove the network
if docker network ls | grep -q "ide-network"; then
  echo "Removing network ide-network..."
  docker network rm ide-network 2>/dev/null || {
    echo "⚠️  Network may still be in use or already removed"
  }
  echo "✓ Network removed"
else
  echo "ℹ️  Network 'ide-network' not found"
fi

echo ""
echo "Step 5: Cleaning up unused resources..."
echo ""

# Remove dangling images
echo "Removing dangling images..."
docker image prune -f > /dev/null 2>&1 || true

# Remove unused networks
echo "Removing unused networks..."
docker network prune -f > /dev/null 2>&1 || true

# Remove unused volumes (be careful - this removes ALL unused volumes)
echo "Removing unused volumes..."
docker volume prune -f > /dev/null 2>&1 || true

echo "✓ Cleanup complete"

echo ""
echo "========================================="
echo "Cleanup Summary"
echo "========================================="
echo ""

# Show remaining resources
echo "Remaining Docker Swarm services:"
docker service ls 2>/dev/null || echo "  (No services found)"

echo ""
echo "Remaining networks:"
docker network ls | grep -E "NETWORK ID|ide-network" || echo "  (No ide-network found)"

echo ""
echo "Remaining volumes:"
docker volume ls 2>/dev/null | head -5 || echo "  (No volumes found)"

echo ""
echo "Step 6: Leaving Docker Swarm (optional)..."
echo ""

if [ "$LEAVE_SWARM" = true ]; then
  echo "Leaving Docker Swarm..."
  docker swarm leave --force 2>/dev/null || {
    echo "⚠️  Failed to leave Swarm (may not be a manager node)"
  }
  echo "✓ Left Docker Swarm"
else
  echo "ℹ️  Docker Swarm is still active"
  echo "   To leave Swarm: docker swarm leave --force"
  echo "   Or run: ./kill.sh --leave-swarm"
fi

echo ""
echo "========================================="
echo "✅ Cleanup complete!"
echo "========================================="
echo ""
echo "All IDE container resources have been removed."
echo ""

