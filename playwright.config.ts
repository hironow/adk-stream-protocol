import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

// Load .env.local for webServer environment variables
// This ensures CHUNK_LOGGER_ENABLED and other env vars are available to backend server
loadEnv({ path: ".env.local" });

/**
 * Playwright configuration for E2E tests
 *
 * Test Suites (all in scenarios/):
 * 1. scenarios/*.spec.ts - Event-to-event backend+frontend integration
 * 2. scenarios/app-smoke/ - Tier 1: Fast critical path tests (<5 min)
 * 3. scenarios/app-core/ - Tier 2: Comprehensive functionality tests (<20 min)
 * 4. scenarios/app-advanced/ - Tier 3: Edge cases, visual regression, accessibility (<30 min)
 *
 * Note: vitest-based tests are in lib/tests/, app/tests/integration/, components/tests/
 */
export default defineConfig({
  // Run tests serially to avoid rate limiting and resource conflicts
  fullyParallel: false,

  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,

  // Retry on CI only
  retries: process.env.CI ? 2 : 0,

  // Run tests serially (1 worker)
  workers: 1,

  // Global timeout for entire test run (60 minutes)
  // CRITICAL: Prevents infinite hangs, ensures test failures are caught
  globalTimeout: 60 * 60 * 1000, // 60 minutes

  // Reporter configuration
  reporter: [
    ["html", { outputFolder: "playwright-report" }],
    ["junit", { outputFile: "test-results/junit.xml" }],
    ["list"],
  ],

  // Shared settings for all tests
  use: {
    // Base URL for tests
    baseURL: "http://localhost:3000",

    // Collect trace on first retry only (for debugging)
    trace: "on-first-retry",

    // Screenshots on failure
    screenshot: "only-on-failure",

    // Video on first retry
    video: "retain-on-failure",
  },

  // Test timeout
  timeout: 30000, // 30s per test

  // Expect timeout and snapshot configuration
  expect: {
    timeout: 10000, // 10s per assertion

    // Snapshot configuration - centralize all snapshots in assets/snapshots/
    // Example: assets/snapshots/{projectName}/{arg}-{projectName}-{platform}.png
    toHaveScreenshot: {
      pathTemplate:
        "assets/snapshots/{projectName}/{arg}-{projectName}-{platform}{ext}",
    },
  },

  // Configure projects for different test suites
  projects: [
    // Project 1: scenarios/ - Event-to-event integration tests
    {
      name: "scenarios",
      testDir: "./scenarios",
      use: { ...devices["Desktop Chrome"] },
      // Exclude app-* subdirectories from this project
      testIgnore: ["**/app-*/**"],
      // Per-test timeout: 60 seconds (backend interactions can be slower)
      timeout: 60 * 1000,
    },

    // Project 2: scenarios/app-smoke - Tier 1: Fast smoke tests
    {
      name: "app-e2e-smoke",
      testDir: "./scenarios/app-smoke",
      use: { ...devices["Desktop Chrome"] },
      // Per-test timeout: 30 seconds (smoke tests should be fast)
      timeout: 30 * 1000,
    },

    // Project 3: scenarios/app-core - Tier 2: Core functionality
    {
      name: "app-e2e-core",
      testDir: "./scenarios/app-core",
      use: { ...devices["Desktop Chrome"] },
      // Per-test timeout: 45 seconds (more complex interactions)
      timeout: 45 * 1000,
    },

    // Project 4: scenarios/app-advanced - Tier 3: Advanced tests
    {
      name: "app-e2e-advanced",
      testDir: "./scenarios/app-advanced",
      use: { ...devices["Desktop Chrome"] },
      // Per-test timeout: 60 seconds (visual regression, accessibility scans)
      timeout: 60 * 1000,
    },

    // Uncomment for cross-browser testing
    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },

    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },
  ],

  // Run local dev servers (both frontend and backend) before starting tests
  webServer: [
    {
      command: "uv run uvicorn server:app --host 0.0.0.0 --port 8000",
      port: 8000,
      reuseExistingServer: !process.env.CI,
      timeout: 120000, // 2 minutes to start server
      stdout: "pipe",
      stderr: "pipe",
      // Pass environment variables from .env.local to backend server
      env: process.env as any,
    },
    {
      command: "pnpm dev",
      port: 3000,
      reuseExistingServer: !process.env.CI,
      timeout: 120000, // 2 minutes to start server
      stdout: "pipe",
      stderr: "pipe",
      // Pass environment variables from .env.local to frontend server
      env: process.env as any,
    },
  ],

  // Global setup/teardown
  // globalSetup: require.resolve('./app/tests/helpers/global-setup.ts'),
  // globalTeardown: require.resolve('./app/tests/helpers/global-teardown.ts'),
});
