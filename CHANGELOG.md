# Changelog

## 2025-10-27 - OpenCode Zen Integration Fix

### Problem
- Yeet was configured to use `glm-4` model which doesn't exist in OpenCode Zen
- Wrong API endpoint (`https://api.opencode.ai/v1` instead of Zen endpoint)
- Wrong AI SDK package (`@ai-sdk/openai` instead of `@ai-sdk/openai-compatible`)
- Users got error: "Unsupported model version v1 for provider openai.chat"

### Root Cause Analysis
See [OPENCODE_ZEN_INTEGRATION.md](./OPENCODE_ZEN_INTEGRATION.md) for full details.

**Key findings:**
1. OpenCode Zen uses different endpoints per model type
2. Most Zen models require `@ai-sdk/openai-compatible` SDK
3. `glm-4` is not a valid Zen model
4. Zen base URL is `https://opencode.ai/zen/v1`

### Changes Made

#### Dependencies
- **Removed**: `@ai-sdk/openai` (v1.0.0)
- **Added**: `@ai-sdk/openai-compatible` (v1.0.22)

#### Configuration Defaults
- **Model**: `glm-4` → `grok-code` (FREE model!)
- **Base URL**: `https://api.opencode.ai/v1` → `https://opencode.ai/zen/v1`
- **API Provider**: `createOpenAI()` → `createOpenAICompatible()`

#### Files Modified

**package.json**
- Swapped OpenAI SDK for OpenAI-compatible SDK

**src/agent.ts**
- Import: `createOpenAI` → `createOpenAICompatible`
- Provider init now includes `name: "opencode"` parameter

**src/config.ts**
- Default model: `glm-4` → `grok-code`
- Default baseURL: `https://api.opencode.ai/v1` → `https://opencode.ai/zen/v1`
- Updated error messages with correct config

**config.example.json**
- Updated with Zen endpoint and grok-code model

**README.md**
- Added OpenCode Zen section with model pricing
- Updated configuration examples
- Added model selection guide

### Testing
✅ All 18 tests passing
- 3 e2e tests (conversation flow)
- 15 tool tests (bash, read, edit, write)

### Benefits

#### For Users
- **Free model available**: `grok-code` is free on Zen
- **Correct defaults**: Auto-config now works properly
- **Better documentation**: Clear model options and pricing
- **Easy switching**: Just change model ID to try different models

#### Available Models (Zen)
- `grok-code` - FREE
- `qwen3-coder` - $0.45/$1.50 per 1M tokens (excellent for coding)
- `kimi-k2` - $0.60/$2.50 per 1M tokens
- Plus GPT-5, Claude models

### Migration Guide

**If you have existing `~/.yeet/config.json`:**

```bash
# Backup old config
cp ~/.yeet/config.json ~/.yeet/config.json.backup

# Update to Zen endpoint and free model
cat > ~/.yeet/config.json << 'EOF'
{
  "opencode": {
    "apiKey": "your-opencode-zen-api-key",
    "baseURL": "https://opencode.ai/zen/v1",
    "model": "grok-code"
  },
  "maxSteps": 5,
  "temperature": 0.3
}
EOF
```

**Or delete config to regenerate with new defaults:**

```bash
rm ~/.yeet/config.json
# Will auto-regenerate on next run with OpenCode credentials
```

### Next Steps

- [ ] Test with real OpenCode Zen API key
- [ ] Verify streaming responses work
- [ ] Test tool execution in real conversations
- [ ] Add support for other Zen model endpoints (GPT-5, Claude)
- [ ] Consider adding model auto-detection based on ID

### References
- [OpenCode Zen Docs](https://opencode.ai/docs/zen/)
- [OpenCode Zen Pricing](https://opencode.ai/docs/zen/#pricing)
- [AI SDK OpenAI-Compatible Provider](https://ai-sdk.dev/providers/ai-sdk-providers/openai-compatible)
