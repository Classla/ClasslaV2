#!/bin/bash
set -e

# Build script for Classla IDE Container system
# Detects platform and builds all required Docker images

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "========================================="
echo "Classla IDE Container - Build Script"
echo "========================================="
echo ""

# Detect platform architecture
ARCH=$(uname -m)
PLATFORM=""
case "$ARCH" in
  x86_64)
    PLATFORM="linux/amd64"
    echo "✓ Detected platform: x86_64 (amd64)"
    ;;
  arm64|aarch64)
    PLATFORM="linux/arm64"
    echo "✓ Detected platform: ARM64"
    ;;
  *)
    echo "⚠️  Warning: Unknown architecture $ARCH, defaulting to linux/amd64"
    PLATFORM="linux/amd64"
    ;;
esac
echo ""

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
  echo "❌ Error: Docker is not running. Please start Docker and try again."
  exit 1
fi

echo "Building Docker images..."
echo ""

# Build IDE container image
echo "📦 Building IDE container image (classla-ide-container:latest)..."
cd "$SCRIPT_DIR"
if docker build --platform "$PLATFORM" -t classla-ide-container:latest .; then
  echo "✓ IDE container image built successfully"
else
  echo "❌ Failed to build IDE container image"
  exit 1
fi
echo ""

# Build orchestration API image
echo "📦 Building orchestration API image (ide-orchestration-api:latest)..."
cd "$SCRIPT_DIR/orchestration"
if docker build --platform "$PLATFORM" -t ide-orchestration-api:latest .; then
  echo "✓ Orchestration API image built successfully"
else
  echo "❌ Failed to build orchestration API image"
  exit 1
fi
echo ""

echo "========================================="
echo "✅ All images built successfully!"
echo "========================================="
echo ""
echo "Built images:"
docker images | grep -E "(classla-ide-container|ide-orchestration-api)" | head -5
echo ""
echo "Ready to start with: ./start.sh"


