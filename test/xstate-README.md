# XState Agent Loop E2E Tests

Comprehensive end-to-end tests for the XState-based agent runtime.

## Overview

The `xstate-agent-loop.test.ts` file contains thorough tests that verify:

1. **Complete State Machine Flow**
   - State transitions: `idle` → `thinking` → `executingTool` → `capturingSnapshot` → back to `thinking`
   - Control flow with `complete`, `clarify`, `pause` tools
   - Error handling and recovery

2. **Filesystem Snapshots**
   - Git tree hash capture after each file-modifying tool
   - Snapshot restoration (time-travel to any historical state)
   - Automatic deduplication via git's content-addressable storage

3. **Tool Execution**
   - All tools properly invoked (write, bash, read, etc.)
   - Tool history matches actual calls
   - Results properly captured in context

4. **Real LLM Integration**
   - No mocks - uses actual OpenCode Zen or Maple API
   - Tests with grok-code model by default
   - Can be configured to use any model

## Running the Tests

### Prerequisites

1. **Config file** at `~/.yeet/config.json` with OpenCode API key:
   ```json
   {
     "opencode": {
       "apiKey": "your-key-here",
       "baseURL": "https://opencode.ai/zen/v1",
       "model": "grok-code"
     },
     "maxSteps": 20,
     "temperature": 0.5,
     "activeProvider": "opencode"
   }
   ```

2. **Git installed** - used for filesystem snapshots

### Run All Tests

```bash
bun test test/xstate-agent-loop.test.ts
```

### Run Specific Test

```bash
# Just the main fizzbuzz test
bun test test/xstate-agent-loop.test.ts -t "FizzBuzz with Complete"

# Just the invariants test
bun test test/xstate-agent-loop.test.ts -t "State Machine Invariants"
```

## Test Structure

### Test 1: FizzBuzz E2E
**What it does:**
- Creates isolated git repo in `/tmp`
- Initializes XState actor with filesystem snapshot
- Sends task: "Write fizzbuzz.ts and execute it, then call complete"
- Waits for agent to finish (up to 3 minutes timeout)
- Validates:
  - State transitions occurred correctly
  - Write tool created the file
  - Bash tool executed the program
  - Complete tool was called
  - Output matches expected fizzbuzz (1-15)
  - Snapshots were captured
  - Can restore to any snapshot
  - Tool history is complete

**Expected output:**
```
=================================================================
🧪 XState Agent Loop E2E Test
=================================================================

📁 Test directory: /tmp/xstate-agent-test-1234567890
🔧 Initializing git repository...
✅ Git repository initialized with initial commit
📸 Initial snapshot: 3f2a1b4c...

🤖 Using opencode: grok-code

🎬 Creating XState actor...

📤 Task: Write a TypeScript file at /tmp/.../fizzbuzz.ts...

⏳ Waiting for agent to complete...

🔄 State: thinking
   Response: I'll write a fizzbuzz program...

🔄 State: executingTool
   🔧 Tool: write
   📦 Args: { path: "/tmp/.../fizzbuzz.ts", ... }

🔄 State: capturingSnapshot
   📸 Snapshot: 8a7b5c3d...

...

✅ Agent finished

📊 Test Results:
1️⃣  State Transitions: idle → thinking → executingTool → capturingSnapshot
2️⃣  Tool Calls: write: 1x, bash: 1x, complete: 1x
3️⃣  Conversation: 2 messages
4️⃣  Snapshots: 2 total
5️⃣  Tool History: [detailed logs]

🔍 Running Assertions:
  ✅ Machine went through expected states
  ✅ Write tool called to create fizzbuzz file
  ✅ Bash tool executed fizzbuzz program
  ✅ Agent called complete with summary
  ✅ FizzBuzz output matches expected
  ✅ Captured 2 snapshots
  ✅ 2 unique filesystem states
  ✅ File exists: /tmp/.../fizzbuzz.ts
  ✅ Successfully restored snapshots
  ✅ Conversation history properly tracked
  ✅ Tool history has N entries

=================================================================
🎉 ALL TESTS PASSED!
=================================================================
```

### Test 2: State Machine Invariants
**What it does:**
- Tests fundamental properties that should always hold:
  - Machine starts and ends in `idle` state
  - No concurrent active operations
  - Every tool call has a corresponding result
  - Snapshot timestamps are monotonically increasing
  - Current snapshot exists in history

**Purpose:** Catch state machine logic errors

## Debugging Failed Tests

### Agent Doesn't Call Complete Tool

**Symptom:** Test fails with "expected true to be false"
**Fix:** Adjust system prompt in `src/agent.ts` to emphasize complete tool

### Wrong FizzBuzz Output

**Symptom:** Output doesn't match expected
**Check:** Look at console logs showing actual output
**Debug:** Agent might have written JavaScript instead of TypeScript, or wrong number range

### Timeout

**Symptom:** Test fails after 3 minutes
**Causes:**
- LLM is slow (try different model)
- Agent is stuck in loop (check logs for repeated tool calls)
- Network issues

**Fix:**
```typescript
// Increase timeout in test
TEST_TIMEOUT = 300_000; // 5 minutes
```

### Snapshot Capture Fails

**Symptom:** "Cannot read tree hash"
**Cause:** Git repo not initialized properly
**Fix:** Check that initial commit exists before starting actor

## Extending the Tests

### Add New Task

```typescript
test("XState Agent Loop - New Task", async () => {
  // ... setup git repo and snapshot ...
  
  const actor = createActor(agentMachine, { input: { ... } });
  actor.start();
  
  actor.send({
    type: "USER_MESSAGE",
    content: "Your new task here. Call complete when done.",
  });
  
  await waitFor(actor, state => state.value === "idle");
  
  // ... assertions ...
});
```

### Test Clarify Tool

```typescript
// In task: ask ambiguous question
const task = "Write a file (but don't say what kind). Call clarify if you need info.";

// Check that agent called clarify
const clarifyCalls = toolCalls.filter(t => t.name === "clarify");
expect(clarifyCalls.length).toBeGreaterThan(0);
```

### Test Pause Tool

```typescript
// Send task that might be hard
const task = "Solve P=NP. Call pause if you get stuck.";

// Agent should pause instead of failing
const finalState = await waitFor(actor, state => state.value === "paused");
expect(finalState.value).toBe("paused");
```

## Configuration

### Use Different Model

Edit `~/.yeet/config.json`:
```json
{
  "opencode": {
    "model": "qwen3-coder"  // or "claude-sonnet-4", etc.
  }
}
```

### Adjust Max Steps

```json
{
  "maxSteps": 30  // allow more iterations
}
```

### Use Maple AI Instead

```json
{
  "activeProvider": "maple",
  "maple": {
    "apiKey": "your-maple-key",
    "apiUrl": "https://enclave.trymaple.ai",
    "model": "mistral-small-3-1-24b",
    "pcr0Values": [...]
  }
}
```

## Performance Notes

- **Initial run:** ~30-60 seconds (LLM inference + tool execution)
- **Git operations:** <1ms per snapshot (very fast)
- **State transitions:** Instant
- **Bottleneck:** LLM API calls

## CI/CD Integration

To run in CI:

1. Set `OPENCODE_API_KEY` environment variable
2. Run: `bun test test/xstate-agent-loop.test.ts`
3. Tests create/cleanup temp directories automatically

Example GitHub Actions:
```yaml
- name: Run XState E2E Tests
  env:
    OPENCODE_API_KEY: ${{ secrets.OPENCODE_API_KEY }}
  run: bun test test/xstate-agent-loop.test.ts
  timeout-minutes: 5
```
