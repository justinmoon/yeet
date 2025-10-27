# Notes for AI Agents Working on Yeet

## Logging Strategy

**CRITICAL: Never log to console after `renderer.start()`**

Once the TUI renderer starts, it owns the terminal. Any `console.log()` or `console.error()` will:
1. Print raw text directly to terminal
2. TUI can't clear it
3. TUI renders on top of it
4. Creates overlapping/duplicate text (the bug we just fixed)

### ✅ Safe Logging
```typescript
// BEFORE renderer.start()
console.log("Loading config...")

// Create and start renderer
renderer.start()

// AFTER renderer.start() - use UI methods ONLY
ui.appendOutput("Status update\n")
ui.setStatus("Ready")
```

### ❌ Breaks Everything
```typescript
renderer.start()

// This writes raw text to terminal that TUI can't clear!
console.log("Agent started")  // ❌ WRONG
console.error("Error")         // ❌ WRONG
process.stdout.write("...")    // ❌ WRONG
```

### Exception
`console.error()` in the outer catch block (before process.exit) is OK - renderer never started.

## Testing Reality

Test renderer (`captureCharFrame()`) behaves differently than real terminal:
- Tests might pass but real terminal shows bugs
- Z-index/layering issues don't appear in tests
- Always test actual TUI manually after layout changes
