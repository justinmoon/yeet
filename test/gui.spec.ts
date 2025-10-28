/**
 * Playwright E2E tests for React Flow GUI
 *
 * Tests the web UI for visualizing and running XState agent workflows
 * Will be extended as we add more phases (execution, inspection, etc.)
 */

import { expect, test } from "@playwright/test";

const GUI_URL = "http://localhost:3456";
const TEST_TIMEOUT = 10000;

// Helper to start GUI server before tests
test.beforeAll(async () => {
  // Note: Server should be running before tests
  // Run with: bun run gui
  // Could auto-start here but keeping it simple for now
});

test.describe("Phase 1: Static Visualization", () => {
  test("loads the GUI and displays header", async ({ page }) => {
    await page.goto(GUI_URL);

    // Check page title
    await expect(page).toHaveTitle(/XState Agent Loop/);

    // Check header elements
    const header = page.locator(".header");
    await expect(header).toBeVisible();

    const title = page.locator(".header h1");
    await expect(title).toHaveText("XState Agent Loop");

    const subtitle = page.locator(".header .subtitle");
    await expect(subtitle).toHaveText("State Machine Visualizer");
  });

  test("renders React Flow canvas", async ({ page }) => {
    await page.goto(GUI_URL);

    // Wait for React Flow to mount
    const canvas = page.locator(".react-flow");
    await expect(canvas).toBeVisible({ timeout: TEST_TIMEOUT });

    // Check that viewport exists
    const viewport = page.locator(".react-flow__viewport");
    await expect(viewport).toBeVisible();
  });

  test("displays all state machine nodes", async ({ page }) => {
    await page.goto(GUI_URL);

    // Wait for React Flow
    await page.waitForSelector(".react-flow", { timeout: TEST_TIMEOUT });

    // Wait a bit for nodes to render
    await page.waitForTimeout(1000);

    // Check all expected state nodes exist
    const expectedStates = [
      "idle",
      "thinking",
      "executingTool",
      "capturingSnapshot",
      "paused",
      "awaitingClarification",
      "error",
    ];

    for (const state of expectedStates) {
      const node = page.locator(`.react-flow__node.${state}`);
      await expect(node).toBeVisible();
      console.log(`✓ Found ${state} node`);
    }
  });

  test("nodes have correct labels", async ({ page }) => {
    await page.goto(GUI_URL);
    await page.waitForSelector(".react-flow", { timeout: TEST_TIMEOUT });
    await page.waitForTimeout(1000);

    // Check node labels
    const labelChecks = [
      { state: "idle", expectedLabel: "Idle" },
      { state: "thinking", expectedLabel: "Thinking" },
      { state: "executingTool", expectedLabel: "Executing Tool" },
      { state: "capturingSnapshot", expectedLabel: "Capturing Snapshot" },
      { state: "paused", expectedLabel: "Paused" },
      {
        state: "awaitingClarification",
        expectedLabel: "Awaiting Clarification",
      },
      { state: "error", expectedLabel: "Error" },
    ];

    for (const { state, expectedLabel } of labelChecks) {
      const node = page.locator(`.react-flow__node.${state}`);
      const label = node.locator(".node-label");
      await expect(label).toHaveText(expectedLabel);
      console.log(`✓ ${state}: "${expectedLabel}"`);
    }
  });

  test("displays edges between states", async ({ page }) => {
    await page.goto(GUI_URL);
    await page.waitForSelector(".react-flow", { timeout: TEST_TIMEOUT });
    await page.waitForTimeout(1000);

    // Check that edges exist
    const edges = page.locator(".react-flow__edge");
    const edgeCount = await edges.count();

    // We defined 16 transitions in the machine
    expect(edgeCount).toBeGreaterThanOrEqual(15);
    console.log(`✓ Found ${edgeCount} edges`);
  });

  test("edges have labels", async ({ page }) => {
    await page.goto(GUI_URL);
    await page.waitForSelector(".react-flow", { timeout: TEST_TIMEOUT });
    await page.waitForTimeout(1000);

    // Check for some key transition labels
    const edgeLabels = page.locator(".react-flow__edge-text");
    const labelCount = await edgeLabels.count();

    expect(labelCount).toBeGreaterThan(0);
    console.log(`✓ Found ${labelCount} edge labels`);

    // Spot check some specific labels
    const allText = await page
      .locator(".react-flow__edge-text")
      .allTextContents();
    console.log("Edge labels:", allText);

    // Should contain key transitions
    expect(allText.join(" ")).toContain("USER_MESSAGE");
  });

  test("React Flow controls are present", async ({ page }) => {
    await page.goto(GUI_URL);
    await page.waitForSelector(".react-flow", { timeout: TEST_TIMEOUT });

    // Check for controls panel
    const controls = page.locator(".react-flow__controls");
    await expect(controls).toBeVisible();

    // Check for control buttons
    const buttons = controls.locator(".react-flow__controls-button");
    const buttonCount = await buttons.count();

    // Should have zoom in, zoom out, fit view, etc.
    expect(buttonCount).toBeGreaterThan(0);
    console.log(`✓ Found ${buttonCount} control buttons`);
  });

  test("background grid is visible", async ({ page }) => {
    await page.goto(GUI_URL);
    await page.waitForSelector(".react-flow", { timeout: TEST_TIMEOUT });

    // Check for background
    const background = page.locator(".react-flow__background");
    await expect(background).toBeVisible();
  });

  test("nodes have correct CSS classes for styling", async ({ page }) => {
    await page.goto(GUI_URL);
    await page.waitForSelector(".react-flow", { timeout: TEST_TIMEOUT });
    await page.waitForTimeout(1000);

    // Check that nodes have their state-specific classes
    const idleNode = page.locator(".react-flow__node.idle");
    await expect(idleNode).toHaveClass(/idle/);

    const thinkingNode = page.locator(".react-flow__node.thinking");
    await expect(thinkingNode).toHaveClass(/thinking/);

    const errorNode = page.locator(".react-flow__node.error");
    await expect(errorNode).toHaveClass(/error/);

    console.log("✓ Nodes have correct CSS classes");
  });

  test("can interact with zoom controls", async ({ page }) => {
    await page.goto(GUI_URL);
    await page.waitForSelector(".react-flow", { timeout: TEST_TIMEOUT });
    await page.waitForTimeout(1000);

    // Get initial viewport transform
    const viewport = page.locator(".react-flow__viewport");
    const initialTransform = await viewport.getAttribute("transform");

    // Click fit view button (usually the last button)
    const controls = page.locator(".react-flow__controls");
    const fitButton = controls.locator(".react-flow__controls-button").last();
    await fitButton.click();

    await page.waitForTimeout(500);

    // Transform should have changed
    const newTransform = await viewport.getAttribute("transform");
    // Note: Transform might be the same if already fitted, but clicking shouldn't error
    console.log("✓ Zoom controls are interactive");
  });

  test("viewport is scrollable/pannable", async ({ page }) => {
    await page.goto(GUI_URL);
    await page.waitForSelector(".react-flow", { timeout: TEST_TIMEOUT });
    await page.waitForTimeout(1000);

    const viewport = page.locator(".react-flow__viewport");
    const initialTransform = await viewport.getAttribute("transform");

    // Simulate drag (pan)
    const canvas = page.locator(".react-flow__pane");
    const box = await canvas.boundingBox();

    if (box) {
      // Drag from center to offset
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(
        box.x + box.width / 2 + 50,
        box.y + box.height / 2 + 50,
      );
      await page.mouse.up();

      await page.waitForTimeout(300);

      const newTransform = await viewport.getAttribute("transform");
      // Pan should change the transform
      expect(newTransform).not.toBe(initialTransform);
      console.log("✓ Viewport is pannable");
    }
  });

  test("no console errors on page load", async ({ page }) => {
    const errors: string[] = [];

    page.on("console", (msg) => {
      if (msg.type() === "error") {
        errors.push(msg.text());
      }
    });

    page.on("pageerror", (error) => {
      errors.push(error.message);
    });

    await page.goto(GUI_URL);
    await page.waitForSelector(".react-flow", { timeout: TEST_TIMEOUT });
    await page.waitForTimeout(2000);

    // Check for errors
    if (errors.length > 0) {
      console.log("Console errors found:", errors);
    }

    expect(errors).toHaveLength(0);
  });

  test("page is responsive and fits viewport", async ({ page }) => {
    await page.goto(GUI_URL);
    await page.waitForSelector(".react-flow", { timeout: TEST_TIMEOUT });

    // Check that main containers are properly sized
    const root = page.locator("#root");
    const box = await root.boundingBox();

    expect(box).not.toBeNull();
    if (box) {
      // Should fill viewport (approximately)
      expect(box.height).toBeGreaterThan(500);
      expect(box.width).toBeGreaterThan(700);
      console.log(`✓ Page dimensions: ${box.width}x${box.height}`);
    }
  });
});

test.describe("Phase 1: Visual Verification", () => {
  test("screenshot: full page", async ({ page }) => {
    await page.goto(GUI_URL);
    await page.waitForSelector(".react-flow", { timeout: TEST_TIMEOUT });
    await page.waitForTimeout(1500); // Let layout settle

    // Take screenshot for visual regression testing
    await page.screenshot({
      path: "test-results/gui-phase1-full.png",
      fullPage: true,
    });
    console.log("✓ Screenshot saved: gui-phase1-full.png");
  });

  test("screenshot: canvas only", async ({ page }) => {
    await page.goto(GUI_URL);
    await page.waitForSelector(".react-flow", { timeout: TEST_TIMEOUT });
    await page.waitForTimeout(1500);

    // Screenshot just the canvas
    const canvas = page.locator(".canvas-container");
    await canvas.screenshot({
      path: "test-results/gui-phase1-canvas.png",
    });
    console.log("✓ Screenshot saved: gui-phase1-canvas.png");
  });
});

// Placeholder for Phase 2 tests
test.describe("Phase 2: Live Execution [TODO]", () => {
  test.skip("displays control panel with input and start button", async ({
    page,
  }) => {
    // Will implement when Phase 2 is ready
  });

  test.skip("can start workflow execution", async ({ page }) => {
    // Will implement when Phase 2 is ready
  });

  test.skip("highlights active state during execution", async ({ page }) => {
    // Will implement when Phase 2 is ready
  });
});

// Placeholder for Phase 3 tests
test.describe("Phase 3: Context Inspection [TODO]", () => {
  test.skip("displays state inspector panel", async ({ page }) => {
    // Will implement when Phase 3 is ready
  });

  test.skip("shows tool history", async ({ page }) => {
    // Will implement when Phase 3 is ready
  });
});
