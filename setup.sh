#!/usr/bin/env bash
# setup.sh — Bootstrap a worktree (or fresh clone) with dependencies and .env files.
# Usage: ./setup.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"

# Detect the main repo root (for symlinking .env files in worktrees)
MAIN_ROOT=""
if [ -f "$REPO_ROOT/.git" ]; then
  # Inside a worktree — .git is a file pointing to the main repo
  MAIN_ROOT="$(git -C "$REPO_ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null | sed 's|/\.git$||')"
fi

# ---------------------------------------------------------------------------
# 1. Install dependencies
# ---------------------------------------------------------------------------
for pkg in classla-frontend classla-backend classla-ide-container/orchestration; do
  if [ ! -d "$REPO_ROOT/$pkg/node_modules" ]; then
    echo "Installing $pkg dependencies..."
    (cd "$REPO_ROOT/$pkg" && npm install)
  else
    echo "$pkg/node_modules already exists, skipping install."
  fi
done

# ---------------------------------------------------------------------------
# 2. Symlink .env files from the main repo (worktree only)
# ---------------------------------------------------------------------------
if [ -n "$MAIN_ROOT" ] && [ "$MAIN_ROOT" != "$REPO_ROOT" ]; then
  # Symlink .env files
  for pkg in classla-frontend classla-backend; do
    src="$MAIN_ROOT/$pkg/.env"
    dest="$REPO_ROOT/$pkg/.env"
    if [ -f "$src" ] && [ ! -e "$dest" ]; then
      ln -s "$src" "$dest"
      echo "Symlinked $pkg/.env → main repo"
    elif [ -e "$dest" ]; then
      echo "$pkg/.env already exists, skipping."
    else
      echo "Warning: $MAIN_ROOT/$pkg/.env not found — create it from .env.example"
    fi
  done

  # Symlink .claude/ settings directory
  src="$MAIN_ROOT/.claude"
  dest="$REPO_ROOT/.claude"
  if [ -d "$src" ] && [ ! -e "$dest" ]; then
    ln -s "$src" "$dest"
    echo "Symlinked .claude/ → main repo"
  elif [ -e "$dest" ]; then
    echo ".claude/ already exists, skipping."
  fi
else
  echo "Not a worktree (or already in main repo) — skipping symlinks."
  for pkg in classla-frontend classla-backend; do
    if [ ! -f "$REPO_ROOT/$pkg/.env" ]; then
      echo "Warning: $pkg/.env missing — copy $pkg/.env.example and fill in values."
    fi
  done
fi

echo "Setup complete."
