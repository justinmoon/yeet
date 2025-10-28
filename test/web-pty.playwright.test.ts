import { type ChildProcess, spawn } from "node:child_process";
import { expect, test } from "@playwright/test";

let serverProcess: ChildProcess;
const PORT = 8766; // Use different port to avoid conflicts

test.beforeAll(async () => {
  // Start the web-pty server using Bun
  serverProcess = spawn("bun", ["run", "src/web-pty.ts"], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: "pipe",
  });

  // Wait for server to start
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Server failed to start within 10s"));
    }, 10000);

    serverProcess.stdout?.on("data", (data) => {
      const output = data.toString();
      console.log("Server:", output);
      if (output.includes("Web UI available")) {
        clearTimeout(timeout);
        resolve();
      }
    });

    serverProcess.stderr?.on("data", (data) => {
      console.error("Server error:", data.toString());
    });

    serverProcess.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  // Give it a bit more time to be ready
  await new Promise((resolve) => setTimeout(resolve, 1000));
});

test.afterAll(async () => {
  // Clean up server
  if (serverProcess) {
    serverProcess.kill("SIGTERM");
    // Wait for graceful shutdown
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (!serverProcess.killed) {
      serverProcess.kill("SIGKILL");
    }
  }
});

test("web-pty server should serve HTML page", async ({ page }) => {
  await page.goto(`http://localhost:${PORT}`);

  // Check page title
  await expect(page).toHaveTitle("Yeet");

  // Check that xterm.js is loaded
  const xtermScript = page.locator('script[src*="xterm"]');
  await expect(xtermScript.first()).toBeAttached();
});

test("web-pty should render TUI in browser", async ({ page }) => {
  await page.goto(`http://localhost:${PORT}`);

  // Wait for terminal to be present
  await page.waitForSelector("#terminal");
  await expect(page.locator("#terminal")).toBeVisible();

  // Wait for xterm to initialize
  await page.waitForSelector(".xterm", { timeout: 5000 });
  await expect(page.locator(".xterm")).toBeVisible();

  // Wait for WebSocket connection and TUI to render
  await page.waitForTimeout(2000);

  // Check if terminal has content (TUI should render status bar, boxes, etc.)
  const terminalText = await page.evaluate(() => {
    const terminal = document.querySelector(".xterm-rows");
    return terminal?.textContent || "";
  });

  console.log("Terminal content length:", terminalText.length);
  console.log("Terminal sample:", terminalText.substring(0, 200));

  // The TUI should have rendered something (status bar, boxes, etc.)
  expect(terminalText.length).toBeGreaterThan(100);

  // Look for TUI elements (borders, status text)
  // The TUI uses box drawing characters
  const hasBoxChars =
    terminalText.includes("│") ||
    terminalText.includes("─") ||
    terminalText.includes("┌") ||
    terminalText.includes("┐") ||
    terminalText.includes("└") ||
    terminalText.includes("┘");

  expect(hasBoxChars).toBe(true);
});

test("web-pty should handle input", async ({ page }) => {
  await page.goto(`http://localhost:${PORT}`);

  // Wait for terminal
  await page.waitForSelector(".xterm", { timeout: 5000 });
  await page.waitForTimeout(2000);

  // Get initial content
  const getTerminalContent = () =>
    page.evaluate(() => {
      const terminal = document.querySelector(".xterm-rows");
      return terminal?.textContent || "";
    });

  const beforeInput = await getTerminalContent();

  // Click on terminal to focus
  await page.click(".xterm");

  // Type a command (use /help which should work)
  await page.keyboard.type("/help");
  await page.keyboard.press("Enter");

  // Wait for response
  await page.waitForTimeout(1500);

  // Check that content changed
  const afterInput = await getTerminalContent();

  console.log("Before input length:", beforeInput.length);
  console.log("After input length:", afterInput.length);

  // Content should have changed (response from command)
  expect(afterInput).not.toBe(beforeInput);

  // Should contain help text
  expect(afterInput.toLowerCase()).toContain("command");
});

test("web-pty WebSocket should be connected", async ({ page }) => {
  // Track WebSocket connections
  const wsConnections: any[] = [];

  page.on("websocket", (ws) => {
    wsConnections.push(ws);
    console.log("WebSocket opened:", ws.url());

    ws.on("close", () => console.log("WebSocket closed"));
    ws.on("socketerror", (error) => console.error("WebSocket error:", error));
  });

  await page.goto(`http://localhost:${PORT}`);

  // Wait for WebSocket connection
  await page.waitForTimeout(2000);

  // Should have established a WebSocket connection
  expect(wsConnections.length).toBeGreaterThan(0);
  expect(wsConnections[0].url()).toContain("/ws");
});

test("web-pty should handle terminal resize", async ({ page, context }) => {
  await page.goto(`http://localhost:${PORT}`);
  await page.waitForSelector(".xterm", { timeout: 5000 });
  await page.waitForTimeout(1000);

  // Get initial size
  const getTerminalSize = () =>
    page.evaluate(() => {
      const xterm = document.querySelector(".xterm");
      return {
        width: xterm?.clientWidth || 0,
        height: xterm?.clientHeight || 0,
      };
    });

  const initialSize = await getTerminalSize();

  // Resize viewport
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.waitForTimeout(500);

  const newSize = await getTerminalSize();

  // Terminal should have resized
  expect(newSize.width).not.toBe(initialSize.width);
});
