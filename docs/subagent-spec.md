# Subagent System Specification

## Goals
- Allow Yeet to run multiple agent personas (primary, subtask, watcher, orchestrator) without polluting the main conversation context.
- Support both manual launches (slash commands, hotkeys) and automatic delegation via tools.
- Keep each agent's transcript, workspace, and permissions isolated while exposing concise summaries/breadcrumbs to the parent UI.
- Provide the foundation for advanced workflows such as reviewer automation, pair-programmer watchers, or a Roo-style orchestrator.

## Core Concepts
1. **Agent Profiles** (`Config.agents`)
   - Define prompt/model/tool configuration plus capability flags (`primary`, `subtask`, `watcher`, `orchestrator`).
   - Stored inline or as `~/.config/yeet/agents/*.json`, merged field-by-field.
   - Tool permissions/Workspace policies enforce read-only vs writable behavior.

2. **Workspace Bindings**
   - `WorkspaceBinding` describes cwd, isolation mode (`shared | sandbox | custom`), and `allowWrites`.
   - Calculated per spawn via profile policy + overrides; write tools call `ensureWorkspaceWriteAccess`.

3. **Agent Sessions**
   - `AgentSessionContext` tracks `agentId`, capability, workspace, permissions, trigger, parent/child IDs, status timestamps.
   - Persisted via `src/sessions.ts` with new fields plus `SessionBreadcrumb[]` summarizing subtask/watcher output.
   - Parent sessions only store breadcrumbs; child transcripts live in their own session files.

4. **Spawner + Inbox (future steps)**
   - `AgentSpawner.spawn` resolves a profile, creates a session, sets workspace binding, and streams `runAgent`.
   - `AgentInbox` collects status updates so UI/main agent can poll rather than being interrupted mid-task.
   - Blocking subtasks return summaries; non-blocking watchers push notifications/interrupts.

5. **Invocation Surfaces**
   - Tools: `spawn_subagent` (blocking), `request_review`, etc., call the spawner with structured payloads.
   - Slash commands/hotkeys: each agent profile registers whichever triggers make sense (e.g., `/oracle`, `/pair`, `Ctrl+Shift+P`).
   - Watcher bridge: streams conversation deltas to watcher profiles and routes interjections back to the inbox/UI.

6. **UI Integration**
   - Status ledger displays active sessions (`oracle#4 running`, `pair#2 watching`).
   - Inbox panel lists completed subtasks/reviews plus orchestrator events.
   - Session switcher (future multi-session step) lets user jump into top-level primary runs.

## Agent Archetypes
1. **Oracle (subtask + slash command)**
   - Read-only workspace.
   - Provides planning/help summaries; invoked via `/oracle` or tool when main agent is stuck.

2. **Reviewer (subtask)**
   - Read-only; receives diff context.
   - Can be launched via `/review` or `request_review` tool; results arrive in inbox with link to transcript.

3. **Pair Programmer (watcher + subtask)**
   - Watcher mode monitors drift, can interject; toggle via hotkey.
   - Subtask mode runs exploratory work when invoked manually.

4. **Roo-Style Orchestrator (orchestrator + subtask)**
   - Manages a queue of goals, spawns other agent profiles (planner, reviewer, builder).
   - Maintains dependency graph and passes summaries/artifacts downstream.
   - Offers `/orchestrate <goal>` and a tool hook so the main agent can delegate large workflows.
   - Tracks progress/EQ: e.g., `plan → implement → review`, each step represented as a child session/breadcrumb.

5. **State machine enforcer**
  - I want to be able to tell the coding agent that basically "you are only able to quit if you call some tool call ... otherwise you must keep working ... ie 'message user / ask for help' or 'submit for review' or 'llm unreachable'"
  - perhaps we could just enforce this directly in code

## Data Flow Example (Orchestrator)
1. User runs `/orchestrate build login page`.
2. Spawner creates `orchestrator` session (primary/subtask hybrid) with its own workspace binding.
3. Orchestrator agent plans steps and uses `spawn_subagent` tool to launch:
   - `planner` subtask → produces timeline summary.
   - `builder` subtask (maybe read-write, custom worktree) → commits code.
   - `reviewer` subtask → verifies changes.
4. Each child posts status to the inbox; orchestrator aggregates and emits a final breadcrumb once the workflow completes.

## Open Questions
- **Resource limits**: enforce max concurrent child sessions? queueing strategy?
- **Workspace provisioning**: when to auto-create git worktrees vs reuse? do we snapshot state per subtask?
- **Watcher interruptions**: how to prioritize vs inbox? Should severe warnings preempt the main agent?
- **Security**: need additional sandboxing for orchestrator-launched builders?
- **Telemetry**: what metrics/logs should be captured to debug orchestration flows?

This spec should guide the remaining implementation steps: session storage, spawner/inbox, tooling, UI changes, and the four reference agents (oracle, reviewer, pair-programmer, orchestrator). Update as design decisions evolve.
