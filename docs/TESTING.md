# Testing

## Philosophy

Yeet uses a **layered testing approach** that prioritizes fast, deterministic feedback locally while maintaining comprehensive validation in nightly runs:

1. **Deterministic pre-merge** - No network calls, finishes in <5 minutes
2. **Structured telemetry** - All stages emit junit/JSON for tooling integration
3. **Cost awareness** - Expensive tests (real AI providers, E2E) are opt-in or nightly-only
4. **Hermetic execution** - Everything runs via Nix apps for reproducibility across environments

## Running Tests

### Pre-merge (Required before PR)

Runs deterministic checks: format, lint, typecheck, unit tests, and UI smoke tests with fake providers.

```bash
just pre-merge
# or: nix run .#pre-merge
```

**Layers:**
- Layer 1: Format/lint/typecheck + deterministic Bun suites
- Layer 2: Agent tests using fixture transcripts (no real API calls)
- Layer 3: Toolchain regression (git, sessions, tokens, tools)
- Layer 4: Playwright UI smoke tests (web-pty, GUI)

**Time:** ~4 minutes
**Artifacts:** `reports/pre-merge/` (junit, HTML, coverage)

### Nightly (Comprehensive validation)

Runs pre-merge + full E2E tests with real AI providers.

```bash
just nightly
# or: nix run .#nightly
```

**Additional coverage:**
- GUI E2E tests with real inference
- Maple integration tests (if `MAPLE_API_KEY` set)
- Full provider validation

**Time:** 20-25 minutes
**Artifacts:** `reports/nightly/` (junit, HTML, coverage)

### Development

```bash
# All tests
bun test

# Specific suite
bun test test/tools/

# Watch mode
bun test --watch

# Playwright (manual)
bunx playwright test
bunx playwright test --config=playwright.gui.config.ts
```

## Test Organization

```
test/
├── tools/              # Tool implementation tests (bash, edit, read, write, search)
├── cli/                # CLI interface tests
├── fixtures/
│   ├── agent/          # Agent response fixtures for deterministic tests
│   └── files/          # Test files (binary, unicode, etc)
├── sessions.test.ts    # Session persistence
├── tokens.test.ts      # Token accounting
├── git.test.ts         # Git integration
├── agent-fixture.test.ts   # Fixture loading
├── *.playwright.test.ts    # Playwright UI tests
└── *-e2e.test.ts      # E2E tests (real providers, not in pre-merge)
```

## Key Files

### Scripts

- `scripts/pre-merge.sh` - Pre-merge harness (called by `nix run .#pre-merge`)
- `scripts/nightly.sh` - Nightly suite (called by `nix run .#nightly`)
- `scripts/fake-provider-server.ts` - HTTP/SSE stub server for Playwright tests

### Configuration

- `playwright.config.ts` - Web-pty smoke tests (@smoke tag)
- `playwright.gui.config.ts` - GUI smoke tests (@smoke tag)
- `playwright.gui-e2e.config.ts` - GUI E2E tests (nightly only)
- `flake.nix` - Nix apps for hermetic test execution
- `justfile` - Convenience recipes

### Providers

- `src/providers/fake.ts` - Deterministic provider using fixture transcripts
- `src/fixtures/agent-fixture.ts` - Fixture loader for agent tests

## Environment Variables

### Pre-merge
- `YEET_CONFIG_DIR` - Override config directory (for fixture configs)
- `CI_AGENT_FIXTURES=1` - Use fixture transcripts (default in pre-merge)
- `YEET_PROVIDER=fake` - Use fake provider (default in pre-merge)
- `REPORT_DIR` - Report output directory (default: `reports/pre-merge`)

### Nightly
- `CI_REAL_E2E=1` - Enable real E2E tests (default in nightly)
- `YEET_PROVIDER=live` - Use real providers (default in nightly)
- `MAPLE_API_KEY` - If set, runs Maple integration tests

### Playwright
- `CI=1` - Enable junit/HTML reporters
- `PLAYWRIGHT_BROWSERS_PATH` - Browser location (auto-set by Nix)

## Adding Tests

### Unit tests
Add to appropriate directory in `test/`, import from `bun:test`:

```typescript
import { describe, expect, test } from "bun:test";

describe("Feature", () => {
  test("should work", () => {
    expect(true).toBe(true);
  });
});
```

### Agent tests with fixtures
1. Run agent with real provider and capture response
2. Save trimmed response (<3KB) to `test/fixtures/agent/name.jsonl`
3. Use `loadAgentFixture("name")` in test

### Playwright tests
- Add `@smoke` tag for tests that should run in pre-merge
- Omit tag for E2E tests that need real inference (nightly only)

## Smoke vs E2E

**Smoke tests** (@smoke tag):
- Run in pre-merge with fake providers
- Verify UI rendering and basic functionality
- Fast (<10s per suite)
- No real API calls

**E2E tests** (no tag):
- Run in nightly with real providers
- Test full integration including AI responses
- Slow (minutes per suite)
- Cost money (real API calls)
