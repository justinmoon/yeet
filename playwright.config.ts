import { defineConfig, devices } from "@playwright/test";

// Support junit reporter for CI/pre-merge
const reporters: any[] = process.env.CI
  ? [
      [
        "junit",
        { outputFile: "reports/pre-merge/playwright/web-pty/junit.xml" },
      ],
      ["html", { outputFolder: "reports/pre-merge/playwright/web-pty/html" }],
      ["line"],
    ]
  : ["list"];

export default defineConfig({
  testDir: "./test",
  testMatch: "**/web-pty.playwright.test.ts", // Only web-pty tests, GUI tests use separate config
  fullyParallel: false, // Run tests serially to avoid port conflicts
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker to avoid conflicts
  reporter: reporters,
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
      // Pass through YEET_CONFIG_DIR for fixture config in CI/pre-merge
      ...(process.env.YEET_CONFIG_DIR && {
        YEET_CONFIG_DIR: process.env.YEET_CONFIG_DIR,
      }),
    },
  },
});
