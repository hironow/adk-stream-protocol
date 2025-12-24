import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for E2E tests
 *
 * Test Suites:
 * 1. scenarios/ - Event-to-event backend+frontend integration (EXISTING)
 * 2. app/tests/e2e/ - UI-focused user interaction tests (NEW)
 *
 * Test execution tiers (app/tests/e2e/ only):
 * - Tier 1 (Smoke): Fast critical path tests (<5 min)
 * - Tier 2 (Core): Comprehensive functionality tests (<20 min)
 * - Tier 3 (Advanced): Edge cases, visual regression, accessibility (<30 min)
 *
 * See: agents/app_plan.md for full testing strategy
 */
export default defineConfig({
  // Run tests in parallel
  fullyParallel: true,

  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,

  // Retry on CI only
  retries: process.env.CI ? 2 : 0,

  // Limit workers on CI for stability
  workers: process.env.CI ? 2 : undefined,

  // Reporter configuration
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['junit', { outputFile: 'test-results/junit.xml' }],
    ['list'],
  ],

  // Shared settings for all tests
  use: {
    // Base URL for tests
    baseURL: 'http://localhost:3000',

    // Collect trace on first retry only (for debugging)
    trace: 'on-first-retry',

    // Screenshots on failure
    screenshot: 'only-on-failure',

    // Video on first retry
    video: 'retain-on-failure',
  },

  // Test timeout
  timeout: 30000, // 30s per test

  // Expect timeout
  expect: {
    timeout: 10000, // 10s per assertion
  },

  // Configure projects for different test suites
  projects: [
    // Project 1: scenarios/ - Event-to-event integration tests
    {
      name: 'scenarios',
      testDir: './scenarios',
      use: { ...devices['Desktop Chrome'] },
    },

    // Project 2: app/tests/e2e/smoke - Tier 1: Fast smoke tests
    {
      name: 'app-e2e-smoke',
      testDir: './app/tests/e2e/smoke',
      use: { ...devices['Desktop Chrome'] },
    },

    // Project 3: app/tests/e2e/core - Tier 2: Core functionality
    {
      name: 'app-e2e-core',
      testDir: './app/tests/e2e/core',
      use: { ...devices['Desktop Chrome'] },
    },

    // Project 4: app/tests/e2e/advanced - Tier 3: Advanced tests
    {
      name: 'app-e2e-advanced',
      testDir: './app/tests/e2e/advanced',
      use: { ...devices['Desktop Chrome'] },
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

  // Run local dev server before starting tests
  webServer: {
    command: 'pnpm dev',
    port: 3000,
    reuseExistingServer: !process.env.CI,
    timeout: 120000, // 2 minutes to start server
    stdout: 'pipe',
    stderr: 'pipe',
  },

  // Global setup/teardown
  // globalSetup: require.resolve('./app/tests/helpers/global-setup.ts'),
  // globalTeardown: require.resolve('./app/tests/helpers/global-teardown.ts'),
});
