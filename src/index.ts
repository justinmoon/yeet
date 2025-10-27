#!/usr/bin/env bun
import { createCliRenderer } from "@opentui/core"
import { createUI } from "./ui"
import { loadConfig } from "./config"
import { logger } from "./logger"

async function main() {
  try {
    logger.info("Yeet starting")
    
    // Load config
    const config = await loadConfig()
    logger.info("Config loaded", { activeProvider: config.activeProvider })

    // Create renderer
    const renderer = await createCliRenderer({
      exitOnCtrlC: true,
      targetFps: 60,
    })

    // Create UI
    createUI(renderer, config)

    // Start renderer
    renderer.start()
    logger.info("TUI renderer started")

    console.log("Yeet started. Type your message and press Enter to send (Shift+Enter for newlines).")
  } catch (error: any) {
    logger.error("Failed to start yeet", { error: error.message, stack: error.stack })
    console.error(`Failed to start yeet: ${error.message}`)
    await logger.close()
    process.exit(1)
  }
}

main()
