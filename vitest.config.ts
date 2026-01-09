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
