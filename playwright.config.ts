import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";

// Load .env.local for environment variables (e.g., SessionId)
dotenv.config({ path: ".env.local" });

/**
 * Playwright E2E Test Configuration
 *
 * Tests located in: scenarios/
 *
 * Requirements:
 * - Real backend servers must be running (ADK Python + Next.js)
 * - No mocks allowed (per CLAUDE.md e2e-guidelines)
 * - Tests verify Gemini Direct and ADK SSE mode equivalence
 * - Tests verify history sharing between modes
 */

export default defineConfig({
  // Test directory
  testDir: "./scenarios",

  // Maximum time one test can run for (3 minutes to accommodate LLM response times)
  timeout: 180 * 1000,

  // Run tests in files in parallel
  fullyParallel: false,

  // Run tests sequentially (one worker) to avoid shared backend/frontend conflicts
  workers: 1,

  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,

  // Retry on CI only
  retries: process.env.CI ? 2 : 0,

  // Reporter to use
  reporter: [["html"], ["list"]],

  // Shared settings for all the projects below
  use: {
    // Base URL to use in actions like `await page.goto('/')`
    baseURL: "http://localhost:3000",

    // Collect trace when retrying the failed test
    trace: "on-first-retry",

    // Screenshot on failure
    screenshot: "only-on-failure",
  },

  // Configure projects for major browsers
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Grant geolocation permission for get_location tool tests
        permissions: ["geolocation"],
        // Set mock geolocation to Tokyo
        geolocation: { longitude: 139.6503, latitude: 35.6762 },
      },
    },
  ],

  // Run your local dev server before starting the tests
  webServer: [
    {
      // Next.js dev server
      command: "pnpm dev",
      url: "http://localhost:3000",
      reuseExistingServer: !process.env.CI,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      // ADK Python backend server
      command: "uv run uvicorn server:app --reload",
      url: "http://localhost:8000/health",
      reuseExistingServer: !process.env.CI,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
