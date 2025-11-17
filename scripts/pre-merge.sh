#!/usr/bin/env bash
set -euo pipefail

log() {
  printf '[pre-merge] %s\n' "$*"
}

ensure_fixture_config() {
  if [[ -n "${YEET_CONFIG_DIR:-}" && -f "${YEET_CONFIG_DIR}/config.json" ]]; then
    return
  fi

  local fixture_config_dir="${REPORT_DIR}/.yeet-config"
  mkdir -p "${fixture_config_dir}"

  if [[ -f "config.example.json" ]]; then
    cp "config.example.json" "${fixture_config_dir}/config.json"
  else
    cat >"${fixture_config_dir}/config.json" <<'EOF'
{
  "activeProvider": "opencode",
  "opencode": {
    "apiKey": "fake-key",
    "baseURL": "https://example.invalid",
    "model": "stub"
  },
  "maxSteps": 5,
  "temperature": 0.2
}
EOF
  fi

  mkdir -p "${fixture_config_dir}/agents"
  export YEET_CONFIG_DIR="${fixture_config_dir}"
  log "Using fixture config at ${YEET_CONFIG_DIR}"
}

run_playwright_smoke() {
  local config_file=$1
  local suite_name=$2
  local suite_dir="${REPORT_DIR}/playwright/${suite_name}"

  mkdir -p "${suite_dir}"

  # Use reporters defined in config (activated by CI=1)
  CI=1 bunx playwright test \
    --config="${config_file}" \
    --grep "@smoke"
}

run_cli_smoke() {
  local cli_dir="${REPORT_DIR}/cli"
  local fixture="${1:-hello-world}"
  local prompt="Run CLI smoke prompt"
  mkdir -p "${cli_dir}"

  bun run src/cli/exec.ts --fixture "${fixture}" "${prompt}" \
    >"${cli_dir}/human.txt"

  bun run src/cli/exec.ts --fixture "${fixture}" --json "${prompt}" \
    >"${cli_dir}/events.jsonl"
}

export REPORT_DIR=${REPORT_DIR:-reports/pre-merge}
BUN_CACHE_DIR="${BUN_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/yeet/bun}"

log "Preparing report + cache directories..."
mkdir -p "${REPORT_DIR}" "${REPORT_DIR}/bun"
mkdir -p "${BUN_CACHE_DIR}"

export CI_AGENT_FIXTURES=${CI_AGENT_FIXTURES:-1}
export YEET_PROVIDER=${YEET_PROVIDER:-fake}

log "0. Installing dependencies..."
bun install --frozen-lockfile --cache-dir "${BUN_CACHE_DIR}"

log "1. Type checking..."
bun run tsc --noEmit

log "2. Checking code format..."
bunx biome format \
  --reporter=junit \
  . | tee "${REPORT_DIR}/biome-format.xml" >/dev/null

log "3. Running linter..."
bunx biome check \
  --reporter=junit \
  . | tee "${REPORT_DIR}/biome-lint.xml" >/dev/null

log "4. Running deterministic Bun suites with coverage..."
bun test test/tools test/sessions.test.ts test/tokens.test.ts test/cli test/agent-fixture.test.ts \
  --coverage \
  --coverage-reporter=lcov \
  --coverage-out "${REPORT_DIR}/bun/lcov.info"

log "✅ Layer 1 deterministic checks completed"

log "5. Running Playwright smoke suites..."
ensure_fixture_config
run_playwright_smoke "playwright.config.ts" "web-pty"
run_playwright_smoke "playwright.gui.config.ts" "gui"
log "✅ Playwright smoke suites completed"
log "6. Running CLI smoke scenario..."
run_cli_smoke "hello-world"
log "✅ CLI smoke scenario captured"
log "✅ Pre-merge harness finished"
