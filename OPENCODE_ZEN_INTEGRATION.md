# OpenCode Zen Integration Analysis

## The Problem

When running yeet with the auto-generated config, we get:

```
❌ Error: Unsupported model version v1 for provider "openai.chat" and model "glm-4". 
AI SDK 5 only supports models that implement specification version "v2".
```

## Root Causes

### 1. Wrong Model ID
The config uses `"model": "glm-4"` which **does not exist in OpenCode Zen**.

According to [OpenCode Zen docs](https://opencode.ai/docs/zen/), the available models are:
- GPT 5 (`gpt-5`)
- GPT 5 Codex (`gpt-5-codex`)
- Claude Sonnet 4.5 (`claude-sonnet-4-5`)
- Claude Sonnet 4 (`claude-sonnet-4`)
- Claude Haiku 4.5 (`claude-haiku-4-5`)
- Claude Haiku 3.5 (`claude-3-5-haiku`)
- Claude Opus 4.1 (`claude-opus-4-1`)
- Qwen3 Coder 480B (`qwen3-coder`)
- Grok Code Fast 1 (`grok-code`) - FREE
- Kimi K2 (`kimi-k2`)

`glm-4` appears to be an older/deprecated model or from a different service.

### 2. Wrong Base URL
The config uses `"baseURL": "https://api.opencode.ai/v1"` which is **not the Zen endpoint**.

According to the docs, Zen uses:
- `https://opencode.ai/zen/v1/responses` (GPT models)
- `https://opencode.ai/zen/v1/messages` (Claude models)
- `https://opencode.ai/zen/v1/chat/completions` (Qwen, Grok, Kimi)

The `https://api.opencode.ai/v1` endpoint is for other services (GitHub app integration, etc.).

### 3. Wrong AI SDK Package
We're using `@ai-sdk/openai` but most Zen models require `@ai-sdk/openai-compatible`.

From the docs:
- GPT models: Use `@ai-sdk/openai`
- Claude models: Use `@ai-sdk/anthropic`
- **Qwen, Grok, Kimi**: Use `@ai-sdk/openai-compatible`

## How OpenCode Handles This

OpenCode dynamically:
1. Fetches model metadata from models.dev
2. Installs the correct npm package for each model
3. Uses provider-specific options and endpoints

From `opencode/src/provider/provider.ts`:
```typescript
const pkg = model.provider?.npm ?? provider.npm ?? provider.id
if (pkg.includes("@ai-sdk/openai-compatible") && options["includeUsage"] === undefined) {
  options["includeUsage"] = true
}
```

And from `opencode/src/session/prompt.ts`:
```typescript
providerOptions: {
  [model.npm === "@ai-sdk/openai" ? "openai" : model.providerID]: params.options,
}
```

## The Fix

We have two options:

### Option A: Use OpenAI-Compatible Package (Recommended)

**Pros:**
- Works with most Zen models (Qwen, Grok, Kimi)
- Simpler configuration
- Grok Code Fast is FREE

**Changes needed:**

1. Update `package.json`:
```json
{
  "dependencies": {
    "@ai-sdk/openai-compatible": "^1.0.0",  // ADD THIS
    "@opentui/core": "^0.4.3",
    "ai": "^5.0.17",
    "zod": "^3.24.1"
  }
}
```

2. Update `src/agent.ts`:
```typescript
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"

export async function* runAgent(
  message: string,
  config: Config,
  onToolCall?: (tool: string) => void
): AgentAsyncGenerator {
  const openai = createOpenAICompatible({
    name: "opencode",
    apiKey: config.opencode.apiKey,
    baseURL: config.opencode.baseURL,
  })

  const model = openai(config.opencode.model)
  // ... rest stays the same
}
```

3. Update `src/config.ts` defaults:
```typescript
const config: Config = {
  opencode: {
    apiKey,
    baseURL: "https://opencode.ai/zen/v1",  // CHANGED
    model: "grok-code",  // FREE model!
  },
  maxSteps: 5,
  temperature: 0.3,
}
```

4. Update `config.example.json`:
```json
{
  "opencode": {
    "apiKey": "your-opencode-zen-api-key",
    "baseURL": "https://opencode.ai/zen/v1",
    "model": "grok-code"
  },
  "maxSteps": 5,
  "temperature": 0.3
}
```

### Option B: Support Multiple Providers

**Pros:**
- Can use GPT 5 Codex (best for coding)
- Can use Claude models (best reasoning)
- More flexible

**Cons:**
- More complex code
- Need to handle different SDKs
- More dependencies

**Would require:**
- Detecting model type from model ID
- Dynamically loading correct SDK
- Different baseURL per model family
- More complex configuration

## Recommendation

**Use Option A** with these defaults:
- Model: `grok-code` (free, good for testing)
- Base URL: `https://opencode.ai/zen/v1`
- Package: `@ai-sdk/openai-compatible`

Users can easily switch to paid models like `qwen3-coder` or `kimi-k2` by just changing the model ID.

For users who want GPT 5 Codex or Claude, they can manually:
1. Change baseURL to the model-specific endpoint
2. Install the correct SDK package
3. Update the model ID

## Test Plan

1. ✅ Fix the bug (use correct model + endpoint)
2. ✅ Test with free model (grok-code)
3. ✅ Update documentation
4. ⏳ Test with real API key
5. ⏳ Verify streaming works
6. ⏳ Verify tool execution works

## References

- [OpenCode Zen Docs](https://opencode.ai/docs/zen/)
- [OpenCode Provider Code](https://github.com/sst/opencode/blob/main/packages/opencode/src/provider/provider.ts)
- [AI SDK OpenAI-Compatible](https://ai-sdk.dev/providers/ai-sdk-providers/openai-compatible)
