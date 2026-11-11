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
    globalSetup: ["./vitest.global-setup.ts"],
    // Use forks pool for parallel execution
    // Each test file runs in separate process for clean isolation
    pool: "forks",
    // Give more time for cleanup to complete
    teardownTimeout: 10000,
    // vitest 4 removed `forks` / `forceExit` (they are not options of its
    // InlineConfig and were being ignored): the fork pool is parallel by
    // default, and the MSW WebSocket cleanup workaround now lives in the
    // teardown below plus teardownTimeout.
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
