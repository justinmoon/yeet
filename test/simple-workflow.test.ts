/**
 * Simple workflow test - 1 coder + 1 reviewer
 * Tests the basic multi-agent pattern
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { createActor } from "xstate";
import { simpleWorkflowMachine } from "../src/workflow-machine";

const TEST_DIRS = [
  "/tmp/workflow-coder",
  "/tmp/workflow-reviewer",
];

beforeEach(() => {
  // Clean up test directories
  for (const dir of TEST_DIRS) {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true });
    }
    mkdirSync(dir, { recursive: true });
  }

  console.log("🤖 Simple Workflow Test - 1 Coder + 1 Reviewer");
});

afterEach(() => {
  // Clean up test directories
  for (const dir of TEST_DIRS) {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true });
    }
  }
});

describe("Simple Workflow", () => {
  test(
    "should run coder then reviewer",
    async () => {
      const task =
        "Create a simple hello.txt file with 'Hello World' in it. Use the write tool.";

      const actor = createActor(simpleWorkflowMachine, {
        input: {
          task,
          coderModel: "claude-sonnet-4-5",
          reviewerModel: "claude-sonnet-4-5",
        },
      });

      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          actor.stop();
          reject(new Error("Workflow timed out after 60s"));
        }, 60000);

        let lastState = "";
        actor.subscribe((state) => {
          const stateStr = JSON.stringify(state.value);
          if (stateStr !== lastState) {
            console.log(`  State: ${stateStr}`);
            lastState = stateStr;
          }

          if (state.matches("complete")) {
            clearTimeout(timeout);
            actor.stop();

            console.log("\n✅ Workflow completed!");
            console.log(
              `  Implementations: ${state.context.implementations.size}`,
            );
            console.log(`  Reviews: ${state.context.reviews.size}`);

            // Verify we have results
            expect(state.context.implementations.size).toBe(1);
            expect(state.context.reviews.size).toBe(1);

            const impl = state.context.implementations.get("coder");
            expect(impl).toBeDefined();
            expect(impl?.success).toBe(true);

            const review = state.context.reviews.get("reviewer");
            expect(review).toBeDefined();
            expect(review!.length).toBeGreaterThan(0);

            console.log(`\n📝 Review excerpt: ${review!.substring(0, 200)}...`);

            resolve(undefined);
          } else if (state.matches("error")) {
            clearTimeout(timeout);
            actor.stop();
            reject(new Error("Workflow failed"));
          }
        });

        actor.start();
      });
    },
    70000, // 70 second timeout
  );

  test(
    "should handle multiple steps in implementation",
    async () => {
      const task =
        "Create two files: a.txt with 'Hello' and b.txt with 'World'. " +
        "Then use bash to combine them into combined.txt. Use the complete tool when done.";

      const actor = createActor(simpleWorkflowMachine, {
        input: {
          task,
          coderModel: "claude-sonnet-4-5",
          reviewerModel: "claude-haiku-4-5",
        },
      });

      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          actor.stop();
          reject(new Error("Workflow timed out after 90s"));
        }, 90000);

        actor.subscribe((state) => {
          if (state.matches("complete")) {
            clearTimeout(timeout);
            actor.stop();

            console.log("✅ Multi-step workflow completed!");

            // Verify results
            const impl = state.context.implementations.get("coder");
            expect(impl?.success).toBe(true);

            const review = state.context.reviews.get("reviewer");
            expect(review).toBeDefined();

            // Check that files were created
            expect(existsSync("/tmp/workflow-coder/a.txt")).toBe(true);
            expect(existsSync("/tmp/workflow-coder/b.txt")).toBe(true);
            expect(existsSync("/tmp/workflow-coder/combined.txt")).toBe(true);

            resolve(undefined);
          } else if (state.matches("error")) {
            clearTimeout(timeout);
            actor.stop();

            const impl = state.context.implementations.get("coder");
            console.error("Implementation error:", impl?.error);

            reject(new Error(`Workflow failed: ${impl?.error || "unknown"}`));
          }
        });

        actor.start();
      });
    },
    100000, // 100 second timeout for multi-step
  );
});
