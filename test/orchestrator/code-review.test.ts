/**
 * E2E test for code review workflow
 */
import { describe, expect, test } from "bun:test";
import { loadConfig } from "../../src/config";
import { runWorkflow } from "../../src/orchestrator";
import { CODE_REVIEW_WORKFLOW } from "../../src/orchestrator/workflows";

describe("Code Review Workflow", () => {
  test(
    "should complete workflow for clean code",
    async () => {
      const config = await loadConfig();

      // Create a simple test file for review
      const testCode = `
// test-file.ts
export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
  return emailRegex.test(email);
}
      `.trim();

      const result = await runWorkflow(
        CODE_REVIEW_WORKFLOW,
        `Review this code for security, style, and correctness:\n\n${testCode}\n\nThis is a simple email validation function.`,
        config,
      );

      // Basic assertions
      expect(result.history.length).toBeGreaterThan(0);
      expect(result.transitionCount).toBeGreaterThan(0);

      // Should have gone through analyze stage
      expect(result.history.some((h) => h.includes("analyze"))).toBe(true);

      // Should reach a final state (approve or reject)
      const finalTransition = result.history[result.history.length - 1];
      expect(
        finalTransition.includes("approve") ||
          finalTransition.includes("reject"),
      ).toBe(true);

      console.log("\n📊 Test Results:");
      console.log(`   Transitions: ${result.transitionCount}`);
      console.log(`   History: ${result.history.join(" → ")}`);
      if (result.finalSummary) {
        console.log(`   Final Summary: ${result.finalSummary}`);
      }
    },
    { timeout: 120000 },
  ); // 2 minute timeout for LLM calls

  test(
    "should detect security issues",
    async () => {
      const config = await loadConfig();

      // Code with SQL injection vulnerability
      const vulnerableCode = `
// database.ts
export function getUserByEmail(email: string) {
  const query = "SELECT * FROM users WHERE email = '" + email + "'";
  return db.query(query);
}
      `.trim();

      const result = await runWorkflow(
        CODE_REVIEW_WORKFLOW,
        `Review this code for security issues:\n\n${vulnerableCode}\n\nThis is a database query function.`,
        config,
      );

      // Should go through security stage
      expect(result.history.some((h) => h.includes("security"))).toBe(true);

      console.log("\n📊 Security Test Results:");
      console.log(`   Transitions: ${result.transitionCount}`);
      console.log(`   History: ${result.history.join(" → ")}`);
    },
    { timeout: 120000 },
  );

  test(
    "should handle style issues",
    async () => {
      const config = await loadConfig();

      // Code with style issues
      const badStyleCode = `
// poorly-formatted.ts
function   foo(  x:number,y :  number  )
{
return x+y
}
      `.trim();

      const result = await runWorkflow(
        CODE_REVIEW_WORKFLOW,
        `Review this code:\n\n${badStyleCode}\n\nCheck for style and formatting issues.`,
        config,
      );

      // Should go through style stage
      expect(result.history.some((h) => h.includes("style"))).toBe(true);

      console.log("\n📊 Style Test Results:");
      console.log(`   Transitions: ${result.transitionCount}`);
      console.log(`   History: ${result.history.join(" → ")}`);
    },
    { timeout: 120000 },
  );
});
