#!/usr/bin/env bash
set -euo pipefail

log() {
  printf '[ci] %s\n' "$*"
}

log "Running TypeScript CI checks..."
echo ""

log "0. Installing dependencies..."
bun install

log "1. Type checking..."
bun run tsc --noEmit

log "2. Checking code format..."
bunx biome format .

log "3. Running linter..."
bunx biome check .

log "4. Running unit tests..."
# Run unit tests + Maple crypto tests, skip model-behavior-dependent E2E tests
bun test test/tools test/sessions.test.ts test/tokens.test.ts

log "5. Running Playwright tests (web-pty)..."
bunx playwright test

log "6. Running GUI Playwright tests..."
# Start vite dev server in background
bun vite &
VITE_PID=$!
sleep 3

# Run GUI tests
bunx playwright test test/gui-hello.playwright.test.ts

# Kill vite
kill $VITE_PID 2>/dev/null || true

echo ""
log "✅ All CI checks passed!"
