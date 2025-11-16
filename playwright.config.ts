import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./test",
  testMatch: ["**/web-pty.playwright.test.ts", "**/explain-tui.playwright.test.ts"], // web-pty and explain TUI tests
  fullyParallel: false, // Run tests serially to avoid port conflicts
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker to avoid conflicts
  reporter: "list",
  use: {
    baseURL: "http://localhost:8766",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    // Use Nix-provided browser if available
    launchOptions: process.env.PLAYWRIGHT_BROWSERS_PATH
      ? {
          executablePath: process.env.PLAYWRIGHT_LAUNCH_OPTIONS_EXECUTABLE_PATH,
        }
      : undefined,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  timeout: 30000,

  // Auto-start web-pty server
  webServer: {
    command: "bun run src/web-pty.ts",
    url: "http://localhost:8766",
    timeout: 30000,
    reuseExistingServer: true,
    env: {
      PORT: "8766",
    },
  },
});
