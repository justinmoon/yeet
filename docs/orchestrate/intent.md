- I dislike the current subagent plan/spec; they feel fuzzy and over-abstracted (e.g., undefined “inbox”).
- Main features I want: (1) one-off helpers like oracle/explore for planning/debugging/loading context; (2) back-and-forth coder ↔ reviewer flow; (3) pair programmer watcher that interrupts when I’m off-track.
- Questioning whether “agent profiles” abstraction is needed; prefer minimal descriptors if any.
- Clarify “each spawned agent gets its own transcript file” — what does that mean in practice?
- Prefer using the command palette for everything; no slash commands.
- Sessions: want to know if they’re resumable and how parent/child relationships are stored in ~/.config/yeet/sessions.
- Coder/reviewer might be better as a mode in the main coding session rather than separate subagents. Coder has a tool to “complete plan task/submit for review” to hand off to the reviewer; reviewer has “submit review” and “message user” tools. Need guardrails so they don’t loop forever or stalemate without surfacing.
- No orchestrator; agents pass the baton among themselves via tool calls. Event loop can switch active agent based on these calls.
- Pair programmer is concurrent, read-only, listens on an event bus of conversation/events, and only surfaces when it calls an “interrupt” tool. Want to be able to toggle/inspect its activity and any read-only probes it runs while deciding to interrupt.
- UI desires: coder/reviewer messages inline in main convo with clear attribution; pair programmer only shows up on interrupts, but provide a console/drawer/split view to watch its thinking. Multi-coder agents in different git worktrees should belong to the same session with UI options: side-by-side columns or hotkey/tab switcher with unread badges.
- Also want the ability to spawn two coding agents in separate worktrees concurrently; they share the session context but have distinct workspaces/views.
- Need a way to stop reviewer/coder ping-pong: time/baton-swap limits or a “stalemate” outcome; reviewer can message the user if stuck.
- Preference updates: keep plan frontmatter minimal (current step only; no heavy step arrays); rename tools (`request_review`, `request_changes`); states should be `coder_active`, `reviewer_active`, `awaiting_user_input`, `error`; don’t hard-enforce CI/acceptance commands—just encourage. Desire an eventual “explain this” agent after final approval with dedicated UI. Agent/tool prefixes should be concise (e.g., `[coder:tool]`, `[reviewer:tool]`).
- Prefer to avoid “baton” terminology in code.

Coder ↔ Reviewer clarifying questions (with answers)
- Q1: What exactly triggers handoff to reviewer and back—manual command, tool call, automatic milestones?  
  A: State machine with nodes (coder coding, reviewer reviewing, waiting for user, error). Edges: coder→reviewer via “I finished implementing” tool; reviewer→coder via “here is code review.” Context like “current plan step” lives outside core state (e.g., plan.md). We may later add a lightweight orchestrator to decide the next agent and inject tool calls/system prompt; tracking plan steps in markdown is awkward compared to a DB.
- Q2: What context must always go to reviewer?  
  A: Minimal: system prompt says they’re a reviewer for docs/<feature>/plan.md step n; look at spec.md + intent.md; look for regressions on prior steps and risks for future steps. They’re a multi-turn agent; initial prompt + filesystem access are enough.
- Q3: What outputs do we need from reviewer, and how are they shown?  
  A: Tool calls: `request_change(text specifying fixes needed for approval)`, `approve()`, plus `message_user` for clarifying questions. UI should show which agent is active (e.g., in nav); otherwise show like past tool-call flows.
- Q4: Stop conditions to prevent infinite loops?  
  A: If reviewer requests changes for the same step a 4th time, halt and wait for user input.
- Q5: Tool permissions differences?  
  A: Same overall permissions, but reviewer cannot edit code (ideally touches no filesystem). Need to decide who marks the step “done” and where that state is tracked.

Next clarifying questions (pending answers)
- Q6: Where is the source of truth for plan step state (in plan.md, separate JSON/DB, in-memory context), and who updates it—coder, reviewer, or the harness on tool calls?
- Q7: When reviewer approves a step, how should the coder’s context reset—fresh prompt seeded with next step only, or cumulative history? Do we truncate past turns or just prepend a new system message?
- Q8: What artifacts/tests should the reviewer run or rely on—are they allowed to run read-only tests, gather diffs, or are they limited to code inspection only?
- Q9: How should user interventions work mid-loop (e.g., user messages during review, or overrides the 4-request-change halt)? Should user input immediately grab the baton or be queued for the current agent?
- Q10: In multi-worktree/multi-coder scenarios, does a single reviewer cover all worktrees, or does each coder get its own reviewer? How is handoff tied to a specific workspace?

Answers (latest round)
- Q6: Open question.
- Q7: Reset the agent’s LLM context on step approval; system prompt should state the current step. UI should still show full history.
- Q8: Reviewer can run whatever they want; they should run `just pre-merge` (project CI) and per-step acceptance criteria from plan.md. Plan steps can include manual acceptance items (e.g., Yubikey); reviewer should use “ask user” tool in that case.
- Q9: Open; user likely needs a command-palette action to pass the baton manually.
- Q10: Future goal: multiple coders in multiple worktrees with multiple reviewers who debate/agree on outcomes. Not needed now, but informs design.

New clarifying questions (pending answers)
- Q11: How should we represent plan steps and their acceptance criteria so the system can tell which step is active (structured block in plan.md, frontmatter, separate manifest)?
- Q12: What exactly should the “ask user/message user” flow look like in the UI (modal, inline message with buttons), and should it pause the state machine until answered?
- Q13: When the coder signals “finished implementing,” should we automatically snapshot diff/tests and attach them to the reviewer’s starting context, or let reviewer gather context on demand?

Answers (latest)
- Q11: Open question.
- Q12: Show as a message `[agent] <text>` that waits for user response; better prefixes like `[coder]`, `[reviewer]`, and tool calls like `[coder:bash]` to identify the agent.
- Q13: Keep it simple; reviewer gathers needed context on demand. We can refine later after usage.
