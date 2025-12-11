#!/bin/bash
# Pre-pull Docker images on all Swarm nodes to reduce startup time
# This script should be run on each node to ensure images are cached

set -e

IMAGE_NAME="${IDE_CONTAINER_IMAGE:-classla-ide-container:latest}"

echo "========================================="
echo "Pre-pulling Docker images for faster startup"
echo "========================================="
echo "Image: $IMAGE_NAME"
echo ""

# Pull the image
echo "Pulling $IMAGE_NAME..."
docker pull "$IMAGE_NAME" || {
    echo "WARNING: Failed to pull $IMAGE_NAME"
    echo "This is OK if the image is built locally"
}

echo ""
echo "Image pre-pull complete!"
echo "Containers using this image will start faster."

