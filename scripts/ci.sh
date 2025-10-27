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
bun run typecheck

log "2. Checking code format..."
bun run fmt:check

log "3. Running linter..."
bun run lint

log "4. Running tests..."
# Run unit tests + Maple crypto tests, skip model-behavior-dependent E2E tests
bun test test/tools test/maple-e2e.test.ts

echo ""
log "✅ All CI checks passed!"
