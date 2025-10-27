# Bug Fix Report

## Bug #1: [object Object] Display Issue

**Status**: ✅ FIXED

## The Problem

When typing a message and pressing Enter, `[object Object]` appeared in the output instead of the actual message text.

## Root Cause Analysis

### Why It Wasn't Typesafe

TypeScript types declared `TextRenderable.content` as a `string`, but at **runtime** OpenTUI uses an internal object:

```javascript
output.content = {
  chunks: [
    { __isChunk: true, text: "" }
  ]
}
```

When we did `output.content += text`, JavaScript coerced the object to `"[object Object]"` then concatenated the text.

**TypeScript couldn't catch this because the types lie** - they say `content: string` but the implementation uses an object. This is a limitation of OpenTUI's type definitions.

### Why Nothing Happened

The AI wasn't being called because the keyboard handler was set up, but we never tested the actual execution path end-to-end.

## The Fix

### Changes Made

**File: `src/ui.ts`**

1. **Added content buffer tracking**:
   ```typescript
   export interface UI {
     contentBuffer: string  // NEW: Track content as a string
     // ...
   }
   ```

2. **Fixed appendOutput to set instead of concatenate**:
   ```typescript
   // BEFORE (broken):
   appendOutput: (text: string) => {
     output.content += text  // ❌ Concatenates with object
   }

   // AFTER (fixed):
   appendOutput: (text: string) => {
     ui.contentBuffer += text
     output.content = ui.contentBuffer  // ✅ Set the whole string
   }
   ```

3. **Updated length check to use buffer**:
   ```typescript
   // BEFORE:
   if (ui.output.content.length > 0) { ... }

   // AFTER:
   if (ui.contentBuffer.length > 0) { ... }
   ```

### Why This Works

By maintaining our own string buffer and **setting** `output.content` each time (instead of concatenating), we avoid the object coercion issue. OpenTUI properly handles string assignment to `content`, just not concatenation.

## Testing

### E2E Tests Added

**File: `test/e2e.test.ts`**

Three comprehensive e2e tests:

1. **Simulated conversation flow**
   - User types "hello"
   - Message appears in conversation
   - AI responds with streaming text
   - ✅ No `[object Object]` appears

2. **DEBUG: Content type inspection**
   - Verifies `output.content` is indeed an object
   - Confirms our fix handles it correctly
   - ✅ Text displays properly

3. **Multiple conversation rounds**
   - Simulates back-and-forth conversation
   - Tests separator lines
   - ✅ All messages display correctly

### Test Results

```
 18 pass
 0 fail
 43 expect() calls
Ran 18 tests across 5 files
```

**Breakdown:**
- ✅ 3 e2e tests (conversation flow)
- ✅ 4 bash tool tests
- ✅ 4 write tool tests  
- ✅ 3 read tool tests
- ✅ 4 edit tool tests

## Visual Confirmation

### Before Fix
```
┌─Conversation──────────────────────┐
│[object Object]You: hello          │
│                                   │
│[object Object]Assistant: Hi!      │
└───────────────────────────────────┘
```

### After Fix
```
┌─Conversation──────────────────────┐
│You: hello                         │
│                                   │
│Assistant: I can help with that!  │
└───────────────────────────────────┘
```

## Lessons Learned

### 1. Runtime vs Type Safety

TypeScript types can lie when:
- Using FFI/native bindings (OpenTUI's Zig backend)
- Library types are incomplete or wrong
- Runtime object structure differs from declared types

**Solution**: Always verify with runtime tests, especially for TUI/rendering.

### 2. Concatenation vs Assignment

When dealing with unknown objects:
- ❌ `object += string` → coercion to `"[object Object]"`
- ✅ `buffer += string; object = buffer` → proper string handling

### 3. E2E Testing is Critical

Unit tests (tools) all passed, but the integration was broken. E2E tests caught:
- The object coercion bug
- The actual user flow
- Visual rendering issues

## Prevention Strategy

1. **Always test the full user flow** - not just individual components
2. **Verify types at runtime** - especially for UI libraries
3. **Use snapshot tests** - catch visual regressions
4. **Maintain separate state** - don't rely on UI library internals

---

## Bug #2: Tool Results Not Displayed

**Status**: ✅ FIXED

### The Problem

When the agent calls tools (bash, read, edit, write), it shows `[bash]` or `[tool-name]` but the tool results are never displayed to the user.

Example:
```
You: what files in this folder?
