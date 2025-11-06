# OpenAI/ChatGPT Pro Implementation Status

## Summary

**Status:** OAuth working, API accessible, but **incompatible with yeet's tool system**

The Codex API successfully responds to requests, but it uses a different:
- Streaming format (Server-Sent Events vs OpenAI JSON streaming)
- Tool/function calling format (incompatible with AI SDK's tooling)
- Parameter set (doesn't support temperature, system messages, etc.)

**Conclusion:** Would require significant changes to yeet's agent system to support Codex. Not a drop-in replacement for Anthropic/OpenAI providers.

## ✅ Completed

### OAuth Flow
- [x] Local callback server on port 1455
- [x] Automatic browser redirect handling
- [x] PKCE flow with code challenge/verifier
- [x] Token exchange and refresh
- [x] CSRF protection with state verification
- [x] Account ID extraction from JWT
- [x] Success page display after auth

### Provider Plumbing
- [x] OpenAI config in `src/config.ts`
- [x] OpenAI models in `src/models/registry.ts` (gpt-5, gpt-5-codex)
- [x] Provider support in `src/agent.ts`
- [x] Provider support in `src/explain/model.ts`
- [x] Model selection in all UI adapters (TUI, Solid, Web)
- [x] Token counting for OpenAI models
- [x] Session management for OpenAI

### Commands
- [x] `/login-anthropic` - Anthropic OAuth flow
- [x] `/login-openai` - OpenAI OAuth flow with callback server
- [x] `/auth status` - Shows OpenAI auth status
- [x] `/models` - Lists and switches OpenAI models

### Request Transformation
- [x] URL rewriting: `/chat/completions` → `/codex/responses`
- [x] Message format conversion: `messages` array → `input` array
- [x] System message filtering (Codex doesn't support them)
- [x] Parameter filtering (temperature, top_p, tool_choice, etc.)
- [x] Request body transformation in custom fetch wrapper
- [x] Header injection (Bearer token, account ID, Codex headers)
- [x] Automatic token refresh on expiration
- [x] Codex instructions fetching from GitHub with ETag caching

## ❌ Blocking Issues

### 1. Incompatible Streaming Format

**Problem:** Codex uses Server-Sent Events (SSE) with a custom format, not OpenAI's streaming JSON

Codex response format:
```
event: response.created
data: {"type":"response.created","response":{...}}

event: response.output_text.delta
data: {"type":"response.output_text.delta","text":"Hello"}

event: response.done
data: {"type":"response.done","response":{...}}
```

OpenAI format (expected by AI SDK):
```json
{"id":"...","choices":[{"delta":{"content":"Hello"}}]}
```

**Impact:** AI SDK's `streamText()` fails to parse Codex responses

### 2. Incompatible Tool/Function Calling

**Problem:** Codex uses a different tool format than OpenAI

AI SDK sends:
```json
{
  "tools": [{
    "type": "function",
    "function": {
      "name": "bash",
      "description": "Execute bash command",
      "parameters": {...}
    }
  }]
}
```

Codex expects: Unknown format (returns error: `Missing required parameter: 'tools[0].name'`)

**Impact:** yeet's core functionality (bash, read, write, edit tools) doesn't work

### 3. Unsupported Parameters

Codex doesn't support:
- `temperature` - Sampling parameter
- `top_p` - Nucleus sampling
- `frequency_penalty` / `presence_penalty` - Token penalties
- `stop` - Stop sequences
- `seed` - Reproducibility
- `tool_choice` - Tool selection strategy
- `max_tokens` / `max_output_tokens` - Token limits
- System messages in messages array (must use `instructions` field)

## What Works

**Basic API calls without tools:**
- OAuth authentication ✅
- Token refresh ✅
- Simple text generation requests ✅
- Codex instructions injection ✅
- Account ID tracking ✅

**Test results:**
```bash
bun run test-openai.ts
# Result: Successfully counted r's in "strawberry" = 3
```

## What Doesn't Work

- Tool/function calling (core yeet functionality)
- Streaming response parsing through AI SDK
- Multi-step agent workflows
- Any yeet commands that use tools (bash, read, write, edit)

## Technical Details

### Files Created
- `src/openai-auth.ts` - OAuth and fetch wrapper (427 lines)
- `src/openai-callback-server.ts` - Local OAuth server (135 lines)
- `src/codex-instructions.ts` - GitHub instructions fetcher (205 lines)
- `CODEX_INSTRUCTIONS.md` - Official Codex prompt (for reference)
- `test-openai.ts` - Simple API test (works)
- `test-openai-with-tools.ts` - Tool test (fails)

### Commits
```
[Latest] Fix Codex API compatibility issues (streaming/tools incompatible)
df2fc2f WIP: Add Codex API request transformation (instructions validation failing)
30bc600 Fix URL rewriting for Codex API and add debug logging
34d9a62 Fix OAuth state verification for automatic callback
b66e3c5 Add automatic OAuth callback server for OpenAI login
2cc4f42 Add ChatGPT Pro OAuth support via OpenAI Codex API
```

## Recommendations

### Option 1: Custom Codex Agent Implementation (High effort)
- Write custom SSE streaming parser for Codex format
- Reverse-engineer Codex tool calling format
- Create separate agent implementation for Codex
- Maintain two parallel systems (Anthropic + Codex)

### Option 2: Wait for Official Support (Zero effort)
- OpenAI may release official Codex SDK
- AI SDK maintainers may add Codex support
- Keep OAuth implementation for future use

### Option 3: Use Different Provider (Recommended)
- Stick with Anthropic (Claude Code) - fully working
- Use OpenCode/Maple for alternatives
- ChatGPT Pro OAuth works but Codex API not compatible with yeet's architecture

## Next Steps

If pursuing Codex integration:
1. Study openai/codex CLI source for SSE parsing
2. Reverse-engineer tool calling format
3. Create custom agent implementation
4. Test end-to-end with all yeet commands

If abandoning Codex:
1. Keep OAuth implementation (works perfectly)
2. Document as experimental/incomplete
3. Focus on improving Anthropic/Claude support
