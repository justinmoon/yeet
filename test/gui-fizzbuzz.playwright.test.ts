/**
 * E2E Test: FizzBuzz implementation via GUI
 * Tests the complete workflow: user input → agent execution → file creation → completion
 */

import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const GUI_URL = "http://localhost:3456";
const TEST_DIR = "/tmp/gui-fizzbuzz-test";

test.describe("GUI FizzBuzz E2E", () => {
  test.beforeEach(() => {
    // Clean test directory
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  test.afterEach(() => {
    // Cleanup
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  test("implements and executes fizzbuzz via GUI", async ({ page }) => {
    // Navigate to GUI
    await page.goto(GUI_URL);

    // Verify control panel is visible
    await expect(page.getByRole("button", { name: "Start" })).toBeVisible();

    // Enter fizzbuzz task
    const taskInput = `Create a fizzbuzz program in ${TEST_DIR}/fizzbuzz.py that prints numbers 1-15, replacing multiples of 3 with Fizz, multiples of 5 with Buzz, and multiples of both with FizzBuzz. Then execute it. When done, call the complete tool with summary of output.`;

    await page.locator('input[type="text"]').fill(taskInput);

    // Click Start
    await page.getByRole("button", { name: "Start" }).click();

    // Wait for execution to begin
    await expect(page.getByRole("button", { name: "Running..." })).toBeVisible({
      timeout: 3000,
    });

    // Verify log panel appears
    await expect(page.locator("text=Execution Log")).toBeVisible({
      timeout: 5000,
    });

    // Watch for key state transitions
    await expect(page.locator("text=→ idle")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("text=→ running.thinking")).toBeVisible({
      timeout: 5000,
    });
    await expect(page.locator("text=→ running.executingTool")).toBeVisible({
      timeout: 10000,
    });

    // Should see tool calls (write, bash)
    await expect(page.locator("text=🔧").first()).toBeVisible({
      timeout: 10000,
    });

    // Wait for completion (fizzbuzz takes a bit: write file + execute + complete)
    await expect(page.locator("text=✅ Complete")).toBeVisible({
      timeout: 60000, // 60s timeout for full workflow
    });

    // Verify button returns to Start
    await expect(page.getByRole("button", { name: "Start" })).toBeVisible();

    // Verify the fizzbuzz file was created
    const fizzbuzzPath = join(TEST_DIR, "fizzbuzz.py");
    expect(existsSync(fizzbuzzPath)).toBe(true);

    // Verify file contains expected content
    const content = readFileSync(fizzbuzzPath, "utf-8");
    expect(content.toLowerCase()).toContain("fizzbuzz");
    expect(content.toLowerCase()).toContain("fizz");
    expect(content.toLowerCase()).toContain("buzz");

    // Check that log shows multiple tool executions
    const logText = await page.locator("div").filter({ hasText: "🔧" }).count();
    expect(logText).toBeGreaterThan(1); // Should have write + bash at minimum
  });
});
