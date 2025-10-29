import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./test",
  testMatch: "**/*gui*.playwright.test.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 3, // Retry flaky E2E tests up to 3 times (AI behavior can vary)
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3456",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
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
  timeout: 90000, // 90s timeout for E2E tests with AI (can be slow)

  // Auto-start both servers
  webServer: [
    {
      command: "bun gui/server.ts",
      url: "http://localhost:3457/api/execute?task=test",
      timeout: 60000,
      reuseExistingServer: true,
    },
    {
      command: "bun vite",
      url: "http://localhost:3456",
      timeout: 60000,
      reuseExistingServer: true,
    },
  ],
});
