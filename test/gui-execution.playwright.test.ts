/**
 * Test Phase 2: Live Execution
 */

import { expect, test } from "@playwright/test";

const GUI_URL = "http://localhost:3456";

test.describe("Phase 2: Live Execution", () => {
  test("control panel is visible", async ({ page }) => {
    await page.goto(GUI_URL);

    // Check input field exists
    const input = page.locator('input[type="text"]');
    await expect(input).toBeVisible();
    await expect(input).toHaveAttribute("placeholder", /Enter task/);

    // Check start button exists
    const button = page.getByRole("button", { name: "Start" });
    await expect(button).toBeVisible();
    await expect(button).toHaveText("Start");
  });

  test("can execute a simple task and see state transitions", async ({
    page,
  }) => {
    await page.goto(GUI_URL);

    // Enter a task
    const input = page.locator('input[type="text"]');
    await input.fill("write hello world to test.txt");

    // Click start
    const button = page.getByRole("button", { name: "Start" });
    await button.click();

    // Wait for button to show "Running..."
    await expect(button).toHaveText("Running...", { timeout: 2000 });

    // Check that log panel appears
    const logPanel = page.locator("text=Execution Log");
    await expect(logPanel).toBeVisible({ timeout: 5000 });

    // Check for idle state transition in log
    await expect(page.locator("text=→ idle")).toBeVisible({ timeout: 3000 });

    // Check for thinking state transition
    await expect(page.locator("text=→ thinking")).toBeVisible({
      timeout: 3000,
    });

    // Verify we're showing the Running state
    await expect(button).toHaveText("Running...");
  });

  test("shows connection error if API server not running", async ({ page }) => {
    // This test assumes API server is NOT running
    await page.goto(GUI_URL);

    const input = page.locator('input[type="text"]');
    await input.fill("test task");

    const button = page.getByRole("button", { name: "Start" });
    await button.click();

    // Should show connection error
    await expect(page.locator("text=/Connection error/i")).toBeVisible({
      timeout: 10000,
    });
  });
});
