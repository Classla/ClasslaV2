#!/usr/bin/env bash
set -e

# Colors
CYAN='\033[0;36m'
YELLOW='\033[0;33m'
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

BACKEND_COLOR='\033[0;36m'   # cyan
FRONTEND_COLOR='\033[0;35m'  # magenta

cleanup() {
  echo -e "\n${YELLOW}Shutting down...${NC}"
  kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
  wait $BACKEND_PID $FRONTEND_PID 2>/dev/null
  echo -e "${GREEN}Done.${NC}"
}
trap cleanup EXIT INT TERM

# --- Redis ---
# Find redis-cli (may be in a versioned Homebrew keg)
REDIS_CLI="$(command -v redis-cli 2>/dev/null || find "$(brew --prefix 2>/dev/null)/bin" "$(brew --cellar 2>/dev/null)" -name redis-cli -type f 2>/dev/null | head -1)"
if [ -z "$REDIS_CLI" ]; then
  echo -e "${RED}redis-cli not found. Install Redis with: brew install redis${NC}"
  exit 1
fi

if "$REDIS_CLI" ping &>/dev/null; then
  echo -e "${GREEN}Redis is already running.${NC}"
else
  echo -e "${YELLOW}Starting Redis...${NC}"
  brew services start redis@6.2 &>/dev/null || brew services start redis &>/dev/null
  sleep 1
  if "$REDIS_CLI" ping &>/dev/null; then
    echo -e "${GREEN}Redis started.${NC}"
  else
    echo -e "${RED}Failed to start Redis.${NC}"
    exit 1
  fi
fi

DIR="$(cd "$(dirname "$0")" && pwd)"

# --- Worktree setup ---
if [ -f "$DIR/.git" ]; then
  echo -e "${YELLOW}Worktree detected — running setup.sh...${NC}"
  "$DIR/setup.sh"
fi

# --- Backend ---
echo -e "${CYAN}Starting backend...${NC}"
cd "$DIR/classla-backend"
npm run dev 2>&1 | while IFS= read -r line; do
  echo -e "${BACKEND_COLOR}[backend]${NC}  $line"
done &
BACKEND_PID=$!

# --- Frontend ---
echo -e "${FRONTEND_COLOR}Starting frontend...${NC}"
cd "$DIR/classla-frontend"
npm run dev 2>&1 | while IFS= read -r line; do
  echo -e "${FRONTEND_COLOR}[frontend]${NC} $line"
done &
FRONTEND_PID=$!

wait
