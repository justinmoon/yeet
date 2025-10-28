/**
 * Simple hello world test for React Flow GUI
 * Start here - if this doesn't pass, nothing will work
 */

import { expect, test } from "@playwright/test";

const GUI_URL = "http://localhost:3456";

test.describe("GUI Hello World", () => {
  test("page loads and displays header", async ({ page }) => {
    await page.goto(GUI_URL);

    const header = page.locator("h1");
    await expect(header).toHaveText("XState Agent Loop");
  });

  test("React loads without errors", async ({ page }) => {
    const errors: string[] = [];

    page.on("console", (msg) => {
      if (msg.type() === "error") {
        errors.push(msg.text());
      }
    });

    await page.goto(GUI_URL);
    await page.waitForTimeout(2000);

    expect(errors).toHaveLength(0);
  });

  test("React Flow canvas renders", async ({ page }) => {
    await page.goto(GUI_URL);

    // Wait for React Flow to mount
    const canvas = page.locator(".react-flow");
    await expect(canvas).toBeVisible({ timeout: 10000 });
  });

  test("displays agent machine states (7 expected)", async ({ page }) => {
    await page.goto(GUI_URL);
    await page.waitForSelector(".react-flow", { timeout: 10000 });

    const nodes = page.locator(".react-flow__node");
    // Agent machine has: idle, thinking, executingTool, capturingSnapshot, paused, awaitingClarification, error
    await expect(nodes).toHaveCount(7);
  });

  test("displays state nodes with correct labels", async ({ page }) => {
    await page.goto(GUI_URL);
    await page.waitForSelector(".react-flow", { timeout: 10000 });

    // Check for key states
    await expect(page.locator(".react-flow__node").filter({ hasText: "Idle" })).toBeVisible();
    await expect(page.locator(".react-flow__node").filter({ hasText: "Thinking" })).toBeVisible();
    await expect(page.locator(".react-flow__node").filter({ hasText: "Executing Tool" })).toBeVisible();
  });

  test("displays edges for state transitions", async ({ page }) => {
    await page.goto(GUI_URL);
    await page.waitForSelector(".react-flow", { timeout: 10000 });

    // Should have multiple edges connecting states
    const edges = page.locator(".react-flow__edge");
    const count = await edges.count();
    expect(count).toBeGreaterThan(5); // At least several transitions
  });

  test("React Flow renders successfully", async ({ page }) => {
    await page.goto(GUI_URL);
    await page.waitForSelector(".react-flow", { timeout: 10000 });

    // Verify it's actually there and working
    const flow = page.locator(".react-flow");
    await expect(flow).toBeVisible();
  });

  test("controls are present", async ({ page }) => {
    await page.goto(GUI_URL);
    await page.waitForSelector(".react-flow", { timeout: 10000 });

    const controls = page.locator(".react-flow__controls");
    await expect(controls).toBeVisible();
  });
});
