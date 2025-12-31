/**
 * BIDI Mode Backend Integration Tests
 *
 * Purpose: Detect approval flow issues with real BLOCKING backend BEFORE full scenarios tests run
 * Level: Integration tests (lib/bidi + real ADK backend, no full UI)
 * Environment: Playwright (real browser required for WebSocket connections)
 *
 * Why Playwright not vitest:
 * - jsdom's WebSocket is a stub - cannot make real network connections
 * - Real backend integration requires actual browser environment
 * - These tests sit between unit tests (MSW mocks) and scenarios (full UI)
 *
 * Test Pyramid Position:
 * 1. Unit tests (lib/tests/unit/) - Individual functions, no network
 * 2. E2E tests with MSW (lib/tests/e2e/) - useChat with mocked backend
 * 3. **THIS LAYER** - useChat with real backend, no UI
 * 4. Scenarios (scenarios/) - Full stack with real backend + UI
 *
 * Prerequisites:
 * - Backend server running: uv run uvicorn server:app --reload
 * - Server must implement Phase 12 BLOCKING approval pattern
 */

import { expect, test } from "@playwright/test";
import {
  navigateToChat,
  selectBackendMode,
  sendTextMessage,
  waitForAssistantResponse,
} from "../helpers";

test.describe("BIDI Backend Integration - Approval Flow", () => {
  test.beforeEach(async ({ page }) => {
    // Capture console logs from browser
    page.on("console", (msg) => {
      const text = msg.text();
      if (
        text.includes("sendAutomaticallyWhen") ||
        text.includes("Event Sender") ||
        text.includes("Approval")
      ) {
        console.log(`[Browser Console] ${text}`);
      }
    });

    await navigateToChat(page);
    await selectBackendMode(page, "adk-bidi");
  });

  test("should detect approval flow deadlock with real BLOCKING backend", async ({
    page,
  }) => {
    // Set test timeout to 60s (longer than expected deadlock timeout of 40s)
    test.setTimeout(60000);
    // This test should FAIL with the current deadlock bug
    // and PASS after implementing solution 2a

    console.log("[Test] Requesting payment (should trigger approval flow)...");
    await sendTextMessage(page, "花子さんに50ドル送金してください");

    console.log("[Test] Waiting for approval request...");

    // Should receive approval request
    await expect(
      page.getByRole("button", { name: "Approve" }).first(),
    ).toBeVisible({
      timeout: 15000,
    });

    console.log("[Test] Approval request received, approving...");

    // Approve the payment - THIS IS WHERE DEADLOCK OCCURS
    await page.getByRole("button", { name: "Approve" }).first().click();

    console.log("[Test] Approval sent, waiting for AI response...");

    // Should receive AI response - this will TIMEOUT with deadlock bug
    // Timeout set to 40s (longer than backend's 30s timeout)
    await waitForAssistantResponse(page, { timeout: 40000 });

    console.log("[Test] ✓ Approval flow completed successfully");
  });

  test("should handle denial flow with real BLOCKING backend", async ({
    page,
  }) => {
    test.setTimeout(60000);

    console.log("[Test] Requesting payment...");
    await sendTextMessage(page, "太郎さんに100ドル送金してください");

    console.log("[Test] Waiting for approval request...");
    await expect(
      page.getByRole("button", { name: "Deny" }).first(),
    ).toBeVisible({
      timeout: 15000,
    });

    console.log("[Test] Denying payment...");
    await page.getByRole("button", { name: "Deny" }).first().click();

    console.log("[Test] Waiting for AI response after denial...");
    await waitForAssistantResponse(page, { timeout: 40000 });

    console.log("[Test] ✓ Denial flow completed successfully");
  });
});
