#!/usr/bin/env bun
import "../solid-preload";
import { loadConfig } from "./config";
import { logger } from "./logger";
import { createTUISolidAdapter } from "./ui/tui-solid-adapter.tsx";

async function main() {
  try {
    logger.info("Yeet TUI starting");

    const config = await loadConfig();
    logger.info("Config loaded", { activeProvider: config.activeProvider });

    const ui = await createTUISolidAdapter(config);

    // Keep process alive
    process.on("SIGINT", async () => {
      await ui.stop();
      await logger.close();
      process.exit(0);
    });
  } catch (error: any) {
    logger.error("Failed to start yeet TUI", {
      error: error.message,
      stack: error.stack,
    });
    console.error(`Failed to start yeet TUI: ${error.message}`);
    await logger.close();
    process.exit(1);
  }
}

main();
