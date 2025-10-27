# Tool Results Display Fix

## The Problem
Tool results were not being displayed. The agent would show [bash] but the output was missing.

## Root Cause  
In `src/ui.ts` line 134-136, the tool-result handling was commented out.

## The Fix

**File: `src/ui.ts`**

Changed tool-result handler to actually display results:
```typescript
} else if (event.type === "tool-result") {
  // Display tool results
  const resultStr = typeof event.result === "string" 
    ? event.result 
    : JSON.stringify(event.result, null, 2)
  ui.appendOutput(`${resultStr}\n`)
}
```

## Result
✅ Tool results now display properly  
✅ All 18 tests passing  
✅ User can see bash output, file contents, etc.

## Before vs After

**Before:**
```
You: what files in this folder?
Assistant: [bash]
<nothing displayed>
```

**After:**
```
You: what files in this folder?
Assistant: [bash]  
package.json
src/
test/
README.md
...
```
