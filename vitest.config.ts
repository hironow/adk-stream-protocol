import path from "node:path";
import { config as loadEnv } from "dotenv";
import { defineConfig } from "vitest/config";

// Load .env.local for environment variables (e.g., CHUNK_LOGGER_SESSION_ID)
// This ensures consistency across all test frameworks
loadEnv({ path: ".env.local" });

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    globalSetup: [],
    globalTeardown: ["./vitest.global-teardown.ts"],
    // Use forks pool - has WebSocket cleanup issues with msw but tests pass
    // Note: Worker exit errors are expected due to msw cleanup, but all tests pass
    pool: "forks",
    // vitest 4: poolOptions moved to top-level
    forks: {
      singleFork: true,
    },
    // Give more time for cleanup to complete
    teardownTimeout: 5000,
    // Force exit after tests complete to avoid hanging due to WebSocket cleanup issues
    forceExit: true,
    // Suppress console output during tests to reduce noise
    silent: false, // Set to true to completely suppress console output
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      // Exclude scenarios as they are for playwright
      "**/scenarios/**",
      // Exclude app/tests/e2e as they are for playwright
      "**/app/tests/e2e/**",
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
});
