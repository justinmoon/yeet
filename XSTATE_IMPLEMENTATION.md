# XState Agent Loop Implementation

Complete implementation of XState-based agent runtime with filesystem snapshots.

## Overview

This is a **tool-level granular** state machine for agent execution. Every tool call is a state transition, giving full visibility into agent behavior.

## Architecture

```
User Message
    ↓
  [idle]
    ↓
[thinking] ←──────────┐
    ↓                  │
    ├─ TEXT_DELTA ────┤  (accumulate response)
    ├─ TOOL_CALL ─────→ [executingTool]
    ├─ AGENT_DONE ────→ [idle]
    ├─ AGENT_PAUSED ──→ [paused]
    └─ AGENT_CLARIFICATION → [awaitingClarification]
             ↓
    [executingTool]
             ↓
    ┌────────┴─────────┐
    │ file-modifying?  │
    └────────┬─────────┘
         YES │  NO
             │   └──────→ [thinking]
             ↓
  [capturingSnapshot]
             ↓
       (save git tree)
             ↓
       [thinking]
```

## Key Components

### 1. FilesystemSnapshot (`src/filesystem-snapshot.ts`)

Uses **git tree objects** for efficient state storage:
- Each snapshot = one tree hash (SHA-1)
- Git automatically dedupes identical files
- No commits needed - just raw objects in `.git/objects/`
- Can restore to any snapshot instantly

```typescript
const snapshot = new FilesystemSnapshot("/path/to/project");

// Capture current state
const snap1 = await snapshot.capture("After write");
// snap1.treeHash = "3f2a1b4c..."

// Make changes...

// Capture again
const snap2 = await snapshot.capture("After edit");  
// snap2.treeHash = "8a7b5c3d..." (different!)

// Jump back in time
await snapshot.restore(snap1);
```

### 2. Agent Machine (`src/agent-machine.ts`)

XState v5 machine with:
- **Context:** Tracks everything (messages, snapshots, tools, state)
- **Actors:** `streamAgent` (event stream from LLM), `executeTool` (executes and returns result)
- **Guards:** Check if tool modifies files, max steps reached
- **Actions:** Update context (assign messages, snapshots, tool history)

**Context structure:**
```typescript
{
  // Filesystem
  currentSnapshot: SnapshotMetadata,
  snapshotHistory: SnapshotMetadata[],
  
  // Conversation  
  messages: Message[],
  currentResponse: string,
  
  // Tools
  pendingToolCall?: ToolCall,
  toolHistory: Array<{ call, result }>,
  
  // State
  currentStep: number,
  maxSteps: number,
  workingDirectory: string
}
```

### 3. Agent Actor (`src/agent-actor.ts`)

Bridges the streaming agent (`runAgent`) to XState events:

```typescript
for await (const event of runAgent(messages, config)) {
  switch (event.type) {
    case "text": 
      yield { type: "TEXT_DELTA", text: event.content };
    case "tool":
      if (event.name === "complete") {
        yield { type: "AGENT_DONE" };
      } else {
        yield { type: "TOOL_CALL", toolCall: {...} };
      }
    // ...
  }
}
```

### 4. Control Flow Tools (`src/tools/control.ts`)

Three new tools for workflow management:

- **`complete`**: Agent signals task is done
  ```typescript
  complete({ summary: "Created fizzbuzz.ts and verified output" })
  ```

- **`clarify`**: Agent needs user input
  ```typescript
  clarify({ question: "Should I use TypeScript or JavaScript?" })
  ```

- **`pause`**: Agent wants to stop and review
  ```typescript
  pause({ reason: "Hit rate limit, waiting before retry" })
  ```

**System prompt enforces:** Agent MUST end with one of these tools (no silent stops).

### 5. Tool Executor (`src/tool-executor.ts`)

Executes tools and returns results:
```typescript
const result = await executeTool(toolCall, workingDir);
// result.result contains the tool output
// result.snapshot (optional) if file was modified
```

## Usage

```typescript
import { createActor, waitFor } from "xstate";
import { agentMachine } from "./agent-machine";
import { FilesystemSnapshot } from "./filesystem-snapshot";

// Setup
const snapshot = new FilesystemSnapshot(process.cwd());
const initialSnap = await snapshot.capture("Initial");

// Create actor
const actor = createActor(agentMachine, {
  input: {
    currentSnapshot: initialSnap,
    snapshotHistory: [initialSnap],
    messages: [],
    currentResponse: "",
    toolHistory: [],
    currentStep: 0,
    maxSteps: 10,
    workingDirectory: process.cwd(),
  },
});

// Subscribe to state changes
actor.subscribe((state) => {
  console.log("State:", state.value);
  console.log("Snapshot:", state.context.currentSnapshot.treeHash);
});

// Start and send task
actor.start();
actor.send({
  type: "USER_MESSAGE",
  content: "Write a fizzbuzz program and run it. Call complete when done.",
});

// Wait for completion
await waitFor(actor, state => state.value === "idle");

// Access final state
const context = actor.getSnapshot().context;
console.log("Messages:", context.messages.length);
console.log("Tools used:", context.toolHistory.map(t => t.call.name));
console.log("Snapshots:", context.snapshotHistory.length);
```

## Design Decisions

### Why Tool-Level Granularity?

**Alternatives considered:**
1. **Session-level** - agent as black box, one transition per run
2. **Token-level** - every token is a state (too fine)

**Chose tool-level because:**
- Full visibility into agent actions
- Can implement custom logic between tools (approval gates, rate limiting)
- Easy to debug - see exactly where agent got stuck
- Natural for React Flow visualization (each node = one tool call)

### Why Git Object Store?

**Alternatives considered:**
1. **Full snapshots** - `{path: content}` map (memory intensive)
2. **Operation log** - store every edit operation (complex replay)
3. **CRDT** - full DeltaDB-style (overkill for turn-by-turn)

**Chose git objects because:**
- Efficient storage (git's packfiles, automatic dedup)
- Can diff any two states instantly
- Works with existing git tools
- No commit spam in history
- Natural path to final PR
- Fast - git is heavily optimized

### Why Control Flow Tools?

**Problem:** Agents often stop silently when stuck, making it hard to know if they're done or paused.

**Solution:** Explicit control flow tools:
- **complete**: "I'm done, here's what I did"
- **clarify**: "I need more info from you"  
- **pause**: "I'm stuck/economizing tokens, need guidance"

System prompt enforces calling one of these. No more ambiguous stops.

## Testing

Comprehensive e2e test in `test/xstate-agent-loop.test.ts`:

**Test 1: FizzBuzz with Complete Tool**
- Real LLM (no mocks)
- Full workflow: write → execute → complete
- Validates state transitions, snapshots, tool history
- Checks output correctness
- ~60 seconds

**Test 2: State Machine Invariants**
- Verifies fundamental properties always hold
- Concurrency, pairing, monotonicity

Run: `bun test test/xstate-agent-loop.test.ts`

See: `test/xstate-README.md` for details

## Comparison: Original vs XState

| Aspect | Original Yeet | XState Version |
|--------|---------------|----------------|
| Agent loop | Implicit (generator) | Explicit (state machine) |
| State visibility | Opaque | Full transparency |
| Tool calls | Streamed events | State transitions |
| Filesystem | Not tracked | Git tree snapshots |
| History | Messages only | Messages + tools + snapshots |
| Control flow | Implicit | Explicit (complete/clarify/pause) |
| Time-travel | No | Yes (restore any snapshot) |
| Debuggability | Logs | State machine + snapshots + history |

## Benefits

1. **Full Observability**
   - See every state transition
   - Track exact filesystem state at each step
   - Complete tool history with results

2. **Time-Travel Debugging**
   - Jump to any historical state
   - Compare filesystem across states
   - Replay from any point

3. **Explicit Control Flow**
   - No ambiguous stops
   - Clear completion signals
   - Pauseable for human review

4. **Foundation for Multi-Agent**
   - Easy to add parallel states (multiple agents)
   - Can model review/approval workflows
   - Supports complex orchestration patterns

5. **Efficient Storage**
   - Git deduplication = minimal overhead
   - Can store hundreds of snapshots cheaply
   - Fast restoration (<1ms)

## Next Steps

### Immediate
- [x] Implement core state machine
- [x] Add filesystem snapshots
- [x] Create control flow tools
- [x] Write comprehensive e2e test

### Near-term
- [ ] Add TUI showing current state
- [ ] Visualize state transitions in console
- [ ] Support multi-turn clarification dialogs
- [ ] Add snapshot diffing in context

### Future
- [ ] React Flow visualizer for state history
- [ ] Multi-agent workflows (parallel racing)
- [ ] Review gauntlet patterns
- [ ] Debate/argumentation workflows
- [ ] Integration with ~/code/asmr for complex orchestration

## Files

```
src/
  agent-machine.ts          # XState machine definition
  agent-actor.ts            # Bridge agent stream → XState events
  filesystem-snapshot.ts    # Git tree hash snapshots
  tool-executor.ts          # Execute tools, return results
  tools/control.ts          # complete, clarify, pause tools
  index-xstate.ts           # Example usage

test/
  xstate-agent-loop.test.ts # Comprehensive e2e tests
  xstate-README.md          # Test documentation
```

## Resources

- [XState v5 Docs](https://stately.ai/docs/xstate)
- [isomorphic-git API](https://isomorphic-git.org/)
- [Git Internals](https://git-scm.com/book/en/v2/Git-Internals-Git-Objects)
- Design discussion: `~/code/asmr/docs/ideas.md`
