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
import { parseCommand, executeCommand, handleMapleSetup } from "./commands"
import { getModelInfo } from "./models/registry"
import { logger } from "./logger"

export interface UI {
  input: TextareaRenderable
  output: TextRenderable
  status: TextRenderable
  contentBuffer: string
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>
  appendOutput: (text: string) => void
  setStatus: (text: string) => void
  clearInput: () => void
  pendingMapleSetup?: {
    modelId: string
  }
}

export function createUI(renderer: CliRenderer, config: Config): UI {
  renderer.setBackgroundColor("#0D1117")

  // Main container
  const container = new BoxRenderable(renderer, {
    id: "main",
    padding: 1,
  })
  renderer.root.add(container)

  // Get current model info for status
  const currentModelId = config.activeProvider === "opencode" 
    ? config.opencode.model 
    : config.maple?.model || ""
  const modelInfo = getModelInfo(currentModelId)
  const modelDisplay = modelInfo ? `${modelInfo.name} (${config.activeProvider})` : currentModelId

  // Status bar at top
  const status = new TextRenderable(renderer, {
    id: "status",
    content: `Ready • ${modelDisplay} • Press Enter to send`,
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
    conversationHistory: [],  // Initialize conversation history
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
      
      // @ts-ignore - optional internal API for forcing re-render
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
        // Check if we're waiting for Maple API key
        if (ui.pendingMapleSetup) {
          const apiKey = message
          const modelId = ui.pendingMapleSetup.modelId
          ui.pendingMapleSetup = undefined
          ui.clearInput()
          await handleMapleSetup(apiKey, modelId, ui, config)
        } else {
          const parsed = parseCommand(message)
          if (parsed.isCommand && parsed.command) {
            ui.clearInput()
            await executeCommand(parsed.command, parsed.args, ui, config)
          } else {
            await handleMessage(message, ui, config)
          }
        }
      }
    }
  })

  return ui
}

async function handleMessage(message: string, ui: UI, config: Config) {
  logger.info("Handling user message", { messageLength: message.length })
  
  // Add separator if there's already content
  if (ui.contentBuffer.length > 0) {
    ui.appendOutput("\n" + "─".repeat(60) + "\n\n")
  }
  
  ui.appendOutput(`You: ${message}\n\n`)
  ui.clearInput()
  ui.setStatus("Agent thinking... • Press Enter to send")

  try {
    ui.appendOutput("Assistant: ")
    
    // Build conversation history with current message
    const messages = [
      ...ui.conversationHistory,
      { role: "user" as const, content: message }
    ]
    
    let assistantResponse = ""
    let textChunks = 0
    for await (const event of runAgent(messages, config, (tool) => {
      logger.debug("Tool called", { tool })
      ui.setStatus(`Running ${tool}... • Press Enter to send`)
    })) {
      logger.debug("Agent event", { type: event.type })
      
      if (event.type === "text") {
        textChunks++
        logger.debug("Text chunk received", { content: event.content?.substring(0, 50), chunkNumber: textChunks })
        const text = event.content || ""
        assistantResponse += text
        ui.appendOutput(text)
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
    
    // Save conversation to history
    ui.conversationHistory.push({ role: "user", content: message })
    if (assistantResponse) {
      ui.conversationHistory.push({ role: "assistant", content: assistantResponse })
    }
    
    logger.info("Message handled successfully", { textChunks, historyLength: ui.conversationHistory.length })
  } catch (error: any) {
    logger.error("Error handling message", { error: error.message, stack: error.stack })
    ui.appendOutput(`\n❌ Error: ${error.message}\n`)
  }

  const currentModelId = config.activeProvider === "opencode" 
    ? config.opencode.model 
    : config.maple?.model || ""
  const modelInfo = getModelInfo(currentModelId)
  const modelDisplay = modelInfo ? `${modelInfo.name} (${config.activeProvider})` : currentModelId
  ui.setStatus(`Ready • ${modelDisplay} • Press Enter to send`)
}
