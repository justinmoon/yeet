#!/usr/bin/env bash
set -euo pipefail

log() {
  printf '[nightly] %s\n' "$*"
}

export REPORT_DIR=${REPORT_DIR:-reports/nightly}
export CI_AGENT_FIXTURES=${CI_AGENT_FIXTURES:-0}  # Use real providers by default
export CI_REAL_E2E=${CI_REAL_E2E:-1}
export YEET_PROVIDER=${YEET_PROVIDER:-live}

log "Starting nightly suite..."
log "Report directory: ${REPORT_DIR}"
log "Agent fixtures: ${CI_AGENT_FIXTURES}"
log "Real E2E: ${CI_REAL_E2E}"
log "Provider: ${YEET_PROVIDER}"

mkdir -p "${REPORT_DIR}"

log "Running pre-merge harness..."
./scripts/pre-merge.sh

log "✅ Pre-merge harness completed"

# Maple tests remain opt-in: only run when MAPLE_API_KEY is set
if [[ -n "${MAPLE_API_KEY:-}" ]]; then
  log "Running Maple integration tests..."
  mkdir -p "${REPORT_DIR}/maple"
  ./scripts/test-maple.sh --junit "${REPORT_DIR}/maple/junit.xml"
  log "✅ Maple tests completed"
else
  log "⏭️  Skipping Maple tests (MAPLE_API_KEY not set)"
fi

# Run full E2E tests with real inference (or fake if YEET_PROVIDER=fake)
log "Running GUI E2E tests..."
mkdir -p "${REPORT_DIR}/playwright/gui-e2e"

# Use reporters defined in playwright.gui-e2e.config.ts
CI=1 bunx playwright test --config=playwright.gui-e2e.config.ts

log "✅ GUI E2E tests completed"

log "✅ Nightly suite finished"
log "Reports available at: ${REPORT_DIR}"
