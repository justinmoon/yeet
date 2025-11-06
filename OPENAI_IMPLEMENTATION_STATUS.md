# OpenAI/ChatGPT Pro Implementation Status

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
- [x] Token field mapping: `max_tokens` → `max_output_tokens`
- [x] Request body transformation in custom fetch wrapper
- [x] Header injection (Bearer token, account ID, Codex headers)
- [x] Automatic token refresh on expiration

## ❌ Blocking Issue

### Codex Instructions Validation

**Problem:** Codex API returns `400 Bad Request` with error: `"Instructions are not valid"`

**Root Cause:** The Codex API requires specific, comprehensive instructions that must be fetched from the official Codex GitHub repository. Our simplified instructions are rejected.

**What's Needed:**
1. Fetch instructions from: `https://raw.githubusercontent.com/openai/codex/{release-tag}/codex-rs/core/gpt_5_codex_prompt.md`
2. Cache instructions locally (with ETag-based caching)
3. Handle updates when new Codex releases come out
4. Add rate limiting (15-minute cache TTL as in reference implementation)

**Reference Implementation:** See `~/code/opencode-openai-codex-auth/lib/prompts/codex.ts`

## Test Results

**OAuth Flow:** ✅ Working perfectly
- Browser opens automatically
- Callback server captures redirect
- Tokens saved to config
- Account ID extracted correctly

**API Requests:** ❌ Failing at instructions validation
```bash
# Test command
bun run test-openai.ts

# Result
Error: Bad Request
Response: {"detail":"Instructions are not valid"}
```

## Next Steps

1. **Implement Codex instructions fetcher**
   - Create `src/codex-instructions.ts`
   - Fetch from GitHub with release tag lookup
   - Implement ETag-based caching
   - Handle fallback to bundled instructions

2. **Update request transformer**
   - Use fetched instructions instead of hardcoded string
   - Handle instruction caching/refresh
   - Add error handling for fetch failures

3. **Test end-to-end**
   - Verify simple queries work
   - Test with tool use (once instructions work)
   - Verify streaming responses

## Files Changed

- `src/openai-auth.ts` - OAuth and fetch wrapper (new)
- `src/openai-callback-server.ts` - Local OAuth callback server (new)
- `src/config.ts` - OpenAI provider config
- `src/models/registry.ts` - OpenAI models
- `src/agent.ts` - OpenAI provider support
- `src/explain/model.ts` - OpenAI provider support
- `src/commands/index.ts` - Login commands
- `src/ui/interface.ts` - OAuth state in UI interface
- `src/ui/tui-adapter.ts` - OpenAI provider support
- `src/ui/tui-solid-adapter.tsx` - OpenAI provider support
- `src/ui/web-adapter.ts` - OpenAI provider support
- `src/ui/backend.ts` - Token counting, session management
- `src/ui/model-modal.ts` - OpenAI in model picker

## Commit History

```
df2fc2f WIP: Add Codex API request transformation (instructions validation failing)
30bc600 Fix URL rewriting for Codex API and add debug logging
34d9a62 Fix OAuth state verification for automatic callback
b66e3c5 Add automatic OAuth callback server for OpenAI login
2cc4f42 Add ChatGPT Pro OAuth support via OpenAI Codex API
```
