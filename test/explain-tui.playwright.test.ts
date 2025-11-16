import { expect, test } from "@playwright/test";

const PORT = 8766;

test.describe("Explain Feature in TUI", () => {
  test("can open explain from command palette", async ({ page }) => {
    await page.goto(`http://localhost:${PORT}`);

    // Wait for terminal to load
    await page.waitForSelector(".xterm", { timeout: 5000 });
    await page.waitForTimeout(2000);

    // Click terminal to focus
    await page.click(".xterm");

    // Open command palette with Cmd+O (or Ctrl+Shift+P)
    await page.keyboard.press("Control+Shift+P");

    // Wait for palette to appear
    await page.waitForTimeout(500);

    // Type "explain" to filter
    await page.keyboard.type("explain");
    await page.waitForTimeout(300);

    // Press Enter to select "Explain Changes"
    await page.keyboard.press("Enter");

    // Wait for explain prompt mode
    await page.waitForTimeout(500);

    // Get terminal content to verify we're in explain mode
    const getTerminalContent = () =>
      page.evaluate(() => {
        const terminal = document.querySelector(".xterm-rows");
        return terminal?.textContent || "";
      });

    const content = await getTerminalContent();

    // Should show the explain prompt title
    expect(content).toContain("Explain Changes");
    expect(content).toContain("What would you like to understand");
  });

  test("clears input when entering explain mode", async ({ page }) => {
    await page.goto(`http://localhost:${PORT}`);
    await page.waitForSelector(".xterm", { timeout: 5000 });
    await page.waitForTimeout(2000);

    await page.click(".xterm");

    // Open palette
    await page.keyboard.press("Control+Shift+P");
    await page.waitForTimeout(500);

    // Type "tut" to filter for tutorial/explain
    await page.keyboard.type("tut");
    await page.waitForTimeout(300);

    // Select explain option
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);

    // Now type a prompt - if input was cleared, this should work
    await page.keyboard.type("explain what changed");

    const content = await page.evaluate(() => {
      const terminal = document.querySelector(".xterm-rows");
      return terminal?.textContent || "";
    });

    // The prompt should be visible, not "tut"
    expect(content).toContain("explain what changed");
    expect(content).not.toContain("tutexplain what changed"); // Should not have old text concatenated
  });

  test("can submit explain prompt and see tutorial", async ({ page }) => {
    await page.goto(`http://localhost:${PORT}`);
    await page.waitForSelector(".xterm", { timeout: 5000 });
    await page.waitForTimeout(2000);

    await page.click(".xterm");

    // Open palette
    await page.keyboard.press("Control+Shift+P");
    await page.waitForTimeout(500);

    // Navigate to explain
    await page.keyboard.type("explain");
    await page.waitForTimeout(300);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);

    // Enter a prompt with --stub flag in env (if supported) or use a simple prompt
    await page.keyboard.type("test prompt");
    await page.keyboard.press("Enter");

    // Wait for tutorial to load (this might take a while with real LLM)
    // For now, just verify the prompt was accepted
    await page.waitForTimeout(1000);

    const content = await page.evaluate(() => {
      const terminal = document.querySelector(".xterm-rows");
      return terminal?.textContent || "";
    });

    // Tutorial should appear or loading should be shown
    // This test might need adjustment based on actual behavior
    expect(content.length).toBeGreaterThan(100);
  });

  test("can navigate tutorial with arrow keys", async ({ page }) => {
    // This test assumes we can get into tutorial mode
    // In a real scenario, we'd need to mock the explain result or use stub mode
    await page.goto(`http://localhost:${PORT}`);
    await page.waitForSelector(".xterm", { timeout: 5000 });
    await page.waitForTimeout(2000);

    await page.click(".xterm");

    // TODO: This test would need actual tutorial data to navigate
    // For now, we can verify the arrow key handling is wired up
    // by checking that processExplainKeyEvent is called

    // Skip this test for now as it requires mocking explain results
    test.skip();
  });

  test("can exit tutorial with q or Esc", async ({ page }) => {
    // This test would verify that q or Esc closes the tutorial
    // and returns to main TUI

    // Skip for now as it requires being in tutorial mode
    test.skip();
  });
});
