#!/bin/bash
# Run this after cloning or creating a new worktree to install all dependencies.
set -e

echo "Installing classla-frontend dependencies..."
(cd classla-frontend && npm install)

echo "Installing classla-backend dependencies..."
(cd classla-backend && npm install)

echo "Installing classla-ide-container/orchestration dependencies..."
(cd classla-ide-container/orchestration && npm install)

echo "Done."
