import {
  type CliRenderer,
  BoxRenderable,
  TextareaRenderable,
  TextRenderable,
  type KeyEvent,
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

  // Output area (grows to fill space)
  const outputBox = new BoxRenderable(renderer, {
    id: "output-box",
    borderStyle: "single",
    borderColor: "#30363D",
    title: "Conversation",
    titleAlignment: "left",
    flexGrow: 1,
    border: true,
  })
  container.add(outputBox)

  const output = new TextRenderable(renderer, {
    id: "output",
    content: "",
    fg: "#C9D1D9",
  })
  outputBox.add(output)

  // Input area (fixed height at bottom)
  const inputBox = new BoxRenderable(renderer, {
    id: "input-box",
    borderStyle: "single",
    borderColor: "#58A6FF",
    title: "Your Message",
    titleAlignment: "left",
    height: 5,
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
        console.error("[UI] Tool call:", event.name, "args:", JSON.stringify(event.args, null, 2))
        ui.appendOutput(`\n[${event.name}] ${JSON.stringify(event.args)}\n`)
      } else if (event.type === "tool-result") {
        // Display tool results
        const resultStr = typeof event.result === "string" 
          ? event.result 
          : JSON.stringify(event.result, null, 2)
        ui.appendOutput(`${resultStr}\n`)
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
