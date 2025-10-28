# Agent / AI SDK Boundary

## The Problem

We have a **fundamental architectural conflict**:

### Vercel AI SDK's Model (what it wants to do)
```
User Message → LLM
           ↓
       Tool Call
           ↓ (SDK executes)
       Tool Result
           ↓ (SDK feeds back to LLM)
       LLM continues
           ↓
       Repeat (maxSteps times)
           ↓
       Done
```

### Our XState Model (what we're trying to do)
```
User Message → running.thinking (invoke agent)
                    ↓ TOOL_CALL event
               running.executingTool (XState executes)
                    ↓ Tool result
               running.thinking (agent continues?)
                    ↓
               Done
```

## Current Broken State

**We're doing both and neither:**
1. AI SDK invoked with `maxSteps: 20` - it WANTS to handle tools
2. XState intercepts `TOOL_CALL` events - we TAKE control
3. XState executes tools in separate actor
4. Tool results added to `context.messages`
5. **BUG**: Already-running `streamAgent` doesn't see updated messages!
6. Agent either:
   - Calls `complete` prematurely (doesn't know tool succeeded)
   - Loops calling same tool (doesn't see result)

## The Boundary Decision

We must choose ONE of these approaches:

### Option A: AI SDK Owns Tools (Simple, Less Control)

**Let SDK handle everything:**
```typescript
// In agent.ts - SDK does the full loop
const result = await streamText({
  model: provider(modelName),
  system: SYSTEM_PROMPT,
  messages,
  tools: toolSet,
  maxSteps: 20,  // SDK handles tool loop
  temperature: 0.3,
});

// Just stream everything SDK does
for await (const chunk of result.fullStream) {
  yield chunk; // Pass through
}
```

**XState machine becomes:**
```typescript
states: {
  idle: { on: { USER_MESSAGE: "executing" } },
  executing: {
    invoke: {
      src: "streamAgent", // Runs until complete
      onDone: "idle"
    }
  }
}
```

**Pros:**
- SDK handles tool execution loop correctly
- Simple state machine
- Works out of the box

**Cons:**
- Tool execution hidden inside SDK
- Can't represent tools as XState states
- No custom retry logic per tool
- No human-in-the-loop approval
- No tool execution visibility in state graph

### Option B: XState Owns Tools (Complex, Full Control) ⭐ RECOMMENDED

**SDK executes ONE step, XState manages loop:**

```typescript
// In agent.ts - ONE step only
const result = await streamText({
  model: provider(modelName),
  system: SYSTEM_PROMPT,
  messages,
  tools: toolSet,
  maxSteps: 1,  // ⚠️ CRITICAL: Only one tool call
  temperature: 0.3,
});
```

**Key changes needed:**
1. **maxSteps: 1** - SDK stops after first tool call
2. **Re-invoke agent** after each tool execution with updated messages
3. **XState controls the loop**

**State machine flow:**
```typescript
states: {
  idle: {
    on: { USER_MESSAGE: "running" }
  },
  
  running: {
    initial: "thinking",
    states: {
      thinking: {
        // Invoke agent with current messages
        invoke: {
          src: "streamAgent",
          input: ({ context }) => ({
            messages: context.messages, // Includes tool results!
          }),
          onDone: "thinking", // ⚠️ Re-invoke after tool execution
        },
        on: {
          TOOL_CALL: {
            target: "executingTool",
            actions: "recordToolCall"
          },
          AGENT_DONE: "#agent.idle",
        }
      },
      
      executingTool: {
        invoke: {
          src: "executeTool",
          onDone: {
            target: "thinking", // ⚠️ Goes back, re-invokes agent
            actions: "recordToolSuccess"
          }
        }
      }
    }
  }
}
```

**Pros:**
- Tool execution visible in state graph
- Can add custom retry logic
- Can add human-in-the-loop
- Full observability
- Can interrupt/pause between tools

**Cons:**
- More complex state machine
- More invocations = more overhead
- Need to manage message history carefully

## Current Implementation Status

❌ **BROKEN**: We're using Option B's state machine but with SDK's `maxSteps: 20`

The agent is invoked ONCE and never sees tool results we add to messages.

## Recommended Fix

**Commit to Option B with these changes:**

1. **agent.ts**: Set `maxSteps: 1`
2. **agent-machine.ts**: Keep current structure, it's correct!
3. **Accept**: Agent will be re-invoked after each tool
4. **Benefit**: Tool execution as XState states enables:
   - Human approval for risky commands
   - Custom retry logic per tool type
   - Tool execution timeout controls
   - Parallel tool execution (future)
   - Visual workflow with tools as nodes

## Why Option B is Better for Our Use Case

Our goal is **multi-agent workflows with visibility and control**:
- ✅ Want to see "Agent A → write file → Agent B → review file"
- ✅ Want gauntlet workflows with multiple review steps
- ✅ Want to pause and inspect between tools
- ✅ Want to visualize in React Flow with tool nodes
- ✅ Want different agents with different tool permissions

Option A hides all this inside the SDK black box.

## Implementation Notes

### Message History Growth
With Option B, `context.messages` grows:
```
1. User: "create fizzbuzz"
2. Assistant: "I'll create it..."
3. User: "Tool write succeeded. Result: {...}"
4. Assistant: "Now I'll run it..."
5. User: "Tool bash succeeded. Result: {...}"
6. Assistant: "Done!"
```

This is correct! Each tool result becomes a user message that the agent sees.

### Token Cost
Re-invoking means:
- More API calls
- Messages grow with each tool
- But manageable - most tasks < 10 tools

### Alternative: Streaming Tool Results
Could we feed tool results into the SDK's running stream? 
- Not easily with current SDK API
- Would require custom SDK fork
- Option B is cleaner
