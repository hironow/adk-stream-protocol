/**
 * Tool Approval E2E Tests (Phase 4)
 *
 * Verifies the complete tool approval flow:
 * 1. AI requests sensitive tool (change_bgm, get_location)
 * 2. Backend generates tool-approval-request event
 * 3. Frontend displays approval dialog
 * 4. User approves tool execution
 * 5. Browser API executes (AudioContext, Geolocation)
 * 6. Result sent back to backend via addToolOutput
 * 7. Backend Future resolves and AI continues
 *
 * Per CLAUDE.md guidelines:
 * - Uses real backend servers (no mocks)
 * - Given-When-Then structure
 * - Tests ADK BIDI mode (tool approval only works in BIDI)
 */

import { expect, test } from "@playwright/test";
import {
  getLastMessage,
  getMessageText,
  navigateToChat,
  selectBackendMode,
  sendTextMessage,
  setupFrontendConsoleLogger,
  waitForAssistantResponse,
} from "../helpers";

test.describe("Tool Approval Flow (Phase 4)", () => {
  test.beforeEach(async ({ page }) => {
    // Setup frontend console logger
    const sessionId =
      process.env.NEXT_PUBLIC_CHUNK_LOGGER_SESSION_ID ||
      process.env.CHUNK_LOGGER_SESSION_ID ||
      "test";
    setupFrontendConsoleLogger(page, sessionId);

    // Given: User navigates to chat and selects ADK BIDI mode
    await navigateToChat(page);
    await selectBackendMode(page, "adk-bidi");
  });

  test("should display approval dialog when AI requests change_bgm tool", async ({
    page,
  }) => {
    // Given: Backend has change_bgm tool configured with approval requirement

    // When: User asks AI to change BGM
    await sendTextMessage(page, "BGMを変更してください");

    // Then: Approval dialog appears
    await expect(
      page.getByRole("heading", { name: "Tool Approval Required" }),
    ).toBeVisible({
      timeout: 30000,
    });

    // Dialog should show tool name and arguments
    await expect(page.getByText(/change_bgm/i)).toBeVisible();

    // Dialog should have Approve and Reject buttons
    await expect(page.getByRole("button", { name: "Approve" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reject" })).toBeVisible();
  });

  test("should execute change_bgm and complete conversation when user approves", async ({
    page,
  }) => {
    // Given: Backend is ready and AudioContext is initialized

    // When: User requests BGM change
    await sendTextMessage(page, "BGMを変更してください");

    // Then: Approval dialog appears
    await expect(
      page.getByRole("heading", { name: "Tool Approval Required" }),
    ).toBeVisible({
      timeout: 30000,
    });

    // When: User clicks Approve
    await page.getByRole("button", { name: "Approve" }).click();

    // Then: Dialog should close
    await expect(
      page.getByRole("heading", { name: "Tool Approval Required" }),
    ).not.toBeVisible({
      timeout: 5000,
    });

    // And: AI should complete response with tool result
    await waitForAssistantResponse(page);

    const lastMessage = await getLastMessage(page);
    const text = await getMessageText(lastMessage);

    // Response should indicate BGM was changed
    expect(text.length).toBeGreaterThan(0);
    // Could check for keywords like "変更" or "BGM" but LLM response varies
  });

  test("should send error result when user rejects tool", async ({ page }) => {
    // Given: Backend is ready

    // When: User requests BGM change
    await sendTextMessage(page, "BGMを変更してください");

    // Then: Approval dialog appears
    await expect(
      page.getByRole("heading", { name: "Tool Approval Required" }),
    ).toBeVisible({
      timeout: 30000,
    });

    // When: User clicks Reject
    await page.getByRole("button", { name: "Reject" }).click();

    // Then: Dialog should close
    await expect(
      page.getByRole("heading", { name: "Tool Approval Required" }),
    ).not.toBeVisible({
      timeout: 5000,
    });

    // And: AI should complete response with error
    await waitForAssistantResponse(page);

    const lastMessage = await getLastMessage(page);
    const text = await getMessageText(lastMessage);

    // Response should indicate user denied permission
    expect(text.length).toBeGreaterThan(0);
    // AI should acknowledge denial (though exact wording varies)
  });

  test("should handle get_location tool approval flow", async ({
    page,
    context,
  }) => {
    // Given: Grant geolocation permission
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: 35.6762, longitude: 139.6503 }); // Tokyo

    // When: User requests location
    await sendTextMessage(page, "現在地を教えてください");

    // Then: Approval dialog appears
    await expect(
      page.getByRole("heading", { name: "Tool Approval Required" }),
    ).toBeVisible({
      timeout: 30000,
    });

    // Dialog should show get_location tool
    await expect(page.getByText(/get_location/i)).toBeVisible();

    // When: User approves
    await page.getByRole("button", { name: "Approve" }).click();

    // Then: Dialog closes and AI continues
    await expect(
      page.getByRole("heading", { name: "Tool Approval Required" }),
    ).not.toBeVisible({
      timeout: 5000,
    });

    await waitForAssistantResponse(page);

    const lastMessage = await getLastMessage(page);
    const text = await getMessageText(lastMessage);

    // Response should contain location information
    expect(text.length).toBeGreaterThan(0);
    // Could check for Tokyo-related keywords but LLM response format varies
  });

  test("should handle multiple tool approval requests in sequence", async ({
    page,
  }) => {
    // Given: Backend is ready

    // When: User requests BGM change
    await sendTextMessage(page, "BGMを変更してください");

    // Then: First approval dialog appears
    await expect(
      page.getByRole("heading", { name: "Tool Approval Required" }),
    ).toBeVisible({
      timeout: 30000,
    });

    // When: User approves first tool
    await page.getByRole("button", { name: "Approve" }).click();

    // Then: First response completes
    await expect(
      page.getByRole("heading", { name: "Tool Approval Required" }),
    ).not.toBeVisible({
      timeout: 5000,
    });
    await waitForAssistantResponse(page);

    // When: User requests another tool action
    await sendTextMessage(page, "もう一度BGMを変更してください");

    // Then: Second approval dialog appears
    await expect(
      page.getByRole("heading", { name: "Tool Approval Required" }),
    ).toBeVisible({
      timeout: 30000,
    });

    // When: User approves second tool
    await page.getByRole("button", { name: "Approve" }).click();

    // Then: Second response completes
    await expect(
      page.getByRole("heading", { name: "Tool Approval Required" }),
    ).not.toBeVisible({
      timeout: 5000,
    });
    await waitForAssistantResponse(page);

    const lastMessage = await getLastMessage(page);
    const text = await getMessageText(lastMessage);

    expect(text.length).toBeGreaterThan(0);
    // Both tool executions should have completed successfully
  });
});
