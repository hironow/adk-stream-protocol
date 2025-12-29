/**
 * Temporary test to verify chunk logger download button visibility
 */

import { test } from "@playwright/test";
import {
  navigateToChat,
  selectBackendMode,
  setupFrontendConsoleLogger,
} from "../helpers";

test("Check if Download Chunks button is visible", async ({ page }) => {
  // Setup frontend console logger
  const sessionId =
    process.env.NEXT_PUBLIC_CHUNK_LOGGER_SESSION_ID ||
    process.env.CHUNK_LOGGER_SESSION_ID ||
    "test";
  setupFrontendConsoleLogger(page, sessionId);

  // Given: Navigate to chat
  await navigateToChat(page);
  await selectBackendMode(page, "adk-sse");

  // When: Check for download button
  const downloadButton = page.getByRole("button", { name: /Download Chunks/i });
  const count = await downloadButton.count();

  console.log(`Download Chunks button count: ${count}`);

  if (count > 0) {
    console.log("✅ Download button found!");
    const isVisible = await downloadButton.isVisible();
    console.log(`Download button visible: ${isVisible}`);
  } else {
    console.log("❌ Download button not found");

    // Check chunk logger environment variables via browser console
    const chunkLoggerStatus = await page.evaluate(() => {
      return {
        enabled: process.env.NEXT_PUBLIC_CHUNK_LOGGER_ENABLED,
        sessionId: process.env.NEXT_PUBLIC_CHUNK_LOGGER_SESSION_ID,
      };
    });
    console.log("Chunk logger env vars:", chunkLoggerStatus);
  }

  // Take screenshot for debugging
  await page.screenshot({
    path: "assets/snapshots/scenarios/chunk-download-debug-scenarios-darwin.png",
  });
});
