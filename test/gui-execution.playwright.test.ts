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

    // Enter a task with explicit completion
    const input = page.locator('input[type="text"]');
    await input.fill("Run: echo test. When done, call complete tool.");

    // Click start
    await page.getByRole("button", { name: "Start" }).click();

    // Wait for execution to begin - look for Running button
    await expect(page.getByRole("button", { name: "Running..." })).toBeVisible({
      timeout: 3000,
    });

    // Check that log panel appears
    await expect(page.locator("text=Execution Log")).toBeVisible({
      timeout: 5000,
    });

    // Check for state transitions in log
    await expect(page.locator("text=→ idle")).toBeVisible({ timeout: 3000 });
    await expect(
      page.locator("text*=thinking").or(page.locator("text*=running")),
    ).toBeVisible({ timeout: 5000 });

    // Check for tool execution
    await expect(page.locator("text=🔧")).toBeVisible({ timeout: 5000 });

    // Wait for completion (should happen within 20s)
    await expect(page.locator("text=✅ Complete")).toBeVisible({
      timeout: 20000,
    });

    // Verify button is back to Start
    await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
  });
});
