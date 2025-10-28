#!/usr/bin/env bun
import { loadConfig } from "./config";
import { logger } from "./logger";
import { createWebAdapter } from "./ui/web-adapter";

async function main() {
  try {
    logger.info("Yeet Web UI starting");

    const config = await loadConfig();
    logger.info("Config loaded", { activeProvider: config.activeProvider });

    const port = Number(process.env.PORT) || 8765;
    const ui = await createWebAdapter(config, port);

    // Keep process alive
    process.on("SIGINT", async () => {
      await ui.stop();
      await logger.close();
      process.exit(0);
    });

    // Keep the process running
    await new Promise(() => {});
  } catch (error: any) {
    logger.error("Failed to start yeet Web UI", {
      error: error.message,
      stack: error.stack,
    });
    console.error(`Failed to start yeet Web UI: ${error.message}`);
    await logger.close();
    process.exit(1);
  }
}

main();
