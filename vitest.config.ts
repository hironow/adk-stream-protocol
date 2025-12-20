import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
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
