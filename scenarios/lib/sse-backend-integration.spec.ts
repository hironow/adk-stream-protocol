/**
 * SSE Mode Backend Integration Tests
 *
 * Purpose: Baseline tests to confirm SSE mode works correctly with real backend
 * Level: Integration tests (lib/sse + real ADK backend, no full UI)
 * Environment: Playwright (required for real HTTP/SSE connections)
 *
 * Why This Layer Exists:
 * - Confirms SSE mode has no approval flow deadlock (baseline for comparison)
 * - Detects backend integration issues before complex scenarios tests
 * - Faster than full scenarios tests, more reliable than jsdom tests
 *
 * Test Pyramid Position:
 * 1. Unit tests (lib/tests/unit/) - Individual functions, no network
 * 2. E2E tests with MSW (lib/tests/e2e/) - useChat with mocked backend
 * 3. **THIS LAYER** - useChat with real backend, no UI
 * 4. Scenarios (scenarios/) - Full stack with real backend + UI
 *
 * Prerequisites:
 * - Backend server running: uv run uvicorn server:app --reload
 * - Server must implement approval flow for SSE mode
 */

import { expect, test } from "@playwright/test";
import {
  navigateToChat,
  selectBackendMode,
  sendTextMessage,
  waitForAssistantResponse,
} from "../helpers";

test.describe("SSE Backend Integration - Approval Flow", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToChat(page);
    await selectBackendMode(page, "adk-sse");
  });

  test("should handle approval flow with real SSE backend (baseline)", async ({
    page,
  }) => {
    // This test should PASS - SSE mode has no deadlock issue
    // It serves as a baseline to confirm the backend is working

    console.log("[SSE Test] Requesting payment...");
    await sendTextMessage(page, "花子さんに50ドル送金してください");

    console.log("[SSE Test] Waiting for approval request...");
    await expect(
      page.getByRole("button", { name: "Approve" }).first(),
    ).toBeVisible({
      timeout: 15000,
    });

    console.log("[SSE Test] Approving payment...");
    await page.getByRole("button", { name: "Approve" }).first().click();

    console.log("[SSE Test] Waiting for AI response after approval...");
    // SSE mode should complete successfully (no deadlock)
    await waitForAssistantResponse(page, { timeout: 30000 });

    console.log("[SSE Test] ✓ Approval flow completed successfully");
  });

  test("should handle denial flow with real SSE backend", async ({ page }) => {
    console.log("[SSE Test] Requesting payment...");
    await sendTextMessage(page, "太郎さんに100ドル送金してください");

    console.log("[SSE Test] Waiting for approval request...");
    await expect(
      page.getByRole("button", { name: "Deny" }).first(),
    ).toBeVisible({
      timeout: 15000,
    });

    console.log("[SSE Test] Denying payment...");
    await page.getByRole("button", { name: "Deny" }).first().click();

    console.log("[SSE Test] Waiting for AI response after denial...");
    await waitForAssistantResponse(page, { timeout: 30000 });

    console.log("[SSE Test] ✓ Denial flow completed successfully");
  });
});
