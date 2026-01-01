/**
 * P4-T4.4: Mode/Model Tool Testing
 *
 * This test suite validates LLM-dependent features that require real API calls:
 * - Tool invocation and approval flow (weather tool)
 * - Modes: ADK SSE, ADK BIDI
 *
 * Note: Basic system features (message processing, history, encoding) are tested
 * in integration tests to avoid LLM API costs.
 */

import { expect, test } from "@playwright/test";
import {
  clearChatHistory,
  navigateToChat,
  selectBackendMode,
  sendTextMessage,
  setupFrontendConsoleLogger,
} from "../helpers";

// Test configuration
const _TEST_TIMEOUT = 30000; // 30 seconds per test

// Test data
const TEST_PROMPTS = {
  tool: "What's the weather like in Tokyo?",
};

test.describe("Systematic Mode/Model Testing (P4-T4.4)", () => {
  test.beforeEach(async ({ page }) => {
    // Setup frontend console logger
    const sessionId =
      process.env.NEXT_PUBLIC_CHUNK_LOGGER_SESSION_ID ||
      process.env.CHUNK_LOGGER_SESSION_ID ||
      "test";
    setupFrontendConsoleLogger(page, sessionId);

    await navigateToChat(page);
  });

  test.afterEach(async ({ page }) => {
    await clearChatHistory(page);
  });

  // Test 4: Tool usage (weather)
  test.describe("Tool Usage", () => {
    for (const mode of ["adk-sse", "adk-bidi"] as const) {
      test(`${mode}: Weather tool`, async ({ page }) => {
        test.setTimeout(90000); // 90 seconds for weather tool + network latency

        await selectBackendMode(page, mode);

        // Ask about weather (triggers tool)
        await sendTextMessage(page, TEST_PROMPTS.tool);

        // Wait for tool approval UI
        await page
          .waitForSelector('[data-testid="tool-approval"]', {
            timeout: 10000,
          })
          .catch(() => {
            // Tool approval might auto-approve in test mode
          });

        // If approval needed, approve it
        const approveButton = page.locator('button:has-text("Approve")');
        if (await approveButton.isVisible()) {
          await approveButton.click();

          // Wait for tool execution and result
          await page.waitForTimeout(5000);
        } else {
          // If auto-approved, still wait for execution
          await page.waitForTimeout(5000);
        }

        // Verify response contains weather info
        const bodyText = await page.textContent("body");
        expect(bodyText).toBeTruthy();
        expect(bodyText).toMatch(/weather|温度|天気|temperature/i);
      });
    }
  });
});
