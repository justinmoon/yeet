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

  test("displays 2 nodes", async ({ page }) => {
    await page.goto(GUI_URL);
    await page.waitForSelector(".react-flow", { timeout: 10000 });

    const nodes = page.locator(".react-flow__node");
    await expect(nodes).toHaveCount(2);
  });

  test("nodes have correct labels", async ({ page }) => {
    await page.goto(GUI_URL);
    await page.waitForSelector(".react-flow", { timeout: 10000 });

    const node1 = page.locator(".react-flow__node").first();
    await expect(node1).toContainText("Node 1");

    const node2 = page.locator(".react-flow__node").nth(1);
    await expect(node2).toContainText("Node 2");
  });

  test("displays 1 edge", async ({ page }) => {
    await page.goto(GUI_URL);
    await page.waitForSelector(".react-flow", { timeout: 10000 });

    const edges = page.locator(".react-flow__edge");
    await expect(edges).toHaveCount(1);
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
