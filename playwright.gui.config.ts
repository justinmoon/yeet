import { defineConfig, devices } from "@playwright/test";

// Support junit reporter for CI/pre-merge
const reporters: any[] = process.env.CI
  ? [
      ["junit", { outputFile: "reports/pre-merge/playwright/gui/junit.xml" }],
      ["html", { outputFolder: "reports/pre-merge/playwright/gui/html" }],
      ["line"],
    ]
  : ["list"];

export default defineConfig({
  testDir: "./test",
  testMatch: "**/gui.playwright.test.ts", // Only fast GUI tests, not E2E
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0, // Retries for CI only
  workers: 1,
  reporter: reporters,
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
  timeout: 30000, // 30s timeout for fast GUI tests

  // Auto-start both servers
  webServer: [
    {
      command: "bun demos/workflows/server.ts",
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
