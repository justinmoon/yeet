# Yeet Testing & QA Plan

## Executive Summary
We are moving Yeet’s validation story from a single Bash script (`scripts/ci.sh`) into a layered pipeline that gives fast feedback locally, enforces deterministic coverage in pre-merge, and maintains slower but higher-signal suites in a nightly tier. Everything funnels through Nix apps so the exact same hermetic shell runs locally, on Hetzner Forge, and from ad-hoc agent invocations. Pre-merge now includes Playwright smoke suites and CLI/json harnesses pointed at a fake inference provider, while nightly reruns the same flows (plus Maple + long-running suites) with real inference. The end-state is two entry points (`nix run .#pre-merge` and `nix run .#nightly`) that emit junit/JSON artifacts and keep the repo ready for downstream packaging.

## Goals & Guardrails
- **Deterministic pre-merge**: Layer 1–3 tests must not call networked models and should finish <5 minutes on a laptop.
- **One command = one pipeline**: No bespoke CI YAML; everything shells out to `scripts/pre-merge.sh` / `scripts/nightly.sh`.
- **Structured telemetry**: All stages emit junit (Biome + Bun) and Playwright HTML so failures flow into tooling.
- **Cost awareness**: Expensive suites (Playwright E2E, Maple integration, live-provider agents) stay opt-in unless running nightly.
- **Agent-ready artifacts**: Capture junit + logs so single-player workflows can root-cause failures quickly without extra infrastructure.
- **UI coverage every PR**: Playwright smoke specs and ANSI snapshot tests run in pre-merge using the fake provider so regressions land fast; nightly flips to real inference for the exact same specs.

## Current Signal Inventory
| Signal | Command/Location | Current Issue |
| --- | --- | --- |
| Bash CI script | `scripts/ci.sh` | Hardcodes `[ci]` logs, no junit artifacts, Bun install not frozen, not wired to Nix `apps`. |
| `just pre-merge` | `justfile` | Delegates to `nix run .#pre-merge` but the flake entry mirrors the old CI script; `ci` target is redundant. |
| Deterministic Bun suites | `test/tools`, `test/sessions.test.ts`, `test/tokens.test.ts` | Already exist but run via `bun test` without reporters. |
| Behavioral agent suites | `test/agent-*.test.ts`, explain, clipboard | Hit real providers, causing flake and higher cost. |
| Playwright | `playwright.config.ts`, `playwright.gui*.ts` | Manual-only, no gating or junit output. |
| Maple E2E | `scripts/test-maple.sh` | Full-cost integration, not part of CI, no reuse in future cron. |

## Layered Pipeline Overview
| Layer | Focus | Entry | Time Target |
| --- | --- | --- | --- |
| 0 | Shell harness (`scripts/pre-merge.sh`) | `nix run .#pre-merge` / `just pre-merge` | < 4 min |
| 1 | Deterministic formatting + lint + targeted Bun suites | Called inside Layer 0 | 2–3 min |
| 2 | Agent harness replay suites | `CI_AGENT_FIXTURES=1 bun test …` | 2–4 min |
| 3 | Toolchain & persistence regression | Included in Bun invocation | 1–2 min |
| 4 | Playwright UI smoke (fake inference pre-merge, real nightly) | Included in Layer 0 | 3–5 min |
| 5 | Nightly mega-suite | `nix run .#nightly` | 20–25 min |
| 6 | Reporting + invariant agent | Part of nightly | < 5 min |

---

## Layer 0 – Pre-Merge Harness Refresh
**Deliverables**
1. Rename `scripts/ci.sh` → `scripts/pre-merge.sh`. Keep the log helper but switch prefixes to `[pre-merge]`.
2. Stage workflow inside the script:
   - `bun install --frozen-lockfile --cache-dir "${BUN_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/yeet/bun}"`
   - `bun run tsc --noEmit`
   - `bunx biome format --write=false --reporter=junit --report-file "${REPORT_DIR}/biome-format.xml"`
   - `bunx biome check --reporter=junit --report-file "${REPORT_DIR}/biome-lint.xml"`
   - `bun test test/tools test/sessions.test.ts test/tokens.test.ts --coverage --coverage-reporter=lcov --coverage-dir "${REPORT_DIR}/bun"`
3. Export `REPORT_DIR=${REPORT_DIR:-reports/pre-merge}` and `mkdir -p` inside the script so both local and Nix environments agree on paths.
4. Update `flake.nix`:
   - `apps.pre-merge` runs `./scripts/pre-merge.sh`.
   - Remove the obsolete `ci` app so we have a single canonical entry point.
5. Update the `justfile`:
   - Delete the `ci` recipe.
   - Ensure `pre-merge` recipe is just `nix run .#pre-merge`.
6. Document script usage inside `README.md` and `docs/TESTING.md` once implemented (follow-up task).
7. Always run Playwright smoke specs inside the script:
   - Export `YEET_PROVIDER=fake` (or similar) so the web-pty/GUI adapters consume fixture transcripts.
   - Start the lightweight UI server(s) within the script, run the smoke-tagged suites (see Layer 4) collecting junit/HTML reports under `${REPORT_DIR}/playwright`, and capture ANSI transcript snapshots for regression diffs.
8. Add a CLI regression hook:
   - Ship `yeet exec --json` (or equivalent) so we can script the agent with deterministic fixtures.
   - Inside the script, run a minimal CLI scenario against the fake provider twice: once for human output, once with `--json` to assert we can parse the event stream. Store the resulting JSONL under `${REPORT_DIR}/cli`.

**Runtime optimizations**
- Set `BUN_CACHE=${XDG_CACHE_HOME:-$HOME/.cache}/yeet/bun` and reuse across invocations.
- When running under `nix develop`, rely on `direnv` + `lorri` caches so the install step simply verifies lock determinism.

---

## Layer 1 – Fast Deterministic Checks
Purpose: Keep <5 minute guard that catches formatting, linting, schema drift, and deterministic Bun suites (including the CLI/json harness).

**Scope**
- `bun install --frozen-lockfile` (fails on lock drift, respects `BUN_INSTALL_CACHE_DIR` if you want to override the cache path).
- `bun run tsc --noEmit`.
- `bunx biome format --write=false --reporter=junit`.
- `bunx biome check --reporter=junit`.
- `bun test test/tools test/sessions.test.ts test/tokens.test.ts test/cli --bail --coverage --coverage-reporter=lcov --coverage-dir "${REPORT_DIR}/bun"` to exercise all deterministic suites in one run.

**Artifacts**
- `reports/pre-merge/biome-format.xml`
- `reports/pre-merge/biome-lint.xml`
- `reports/pre-merge/bun/lcov.info`

**Owner**: @justin until automation lands in Forge.

---

## Layer 2 – Agent Harness Suites
Purpose: Validate orchestration logic without burning tokens.

**Implementation Plan**
1. Add `providers/fake.ts` that returns an async generator for Bun tests and other in-process consumers, backed by serialized transcripts + tool recordings stored under `test/fixtures/agent/*.jsonl`.
2. Ship a small HTTP/SSE stub (`scripts/fake-provider-server.ts`) so Playwright and other HTTP clients can hit a local server with realistic streaming and error-rate toggles (the CLI continues to use the in-process fixture stream).
3. Introduce `YEET_PROVIDER=fake` (exported inside `scripts/pre-merge.sh` before deterministic Bun suites run) plus a `CI_AGENT_FIXTURES=1` flag so normal development can still talk to real providers.
4. Update targeted tests (`test/agent-diverse-tasks.test.ts`, `test/agent-multistep.test.ts`, `test/explain-*.test.ts`, `test/clipboard*.test.ts`, new CLI tests) to:
   - Import the shared `loadAgentFixture(name: string)` helper for deterministic responses.
   - Assert transcripts, tool routing, structured output, and retry/backoff behavior using the stub.
5. Record fixtures once by running under real providers and storing trimmed responses (max 3KB each) in git.
6. Wire these suites into `scripts/pre-merge.sh` after Layer 1 when `CI_AGENT_FIXTURES=1` is present.

**Outputs**
- (Future) Consider exporting dedicated junit/fixture artifacts once Bun adds reporters or we wire up conversion scripts. For now, reuse the Layer 1 coverage output and keep fixture JSONL files in `test/fixtures/agent/`.

---

## Layer 3 – Toolchain & Persistence Regression
Purpose: Catch file mutation, token-accounting, and persistence regressions before merge.

**Scope & Enhancements**
- Expand `test/tools/*.test.ts` with cases for:
  - Large diff editing (>5k characters, >15k characters) to confirm streaming patch support.
  - Non-UTF8 read/write detection with extended Unicode (Arabic, Cyrillic, Emoji, Math symbols, CJK).
  - Binary file handling and mixed line-ending support (LF, CRLF, CR).
  - Search tool quoting/regex escaping edge cases (parentheses, brackets, braces, backslashes, pipes, word boundaries).
  - Ripgrep max_results truncation and long-line handling (via `test/tools/search.test.ts:174-233`).
- Extend `test/sessions.test.ts` to load/save multi-agent transcripts sequentially (simulate 5+ sessions with persistence validation).
  - Sequential session updates and multiple save/load cycles to verify filesystem persistence.
  - Large conversation history (100+ messages) to test serialization at scale.
- Add git integration suites (`test/git.test.ts`):
  - Tests using real git repositories (temporary test repos) to validate `getGitDiff`, `ensureGitRepo`, and `resolveDefaultBaseRef`.
  - Confirm graceful handling of empty repos, unstaged changes, path filters, and binary files.
  - Multi-commit history parsing and max files limit enforcement.
- Expand `test/tokens.test.ts` to cover all current models (Claude Sonnet 4.5, Opus 4, 3.5 Sonnet/Haiku, Haiku 4.5, Grok Code, Qwen3 Coder, Kimi K2, GPT-5/Codex).
  - Verify token counting consistency and context window handling (200k, 128k, 32k).
- Keep everything behind the deterministic Bun invocation (no network calls for agent fixtures, git tests use local repos).

**Artifacts**
- Fold into the Bun junit + coverage output from Layer 1 to avoid separate files.

**Future Enhancements** (not yet implemented)
- Ripgrep column truncation configuration: The search tool currently only exposes `max_results` truncation. Custom column-width limits would require extending `src/tools/search.ts` to pass `--max-columns` to ripgrep.
- True concurrent session writes: Current tests validate sequential multi-session persistence. Adding `Promise.all()` concurrent writes would stress-test filesystem locking and race conditions.
- Git mocking and instrumentation: Tests use real git binaries in temporary repos. Future work could add mocks for `git status/diff`, progress callbacks for staging operations, and checkpoint-based persistence regression harnesses.

---

## Layer 4 – Playwright UI Smoke (Deterministic)
Purpose: Guarantee the UI adapters stay healthy by running Playwright in every pre-merge invocation while keeping tests fast and deterministic.

**Current Implementation**
- Smoke tests (tagged `@smoke`) verify UI rendering only, no backend execution:
  - Web-pty (2 tests): HTML page serving, TUI rendering in browser (`test/web-pty.playwright.test.ts:7-46`)
  - GUI (2 tests): Control panel loads, React renders without errors (`test/gui.playwright.test.ts:11-32`)
- Playwright configs emit junit + HTML reports when `CI=1`:
  - `playwright.config.ts` → `reports/pre-merge/playwright/web-pty/{junit.xml,html/}`
  - `playwright.gui.config.ts` → `reports/pre-merge/playwright/gui/{junit.xml,html/}`
- Tests auto-start required servers via `webServer` config (web-pty on :8766, GUI on :3456, backend on :3457)
- Current smoke runtime: ~4 seconds for web-pty, ~3.5 seconds for GUI

**Execution**
```bash
# Run web-pty smoke tests
CI=1 bunx playwright test --config=playwright.config.ts --grep @smoke

# Run GUI smoke tests
CI=1 bunx playwright test --config=playwright.gui.config.ts --grep @smoke
```

**Future Enhancements** (not yet implemented)
- Backend execution smoke tests: Add `@smoke` tests that trigger agent execution
  - Wire `YEET_PROVIDER=fake` environment variable in configs
  - Add clipboard flow, command palette, and message streaming scenarios
  - Verify agent responses using fixture transcripts
- ANSI transcript snapshots: Capture terminal buffer state for color/theme regression detection
- Theme contract unit tests: Enforce semantic color buckets (status, diff, markdown) across themes

---

## Layer 5 – Nightly Suite
Purpose: Run the full matrix (pre-merge + Playwright E2E + optional Maple) once per UTC day or on-demand for comprehensive validation.

**Implementation** (`scripts/nightly.sh`)
- Runs complete pre-merge harness first
- Executes GUI E2E tests with real AI inference by default
- Optionally runs Maple integration tests when `MAPLE_API_KEY` is set
- Emits junit + HTML reports to `reports/nightly/`

**Environment Variables**
- `REPORT_DIR`: Report output directory (default: `reports/nightly`)
- `CI_AGENT_FIXTURES`: Use fixture transcripts (default: `0` for real providers; set to `1` for deterministic fixtures)
- `CI_REAL_E2E`: Enable real E2E tests (default: `1`)
- `YEET_PROVIDER`: Provider to use (default: `live`; set to `fake` for deterministic runs)
- `MAPLE_API_KEY`: If set, runs Maple integration tests

**Execution**
```bash
# Via Nix (hermetic shell with Playwright browsers)
nix run .#nightly

# Via just
just nightly

# Direct script (for debugging)
just nightly-headless
# or: bash scripts/nightly.sh
```

**Report Structure**
```
reports/nightly/
├── biome-format.xml              # From pre-merge
├── biome-lint.xml                # From pre-merge
├── bun/lcov.info                 # From pre-merge
├── playwright/
│   ├── web-pty/                  # From pre-merge
│   ├── gui/                      # From pre-merge
│   └── gui-e2e/
│       ├── junit.xml
│       └── html/
├── cli/                          # From pre-merge
└── maple/                        # If MAPLE_API_KEY set
    └── junit.xml
```

**Future Enhancements**
- Scheduled cron on Hetzner Forge with secrets for Maple + provider keys
- Additional fuzzing suites and property-based tests
- Performance regression tracking across nightly runs

---

## Reporting & Developer Ergonomics
- Store all junit/JSON under `reports/` so IDEs and Forge UI can ingest results automatically.
- Copy `~/.yeet/logs/*` (or `$YEET_LOG_DIR`) into the report directory on every run so failures always include TUI/CLI logs.
- Agree on two log prefixes: `[pre-merge]` for Layer 0/1/2/3/4 and `[nightly]` for Layer 5.
- Publish a short FAQ in `README.md` once the scripts exist (how to run deterministic suites, how to opt into UI tests, how to inspect reports).
- Deduplicate dependency installs by caching Bun in `${XDG_CACHE_HOME:-$HOME/.cache}/yeet/bun` and Playwright browsers in `${XDG_CACHE_HOME:-$HOME/.cache}/ms-playwright`.

---

## Implementation Checklist
| Item | Owner | Target |
| --- | --- | --- |
| Rename script + update flake + just recipes | @justin | Week 1 |
| Wire deterministic reporters + caching | @justin | Week 1 |
| Fake provider + fixtures for agent suites | @justin + @automation | Week 2 |
| Enhanced toolchain tests + coverage | @automation | Week 2 |
| Playwright smoke tagging + fake/live provider toggle (`CI_REAL_E2E`) | @frontend | Week 3 |
| `scripts/nightly.sh` + `apps.nightly` | @justin | Week 3 |
| Forge cron + artifact publication (optional) | @infra | Week 4 |

Once all checkboxes are complete, merging code only requires `nix run .#pre-merge` to be green locally, while nightly/on-demand runs provide the richer signal for UI and provider integrations without unnecessary ceremony.
