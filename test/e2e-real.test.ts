// @ts-nocheck
import { test, expect } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { createUI } from "../src/ui"
import { loadConfig } from "../src/config"

test("E2E with REAL API - reproduce display issue", async () => {
  const config = await loadConfig()
  
  const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({
    width: 100,
    height: 30,
  })

  const ui = createUI(renderer, config)
  renderer.start()
  await renderOnce()

  console.log("\n=== INITIAL STATE ===")
  console.log(captureCharFrame())

  // Simulate user input
  ui.input.editBuffer.insertText("list files in this folder")
  await renderOnce()

  console.log("\n=== AFTER TYPING ===")
  console.log(captureCharFrame())

  // Send the message
  const message = ui.input.editBuffer.getText()
  console.log("\n=== SENDING:", message, "===\n")

  // This will trigger real API call with full logging
  ui.appendOutput(`You: ${message}\n\n`)
  ui.clearInput()
  ui.setStatus("Agent thinking...")

  try {
    ui.appendOutput("Assistant: ")
    
    // Import here to ensure fresh module
    const { runAgent } = await import("../src/agent")
    
    for await (const event of runAgent(message, config, (tool) => {
      ui.setStatus(`Running ${tool}...`)
    })) {
      if (event.type === "text") {
        ui.appendOutput(event.content || "")
      } else if (event.type === "tool") {
        ui.appendOutput(`\n[${event.name}]\n`)
      } else if (event.type === "tool-result") {
        const resultStr = typeof event.result === "string" 
          ? event.result 
          : JSON.stringify(event.result, null, 2)
        ui.appendOutput(`${resultStr}\n`)
      } else if (event.type === "error") {
        ui.appendOutput(`\n❌ Error: ${event.error}\n`)
      }
      
      await renderOnce()
    }
    
    ui.appendOutput("\n")
    ui.setStatus("Done")
  } catch (error) {
    ui.appendOutput(`\n❌ Error: ${error.message}\n`)
  }

  await renderOnce()
  
  console.log("\n=== FINAL STATE ===")
  const finalFrame = captureCharFrame()
  console.log(finalFrame)

  // Check for the bug
  if (finalFrame.includes("No command provided")) {
    console.error("\n❌ BUG REPRODUCED: Tool received empty args")
  }
  
  renderer.destroy()
}, {
  timeout: 30000, // 30 seconds for API call
})

// Remove .skip to run:
// bun test test/e2e-real.test.ts
