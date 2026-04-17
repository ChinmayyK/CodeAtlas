#!/bin/bash
# ─────────────────────────────────────────────
# CodeAtlas · Startup Script
# ─────────────────────────────────────────────

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}Starting CodeAtlas (Frontend & Backend)...${NC}"

# Check environment variables
if [ -z "$GITHUB_TOKEN" ]; then
  echo -e "${YELLOW}Warning: GITHUB_TOKEN is not set. GitHub API limits will apply.${NC}"
fi

if [ -z "$OPENAI_API_KEY" ]; then
  echo -e "${YELLOW}Warning: OPENAI_API_KEY is not set. AI Explanations will use fallback mode.${NC}"
fi

# Cleanup function that runs when Ctrl+C is pressed
cleanup() {
  echo -e "\n${RED}Stopping CodeAtlas...${NC}"
  # Kill all background jobs started by this script (process group)
  kill 0
  exit 0
}

# Trap SIGINT (Ctrl+C) and SIGTERM to run the cleanup function
trap cleanup SIGINT SIGTERM

# Install backend dependencies if needed
if [ ! -d "backend/node_modules" ]; then
  echo "Installing backend dependencies..."
  (cd backend && npm install)
fi

# Install frontend dependencies if needed
if [ ! -d "frontend/node_modules" ]; then
  echo "Installing frontend dependencies..."
  (cd frontend && npm install)
fi

# Start Backend
echo -e "${GREEN}Booting Backend...${NC}"
if [ "$1" == "--prod" ]; then
  (cd backend && npm start) &
else
  (cd backend && npm run dev) &
fi

# Start Frontend
echo -e "${GREEN}Booting Frontend...${NC}"
(cd frontend && npm run dev) &

echo -e "${GREEN}CodeAtlas is running. Press Ctrl+C to stop.${NC}"

# Wait for all background processes to finish
wait
