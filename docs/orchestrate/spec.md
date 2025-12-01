- Scope: single coder + single reviewer working a plan in docs/<feature>/plan.md. Focus on baton handoff and plan-step progression; leave multi-coder/reviewer for later but keep extensibility in mind.

- Goals
  - Keep main conversation readable with agent attribution `[coder]`, `[coder:bash]`, `[reviewer]`, `[reviewer:ask-user]`.
  - Ensure coder and reviewer operate on the current plan step with lean, role-specific context.
  - Persist state (active step, approvals, halt conditions) so sessions are resumable without re-running agents.

- Plan representation
  - plan.md uses minimal YAML frontmatter: `active_step: "<id or slug>"`. Keep the body as the human-readable plan with numbered steps and acceptance criteria in prose/bullets.
  - Harness updates only the minimal frontmatter on reviewer approvals/requests to avoid brittle edits in the body. Acceptance criteria remain human-written; agents are encouraged (not forced) to follow them.
  - Add a validator hook: any write to docs/<slug>/spec.md (or plan frontmatter) is checked for basic validity; on failure, inject a message telling the agent to fix formatting/keys.
  - intent.md and spec.md stay as-is; referenced in prompts.

- State machine
  - States: `coder_active`, `reviewer_active`, `awaiting_user_input`, `error`.
  - Transitions:
    - coder→reviewer: coder calls `request_review` tool (implies active step ready).
    - reviewer→coder: reviewer calls `request_changes(text)` (marks active step needs-changes) or `approve()` (marks done and advances active_step to next pending step).
    - Any agent→awaiting_user_input: agent calls `ask_user(message)`; user reply returns baton to the agent that asked.
    - Loop guard: if reviewer issues 4th `request_changes` on the same step, park in `awaiting_user_input` until user intervenes.
    - `error` is reserved for transport/system failures (e.g., LLM unreachable).
  - Extensibility: later, additional states can represent multiple concurrent coders/reviewers bound to distinct worktrees; tokens/ownership can become a pool keyed by thread/workspace.

- State machine detail (events/guards)
  - Events: `coder.request_review`, `reviewer.request_changes(reason)`, `reviewer.approve`, `agent.ask_user(message)`, `user.reply`, `system.error`.
  - Guards:
    - `loop_guard`: count `request_changes` per active step; on 4th, block further auto transitions and move to `awaiting_user_input`.
    - `no_pending_steps`: if approve occurs and no further steps exist, transition to `awaiting_user_input` (later: trigger “explain” agent).
  - State actions:
    - Enter coder_active: spawn coder run with prompt seeded by current step; reset coder message buffer.
    - Enter reviewer_active: spawn reviewer run with prompt seeded by current step + history summary; reviewer buffer can persist across steps (trimmed).
    - Enter awaiting_user_input: pause automatic agent switching; surface prompt inline; resume to the requester on user reply unless user directs otherwise via command palette.
    - Enter error: surface error and require user to resume or reset.
  - User overrides: command palette can force control to coder or reviewer, or reset loop guard counters for the step.

- Agent contexts and prompts
  - Coder: context resets per step. System prompt includes role, current step (from frontmatter), intent/spec pointers, and summary of prior approvals/rejections (from event log). Past conversation remains visible in UI but is not auto-injected.
  - Reviewer: keeps cumulative context across steps (trimmed for length) plus current step details; includes history of change requests/approvals to spot regressions.
  - Both agents see only their own message buffers; baton switch constructs a fresh prompt for the next agent.

- Tooling
  - coder tools: `request_review`, `bash`, `edit`/write tools as allowed by workspace policy.
  - reviewer tools: `request_changes(text)`, `approve()`, `ask_user(message)`, read-only tooling (logs, tests, git diff). Reviewer should not write files.
  - ask-user UI renders as `[agent] message` and pauses that agent until user replies.
  - All tool calls prefixed in UI/logs with `[coder:tool]` or `[reviewer:tool]` for clarity.

- Workspace and permissions
  - Single shared workspace by default. Coder: writable; Reviewer: read-only (but may run tests/commands). Future: worktree binding per agent/thread.
  - Enforce write guards for reviewer. Encourage (but do not hard-enforce) running `just pre-merge` and plan acceptance criteria; allow wiggle room when intermediate steps are expected to fail CI.

- Event log and persistence
  - Session thread record stores: active state, active_step_id, step statuses (mirrors plan frontmatter), loop counters, list of agent runs with transcript paths, event log (state transitions, tool calls, ask-user prompts).
  - On resume: read frontmatter + session log to restore baton state and counters.
  - Transcripts: one per agent run; linked from event log.

- UI behavior
  - Main stream shows messages/tool calls with agent prefixes; shows which agent is currently active in the header.
  - Ask-user prompts appear inline and block that agent until answered.
  - Show per-step status (from frontmatter) and acceptance criteria (from body) in a side panel; indicate active step.
  - Show loop guard status if parked after the 4th request-changes.

- Loop guard and policy
  - Configurable max change-requests per step (default 3, halt on 4th).
  - Optional time budget per step; exceeding it moves to awaiting_user_input.

- Code abstraction sketch
  - PlanState: loader/saver for plan.md frontmatter (`active_step`, optional `step_status` map) plus helpers to get current step text from body. Exposes `set_status(step, status)`, `advance_to_next()`.
  - FlowMachine (no “baton” terminology): small state machine that holds current state, loop counters, active step; consumes events, emits transitions and side effects (spawn agent, write PlanState, log event). Pluggable policy (max change requests, time budget).
  - AgentDriver: wraps `runAgent` with per-agent message buffer, prompt builder, and workspace policy (coder writable, reviewer read-only). Provides `spawn(role, context)` and returns handle with transcript path.
  - EventLog: append-only log (state transitions, tool calls, ask-user prompts, errors) with links to transcripts; used for resume/reconstruction.
  - Validation hook: after writes to plan/spec, run validator; on failure, emit a system message to the active agent to fix formatting/keys.
  - UI adapter: render agent-prefixed messages/tool calls, show baton owner, active step, loop-guard status; render ask-user prompts blocking the requester.

- Future-ready notes (not implemented now)
  - Multi-coder/reviewer: extend state machine to per-worktree threads with their own batons; reviewer pool per thread; eventual “debate” resolution layer.
  - Shared event bus could feed pair-watcher interrupts later; not required for single coder/reviewer.
  - “Explain this” agent could run after final approval to produce a tutorial/summary in a dedicated UI; can hook off the final approve transition.
