- Step 1: Plan state + validation
  - Acceptance: plan.md frontmatter supports only `active_step`; loader tolerates missing value and sets a default; validator runs on spec/plan writes and emits a clear fix-it message to the active agent on failure.
  - Tests: unit tests for PlanState parsing (with/without `active_step`, malformed YAML), defaulting behavior, and preservation of body text on save.

- Step 2: Flow state machine
  - Acceptance: implements states `coder_active`, `reviewer_active`, `awaiting_user_input`, `error`; events `request_review`, `request_changes`, `approve`, `ask_user`, `user.reply`, `system.error`; loop guard halts after 4th `request_changes` on a step; exposes hooks to run state-entry side effects.
  - Tests: happy path (request_review → approve), loop guard (4th request_changes parks in awaiting_user_input), ask_user/user.reply resumes to requester, system.error lands in error, approve with no remaining steps lands in awaiting_user_input.

- Step 3: Agent drivers and prompts
  - Acceptance: coder runs with writable workspace, fresh context per step seeded with current step + intent/spec pointers; reviewer runs read-only, keeps cumulative short history; both tag UI output with `[coder:*]`/`[reviewer:*]`.
  - Tests: coder prompt contains current step and intent/spec refs and resets per step; reviewer retains short history; reviewer write attempts are blocked; prefixes render as expected.

- Step 4: Tool wiring
  - Acceptance: tools registered as `request_review`, `request_changes(text)`, `approve()`, `ask_user(message)`; reviewer tools enforce read-only; `request_review` triggers reviewer run; `request_changes` and `approve` update active_step status and loop counters.
  - Tests: tool invocations dispatch correct events; ask_user blocks and resumes on simulated user.reply; request_review triggers reviewer entry; request_changes/approve update PlanState.

- Step 5: UI surface
  - Acceptance: header shows active agent; main stream shows agent-prefixed messages/tool calls; ask-user prompts render inline and block the requester; display current `active_step` and status sourced from frontmatter.
  - Tests: snapshot or adapter-level tests that active agent indicator switches on events; ask-user renders blocking state; active_step display reflects frontmatter changes.

- Step 6: Persistence and logging
  - Acceptance: event log records state transitions, tool calls, ask-user prompts, errors with timestamps and transcript links; resume reconstructs state and counters from log + frontmatter.
  - Tests: serialization/deserialization restores state, counters, active_step; corrupted log yields a recoverable error path.

- Step 7: Tests
  - Acceptance: integration smoke simulating coder→request_review→reviewer→request_changes→coder→request_review→reviewer→approve with logs/transcripts produced; ensures resume works mid-flow.
