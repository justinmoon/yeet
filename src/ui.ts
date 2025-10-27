import {
  type CliRenderer,
  BoxRenderable,
  TextareaRenderable,
  TextRenderable,
  type KeyEvent,
  ScrollBoxRenderable,
} from "@opentui/core"
import { runAgent, type AgentEvent } from "./agent"
import type { Config } from "./config"

export interface UI {
  input: TextareaRenderable
  output: TextRenderable
  status: TextRenderable
  contentBuffer: string  // Track content as a string
  appendOutput: (text: string) => void
  setStatus: (text: string) => void
  clearInput: () => void
}

export function createUI(renderer: CliRenderer, config: Config): UI {
  renderer.setBackgroundColor("#0D1117")

  // Main container
  const container = new BoxRenderable(renderer, {
    id: "main",
    padding: 1,
  })
  renderer.root.add(container)

  // Status bar at top
  const status = new TextRenderable(renderer, {
    id: "status",
    content: "Ready • Press Enter to send",
    fg: "#8B949E",
    height: 1,
  })
  container.add(status)

  // Output area (grows to fill space) - with scrolling
  const scrollBox = new ScrollBoxRenderable(renderer, {
    id: "output-scroll",
    borderStyle: "single",
    borderColor: "#30363D",
    title: "Conversation",
    titleAlignment: "left",
    flexGrow: 1,
    flexShrink: 1,  // Allow shrinking to not overlap input
    border: true,
    stickyScroll: true,
    stickyStart: "bottom",
    scrollY: true,
    scrollX: false,
    overflow: "hidden",  // Clip content that would overflow
  })
  container.add(scrollBox)

  // Wrap text in a box (like the examples do)
  const outputBox = new BoxRenderable(renderer, {
    id: "output-wrapper",
    width: "auto",
  })
  
  const output = new TextRenderable(renderer, {
    id: "output",
    content: "",
    fg: "#C9D1D9",
  })
  outputBox.add(output)
  scrollBox.add(outputBox)

  // Input area (fixed height at bottom) - with high z-index to prevent overlap
  const inputBox = new BoxRenderable(renderer, {
    id: "input-box",
    borderStyle: "single",
    borderColor: "#58A6FF",
    title: "Your Message",
    titleAlignment: "left",
    height: 5,
    border: true,
    zIndex: 100,  // High z-index to render on top
    backgroundColor: "#0D1117",  // Solid background to block content below
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
  })
  inputBox.add(input)
  input.focus()

  const ui: UI = {
    input,
    output,
    status,
    contentBuffer: "",  // Initialize as empty string
    appendOutput: (text: string) => {
      ui.contentBuffer += text
      output.content = ui.contentBuffer  // Set the whole string, don't concatenate!
      
      // Force layout recalculation and scroll to bottom
      // @ts-ignore - internal API but necessary for correct rendering
      scrollBox.recalculateBarProps?.()
      
      // Scroll to bottom (show newest content)
      // @ts-ignore - accessing internal scroll properties
      const maxScroll = Math.max(0, scrollBox.scrollHeight - scrollBox.viewport.height)
      scrollBox.scrollTop = maxScroll
      
      renderer.requestAnimationFrame?.(() => {
        // Double render to ensure layout is correct
      })
    },
    setStatus: (text: string) => {
      status.content = text
    },
    clearInput: () => {
      input.editBuffer.setText("", { history: false })
    },
  }

  // Handle Enter to submit (but allow Shift+Enter for newlines)
  renderer.keyInput.on("keypress", async (key: KeyEvent) => {
    if (key.name === "return" && !key.shift) {
      key.preventDefault()
      const message = input.editBuffer.getText()
      if (message.trim()) {
        await handleMessage(message, ui, config)
      }
    }
  })

  return ui
}

async function handleMessage(message: string, ui: UI, config: Config) {
  // Add separator if there's already content
  if (ui.contentBuffer.length > 0) {
    ui.appendOutput("\n" + "─".repeat(60) + "\n\n")
  }
  
  ui.appendOutput(`You: ${message}\n\n`)
  ui.clearInput()
  ui.setStatus("Agent thinking... • Press Enter to send")

  try {
    ui.appendOutput("Assistant: ")
    for await (const event of runAgent(message, config, (tool) => {
      ui.setStatus(`Running ${tool}... • Press Enter to send`)
    })) {
      if (event.type === "text") {
        ui.appendOutput(event.content || "")
      } else if (event.type === "tool") {
        // Show tool call with primary arg (e.g., "bash ls" instead of full JSON)
        const primaryArg = event.args?.command || event.args?.path || JSON.stringify(event.args)
        ui.appendOutput(`\n[${event.name}] ${primaryArg}\n`)
      } else if (event.type === "tool-result") {
        // Display tool results - format nicely
        if (typeof event.result === "string") {
          ui.appendOutput(`${event.result}\n`)
        } else if (event.result?.stdout) {
          // Bash tool result - show stdout directly
          ui.appendOutput(event.result.stdout)
          if (event.result.stderr) {
            ui.appendOutput(`stderr: ${event.result.stderr}`)
          }
          if (event.result.exitCode !== 0) {
            ui.appendOutput(`(exit code: ${event.result.exitCode})\n`)
          }
        } else {
          // Other tools - show JSON but formatted
          ui.appendOutput(JSON.stringify(event.result, null, 2) + "\n")
        }
      } else if (event.type === "error") {
        ui.appendOutput(`\n❌ Error: ${event.error}\n`)
      }
    }
    ui.appendOutput("\n")
  } catch (error: any) {
    ui.appendOutput(`\n❌ Error: ${error.message}\n`)
  }

  ui.setStatus("Ready • Press Enter to send")
}
