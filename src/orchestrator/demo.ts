/**
 * Demo script to run the orchestrator with code review workflow
 */

import { runWorkflow } from "./index";
import { CODE_REVIEW_WORKFLOW, BUG_INVESTIGATION_WORKFLOW } from "./workflows";
import { loadConfig } from "../config";

async function main() {
  const config = await loadConfig();

  console.log("🤖 LLM-Based State Machine Orchestration Demo\n");
  console.log("This demonstrates prompt-based workflow orchestration");
  console.log("where the LLM manages state transitions.\n");

  // Example 1: Code Review
  console.log("\n" + "=".repeat(70));
  console.log("📝 Example 1: Code Review Workflow");
  console.log("=".repeat(70));

  const codeToReview = `
// auth.ts
export function loginUser(username: string, password: string) {
  const query = "SELECT * FROM users WHERE username = '" + username + "' AND password = '" + password + "'";
  const user = db.query(query);
  return user;
}
  `.trim();

  try {
    const result = await runWorkflow(
      CODE_REVIEW_WORKFLOW,
      `Review this authentication code for security, style, and correctness:\n\n${codeToReview}`,
      config,
    );

    console.log("\n\n📊 Results:");
    console.log("─".repeat(70));
    console.log(`Transitions: ${result.transitionCount}`);
    console.log(`\nStage History:`);
    result.history.forEach((h, i) => console.log(`  ${i + 1}. ${h}`));

    if (result.finalSummary) {
      console.log(`\n✓ Final Summary:\n  ${result.finalSummary}`);
    }

    console.log("\n📈 Stage Results:");
    Object.entries(result.result).forEach(([stage, res]) => {
      console.log(`\n  ${stage}:`);
      console.log(`    ${JSON.stringify(res, null, 4)}`);
    });
  } catch (error: any) {
    console.error("\n❌ Error:", error.message);
  }
}

main().catch(console.error);
