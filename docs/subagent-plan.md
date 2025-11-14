# Subagent Implementation Plan

## 1. Establish Unified Agent Profiles
1. Extend `Config` with `agents: Record<string, AgentProfileConfig>` where each profile defines prompt/model/tool access plus capability flags (`primary`, `subtask`, `watcher`).
2. Support loading overrides from `~/.config/yeet/agents/*.json` so devs can iterate without rebuilding.
3. Create `AgentRegistry` utility to validate capability combos (e.g., watchers must be read-only) and expose lookup helpers for later phases.
### Acceptance Criteria
- Config schema includes `AgentProfileConfig` with capability flags, tool permissions, workspace + permission presets.
- Profiles merge between inline config and `~/.config/yeet/agents/*.json`.
- `AgentRegistry` can list profiles, filter by capability, and rejects invalid watcher permissions.
- **Manual Verification:** Create an inline agent (e.g., `oracle`) plus `~/.config/yeet/agents/oracle.json` overriding a single field. Run  
  `bunx tsx -e "import { loadConfig } from './src/config.ts'; console.log((await loadConfig()).agents.oracle)"`  
  and confirm the merged result reflects both sources; flip watcher permissions to an invalid state and verify the load fails with an explicit error.

## 2. Build Session + Workspace Infrastructure
1. Add `AgentSessionContext` records tracking `agentId`, `capability`, `workspace`, `permissions`, and lifecycle status; store them alongside the existing session metadata (parent/child links).
2. Introduce `WorkspaceBinding` abstraction that can clone the current repo, attach to an existing worktree, or run read-only within the parent tree.
3. Update persistence so every spawned agent writes its own transcript file while the parent session only keeps a lightweight breadcrumb.
### Acceptance Criteria
- Session files persist `parentId`, `agentId`, capability, and workspace info.
- Workspace binding enforces read-only vs writable modes at tool-execution time.
- Parent transcripts show breadcrumbs while child transcripts are stored separately.
- **Manual Verification:** Run `/workspace readonly`, then trigger any `write`/`edit`/`bash` tool—expect the call to be blocked with a read-only error. Re-enable writes via `/workspace writable`. After spawning a child run, inspect `~/.config/yeet/sessions/<parent>.jsonl` and confirm only breadcrumbs were appended while the child’s transcript lives in its own file.

## 3. Implement AgentSpawner + Inbox
1. Create an `AgentSpawner` class that consumes spawn requests, resolves profiles, prepares workspaces, and launches `runAgent` with isolated message arrays.
2. Ensure `spawn` returns a handle exposing status, cancellation, and (for subtasks) an awaitable summary result.
3. Add an `AgentInbox` queue where spawned agents push status updates; the primary agent/UI can poll this to learn when children finish instead of being interrupted mid-task.
### Acceptance Criteria
- `AgentSpawner.spawn` launches agents with isolated context and honors permissions.
- Returned handles expose `status`, `cancel()`, and `awaitSummary()` (or equivalent).
- Inbox entries include session ID, status, and optional summaries for UI consumption.
- **Manual Verification:** Use `/oracle <prompt>` (or equivalent tool) to spawn a subagent; observe status transitions in logs/UI, cancel a run mid-flight, and confirm summaries land in the inbox after completion.

## 4. Wire Tooling and Invocation Surfaces
1. Add a `spawn_subagent` tool for agent-to-agent delegation; the tool payload includes `agentId`, `prompt`, and `returnMode` (blocking summary vs background).
2. Teach the slash-command layer to register per-agent UX hooks—`/oracle` or `/review` commands for some agents, hotkeys for others, but no global `/agent` abstraction yet.
3. Expose a watcher registration API so capability `watcher` profiles can subscribe to conversation events without blocking the main loop.
### Acceptance Criteria
- Tool schemas validated via zod; tool output wires into AgentSpawner.
- Slash commands can target specific agent configs without affecting others.
- Watcher API allows registering/unregistering listeners tied to profiles.
- **Manual Verification:** Trigger a command that launches a reviewer while another agent (pair programmer) is bound to a hotkey. Ensure each uses its correct UX path and the watcher can be toggled on/off without affecting command-driven subtasks.

## 5. Update UI and State Machines
1. Expand the UI adapter interface to support `setSubagentCount`, `showSubagentStatus`, and `openSubagentTranscript`.
2. Surface a minimal status ledger (e.g., `planner#3 running`, `reviewer#2 waiting`) in the TUI status bar plus an inbox panel for completed work.
3. Enhance the XState machine to treat blocking subagents as asynchronous actors: the main agent records the pending child, streams other work, and only consumes the summary when ready.
### Acceptance Criteria
- UI adapters (TUI + future surfaces) implement new methods without breaking existing behavior.
- Status ledger/inbox visible and updates when AgentInbox entries change.
- XState machine handles blocking subagents without deadlocks or context bloat.
- **Manual Verification:** With a running session, spawn multiple subtasks and verify the indicator counts increase/decrease, inbox items can be opened, and the main agent continues processing user input while waiting on child summaries.

## 6. Phase 1 Pilot: Oracle Subtask
1. Define an `oracle` profile (read-only, subtask + slash command) with a reflection prompt.
2. Allow both `/oracle <prompt>` and tool-triggered calls; verify transcripts remain separate and the parent receives only a concise summary.
3. Capture telemetry (duration, tool usage) to validate the infrastructure before adding more agents.
### Acceptance Criteria
- Oracle profile present by default with correct permissions.
- Invocations produce separate session files and concise parent summaries.
- Metrics/logs capture invocation count, duration, and failures.
- **Manual Verification:** Run `/oracle why is test failing` and confirm: (1) a new session file named `oracle-...` appears, (2) parent conversation shows only an oracle breadcrumb, (3) `~/.config/yeet/sessions` contains telemetry in the log or summary fields.

## 7. Phase 2: Reviewer Workflow
1. Create a `reviewer` profile (read-only, subtask) that can be spawned via a `request_review` tool or `/review` command.
2. When invoked, attach relevant diffs and session metadata, then route the reviewer’s completion into the inbox for the user to inspect/approve.
3. Provide a shortcut to “promote” reviewer findings into the main conversation when the user opens the transcript.
### Acceptance Criteria
- Reviewer tool wiring automatically attaches git diff context.
- Inbox entry includes reviewer summary plus link to transcript.
- Promotion flow inserts reviewer notes into main conversation with attribution.
- **Manual Verification:** Request a review on a branch with diffs; ensure reviewer inbox entry references the diff files and using the “promote” action copies its findings into the conversation.

## 8. Phase 3: Pair-Programmer Watcher
1. Configure a `pair-programmer` profile with both `watcher` and `subtask` capabilities.
2. As a watcher, let it observe the live conversation and raise interrupts only when high-risk drift occurs; add a hotkey to toggle its monitoring.
3. As a subtask, support `/pair <prompt>` so it can run focused explorations without cluttering the main log.
### Acceptance Criteria
- Watcher toggle starts/stops event stream without restarting the session.
- Interrupts include reason + suggested corrections and can be dismissed.
- Subtask mode generates separate transcripts and inbox entries like other agents.
- **Manual Verification:** Toggle the pair-programmer watcher via hotkey, intentionally go off-plan to trigger an interrupt, dismiss it, then invoke `/pair explore alt approach` and confirm it behaves like a normal subtask.

## 9. Phase 4: Roo-Style Orchestrator Agent
1. Create a dedicated `orchestrator` profile that can queue goals, plan across multiple agent profiles, and route work dynamically (e.g., spawn planner, oracle, reviewer, pair-programmer in sequence).
2. Implement an orchestration control plane that tracks subtask dependencies, ensures downstream agents inherit the right workspace/permissions, and updates the inbox/ledger with orchestration state.
3. Expose a `/orchestrate <goal>` entry point plus a tool hook so the main agent can delegate complex workflows (akin to Roo Code’s “manage crew” behavior). Reference implementations to study: `~/code/Roo-Code` (open-source) and `~/code/kilocode` (commercial fork).
### Acceptance Criteria
- Orchestrator can launch at least three child agents (planner, reviewer, builder) sequentially, propagating summaries + artifacts between them.
- UI shows an orchestration timeline distinct from simple subtasks, including outstanding/complete steps.
- Failure handling: if any child fails, orchestrator records the error and either retries or surfaces a consolidated failure summary to the user.
- **Manual Verification:** Run `/orchestrate implement login flow` and watch the orchestration timeline as it spawns planner → builder → reviewer. Force a failure (e.g., break the reviewer) and confirm the orchestrator records and surfaces the error rather than hanging silently.

## 10. Intent/Spec/Plan Workflow Agent
1. Build a planning agent that ingests a user task, seeds `n` research todos, and iteratively adds new todos as discoveries arise instead of front-loading all of them.
2. Require the agent to ask the user `k` clarifying questions, recording both questions and answers before proceeding.
3. Persist artifacts: save the original prompt plus Q&A to `docs/intent.md`, draft `docs/spec.md` describing the feature, and once the spec is approved, synthesize a step-by-step `docs/plan.md`.
### Acceptance Criteria
- Research todo list grows dynamically during execution; logs show when a new question/idea triggers additional todos.
- Clarifying question exchange happens interactively with exactly `k` questions before spec drafting begins.
- The three docs (`docs/intent.md`, `docs/spec.md`, `docs/plan.md`) are created/updated in the repo, reflecting the collected information in order.
- **Manual Verification:** Kick off the workflow with `/plan-feature "<goal>" n=3 k=2`, answer the clarifying questions, and inspect the generated files to ensure intent → spec → plan stages are captured.

## 11. Multi-Session + Full Builder Agents
1. Implement “primary” spawns that launch completely separate sessions (tmux-style) via the spawner, optionally in a different git worktree.
2. Provide a UI switcher to jump between the main agent and any top-level children, reusing the inbox to highlight unread updates.
3. Enforce workspace policies so only explicitly permitted agents (e.g., `builder`) get write access in alternate worktrees.
### Acceptance Criteria
- Primary spawns appear in session list and can be resumed independently.
- UI switcher accurately indicates unread updates/inbox items per session.
- Workspace enforcement prevents non-builder agents from writing to custom worktrees.
- **Manual Verification:** Launch a new primary session in a different git worktree, switch back and forth using the tmux-style UI, and attempt to write from a non-builder agent in that worktree (should fail).

## 12. Testing, Rollout, and Docs
1. Add unit tests for the registry, spawner, inbox, and watcher bridge; record integration smoke tests that spawn oracle/reviewer agents end-to-end.
2. Document configuration examples (`agents.oracle`, `agents.reviewer`, etc.) and usage patterns (slash commands, hotkeys, inbox flow).
3. Gate the feature behind a config flag initially, gather feedback, then enable by default once Stability + UI polish are confirmed.
### Acceptance Criteria
- Automated tests cover success + failure cases for each core component.
- Docs include config snippets and workflow guides verified against the implementation.
- Feature flag toggles entire subsystem; defaults to off until signed off, then on by default with migration instructions.
- **Manual Verification:** Flip the feature flag off/on, run the documented smoke tests (oracle/reviewer spawn scripts), and confirm behavior matches the documentation before enabling by default.
