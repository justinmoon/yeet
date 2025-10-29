/**
 * E2E test for XState agent execution
 * Tests the full pipeline: XState machine → agent → tools → completion
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createActor } from "xstate";
import { agentMachine } from "../src/agent-machine";

const TEST_DIR = "/tmp/xstate-e2e-test";

beforeEach(() => {
  // Create test directory
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true });
  }
  mkdirSync(TEST_DIR, { recursive: true });
  process.chdir(TEST_DIR);
});

afterEach(() => {
  // Cleanup
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true });
  }
});

describe("XState Agent E2E", () => {
  test("complete workflow: write file and read it back", async () => {
    const actor = createActor(agentMachine, {
      input: {},
    });

    const states: string[] = [];

    actor.subscribe((state) => {
      states.push(String(state.value));
    });

    actor.start();

    // Send a simple task with explicit completion instruction
    actor.send({
      type: "USER_MESSAGE",
      content:
        "Write 'Hello XState' to test.txt. When done, call complete tool with summary.",
    });

    // Wait for completion with timeout
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Test timed out after 30s"));
      }, 30000);

      const checkDone = () => {
        const snapshot = actor.getSnapshot();

        // Check if agent called complete tool (implied done)
        if (snapshot.value === "idle" && snapshot.context.currentStep > 0) {
          clearTimeout(timeout);
          resolve();
        } else if (snapshot.value === "error") {
          clearTimeout(timeout);
          reject(new Error("Agent encountered an error"));
        } else {
          setTimeout(checkDone, 100);
        }
      };

      checkDone();
    });

    // Verify state transitions
    expect(states).toContain("idle");
    expect(states).toContain("thinking");

    // Check that test.txt was created
    const testFile = join(TEST_DIR, "test.txt");
    expect(existsSync(testFile)).toBe(true);

    console.log("[Test] ✅ E2E test passed");
  }, 35000); // 35s timeout

  test("simple bash command execution", async () => {
    const actor = createActor(agentMachine, {
      input: {},
    });

    const states: string[] = [];

    actor.subscribe((state) => {
      states.push(String(state.value));
    });

    actor.start();

    // Send a simple bash command with explicit completion
    actor.send({
      type: "USER_MESSAGE",
      content:
        "Run: echo 'test' > output.txt. When done, call complete({ summary: 'created file' })",
    });

    // Wait for completion
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Test timed out after 20s"));
      }, 20000);

      const checkDone = () => {
        const snapshot = actor.getSnapshot();

        if (snapshot.value === "idle" && snapshot.context.currentStep > 0) {
          clearTimeout(timeout);
          resolve();
        } else if (snapshot.value === "error") {
          clearTimeout(timeout);
          reject(new Error("Agent encountered an error"));
        } else {
          setTimeout(checkDone, 100);
        }
      };

      checkDone();
    });

    // Verify file was created
    const outputFile = join(TEST_DIR, "output.txt");
    expect(existsSync(outputFile)).toBe(true);

    console.log("[Test] ✅ Bash execution test passed");
  }, 25000);
});
