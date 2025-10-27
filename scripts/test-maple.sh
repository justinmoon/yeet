#!/bin/bash
#
# Run Maple E2E tests with proper environment setup
#
# Usage:
#   ./scripts/test-maple.sh                    # Uses .env.test
#   MAPLE_API_KEY=xxx ./scripts/test-maple.sh  # Uses env var
#

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}🍁 Maple AI E2E Test Runner${NC}\n"

# Check if .env.test exists and source it
if [ -f .env.test ]; then
  echo -e "${GREEN}✓${NC} Loading credentials from .env.test"
  export $(cat .env.test | grep -v '^#' | xargs)
elif [ -z "$MAPLE_API_KEY" ]; then
  echo -e "${YELLOW}⚠${NC}  No credentials found"
  echo ""
  echo "To run Maple E2E tests, you need to:"
  echo "1. Copy .env.test.example to .env.test"
  echo "2. Add your Maple API key to .env.test"
  echo ""
  echo "Or run with: MAPLE_API_KEY=xxx $0"
  echo ""
  echo -e "${YELLOW}Skipping tests...${NC}"
  exit 0
fi

# Verify API key format (basic check)
if [[ ! $MAPLE_API_KEY =~ ^[a-zA-Z0-9_-]+$ ]]; then
  echo -e "${RED}✗${NC} Invalid MAPLE_API_KEY format"
  echo "  API key should only contain alphanumeric characters, hyphens, and underscores"
  exit 1
fi

# Show what we're testing
echo -e "${GREEN}✓${NC} API Key: ${MAPLE_API_KEY:0:8}..."
echo -e "${GREEN}✓${NC} API URL: ${MAPLE_API_URL:-https://enclave.trymaple.ai}"
echo ""

# Run the tests
echo -e "${GREEN}Running E2E tests...${NC}\n"

bun test test/maple-e2e.test.ts "$@"

TEST_EXIT_CODE=$?

if [ $TEST_EXIT_CODE -eq 0 ]; then
  echo ""
  echo -e "${GREEN}✅ All tests passed!${NC}"
else
  echo ""
  echo -e "${RED}❌ Tests failed with exit code $TEST_EXIT_CODE${NC}"
  exit $TEST_EXIT_CODE
fi
