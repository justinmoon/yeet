/**
 * GUI Playwright Tests
 * Focused tests for XState Agent GUI functionality
 */

import { expect, test } from "@playwright/test";

const GUI_URL = "http://localhost:3456";

test.describe("GUI Basic Functionality", () => {
  test("page loads with control panel", async ({ page }) => {
    await page.goto(GUI_URL);

    // Control panel elements
    await expect(page.getByPlaceholder(/enter task/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
  });

  test("React loads without JavaScript errors", async ({ page }) => {
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

  test("React Flow graph renders", async ({ page }) => {
    await page.goto(GUI_URL);

    // React Flow should be visible
    await expect(page.locator(".react-flow")).toBeVisible({ timeout: 10000 });

    // Should have state nodes
    const nodes = page.locator(".react-flow__node");
    const nodeCount = await nodes.count();
    expect(nodeCount).toBeGreaterThan(3); // At least idle, thinking, executingTool, error, complete

    // Should have edges between states
    const edges = page.locator(".react-flow__edge");
    const edgeCount = await edges.count();
    expect(edgeCount).toBeGreaterThan(2); // Multiple transitions

    // React Flow controls should be present
    await expect(page.locator(".react-flow__controls")).toBeVisible();
  });

  test("displays core state nodes", async ({ page }) => {
    await page.goto(GUI_URL);
    await page.waitForSelector(".react-flow", { timeout: 10000 });

    // Check for essential states
    // The nodes have IDs matching state names, check they exist in DOM
    const nodes = page.locator(".react-flow__node");
    const nodeCount = await nodes.count();
    expect(nodeCount).toBeGreaterThanOrEqual(4); // idle, thinking, executingTool, error at minimum

    // Verify at least one node is visible (smoke test)
    await expect(nodes.first()).toBeVisible();
  });

  test("can input task and start execution", async ({ page }) => {
    await page.goto(GUI_URL);

    // Enter a task
    const input = page.locator('input[type="text"]');
    await input.fill("Test task");

    // Button should be clickable
    const startButton = page.getByRole("button", { name: "Start" });
    await expect(startButton).toBeEnabled();

    // Click start
    await startButton.click();

    // Should transition to running state
    await expect(page.getByRole("button", { name: "Running..." })).toBeVisible({
      timeout: 3000,
    });

    // Log panel should appear
    await expect(page.locator("text=Execution Log")).toBeVisible({
      timeout: 5000,
    });
  });
});
