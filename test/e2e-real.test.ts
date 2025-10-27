// @ts-nocheck
import { test, expect } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { createUI } from "../src/ui"
import { loadConfig } from "../src/config"

test("E2E with REAL API - bash tool with clean output", async () => {
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

  // Verify fixes - scroll shows BOTTOM (newest content) like a chat
  expect(finalFrame).toContain("src")  // Files visible (end of list)
  expect(finalFrame).toContain("test")  // Files visible (end of list)
  expect(finalFrame).toContain("tsconfig.json")  // Files visible (last file)
  expect(finalFrame).not.toContain("No command provided")  // No errors
  
  // Check scrollbar is present (█ character)
  const hasScrollbar = finalFrame.includes("█")
  console.log(hasScrollbar ? "\n✅ Scrollbar present" : "\n⚠️  No scrollbar")
  
  // CHECK FOR OVERLAP: Look for file names mixed into other text
  const lines = finalFrame.split('\n')
  
  // Look for patterns like "BUattachREPORT" or "agents.mdORT"
  const suspiciousLines = lines.filter(line => {
    // Check if line has mixed content (file names mashed together)
    const hasMixedFiles = /[a-z][A-Z]/.test(line) && (/attach|agents\.md|bun\.lock/i.test(line))
    // Check if files appear in wrong places (like in "Your Message" line)
    const hasInputText = /Type your message|Your Message/i.test(line)
    const hasFileContent = /attach|bun\.lock|CHANGELOG|agents\.md/i.test(line)
    return (hasInputText && hasFileContent) || hasMixedFiles
  })
  
  console.log("\n=== OVERLAP DETECTION ===")
  console.log("Total lines:", lines.length)
  console.log("Suspicious lines:", suspiciousLines.length)
  
  if (suspiciousLines.length > 0) {
    console.error("\n❌ POSSIBLE OVERLAP DETECTED:")
    suspiciousLines.forEach((line, i) => {
      console.error(`  [${i}]:`, JSON.stringify(line))
    })
    throw new Error("Overlap detected in test output")
  } else {
    console.log("✅ No overlap detected in test renderer")
  }
  
  renderer.destroy()
}, {
  timeout: 30000, // 30 seconds for API call
})

// Remove .skip to run:
// bun test test/e2e-real.test.ts
