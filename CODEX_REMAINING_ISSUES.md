# Codex Remaining Issues

## Status

✅ **Text generation works**
❌ **Tool calling fundamentally incompatible with AI SDK**

## The Problem

The AI SDK's conversation history management is incompatible with Codex's stateless (`store: false`) Responses API.

### Root Cause

When tool calls are made:

**Request 1** (user asks to run bash):
```json
{ "input": [developer_msg, user_msg], "tools": [...], "store": false }
```

**Response 1** (Codex calls bash tool):
- Codex makes function call with ID `call_XXX`
- Tool executes locally ✅

**Request 2** (send tool result back):
AI SDK builds input array:
```json
{
  "input": [
    developer_msg,
    user_msg,
    {"type": "item_reference", "id": "rs_..."},  // Reference to Codex's response
    {"type": "item_reference", "id": "fc_..."},  // Reference to function call
    {"type": "function_call_output", "call_id": "call_XXX", "output": "..."}
  ],
  "store": false
}
```

**The catch-22:**
- `item_reference` requires `store: true` to resolve
- Codex requires `store: false`
- If we filter out `item_reference`, the `function_call_output` is orphaned
- Codex errors: "No tool call found for function call output with call_id call_XXX"

### Why AI SDK Uses item_reference

The AI SDK's `@ai-sdk/openai` provider builds conversation history using `item_reference` to avoid duplicating content. It expects the server to have stored previous responses when `store: true`.

But Codex (ChatGPT backend) **requires** `store: false`.

## Evidence from Tests

```bash
$ bun test test/openai-e2e.test.ts

✅ Test 1: Simple text generation - PASSED
   Text received: "Hello!"

❌ Test 2: Tool call with bash - FAILED
   - Tool executed: ✅ (bash was called, got result)
   - Result sent back: ❌ (ID mismatch error)
   Error: "No tool call found for function call output with call_id call_SU9uFNnkzUwOl6NG1rmpLlOb."
```

## Root Cause

The AI SDK's `@ai-sdk/openai` provider:
1. Sends requests in Responses format (✅ works)
2. Receives SSE responses (✅ works for text)
3. **Fails to properly parse/track tool call IDs from Responses SSE** (❌)
4. **Sends tool results in wrong format or with wrong IDs** (❌)

## Solution Options

### Option 1: Build Custom Conversation Manager (OpenCode approach)

Don't use AI SDK's conversation history. Build our own like opencode-openai-codex-auth:
- Manually construct `input` array with actual `function_call` objects
- Parse Responses SSE to extract function calls
- Store function call content locally
- Include actual calls (not references) in next request

**How opencode does it:**
```typescript
// Request with tool result
{
  "input": [
    developer_msg,
    user_msg,
    {"type": "function_call", "name": "bash", "arguments": "{...}"},  // Actual call!
    {"type": "function_call_output", "call_id": "call_XXX", "output": "..."}
  ],
  "include": ["reasoning.encrypted_content"],
  "store": false
}
```

**Pros:**
- Proven to work (opencode-openai-codex-auth does this)
- Full control over conversation history
- Stateless operation

**Cons:**
- Can't use AI SDK's `streamText()` - need custom implementation
- Must manually parse SSE responses
- Must manually track conversation state
- Significant refactoring required
- 500+ lines of code

### Option 2: Fork/Patch AI SDK

Modify `@ai-sdk/openai` provider to:
- Detect `store: false` mode
- Include actual `function_call` objects instead of `item_reference`
- Properly handle stateless conversation history

**Pros:**
- Keep using AI SDK's nice APIs
- Fix at the root cause

**Cons:**
- Requires forking and maintaining AI SDK
- Complex internals to understand
- Need to keep fork updated
- May not be accepted upstream

### Option 3: Text-Only Mode (Current State)

Accept that tool calling doesn't work. Use Codex only for text generation.

**Pros:**
- Already works
- Simple, no changes needed

**Cons:**
- Loses main value of Codex (tool calling for coding tasks)
- ChatGPT Pro subscription underutilized

## Recommended Path Forward

**Option 1: Custom Conversation Manager**

This is what opencode-openai-codex-auth does and it works. The implementation would:

1. **Replace AI SDK's streamText with custom implementation:**
   - Parse Codex SSE responses manually
   - Extract function calls from `response.function_call.*` events
   - Store function call content locally
   - Build conversation history without `item_reference`

2. **Key files to reference from opencode:**
   - `lib/request/response-handler.ts` - SSE parsing
   - `lib/request/request-transformer.ts` - Conversation building
   - Look for how they construct `function_call` objects

3. **Integration approach:**
   - Keep current OAuth and auth code
   - Replace `streamText()` in `src/agent.ts` with custom streamer
   - Maintain conversation state in agent loop
   - Include actual function calls in `input` array

**Estimated effort:** 2-3 days of focused work

## Implementation Plan

1. Study opencode's response handler and conversation builder
2. Create `src/codex-streamer.ts` - Custom SSE response handler
3. Create `src/codex-conversation.ts` - Conversation state manager
4. Update `src/agent.ts` to use custom streamer instead of AI SDK
5. Test with `test/openai-e2e.test.ts`
6. Verify multi-turn tool calling works
