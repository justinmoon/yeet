#!/usr/bin/env bun
import "../solid-preload";
import { loadConfig } from "./config";
import { logger } from "./logger";
import { createTUISolidAdapter } from "./ui/tui-solid-adapter";

const args = process.argv.slice(2);

// Check for orchestrator flag
if (args.includes("--orchestrate") || args.includes("orchestrate")) {
  // Remove the orchestrate flag/command
  const orchestrateArgs = args.filter(
    (arg) => arg !== "--orchestrate" && arg !== "orchestrate",
  );

  // Import and run orchestrator CLI
  const { runOrchestratorCLI } = await import("./orchestrator/cli");
  await runOrchestratorCLI(orchestrateArgs);
} else {
  // Run normal TUI
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
