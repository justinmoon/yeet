// @ts-nocheck - AI SDK v5 types are complex
import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test"
import { createTestRenderer, type TestRenderer } from "@opentui/core/testing"
import { createUI } from "../src/ui"
import type { Config } from "../src/config"
import * as agentModule from "../src/agent"

let testRenderer: TestRenderer
let renderOnce: () => Promise<void>
let captureFrame: () => string
let mockInput: any

const mockConfig: Config = {
  opencode: {
    apiKey: "test-key",
    baseURL: "https://api.test.com/v1",
    model: "test-model",
  },
  maxSteps: 5,
  temperature: 0.3,
}

beforeEach(async () => {
  ;({
    renderer: testRenderer,
    renderOnce,
    captureCharFrame: captureFrame,
    mockInput,
  } = await createTestRenderer({
    width: 80,
    height: 24,
  }))
})

afterEach(() => {
  testRenderer.destroy()
})

describe("E2E: Full conversation flow", () => {
  test("simulated conversation with manual message flow", async () => {
    const ui = createUI(testRenderer, mockConfig)
    testRenderer.start()
    await renderOnce()

    console.log("\n=== Initial State ===")
    let frame = captureFrame()
    console.log(frame)
    
    // Check initial state
    expect(frame).toContain("Your Message")
    expect(frame).toContain("Ready")

    // Simulate user typing "hello"
    ui.input.editBuffer.insertText("hello")
    await renderOnce()

    console.log("\n=== After Typing ===")
    frame = captureFrame()
    console.log(frame)
    expect(frame).toContain("hello")

    // Simulate pressing Enter (trigger what the handler does)
    const message = ui.input.editBuffer.getText()
    console.log("\n=== Message to send:", JSON.stringify(message), "===")
    
    // Manually trigger what the Enter handler does
    ui.appendOutput(`You: ${message}\n\n`)
    ui.clearInput()
    ui.setStatus("Agent thinking... • Press Enter to send")
    
    await renderOnce()

    console.log("\n=== After Enter (before AI) ===")
    frame = captureFrame()
    console.log(frame)
    
    // Check that user message appears
    expect(frame).toContain("You: hello")
    expect(frame).toContain("Agent thinking")

    // Now simulate AI response
    ui.appendOutput("Assistant: ")
    ui.appendOutput("I ")
    ui.appendOutput("can ")
    ui.appendOutput("help ")
    ui.appendOutput("with ")
    ui.appendOutput("that!")
    ui.appendOutput("\n")
    ui.setStatus("Ready • Press Enter to send")

    await renderOnce()

    console.log("\n=== After AI Response ===")
    frame = captureFrame()
    console.log(frame)

    // Check that AI response appears
    expect(frame).toContain("You: hello")
    expect(frame).toContain("Assistant: I can help with that!")
    expect(frame).not.toContain("[object Object]")
  })

  test("DEBUG: Check what appendOutput actually does", async () => {
    const ui = createUI(testRenderer, mockConfig)
    testRenderer.start()
    await renderOnce()

    console.log("\n=== Initial output.content type:", typeof ui.output.content)
    console.log("Initial output.content value:", JSON.stringify(ui.output.content))
    
    ui.appendOutput("Test message")
    
    console.log("After append output.content type:", typeof ui.output.content)
    console.log("After append output.content value:", JSON.stringify(ui.output.content))
    
    await renderOnce()
    
    const frame = captureFrame()
    console.log("\n=== Frame after appendOutput ===")
    console.log(frame)
    
    expect(frame).not.toContain("[object Object]")
    expect(frame).toContain("Test message")
  })

  test("multiple conversation rounds", async () => {
    const ui = createUI(testRenderer, mockConfig)
    testRenderer.start()
    await renderOnce()

    // Round 1
    ui.appendOutput("You: How do I create a file?\n\n")
    ui.appendOutput("Assistant: Use the write tool to create files.\n")
    await renderOnce()

    // Round 2
    ui.appendOutput("\n" + "─".repeat(60) + "\n\n")
    ui.appendOutput("You: Thanks!\n\n")
    ui.appendOutput("Assistant: You're welcome!\n")
    await renderOnce()

    const frame = captureFrame()
    console.log("\n=== After Multiple Rounds ===")
    console.log(frame)

    expect(frame).toContain("How do I create a file")
    expect(frame).toContain("Use the write tool")
    expect(frame).toContain("Thanks!")
    expect(frame).toContain("You're welcome")
    expect(frame).not.toContain("[object Object]")
  })
})
