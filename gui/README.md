# XState Agent Loop - Web UI

Visual interface for the XState-based agent runtime using React Flow.

## Quick Start

```bash
# Start the GUI server
bun run gui

# Open in browser
open http://localhost:3456
```

## What You'll See

The GUI displays the XState agent machine as an interactive graph:

**States (nodes):**
- **idle** (blue) - Waiting for user input
- **thinking** (orange) - Agent processing/generating response
- **executingTool** (green) - Running a tool (bash, read, write, edit)
- **capturingSnapshot** (purple) - Saving filesystem state as git tree
- **paused** (orange) - Agent paused, waiting to continue
- **awaitingClarification** (cyan) - Agent needs user input
- **error** (red) - Error occurred

**Transitions (edges):**
- Show how states flow into each other
- Labeled with event types (USER_MESSAGE, TOOL_CALL, etc.)

## Phase 1: Static Visualization

Current implementation shows the state machine structure but doesn't execute yet.

**What works:**
- ✅ Graph visualization with auto-layout
- ✅ Color-coded state nodes
- ✅ Labeled transitions
- ✅ Pan/zoom/fit controls
- ✅ Dark theme matching yeet TUI

**Coming soon:**
- Phase 2: Live execution
- Phase 3: Context inspection
- Phase 4: Snapshot visualization
- Phase 5: E2E testing

## Architecture

```
gui/
  server.ts       - Bun HTTP server (port 3456)
  index.html      - Single-page app with React Flow
  README.md       - This file
```

**Tech stack:**
- React 18 (from CDN)
- React Flow 12 (from CDN)
- Dagre (auto-layout)
- Bun (server)
- No build step needed!

## Development

The UI loads React and React Flow from CDN, so no bundling needed. Just edit `index.html` and refresh.

**File structure:**
```html
<head>
  <!-- React Flow CSS -->
  <link rel="stylesheet" href=".../@xyflow/react/dist/style.min.css">
  <style>
    /* Custom styles for dark theme */
  </style>
</head>
<body>
  <!-- React and React Flow -->
  <script src=".../react.production.min.js"></script>
  <script src=".../react-dom.production.min.js"></script>
  <script src=".../@xyflow/react/dist/umd/index.min.js"></script>
  <script src=".../dagre.min.js"></script>
  
  <script type="module">
    // App code here
  </script>
</body>
```

## Next Steps

### Phase 2: Live Execution
- Add control panel (task input, start button)
- Server endpoint to run workflows
- SSE stream for state updates
- Highlight active state in real-time

### Phase 3: Context Display  
- State inspector panel
- Conversation history
- Tool call log
- Snapshot timeline

### Phase 4: Snapshot Explorer
- Browse files at each snapshot
- Diff view between snapshots
- Restore functionality

### Phase 5: Testing
- Playwright e2e test
- Automated fizzbuzz workflow test
- CI integration

## Port

Default: **3456** (same as asmr)

Change in `gui/server.ts`:
```typescript
const PORT = 3456; // Change this
```

## Browser Support

Tested in:
- Chrome/Edge (latest)
- Firefox (latest)
- Safari (latest)

Requires ES6+ and modern React Flow support.
