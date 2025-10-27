# Display Fix Summary

## Issues Fixed

### 1. Tool Arguments Not Shown
**Before:** `[bash] {}`  
**After:** `[bash] ls`

**Root Cause:** Args were extracted from wrong field (chunk.args instead of chunk.input)  
**Fix:** Changed `chunk.args` to `chunk.input` in agent.ts

### 2. Tool Results Unreadable
**Before:**
```json
{
  "stdout": "attach\nBUG_FIX_REPORT.md\nbun.lock\n...",
  "stderr": "",
  "exitCode": 0
}
```

**After:**
```
attach
BUG_FIX_REPORT.md
bun.lock
CHANGELOG.md
...
```

**Root Cause:** Displaying raw JSON with escaped newlines  
**Fix:** Parse bash results and show stdout directly

## Changes Made

**src/agent.ts:**
- Extract args from `chunk.input` instead of `chunk.args`

**src/ui.ts:**
- Show primary arg (command/path) instead of full JSON for tool calls
- For bash results: display stdout directly with actual newlines
- For other tools: keep formatted JSON

**test/e2e-real.test.ts:**
- Added real API test that reproduces and verifies the fixes
- Tests against live grok-code model

## Test Coverage

✅ All 19 tests passing
- 15 tool unit tests
- 3 e2e mock tests
- 1 e2e real API test (with grok-code)

## Visual Comparison

**Old Output:**
```
You: list files
