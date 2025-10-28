import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./test",
  testMatch: "**/*gui*.playwright.test.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
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
  timeout: 30000,

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
