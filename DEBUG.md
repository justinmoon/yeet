# Tool Arguments Bug - FIXED ✅

## The Problem
Tools were receiving empty args `{}` instead of actual parameters.

## Root Cause
Using `parameters: z.object(...)` doesn't work properly with OpenCode Zen models.
OpenCode uses `inputSchema: jsonSchema(z.toJSONSchema(...))` instead.

## The Fix
Changed all tools from:
```typescript
tool({
  parameters: z.object({ command: z.string() })
})
```

To:
```typescript
tool({
  inputSchema: jsonSchema(z.toJSONSchema(z.object({ command: z.string() })))
})
```

## How We Found It
1. Added logging to see what tools receive
2. Checked OpenCode's actual tool definitions
3. Found they use `z.toJSONSchema()` + `jsonSchema()`
4. Applied the same pattern - it worked!

---

# Debug Visibility for TUI

## The Problem  
You're blind to what's happening in the TUI. Need Playwright-equivalent for terminal.

## Solution: E2E Test with Real API

Run this to see EXACTLY what the model sends:

```bash
cd ~/code/yeet
bun test test/e2e-real.test.ts
```

This test:
1. Calls the REAL API (grok-code)
2. Captures ALL console output
3. Shows the actual TUI render
4. Logs every chunk from the model

## Quick Debug

```bash
# Run with full logging
bun run src/index.ts 2>&1 | tee debug.log

# Then check:
grep "\[AGENT\]" debug.log   # What model sends
grep "\[bash\]" debug.log    # What tool receives
```

## What to Look For

```
[AGENT] Tool call chunk keys: [...]  ← What fields exist?
[AGENT] Full chunk: { ... }          ← The raw data
[bash] Received args: { ... }        ← What tool got
```

If `chunk.args` is empty `{}`, the model isn't sending parameters.

## The TUI Test

Like Playwright captures browser screenshots, our test captures terminal output:

```typescript
const frame = captureFrame()
console.log(frame)  // See EXACTLY what's rendered
```
