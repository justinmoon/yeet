# GUI Playwright Tests

Automated E2E tests for the React Flow web UI.

## Running Tests

**Prerequisites:**
1. GUI server must be running
2. Playwright browsers installed

**Steps:**

```bash
# Terminal 1: Start GUI server
bun run gui

# Terminal 2: Run tests
bun test test/gui.spec.ts

# Or run with headed browser (see it execute)
bunx playwright test test/gui.spec.ts --headed

# Run specific test
bunx playwright test test/gui.spec.ts -g "displays all state machine nodes"
```

## Test Structure

### Phase 1: Static Visualization (14 tests)
Current implementation tests:

- ✅ Page loads with header
- ✅ React Flow canvas renders
- ✅ All 7 state nodes display (idle, thinking, executingTool, etc.)
- ✅ Node labels are correct
- ✅ Edges between states exist (16 transitions)
- ✅ Edge labels visible
- ✅ React Flow controls present
- ✅ Background grid visible
- ✅ CSS classes applied correctly
- ✅ Zoom controls interactive
- ✅ Canvas is pannable/scrollable
- ✅ No console errors
- ✅ Page responsive
- ✅ Screenshots for visual regression

### Phase 2: Live Execution (TODO)
Will test:
- Control panel (input, start button)
- Workflow execution
- Active state highlighting
- SSE event stream
- Logs display

### Phase 3: Context Inspection (TODO)
Will test:
- State inspector panel
- Tool history view
- Conversation display
- Snapshot timeline

## Test Output

**Success:**
```
✓ loads the GUI and displays header (1.2s)
✓ renders React Flow canvas (1.5s)
✓ displays all state machine nodes (2.1s)
  ✓ Found idle node
  ✓ Found thinking node
  ✓ Found executingTool node
  ...
✓ nodes have correct labels (1.8s)
✓ displays edges between states (1.6s)
  ✓ Found 16 edges
✓ screenshot: full page (2.0s)
  ✓ Screenshot saved: gui-phase1-full.png

14 passed (18.3s)
```

**Screenshots:**
- `test-results/gui-phase1-full.png` - Full page
- `test-results/gui-phase1-canvas.png` - Canvas only

Use for visual regression testing.

## Debugging Failed Tests

### Test times out waiting for .react-flow
**Cause:** GUI server not running or wrong port

**Fix:**
```bash
# Check server is running on 3456
curl http://localhost:3456
# Should return HTML

# If not, start it:
bun run gui
```

### "ReactFlow is not defined" error
**Cause:** CDN failed to load or wrong import

**Fix:** Check browser console in headed mode:
```bash
bunx playwright test --headed --debug
```

### Nodes not found
**Cause:** Dagre layout taking too long

**Fix:** Increase timeout in test:
```typescript
await page.waitForTimeout(2000); // Increase from 1000
```

### Screenshot differences
**Cause:** Layout changed or timing issue

**Fix:** 
1. View screenshot in `test-results/`
2. If layout is correct, update baseline
3. If layout is wrong, fix CSS/dagre config

## CI Integration

For GitHub Actions:

```yaml
- name: Start GUI server
  run: bun run gui &
  
- name: Wait for server
  run: sleep 2

- name: Run GUI tests
  run: bun test test/gui.spec.ts
```

## Adding New Tests

When adding Phase 2 features:

1. Un-skip the Phase 2 describe block
2. Add specific test cases
3. Update this README

Example:
```typescript
test.describe("Phase 2: Live Execution", () => {
  test("displays control panel", async ({ page }) => {
    await page.goto(GUI_URL);
    
    const panel = page.locator("[data-testid='control-panel']");
    await expect(panel).toBeVisible();
    
    const input = page.locator("[data-testid='task-input']");
    await expect(input).toBeVisible();
  });
});
```

## Test Data

Use `data-testid` attributes for stable selectors:

```html
<button data-testid="start-button">Start</button>
<div data-testid="state-node" data-state="thinking">...</div>
```

Then in tests:
```typescript
const button = page.locator("[data-testid='start-button']");
const node = page.locator("[data-testid='state-node'][data-state='thinking']");
```

## Performance

Tests should complete in ~20 seconds total.

If slower:
- Check network (CDN loads)
- Reduce waitForTimeout delays
- Use waitForSelector with shorter timeouts
