import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./test",
  testMatch: "**/web-pty.playwright.test.ts", // Only web-pty tests, GUI tests use separate config
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
});
