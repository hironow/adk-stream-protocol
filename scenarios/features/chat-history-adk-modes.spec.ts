/**
 * ADK Mode History Sharing E2E Tests
 *
 * Tests chat history preservation when switching between ADK SSE and ADK BIDI modes.
 * This is a subset of history sharing functionality limited to ADK-only mode transitions.
 *
 * Scope:
 * - ADK SSE ↔ ADK BIDI transitions (same message schema, backend compatible)
 * - Gemini Direct transitions are out of scope (different schema)
 *
 * Per CLAUDE.md guidelines:
 * - Uses real backend servers (no mocks)
 * - Given-When-Then structure
 * - Tests critical integration points
 */

import { expect, test } from "@playwright/test";
import {
  getMessages,
  navigateToChat,
  selectBackendMode,
  sendTextMessage,
  setupFrontendConsoleLogger,
  waitForAssistantResponse,
} from "../helpers";

test.describe("ADK Mode History Sharing", () => {
  test.beforeEach(async ({ page }) => {
    // Setup frontend console logger for debugging
    const sessionId =
      process.env.NEXT_PUBLIC_CHUNK_LOGGER_SESSION_ID ||
      process.env.CHUNK_LOGGER_SESSION_ID ||
      "test";
    setupFrontendConsoleLogger(page, sessionId);
  });

  test("should preserve messages when switching from ADK SSE to ADK BIDI", async ({
    page,
  }) => {
    // Given: User has a conversation in ADK SSE mode
    await navigateToChat(page);
    await selectBackendMode(page, "adk-sse");

    await sendTextMessage(page, "私の名前は太郎です");
    await waitForAssistantResponse(page);

    // Verify message appeared
    const messagesBeforeSwitch = await getMessages(page);
    expect(messagesBeforeSwitch.length).toBeGreaterThanOrEqual(2); // user + assistant

    // When: User switches to ADK BIDI mode
    await selectBackendMode(page, "adk-bidi");

    // Then: Previous messages are still visible
    const messagesAfterSwitch = await getMessages(page);
    expect(messagesAfterSwitch.length).toBe(messagesBeforeSwitch.length);
  });

  test("should preserve messages when switching from ADK BIDI to ADK SSE", async ({
    page,
  }) => {
    // Given: User has a conversation in ADK BIDI mode
    await navigateToChat(page);
    await selectBackendMode(page, "adk-bidi");

    await sendTextMessage(page, "今日の天気について教えて");
    await waitForAssistantResponse(page);

    // Verify message appeared
    const messagesBeforeSwitch = await getMessages(page);
    expect(messagesBeforeSwitch.length).toBeGreaterThanOrEqual(2); // user + assistant

    // When: User switches to ADK SSE mode
    await selectBackendMode(page, "adk-sse");

    // Then: Previous messages are still visible
    const messagesAfterSwitch = await getMessages(page);
    expect(messagesAfterSwitch.length).toBe(messagesBeforeSwitch.length);
  });

  test("should block mode switch during streaming", async ({ page }) => {
    // Given: User is in ADK SSE mode
    await navigateToChat(page);
    await selectBackendMode(page, "adk-sse");

    // When: User sends a message and response is streaming
    const input = page.getByPlaceholder("Type your message...");
    await input.fill("1から100までの数字を順番に言ってください。ゆっくりと。");
    await page.getByRole("button", { name: "Send" }).click();

    // Wait for thinking indicator to appear (streaming started)
    const thinkingIndicator = page.getByTestId("thinking-indicator");
    await expect(thinkingIndicator).toBeVisible({ timeout: 10000 });

    // Then: Mode buttons should be disabled (opacity 0.5)
    const bidiButton = page
      .getByRole("button")
      .filter({ hasText: "ADK BIDI ⚡" });
    await expect(bidiButton).toHaveCSS("opacity", "0.5");

    // And: Clicking should not change the mode
    const sseButton = page.getByRole("button").filter({ hasText: "ADK SSE" });
    // SSE button should still be selected (font-weight 600)
    await expect(sseButton).toHaveCSS("font-weight", "600");

    // Wait for response to complete before test ends
    await waitForAssistantResponse(page, { timeout: 60000 });
  });

  test("should allow mode switch after streaming completes", async ({
    page,
  }) => {
    // Given: User sends message and waits for response
    await navigateToChat(page);
    await selectBackendMode(page, "adk-sse");

    await sendTextMessage(page, "こんにちは");
    await waitForAssistantResponse(page);

    // When: Response completes (not streaming)
    const thinkingIndicator = page.getByTestId("thinking-indicator");
    await expect(thinkingIndicator).not.toBeVisible();

    // Then: Mode buttons should be enabled (opacity 1)
    const bidiButton = page
      .getByRole("button")
      .filter({ hasText: "ADK BIDI ⚡" });
    await expect(bidiButton).toHaveCSS("opacity", "1");

    // And: Can successfully switch modes
    await selectBackendMode(page, "adk-bidi");
    await expect(bidiButton).toHaveCSS("font-weight", "600"); // Now selected
  });

  test("should preserve multiple messages in bidirectional switches", async ({
    page,
  }) => {
    // Given: User has multiple exchanges in ADK SSE mode
    await navigateToChat(page);
    await selectBackendMode(page, "adk-sse");

    await sendTextMessage(page, "最初のメッセージです");
    await waitForAssistantResponse(page);

    await sendTextMessage(page, "2番目のメッセージです");
    await waitForAssistantResponse(page);

    const sseMessages = await getMessages(page);
    expect(sseMessages.length).toBeGreaterThanOrEqual(4); // 2 user + 2 assistant

    // When: Switch to BIDI
    await selectBackendMode(page, "adk-bidi");

    // Then: All messages preserved
    let messages = await getMessages(page);
    expect(messages.length).toBe(sseMessages.length);

    // Capture count after switch but before new message
    const countBeforeBidiMessage = messages.length;

    // When: Add more messages in BIDI
    await sendTextMessage(page, "BIDIモードからのメッセージ");
    await waitForAssistantResponse(page);

    messages = await getMessages(page);
    // At minimum: previous count + 1 (user message), ideally + 2 (user + assistant)
    expect(messages.length).toBeGreaterThan(countBeforeBidiMessage);

    // When: Switch back to SSE
    await selectBackendMode(page, "adk-sse");

    // Then: All messages still preserved
    const finalMessages = await getMessages(page);
    expect(finalMessages.length).toBe(messages.length);
  });
});
