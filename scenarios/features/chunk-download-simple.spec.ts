/**
 * Simple test to verify chunk logger download functionality
 */

import { expect, test } from "@playwright/test";
import {
  downloadFrontendChunkLogs,
  enableChunkLogger,
  navigateToChat,
  selectBackendMode,
  sendTextMessage,
  setupFrontendConsoleLogger,
  waitForAssistantResponse,
} from "../helpers";

test("Simple chunk logger download test", async ({ page }) => {
  // Setup frontend console logger
  const sessionId =
    process.env.NEXT_PUBLIC_CHUNK_LOGGER_SESSION_ID ||
    process.env.CHUNK_LOGGER_SESSION_ID ||
    "test";
  setupFrontendConsoleLogger(page, sessionId);

  // Given: Navigate and enable chunk logger
  await navigateToChat(page);
  await enableChunkLogger(page, "simple-test");
  await page.reload();
  await page.waitForLoadState("networkidle");

  // Select backend mode (handles audio modal automatically)
  await selectBackendMode(page, "adk-sse");

  // Wait a bit for UI to settle
  await page.waitForTimeout(1000);

  // When: Send a simple message
  await sendTextMessage(page, "こんにちは");

  // Wait for response
  await waitForAssistantResponse(page, { timeout: 30000 });

  // Take screenshot to verify state
  await page.screenshot({
    path: "assets/snapshots/scenarios/chunk-download-after-message-scenarios-darwin.png",
  });

  // Check if Download button exists
  const downloadButton = page.getByRole("button", { name: /Download Chunks/i });
  const buttonCount = await downloadButton.count();
  console.log(`Download button count: ${buttonCount}`);

  if (buttonCount > 0) {
    console.log("✅ Download button found!");

    // Try to download
    const logPath = await downloadFrontendChunkLogs(page, "simple-test");
    console.log(`Downloaded log path: ${logPath}`);

    expect(logPath).not.toBeNull();
  } else {
    console.log("❌ Download button NOT found!");

    // Check localStorage
    const lsValues = await page.evaluate(() => ({
      enabled: localStorage.getItem("CHUNK_LOGGER_ENABLED"),
      sessionId: localStorage.getItem("CHUNK_LOGGER_SESSION_ID"),
    }));
    console.log("LocalStorage values:", lsValues);

    throw new Error("Download Chunks button not found");
  }
});
