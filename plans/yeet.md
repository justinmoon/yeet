# Plan: Yeet - Minimal TUI Coding Agent

## Goal

Build a **bare minimum** TUI coding agent modeled after opencode, but dramatically simpler:
- **Launch it** - Start the TUI
- **Chat** - Send messages, get responses
- **Edit code** - Agent can edit files via tools
- **That's it** - No sessions, no history, no fancy features

## Why OpenTUI + Vercel AI SDK?

After studying both codebases:

**OpenTUI** (TypeScript TUI library):
- TextareaRenderable - Full-featured text editor
- TextRenderable - Display text with styling
- BoxRenderable - Layout containers
- CliRenderer - Terminal rendering
- Written in TypeScript with Zig backend
- Perfect for our needs

**OpenCode's approach**:
- Uses separate Go TUI binary
- Communicates with Node.js server
- Too complex for minimal agent

**Our approach**:
- Use OpenTUI directly in TypeScript
- Integrate Vercel AI SDK for agent loop
- Single process, no client/server split
- ~300 lines total

## Architecture

```
┌─────────────────────────────────────┐
│         yeet (single binary)        │
├─────────────────────────────────────┤
│  OpenTUI Renderer                   │
│  ├─ Input box (TextareaRenderable)  │
│  ├─ Output view (TextRenderable)    │
│  └─ Status bar (TextRenderable)     │
├─────────────────────────────────────┤
│  Vercel AI SDK                      │
│  ├─ streamText()                    │
│  ├─ Model: OpenCode Zen GLM 4.6     │
│  └─ Tools: bash, read, edit, write  │
├─────────────────────────────────────┤
│  Tools                              │
│  ├─ bash - Execute commands         │
│  ├─ read - Read file                │
│  ├─ edit - Edit with search/replace │
│  └─ write - Create file             │
└─────────────────────────────────────┘
```

## File Structure

```
~/code/yeet/
├── package.json
├── tsconfig.json
├── bun.lockb
├── README.md
├── plans/
│   └── yeet.md (this file)
└── src/
    ├── index.ts              # Entry point, TUI setup
    ├── agent.ts              # Vercel AI SDK integration
    ├── ui.ts                 # OpenTUI components
    └── tools/
        ├── bash.ts           # Execute shell commands
        ├── read.ts           # Read files
        ├── edit.ts           # Edit files
        └── write.ts          # Write files
```

## Dependencies

```json
{
  "name": "yeet",
  "version": "0.1.0",
  "type": "module",
  "dependencies": {
    "@opentui/core": "latest",
    "ai": "^4.0.0",
    "@ai-sdk/openai": "^1.0.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.0.0"
  }
}
```

**Note**: Using `@ai-sdk/openai` because OpenCode Zen GLM 4.6 is OpenAI-compatible

## Implementation Plan

### Phase 1: OpenTUI Setup (Day 1)

**Goal**: Get basic TUI rendering

**Steps**:
1. Install dependencies
2. Create basic CliRenderer
3. Add TextareaRenderable for input
4. Add TextRenderable for output
5. Handle keyboard input

**src/index.ts**:
```typescript
#!/usr/bin/env bun
import { createCliRenderer } from "@opentui/core"
import { createUI } from "./ui"
import { runAgent } from "./agent"

const renderer = await createCliRenderer({
  exitOnCtrlC: true,
  targetFps: 60,
})

const ui = createUI(renderer)

// Handle Ctrl+C
renderer.keyInput.on("keypress", (key) => {
  if (key.ctrl && key.name === "c") {
    renderer.destroy()
    process.exit(0)
  }
})

console.log("Yeet started. Type your message and press Ctrl+Enter to send.")
```

**src/ui.ts**:
```typescript
import {
  CliRenderer,
  BoxRenderable,
  TextareaRenderable,
  TextRenderable,
  type KeyEvent
} from "@opentui/core"

export interface UI {
  input: TextareaRenderable
  output: TextRenderable
  status: TextRenderable
  appendOutput: (text: string) => void
  setStatus: (text: string) => void
  clearInput: () => void
}

export function createUI(renderer: CliRenderer): UI {
  renderer.setBackgroundColor("#0D1117")

  // Main container
  const container = new BoxRenderable(renderer, {
    id: "main",
    padding: 1,
  })
  renderer.root.add(container)

  // Output area (top 70%)
  const outputBox = new BoxRenderable(renderer, {
    id: "output-box",
    borderStyle: "single",
    borderColor: "#30363D",
    title: "Conversation",
    titleAlignment: "left",
    flexGrow: 7,
    border: true,
  })
  container.add(outputBox)

  const output = new TextRenderable(renderer, {
    id: "output",
    content: "Welcome to yeet! Start typing below...\n\n",
    fg: "#C9D1D9",
  })
  outputBox.add(output)

  // Input area (bottom 30%)
  const inputBox = new BoxRenderable(renderer, {
    id: "input-box",
    borderStyle: "single",
    borderColor: "#58A6FF",
    title: "Your Message (Ctrl+Enter to send)",
    titleAlignment: "left",
    flexGrow: 3,
    border: true,
  })
  container.add(inputBox)

  const input = new TextareaRenderable(renderer, {
    id: "input",
    textColor: "#F0F6FC",
    backgroundColor: "#0D1117",
    placeholder: "Type your message...",
    placeholderColor: "#6E7681",
    wrapMode: "word",
    showCursor: true,
    cursorColor: "#58A6FF",
    onSubmit: async () => {
      const message = input.getText()
      if (message.trim()) {
        await handleMessage(message, ui)
      }
    }
  })
  inputBox.add(input)
  input.focus()

  // Status bar
  const status = new TextRenderable(renderer, {
    id: "status",
    content: "Ready",
    fg: "#8B949E",
    height: 1,
  })
  container.add(status)

  const ui: UI = {
    input,
    output,
    status,
    appendOutput: (text: string) => {
      output.content += text
    },
    setStatus: (text: string) => {
      status.content = text
    },
    clearInput: () => {
      input.setText("")
    }
  }

  return ui
}

async function handleMessage(message: string, ui: UI) {
  ui.appendOutput(`\n> ${message}\n\n`)
  ui.clearInput()
  ui.setStatus("Agent thinking...")
  
  // TODO: Call agent
  
  ui.setStatus("Ready")
}
```

### Phase 2: Vercel AI SDK Integration (Day 2)

**Goal**: Get agent loop working

**src/agent.ts**:
```typescript
import { streamText, tool } from "ai"
import { openai } from "@ai-sdk/openai"
import { z } from "zod"
import * as tools from "./tools"

const SYSTEM_PROMPT = `You are yeet, a minimal coding assistant.

You can:
- Read files (read tool)
- Edit files (edit tool)  
- Write new files (write tool)
- Execute bash commands (bash tool)

Be concise. Focus on the task. No fluff.`

export interface AgentConfig {
  model: string
  apiKey: string
  baseURL: string
  maxSteps: number
}

export async function* runAgent(
  message: string, 
  config: AgentConfig,
  onToolCall?: (tool: string) => void
) {
  const messages = [{ role: "user" as const, content: message }]
  
  const result = await streamText({
    model: openai(config.model, {
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    }),
    system: SYSTEM_PROMPT,
    messages,
    tools: {
      bash: tools.bash,
      read: tools.read,
      edit: tools.edit,
      write: tools.write,
    },
    maxSteps: config.maxSteps,
    temperature: 0.3,
  })

  // Stream text deltas
  for await (const chunk of result.fullStream) {
    if (chunk.type === "text-delta") {
      yield { type: "text", content: chunk.textDelta }
    }
    if (chunk.type === "tool-call") {
      onToolCall?.(chunk.toolName)
      yield { 
        type: "tool", 
        name: chunk.toolName, 
        args: chunk.args 
      }
    }
    if (chunk.type === "tool-result") {
      yield {
        type: "tool-result",
        name: chunk.toolName,
        result: chunk.result
      }
    }
  }
  
  yield { type: "done" }
}
```

**Update src/ui.ts handleMessage**:
```typescript
async function handleMessage(message: string, ui: UI) {
  ui.appendOutput(`\n> ${message}\n\n`)
  ui.clearInput()
  ui.setStatus("Agent thinking...")
  
  const config = {
    model: "glm-4", // OpenCode Zen GLM 4.6
    apiKey: process.env.OPENCODE_API_KEY || "",
    baseURL: "https://api.opencode.ai/v1",
    maxSteps: 5,
  }
  
  try {
    for await (const event of runAgent(message, config, (tool) => {
      ui.setStatus(`Running ${tool}...`)
    })) {
      if (event.type === "text") {
        ui.appendOutput(event.content)
      } else if (event.type === "tool") {
        ui.appendOutput(`\n[${event.name}]\n`)
      } else if (event.type === "tool-result") {
        ui.appendOutput(`\n`)
      }
    }
  } catch (error) {
    ui.appendOutput(`\n❌ Error: ${error.message}\n`)
  }
  
  ui.setStatus("Ready")
}
```

### Phase 3: Tool Implementation (Day 3)

**src/tools/bash.ts**:
```typescript
import { tool } from "ai"
import { z } from "zod"
import { $ } from "bun"

export const bash = tool({
  description: "Execute a bash command in the current directory",
  parameters: z.object({
    command: z.string().describe("The bash command to execute")
  }),
  execute: async ({ command }) => {
    try {
      const result = await $`${command}`.nothrow()
      return {
        stdout: result.stdout.toString(),
        stderr: result.stderr.toString(),
        exitCode: result.exitCode
      }
    } catch (error) {
      return {
        error: error.message,
        exitCode: 1
      }
    }
  }
})
```

**src/tools/read.ts**:
```typescript
import { tool } from "ai"
import { z } from "zod"

export const read = tool({
  description: "Read the contents of a file",
  parameters: z.object({
    path: z.string().describe("Path to the file to read")
  }),
  execute: async ({ path }) => {
    try {
      const file = Bun.file(path)
      const content = await file.text()
      return { content }
    } catch (error) {
      return { error: `Failed to read ${path}: ${error.message}` }
    }
  }
})
```

**src/tools/edit.ts**:
```typescript
import { tool } from "ai"
import { z } from "zod"

export const edit = tool({
  description: "Edit a file by replacing old text with new text",
  parameters: z.object({
    path: z.string().describe("Path to the file to edit"),
    oldText: z.string().describe("Text to find and replace"),
    newText: z.string().describe("Text to replace with")
  }),
  execute: async ({ path, oldText, newText }) => {
    try {
      const file = Bun.file(path)
      const content = await file.text()
      
      if (!content.includes(oldText)) {
        return { 
          error: `Could not find text to replace in ${path}` 
        }
      }
      
      const updated = content.replace(oldText, newText)
      await Bun.write(path, updated)
      
      return { success: true, message: `Updated ${path}` }
    } catch (error) {
      return { error: `Failed to edit ${path}: ${error.message}` }
    }
  }
})
```

**src/tools/write.ts**:
```typescript
import { tool } from "ai"
import { z } from "zod"

export const write = tool({
  description: "Write content to a new file",
  parameters: z.object({
    path: z.string().describe("Path for the new file"),
    content: z.string().describe("Content to write")
  }),
  execute: async ({ path, content }) => {
    try {
      await Bun.write(path, content)
      return { success: true, message: `Created ${path}` }
    } catch (error) {
      return { error: `Failed to write ${path}: ${error.message}` }
    }
  }
})
```

**src/tools/index.ts**:
```typescript
export { bash } from "./bash"
export { read } from "./read"
export { edit } from "./edit"
export { write } from "./write"
```

### Phase 4: Polish & Testing (Day 4)

**Features to add**:
1. Scrolling in output view (TextRenderable with scroll)
2. Better tool output formatting
3. Error handling and display
4. Loading indicators during API calls
5. Config file for API key

**Create ~/.yeet/config.json**:
```json
{
  "opencode": {
    "apiKey": "your-api-key-here",
    "baseURL": "https://api.opencode.ai/v1",
    "model": "glm-4"
  }
}
```

**Add config loading**:
```typescript
// src/config.ts
import path from "path"
import os from "os"

export interface Config {
  opencode: {
    apiKey: string
    baseURL: string
    model: string
  }
}

export async function loadConfig(): Promise<Config> {
  const configPath = path.join(os.homedir(), ".yeet", "config.json")
  const file = Bun.file(configPath)
  
  if (!(await file.exists())) {
    throw new Error(
      `Config not found at ${configPath}\n` +
      `Create it with:\n` +
      `mkdir -p ~/.yeet\n` +
      `echo '{"opencode": {"apiKey": "...", "baseURL": "https://api.opencode.ai/v1", "model": "glm-4"}}' > ~/.yeet/config.json`
    )
  }
  
  return await file.json()
}
```

## Usage

```bash
# Install dependencies
cd ~/code/yeet
bun install

# Create config
mkdir -p ~/.yeet
echo '{"opencode": {"apiKey": "sk-...", "baseURL": "https://api.opencode.ai/v1", "model": "glm-4"}}' > ~/.yeet/config.json

# Run
bun src/index.ts

# Or install globally
bun link
yeet
```

**Example interaction**:
```
┌─ Conversation ─────────────────────────────┐
│ Welcome to yeet! Start typing below...     │
│                                             │
│ > Add error handling to src/app.ts         │
│                                             │
│ I'll add error handling to src/app.ts.     │
│                                             │
│ [read]                                      │
│ [edit]                                      │
│                                             │
│ I've added try-catch blocks around the     │
│ main logic. The changes include:           │
│ - Wrapped fetch in try-catch               │
│ - Added error logging                      │
│ - Return error response on failure         │
│                                             │
└────────────────────────────────────────────┘
┌─ Your Message (Ctrl+Enter to send) ────────┐
│ Run the tests                              │
│                                             │
└────────────────────────────────────────────┘
Ready
```

## OpenTUI Components Used

Based on study of ~/code/opentui/packages/core/src/examples/:

### TextareaRenderable
- **Purpose**: Multi-line text editing
- **Features**: Cursor, selection, word wrap, undo/redo
- **Used for**: Input box where user types
- **Key properties**: 
  - `showCursor: true`
  - `wrapMode: "word"`
  - `onSubmit: (event) => {}`
  - `textColor`, `backgroundColor`

### TextRenderable
- **Purpose**: Display styled text
- **Features**: Colors, formatting, scrolling
- **Used for**: Output area showing conversation
- **Key properties**:
  - `content: string` (can be updated)
  - `fg`, `bg` colors
  - Auto-scrolling as content grows

### BoxRenderable
- **Purpose**: Layout container with borders
- **Features**: Borders, padding, flex layout
- **Used for**: Wrapping input/output areas
- **Key properties**:
  - `borderStyle: "single" | "rounded"`
  - `title`, `titleAlignment`
  - `flexGrow` for sizing

### CliRenderer
- **Purpose**: Terminal rendering engine
- **Features**: 60fps, keyboard/mouse input, alternate screen
- **Used for**: Main application loop
- **Key methods**:
  - `createCliRenderer({ targetFps: 60 })`
  - `renderer.root.add(component)`
  - `renderer.keyInput.on("keypress", handler)`

## Differences from OpenCode

| Feature | OpenCode | Yeet |
|---------|----------|------|
| Architecture | Go TUI + Node.js server | Single TypeScript process |
| Session management | Full sessions, history, persistence | No sessions, ephemeral |
| Tools | 15+ tools | 4 tools (bash, read, edit, write) |
| Models | 20+ models | 1 model (OpenCode Zen GLM 4.6) |
| UI | Multi-pane, tabs, complex layout | Single input/output |
| File context | Smart context gathering | No automatic context |
| Codebase | ~50K LOC | ~300 LOC |
| Purpose | Production coding agent | Learning/experimentation |

## Success Criteria

**Phase 1**: ✅ TUI renders
- Can type in input box
- Output box displays text
- Keyboard shortcuts work

**Phase 2**: ✅ Agent responds
- Send message, get response
- Text streams in real-time
- Error handling works

**Phase 3**: ✅ Tools work
- Agent can read files
- Agent can edit files
- Agent can run commands
- Agent can write new files

**Phase 4**: ✅ Polish
- Good UX (scrolling, status, etc.)
- Config management
- Clean error messages
- Usable for real tasks

## Non-Goals

**What we're NOT building**:
- ❌ Session management
- ❌ History/undo
- ❌ Multi-file context gathering
- ❌ Multiple model support
- ❌ Git integration
- ❌ LSP integration
- ❌ Tabs/multi-pane UI
- ❌ Persistent storage
- ❌ Advanced tools (grep, glob, mcp)
- ❌ Testing/benchmarking agent quality

**What we ARE building**:
- ✅ Chat interface
- ✅ Code editing capability
- ✅ Real-time streaming
- ✅ Basic tool calling
- ✅ Learning platform for understanding agents
- ✅ Foundation for experimentation

## Timeline

**Week 1**: Build core
- Day 1: OpenTUI setup, basic layout
- Day 2: Vercel AI SDK integration, streaming
- Day 3: Tool implementation
- Day 4: Polish, config, testing

**Week 2**: Use & learn
- Test on real tasks
- Document learnings
- Compare to other agents
- Iterate on prompts/tools

## Open Questions

1. **Scrolling**: How to auto-scroll output as content grows?
   - TextRenderable with ScrollBox?
   - Or manual scroll controls?

2. **Streaming UX**: How to show tool calls?
   - Inline like `[bash]`?
   - Separate status line?
   - Expandable sections?

3. **Error recovery**: What if tool fails?
   - Show error, let user retry?
   - Agent auto-retry?

4. **Context size**: How much conversation history?
   - No history (ephemeral)?
   - Last N messages?
   - Smart truncation?

5. **API key management**: Store where?
   - Config file? ✅
   - Environment variable?
   - Keychain integration?

## Learning Goals

**What we'll learn from building this**:
1. How TUI rendering works (OpenTUI internals)
2. How Vercel AI SDK handles streaming
3. Tool call patterns and best practices
4. Prompt engineering for code tasks
5. Real-time UX challenges
6. What makes a good coding agent tool

**What we'll compare**:
- Yeet vs opencode (feature richness)
- Yeet vs droid (approach differences)
- Yeet vs aider (tool design)
- GLM 4.6 model quality

## Future Enhancements (Maybe)

If we want to expand later:
- **History**: Keep last 10 messages
- **Files panel**: Show edited files
- **Grep/glob tools**: Better codebase search
- **Multi-model**: Try different models
- **Session save**: Persist conversation
- **MCP integration**: Use MCP servers
- **Diff view**: Show changes before applying
- **Git tools**: Commit, diff, etc.

But start with absolute minimum!

## References

- **OpenTUI docs**: ~/code/opentui/packages/core/
- **OpenTUI examples**: ~/code/opentui/packages/core/src/examples/
  - editor-demo.ts - TextareaRenderable usage
  - input-demo.ts - Input handling
  - console-demo.ts - Layout and rendering
- **Vercel AI SDK**: https://sdk.vercel.ai/docs
- **OpenCode source**: ~/code/opencode/packages/opencode/src/
  - cli/cmd/tui.ts - How they launch TUI
  - session/prompt.ts - Inference loop
- **Aider**: https://github.com/paul-gauthier/aider (tool/prompt inspiration)

## Next Steps

1. ✅ Create project structure
2. ✅ Install dependencies
3. ✅ Implement Phase 1 (OpenTUI setup)
4. Test basic rendering
5. Implement Phase 2 (Agent loop)
6. Test with dummy responses
7. Implement Phase 3 (Tools)
8. Test on real code editing task
9. Polish UX
10. Document learnings

---

**Status**: 📋 Planning
**Priority**: High (learning project)
**Est. Effort**: 4 days to working prototype
**Learning Value**: 🔥🔥🔥 Very High
**Fun Factor**: 🎉🎉🎉 Super Fun

Let's build something cool!
