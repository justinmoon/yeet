/**
 * Parallel workflow tests - 3 coders + 2 reviewers + debate
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { createActor } from "xstate";
import { parallelReviewWorkflow } from "../src/workflow-machine";

const TEST_DIRS = [
  "/tmp/workflow-agent-1",
  "/tmp/workflow-agent-2",
  "/tmp/workflow-agent-3",
  "/tmp/workflow-reviewer-1",
  "/tmp/workflow-reviewer-2",
];

beforeEach(() => {
  // Clean up test directories
  for (const dir of TEST_DIRS) {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true });
    }
  }
  console.log("🤖 Parallel Workflow Test - 3 Coders + 2 Reviewers + Debate");
});

afterEach(() => {
  // Clean up test directories
  for (const dir of TEST_DIRS) {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true });
    }
  }
});

describe("Parallel Workflow", () => {
  test("should run 3 parallel implementations", async () => {
    const task =
      "Create a file result.txt with the text 'Success'. Keep it simple.";

    const actor = createActor(parallelReviewWorkflow, {
      input: {
        task,
        implementationModels: [
          "claude-sonnet-4-5",
          "claude-haiku-4-5",
          "qwen3-coder",
        ],
        reviewerModels: ["claude-sonnet-4-5", "claude-haiku-4-5"],
        maxRevisions: 1,
      },
    });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        actor.stop();
        reject(new Error("Workflow timed out after 5 minutes"));
      }, 300000); // 5 minute timeout

      let lastState = "";
      actor.subscribe((state) => {
        const stateStr = JSON.stringify(state.value);
        if (stateStr !== lastState) {
          console.log(`  State: ${stateStr}`);
          lastState = stateStr;

          // Log parallel implementation progress
          if (
            typeof state.value === "object" &&
            "parallel-implementation" in state.value
          ) {
            const parallelState = (state.value as any)[
              "parallel-implementation"
            ];
            console.log(`    Agent states: ${JSON.stringify(parallelState)}`);
          }
        }

        if (state.matches("complete")) {
          clearTimeout(timeout);
          actor.stop();

          console.log("\n✅ Parallel workflow completed!");
          console.log(
            `  Implementations: ${state.context.implementations.size}`,
          );
          console.log(`  Reviews: ${state.context.reviews.size}`);
          console.log(
            `  Debate transcript: ${state.context.debateTranscript.length} messages`,
          );
          console.log(
            `  Consensus: ${state.context.consensus?.substring(0, 100)}...`,
          );
          console.log(`  Approved: ${state.context.approved}`);

          // Verify we have results
          expect(state.context.implementations.size).toBeGreaterThanOrEqual(1);
          expect(state.context.consensus).toBeDefined();
          expect(state.context.debateTranscript.length).toBeGreaterThan(0);

          // Log implementation details
          for (const [agentId, impl] of state.context.implementations) {
            console.log(`\n  ${agentId}:`);
            console.log(`    Success: ${impl.success}`);
            if (impl.success) {
              const lastMsg = impl.messages[impl.messages.length - 1];
              console.log(
                `    Output: ${lastMsg?.content.substring(0, 100)}...`,
              );
            } else {
              console.log(`    Error: ${impl.error}`);
            }
          }

          resolve(undefined);
        }
      });

      actor.start();
    });
  }, 360000); // 6 minute timeout for full parallel workflow

  test("should handle mixed success/failure in parallel implementations", async () => {
    // Use a task that might cause some agents to struggle
    const task =
      "Create a complex.txt file with the number 42. This is intentionally simple.";

    const actor = createActor(parallelReviewWorkflow, {
      input: {
        task,
        implementationModels: [
          "claude-sonnet-4-5",
          "claude-haiku-4-5",
          "qwen3-coder",
        ],
        reviewerModels: ["claude-sonnet-4-5", "claude-haiku-4-5"],
        maxRevisions: 1,
      },
    });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        actor.stop();
        reject(new Error("Workflow timed out"));
      }, 300000);

      actor.subscribe((state) => {
        if (state.matches("complete")) {
          clearTimeout(timeout);
          actor.stop();

          console.log("\n✅ Workflow completed with mixed results!");

          // At least one implementation should succeed
          let successCount = 0;
          for (const [_, impl] of state.context.implementations) {
            if (impl.success) successCount++;
          }

          console.log(`  Successful implementations: ${successCount}/3`);
          expect(successCount).toBeGreaterThanOrEqual(1);

          resolve(undefined);
        }
      });

      actor.start();
    });
  }, 360000);
});
