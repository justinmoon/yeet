#!/usr/bin/env bun
// Default entry point - runs TUI or orchestrator demo

// Check if running orchestrator demo
if (process.argv.includes("--orchestrator")) {
  await import("./orchestrator/demo");
} else {
  // Run normal TUI
  await import("./tui");
}
