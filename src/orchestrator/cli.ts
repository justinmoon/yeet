#!/usr/bin/env bun
/**
 * Standalone CLI for running workflows
 * Usage: bun run src/orchestrator/cli.ts <workflow> <task>
 */

import { runWorkflow } from "./index";
import { WORKFLOWS } from "./workflows";
import { loadConfig } from "../config";

export async function runOrchestratorCLI(args: string[]) {

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(`
🤖 Yeet Orchestrator - LLM-based workflow execution

Usage: 
  bun run src/orchestrator/cli.ts <workflow> <task>

Available workflows:
  code-review          Review code for security, style, correctness
  bug-investigation    Systematically investigate and fix bugs

Examples:
  bun run src/orchestrator/cli.ts code-review "Review auth.ts for security issues"
  bun run src/orchestrator/cli.ts bug-investigation "Users can't login"

Options:
  --list              List all available workflows
  -h, --help          Show this help
    `);
    return;
  }

  if (args.includes("--list")) {
    console.log("\n📋 Available workflows:\n");
    Object.entries(WORKFLOWS).forEach(([key, workflow]) => {
      console.log(`  ${key.padEnd(20)} ${workflow.description}`);
    });
    console.log();
    return;
  }

  const workflowName = args[0];
  const task = args.slice(1).join(" ");

  if (!task) {
    console.error("❌ Error: Task description required");
    console.error("Usage: bun run src/orchestrator/cli.ts <workflow> <task>");
    process.exit(1);
  }

  const workflow = WORKFLOWS[workflowName as keyof typeof WORKFLOWS];
  if (!workflow) {
    console.error(`❌ Error: Unknown workflow '${workflowName}'`);
    console.error(
      `Available: ${Object.keys(WORKFLOWS).join(", ")}`,
    );
    process.exit(1);
  }

  console.log(`\n🚀 Starting workflow: ${workflow.name}`);
  console.log(`📝 Task: ${task}\n`);

  const config = await loadConfig();

  try {
    const result = await runWorkflow(workflow, task, config);

    console.log("\n\n" + "=".repeat(70));
    console.log("📊 WORKFLOW RESULTS");
    console.log("=".repeat(70));

    console.log(`\n✓ Completed in ${result.transitionCount} transitions\n`);

    console.log("📍 Stage History:");
    result.history.forEach((h, i) => {
      console.log(`   ${i + 1}. ${h}`);
    });

    if (result.finalSummary) {
      console.log(`\n✨ Final Summary:`);
      console.log(`   ${result.finalSummary}`);
    }

    console.log(`\n📈 Stage Results:`);
    Object.entries(result.result).forEach(([stage, res]: [string, any]) => {
      console.log(`\n   ${stage.toUpperCase()}:`);
      if (res?.findings) {
        console.log(`      Findings: ${res.findings}`);
      }
      if (res?.recommendation) {
        console.log(`      Recommendation: ${res.recommendation}`);
      }
    });

    console.log("\n" + "=".repeat(70) + "\n");
  } catch (error: any) {
    console.error("\n❌ Workflow failed:", error.message);
    process.exit(1);
  }
}

// Allow running as standalone script
if (import.meta.main) {
  const args = process.argv.slice(2);
  runOrchestratorCLI(args).catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
