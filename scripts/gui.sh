#!/usr/bin/env bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

API_PORT=3457
VITE_PORT=3456

echo -e "${BLUE}Starting XState Agent GUI...${NC}\n"

# Function to check if port is in use
port_in_use() {
  lsof -i ":$1" > /dev/null 2>&1
}

# Function to start a service if not running
start_service() {
  local name=$1
  local port=$2
  local command=$3
  local log_file=$4
  
  if port_in_use "$port"; then
    echo -e "${GREEN}✓${NC} $name already running on port $port"
  else
    echo -e "${YELLOW}→${NC} Starting $name on port $port..."
    $command > "$log_file" 2>&1 &
    local pid=$!
    
    # Wait for service to be ready (max 10 seconds)
    local count=0
    while ! port_in_use "$port" && [ $count -lt 20 ]; do
      sleep 0.5
      count=$((count + 1))
      if ! kill -0 $pid 2>/dev/null; then
        echo -e "${RED}✗${NC} $name failed to start. Check $log_file"
        exit 1
      fi
    done
    
    if port_in_use "$port"; then
      echo -e "${GREEN}✓${NC} $name started (PID: $pid, log: $log_file)"
    else
      echo -e "${RED}✗${NC} $name failed to start on port $port"
      exit 1
    fi
  fi
}

# Start API server
start_service "API Server" "$API_PORT" "bun gui/server.ts" "/tmp/xstate-api-server.log"

# Start Vite dev server
start_service "Vite Dev Server" "$VITE_PORT" "bun vite" "/tmp/xstate-vite.log"

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}🚀 GUI is ready!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  ${BLUE}GUI:${NC}        http://localhost:$VITE_PORT"
echo -e "  ${BLUE}API:${NC}        http://localhost:$API_PORT"
echo ""
echo -e "  ${YELLOW}Logs:${NC}"
echo -e "    API:      tail -f /tmp/xstate-api-server.log"
echo -e "    Vite:     tail -f /tmp/xstate-vite.log"
echo ""
echo -e "${YELLOW}Press Ctrl+C to stop watching (services will keep running)${NC}"
echo -e "${YELLOW}To stop services: just stop-gui${NC}"
echo ""

# Tail both logs
tail -f /tmp/xstate-api-server.log /tmp/xstate-vite.log
