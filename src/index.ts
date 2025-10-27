#!/usr/bin/env bun
import { createCliRenderer } from "@opentui/core"
import { createUI } from "./ui"
import { loadConfig } from "./config"

async function main() {
  try {
    // Load config
    const config = await loadConfig()

    // Create renderer
    const renderer = await createCliRenderer({
      exitOnCtrlC: true,
      targetFps: 60,
    })

    // Create UI
    createUI(renderer, config)

    // Start renderer
    renderer.start()

    console.log("Yeet started. Type your message and press Enter to send (Shift+Enter for newlines).")
  } catch (error: any) {
    console.error(`Failed to start yeet: ${error.message}`)
    process.exit(1)
  }
}

main()
