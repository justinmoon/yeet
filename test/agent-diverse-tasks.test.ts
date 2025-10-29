/**
 * Diverse agent task tests
 * Tests various capabilities with real inference
 * Uses Claude Sonnet 4.5 for best performance
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createActor } from "xstate";
import { agentMachine } from "../src/agent-machine";
import type { Config } from "../src/config";
import { loadConfig } from "../src/config";

const TEST_DIR = "/tmp/agent-diverse-tasks";

let originalConfig: Config;

beforeEach(async () => {
  // Set up test directory
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true });
  }
  mkdirSync(TEST_DIR, { recursive: true });
  process.chdir(TEST_DIR);

  // Configure to use Claude Sonnet 4.5 for best performance
  const config = await loadConfig();
  originalConfig = { ...config };
  config.activeProvider = "opencode";
  config.opencode.model = "claude-sonnet-4-5";
  console.log("🤖 Using model: claude-sonnet-4-5");
});

afterEach(() => {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true });
  }
});

async function runTask(
  task: string,
  timeoutMs = 30000,
): Promise<{ success: boolean; duration: number; error?: string }> {
  const startTime = Date.now();
  const actor = createActor(agentMachine);

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      console.log("❌ Task timed out after", timeoutMs, "ms");
      actor.stop();
      resolve({
        success: false,
        duration: Date.now() - startTime,
        error: "Timeout",
      });
    }, timeoutMs);

    let lastState = "";
    actor.subscribe((state) => {
      const currentState = JSON.stringify(state.value);
      if (currentState !== lastState) {
        console.log(
          `  State: ${currentState} (step ${state.context.currentStep})`,
        );
        lastState = currentState;

        // Log tool calls
        if (state.context.pendingToolCall) {
          console.log(`  🔧 Tool: ${state.context.pendingToolCall.name}`);
        }
      }

      if (state.matches("idle") && state.context.currentStep > 0) {
        console.log(`✅ Task completed in ${state.context.currentStep} steps`);
        clearTimeout(timeout);
        actor.stop();
        resolve({ success: true, duration: Date.now() - startTime });
      } else if (state.matches("error")) {
        console.log("❌ Agent error");
        clearTimeout(timeout);
        actor.stop();
        resolve({
          success: false,
          duration: Date.now() - startTime,
          error: "Agent error",
        });
      }
    });

    console.log(`\n📋 Task: ${task.substring(0, 80)}...`);
    actor.start();
    actor.send({ type: "USER_MESSAGE", content: task });
  });
}

describe("Diverse Agent Tasks", () => {
  test("Task 1: Multi-file data processing", async () => {
    const result = await runTask(
      "Create 3 files: a.txt with 'apple', b.txt with 'banana', c.txt with 'cherry'. " +
        "Then create combined.txt that contains all three words, one per line, sorted alphabetically. " +
        "Use the complete tool when done.",
    );

    console.log(`[Task 1] Duration: ${result.duration}ms`);
    expect(result.success).toBe(true);

    // Verify files
    expect(existsSync(join(TEST_DIR, "a.txt"))).toBe(true);
    expect(existsSync(join(TEST_DIR, "b.txt"))).toBe(true);
    expect(existsSync(join(TEST_DIR, "c.txt"))).toBe(true);
    expect(existsSync(join(TEST_DIR, "combined.txt"))).toBe(true);

    const combined = readFileSync(join(TEST_DIR, "combined.txt"), "utf-8");
    expect(combined).toContain("apple");
    expect(combined).toContain("banana");
    expect(combined).toContain("cherry");
  }, 35000);

  test("Task 2: Search and replace across files", async () => {
    // Pre-create files with known content
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(TEST_DIR, "config1.js"), "const PORT = 3000;");
    writeFileSync(join(TEST_DIR, "config2.js"), "const PORT = 3000;");

    const result = await runTask(
      "Find all JavaScript files with 'PORT = 3000' and change it to 'PORT = 8080'. " +
        "Use search to find them, then edit each one. Call complete when done.",
    );

    console.log(`[Task 2] Duration: ${result.duration}ms`);
    expect(result.success).toBe(true);

    const config1 = readFileSync(join(TEST_DIR, "config1.js"), "utf-8");
    const config2 = readFileSync(join(TEST_DIR, "config2.js"), "utf-8");
    expect(config1).toContain("8080");
    expect(config2).toContain("8080");
  }, 35000);

  test("Task 3: Shell script creation and execution", async () => {
    const result = await runTask(
      "Create a bash script called 'count.sh' that counts from 1 to 5 and writes each number to count.txt (one per line). " +
        "Make it executable with chmod +x, then run it. Call complete after running.",
    );

    console.log(`[Task 3] Duration: ${result.duration}ms`);
    expect(result.success).toBe(true);

    expect(existsSync(join(TEST_DIR, "count.sh"))).toBe(true);
    expect(existsSync(join(TEST_DIR, "count.txt"))).toBe(true);

    const output = readFileSync(join(TEST_DIR, "count.txt"), "utf-8");
    expect(output).toContain("1");
    expect(output).toContain("5");
  }, 35000);

  test("Task 4: Debug and fix code", async () => {
    // Pre-create buggy code
    const { writeFileSync } = await import("node:fs");
    const buggyCode = `#!/usr/bin/env python3
def add(a, b):
    return a - b  # Bug: should be + not -

result = add(5, 3)
print(f"5 + 3 = {result}")
`;
    writeFileSync(join(TEST_DIR, "calculator.py"), buggyCode);

    const result = await runTask(
      "The file calculator.py has a bug - the add function subtracts instead of adding. " +
        "Fix the bug by editing the file to use + instead of -. " +
        "Then run it to verify the output is correct (should print '5 + 3 = 8'). " +
        "Call complete when verified.",
    );

    console.log(`[Task 4] Duration: ${result.duration}ms`);
    expect(result.success).toBe(true);

    const fixed = readFileSync(join(TEST_DIR, "calculator.py"), "utf-8");
    expect(fixed).toContain("return a + b");
  }, 40000);
});
