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
    globalTeardown: ["./vitest.global-teardown.ts"],
    // Use forks pool for parallel execution
    // Each test file runs in separate process for clean isolation
    pool: "forks",
    forks: {
      singleFork: false, // Enable parallel execution
    },
    // Give more time for cleanup to complete
    teardownTimeout: 10000,
    // Force exit to prevent hang from libuv handle cleanup issues
    // This is a workaround for MSW WebSocket cleanup issues (see MSW #2537)
    forceExit: true,
    // Suppress console output during tests to reduce noise
    silent: false, // Set to true to completely suppress console output
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      // Exclude scenarios as they are for playwright
      "**/scenarios/**",
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
});
