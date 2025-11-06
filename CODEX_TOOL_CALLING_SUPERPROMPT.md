# GPT-5 Pro: Help Fix Codex Tool Calling

## Context

We're integrating OpenAI ChatGPT Pro (Codex API) into a coding assistant called "yeet". We successfully got text generation working but tool calling is blocked by a fundamental incompatibility with the Vercel AI SDK.

## Current Status

✅ **Working:**
- OAuth authentication with ChatGPT Pro
- Token refresh
- Text generation using `@ai-sdk/openai` provider
- Basic Responses API integration

❌ **Broken:**
- Tool calling (bash, read, write, edit tools)
- Error: "No tool call found for function call output with call_id..."

## Root Cause Analysis

The AI SDK's conversation history management is incompatible with Codex's stateless (`store: false`) operation.

### The Problem

When tool calls are made, the AI SDK builds conversation history using `item_reference` objects:

**Request 2 (after tool execution):**
```json
{
  "input": [
    {"role": "developer", "content": "..."},
    {"role": "user", "content": [{"type": "input_text", "text": "Run bash"}]},
    {"type": "item_reference", "id": "rs_..."},  // Reference to Codex's response
    {"type": "item_reference", "id": "fc_..."},  // Reference to function call
    {"type": "function_call_output", "call_id": "call_XXX", "output": "..."}
  ],
  "store": false
}
```

**The catch-22:**
- `item_reference` requires `store: true` to resolve on the server
- Codex requires `store: false` (stateless operation, confirmed by error messages)
- If we filter out `item_reference`, the `function_call_output` is orphaned
- Codex errors: "No tool call found for function call output with call_id call_XXX"

### Evidence

**CONFIRMED via diagnostic logging (Dec 2024):**

Request 3 input array BEFORE filtering:
```json
Item 0: {"role": "developer", "hasCallId": false, "keys": ["role", "content"]}
Item 1: {"role": "user", "hasCallId": false, "keys": ["role", "content"]}
Item 2: {"type": "item_reference", "id": "rs_0ece61dd...", "hasCallId": false, "keys": ["type", "id"]}
Item 3: {"type": "item_reference", "id": "fc_0ece61dd...", "hasCallId": false, "keys": ["type", "id"]}
Item 4: {"type": "function_call_output", "hasCallId": true, "keys": ["type", "call_id", "output"]}
```

After filtering `item_reference` (required because `store: false`):
```json
Item 0: {"role": "developer", "hasOutput": false, "hasCallId": false}
Item 1: {"role": "user", "hasOutput": false, "hasCallId": false}
Item 2: {"type": "function_call_output", "hasOutput": true, "hasCallId": true}  ← ORPHANED!
```

**Key observation:** The AI SDK does NOT include actual `function_call` objects - only references to them. When we filter the references, the `function_call_output` has no corresponding call.

## How opencode-openai-codex-auth Solves This

The opencode plugin successfully implements tool calling with Codex. Here's how:

**From `lib/request/request-transformer.ts`:**
```typescript
// They filter out item_reference and keep actual function_call objects
export function filterInput(input: InputItem[]): InputItem[] {
  return input
    .filter((item) => {
      if (item.type === "item_reference") {
        return false; // Remove AI SDK references
      }
      return true; // Keep function_call, function_call_output, messages
    })
    .map((item) => {
      // Strip IDs (stateless mode)
      if (item.id) {
        const { id, ...itemWithoutId } = item;
        return itemWithoutId;
      }
      return item;
    });
}
```

**Key insight:** They must be constructing conversation history with **actual `function_call` objects**, not references. Something like:

```json
{
  "input": [
    {"role": "developer", "content": "..."},
    {"role": "user", "content": "Run bash"},
    {"type": "function_call", "name": "bash", "arguments": "{...}"},  // Actual call!
    {"type": "function_call_output", "call_id": "call_XXX", "output": "..."}
  ],
  "include": ["reasoning.encrypted_content"],
  "store": false
}
```

## CRITICAL QUESTIONS for GPT-5 Pro

**We need to inject actual `function_call` objects into the conversation history. How?**

### What We Know:
1. ✅ The AI SDK receives Codex's SSE responses containing function call data
2. ✅ The AI SDK creates `item_reference` objects pointing to those calls
3. ✅ We can intercept and transform the request body before sending to Codex
4. ❌ We DON'T know how to get the function call data to replace the references

### Specific Questions:

1. **Where is the function call data available in our code?**
   - When the AI SDK creates `item_reference`, does it have the actual function call data somewhere?
   - Can we access it from the `streamText()` result or `onStepFinish` callback?
   - Or do we need to parse the SSE response ourselves?

2. **What's the exact Responses API format for `function_call`?**
   ```json
   {
     "type": "function_call",
     "name": "bash",           // ← Tool name
     "arguments": "{...}",     // ← JSON string of arguments
     "call_id": "call_XXX"     // ← Do we need this? Or omit for stateless?
   }
   ```
   - Required fields?
   - Should `arguments` be a JSON string or object?
   - Do we include `call_id` or omit it (stateless mode)?

3. **Best implementation approach?**
   - **Option A:** Wrap response stream, parse SSE, store function calls, inject in next request
   - **Option B:** Hook into AI SDK internals to access function call data
   - **Option C:** Something simpler we're missing?

4. **Codex SSE response format - what events contain function call info?**
   - `response.function_call.delta`?
   - `response.function_call.done`?
   - What fields do these events contain?

## Relevant Code Files

### Our Current Implementation

**src/openai-auth.ts** (Request transformation):
```typescript
// We're filtering item_reference but the function_call_output is orphaned
if (Array.isArray(parsed.input)) {
  parsed.input = parsed.input
    .filter((item: any) => item.type !== "item_reference")
    .map((item: any) => {
      if (item.id) {
        const { id, ...itemWithoutId } = item;
        return itemWithoutId;
      }
      return item;
    });
}

// Add reasoning.encrypted_content for context
parsed.include = ["reasoning.encrypted_content"];
parsed.store = false;
```

**src/agent.ts** (Using AI SDK):
```typescript
// Current approach - uses AI SDK which generates item_reference
const result = await streamText({
  model,
  system,
  messages,
  tools,
  maxSteps,
  onStepFinish: async (step) => {
    // AI SDK handles conversation history automatically
    // But it uses item_reference which doesn't work with store: false
  }
});
```

### OpenCode Reference Files

These files from opencode-openai-codex-auth show it working:
- `lib/request/response-handler.ts` - SSE parsing
- `lib/request/request-transformer.ts` - Conversation building
- `lib/types.ts` - Type definitions

## What We Need

A concrete implementation strategy to fix tool calling. Should we:

**Option A: Parse SSE and Build Custom History**
- Parse Codex SSE responses ourselves
- Extract function calls from events
- Maintain conversation state manually
- Build `input` array with actual objects

**Option B: Transform AI SDK's History**
- Let AI SDK build history with item_reference
- Intercept and transform before sending
- Somehow get function call data to replace references
- Less invasive to existing code

**Option C: Something else?**
- Is there a cleaner approach we're missing?
- Can we make the AI SDK work differently?

## Goal

Get tool calling working with Codex while keeping as much of the AI SDK's nice APIs as possible. We want to avoid rewriting everything from scratch if there's a simpler transformation approach.

Please analyze this and provide:
1. The exact mechanism opencode uses to construct actual function_call objects
2. A recommended implementation approach for our codebase
3. Specific code snippets or transformations needed
4. Any gotchas or edge cases to watch for
