import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    // Suppress console output during tests to reduce noise
    silent: false, // Set to true to completely suppress console output
    logLevel: "error", // Only show errors, suppress log/warn/info
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
