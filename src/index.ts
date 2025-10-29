#!/usr/bin/env bun
// Default entry point - runs TUI or orchestrator

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
  await import("./tui");
}

export {}; // Make this file a module
