/**
 * History Sharing E2E Tests
 *
 * Verifies that chat history is correctly shared between backends.
 *
 * Test Scenarios:
 * - Gemini Direct → ADK SSE transition with history
 * - ADK SSE → Gemini Direct transition with history
 * - History preserved across image and text messages
 *
 * Per CLAUDE.md guidelines:
 * - Uses real backend servers (no mocks)
 * - Given-When-Then structure
 * - Tests critical integration points
 */

import { expect, test } from "@playwright/test";
import {
  getMessages,
  getMessageText,
  getTestImagePath,
  isUserMessage,
  navigateToChat,
  selectBackendMode,
  sendImageMessage,
  sendTextMessage,
  setupFrontendConsoleLogger,
  waitForAssistantResponse,
} from "../helpers";

test.describe("History Sharing Tests", () => {
  test("should preserve history when switching from Gemini Direct to ADK SSE", async ({
    page,
  }) => {
    // Setup frontend console logger
    const sessionId =
      process.env.NEXT_PUBLIC_CHUNK_LOGGER_SESSION_ID ||
      process.env.CHUNK_LOGGER_SESSION_ID ||
      "test";
    setupFrontendConsoleLogger(page, sessionId);

    // Given: User has conversation in Gemini Direct mode
    await navigateToChat(page);
    await selectBackendMode(page, "gemini");

    await sendTextMessage(page, "私の名前はhogeです");
    await waitForAssistantResponse(page);

    await sendTextMessage(page, "好きな色は朱色です");
    await waitForAssistantResponse(page);

    // Verify we have messages
    let messages = await getMessages(page);
    expect(messages.length).toBeGreaterThan(2); // At least user + assistant messages

    // When: User switches to ADK SSE mode
    await selectBackendMode(page, "adk-sse");

    // Give UI time to re-render
    await page.waitForTimeout(500);

    // Then: Previous messages are still visible
    messages = await getMessages(page);
    expect(messages.length).toBeGreaterThan(2);

    // And: User can continue conversation with context
    await sendTextMessage(page, "私の名前を覚えていますか？");
    await waitForAssistantResponse(page);

    const lastMessage = await getMessages(page).then(
      (msgs) => msgs[msgs.length - 1],
    );
    const responseText = await getMessageText(lastMessage);

    // Response should reference the name "hoge" from earlier in conversation
    expect(responseText.toLowerCase()).toContain("hoge");
  });

  test("should preserve history when switching from ADK SSE to Gemini Direct", async ({
    page,
  }) => {
    // Setup frontend console logger
    const sessionId =
      process.env.NEXT_PUBLIC_CHUNK_LOGGER_SESSION_ID ||
      process.env.CHUNK_LOGGER_SESSION_ID ||
      "test";
    setupFrontendConsoleLogger(page, sessionId);

    // Given: User has conversation in ADK SSE mode
    await navigateToChat(page);
    await selectBackendMode(page, "adk-sse");

    await sendTextMessage(page, "私の趣味はプログラミングです");
    await waitForAssistantResponse(page);

    await sendTextMessage(page, "特にPythonが好きです");
    await waitForAssistantResponse(page);

    let messages = await getMessages(page);
    expect(messages.length).toBeGreaterThan(2);

    // When: User switches to Gemini Direct mode
    await selectBackendMode(page, "gemini");

    await page.waitForTimeout(500);

    // Then: Previous messages are still visible
    messages = await getMessages(page);
    expect(messages.length).toBeGreaterThan(2);

    // And: User can continue conversation with context
    await sendTextMessage(page, "私の趣味は何でしたか？");
    await waitForAssistantResponse(page);

    const lastMessage = await getMessages(page).then(
      (msgs) => msgs[msgs.length - 1],
    );
    const responseText = await getMessageText(lastMessage);

    // Response should reference programming hobby from earlier
    expect(responseText.toLowerCase()).toMatch(/プログラミング|python/);
  });

  test("should preserve image history when switching backends", async ({
    page,
  }) => {
    // Setup frontend console logger
    const sessionId =
      process.env.NEXT_PUBLIC_CHUNK_LOGGER_SESSION_ID ||
      process.env.CHUNK_LOGGER_SESSION_ID ||
      "test";
    setupFrontendConsoleLogger(page, sessionId);

    // Given: User sends image in Gemini Direct mode
    await navigateToChat(page);
    await selectBackendMode(page, "gemini");

    const imagePath = getTestImagePath("test-image.png");
    await sendImageMessage(page, imagePath, "この画像には何が写っていますか？");
    await waitForAssistantResponse(page);

    let messages = await getMessages(page);
    const geminiMessageCount = messages.length;
    expect(geminiMessageCount).toBeGreaterThan(1);

    // When: User switches to ADK SSE mode
    await selectBackendMode(page, "adk-sse");

    await page.waitForTimeout(500);

    // Then: Image message is preserved in history
    messages = await getMessages(page);
    expect(messages.length).toBe(geminiMessageCount);

    // And: User can ask follow-up about the image
    await sendTextMessage(page, "この画像の詳細を教えてください");
    await waitForAssistantResponse(page);

    const lastMessage = await getMessages(page).then(
      (msgs) => msgs[msgs.length - 1],
    );
    const responseText = await getMessageText(lastMessage);

    // Response should be contextual to the previously sent image
    expect(responseText.length).toBeGreaterThan(0);
  });

  test("should handle complex history with images and text across backend switches", async ({
    page,
  }) => {
    // Given: User has complex conversation with both images and text
    await navigateToChat(page);
    await selectBackendMode(page, "gemini");

    // Step 1: Text message
    await sendTextMessage(page, "こんにちは");
    await waitForAssistantResponse(page);

    // Step 2: Image message
    const imagePath = getTestImagePath("test-image.png");
    await sendImageMessage(page, imagePath, "この画像を見てください");
    await waitForAssistantResponse(page);

    // Step 3: Follow-up text
    await sendTextMessage(page, "わかりました");
    await waitForAssistantResponse(page);

    const geminiMessages = await getMessages(page);

    // When: Switch to ADK SSE
    await selectBackendMode(page, "adk-sse");
    await page.waitForTimeout(500);

    // Then: All messages preserved
    let messages = await getMessages(page);
    expect(messages.length).toBe(geminiMessages.length);

    // Continue conversation
    await sendTextMessage(page, "ありがとう");
    await waitForAssistantResponse(page);

    // When: Switch back to Gemini Direct
    await selectBackendMode(page, "gemini");
    await page.waitForTimeout(500);

    // Then: Full history still preserved
    messages = await getMessages(page);
    expect(messages.length).toBeGreaterThan(geminiMessages.length);

    // Can still send messages
    await sendTextMessage(page, "さようなら");
    await waitForAssistantResponse(page);

    const finalMessages = await getMessages(page);
    expect(finalMessages.length).toBeGreaterThan(messages.length);
  });

  test("should handle message schema correctly after backend switch", async ({
    page,
  }) => {
    // This test specifically targets the message history compatibility bug
    // Given: User sends image in Gemini Direct
    await navigateToChat(page);
    await selectBackendMode(page, "gemini");

    const imagePath = getTestImagePath("test-image.png");
    await sendImageMessage(page, imagePath, "画像テスト");
    await waitForAssistantResponse(page);

    // When: Switch to ADK SSE and send follow-up
    await selectBackendMode(page, "adk-sse");
    await page.waitForTimeout(500);

    // This should NOT fail with schema validation error
    await sendTextMessage(page, "フォローアップメッセージ");
    await waitForAssistantResponse(page);

    // Then: No error occurred
    const errorElement = page.getByText(/error|invalid|schema/i);
    await expect(errorElement).not.toBeVisible();

    // And response was successful
    const lastMessage = await getMessages(page).then(
      (msgs) => msgs[msgs.length - 1],
    );
    const isUser = await isUserMessage(lastMessage);
    expect(isUser).toBe(false); // Last message is assistant response

    // When: Switch back to Gemini and continue
    await selectBackendMode(page, "gemini");
    await page.waitForTimeout(500);

    // This should also work without error
    await sendTextMessage(page, "最後のメッセージ");
    await waitForAssistantResponse(page);

    // Then: No error and conversation continues
    const finalMessage = await getMessages(page).then(
      (msgs) => msgs[msgs.length - 1],
    );
    const finalIsUser = await isUserMessage(finalMessage);
    expect(finalIsUser).toBe(false);
  });
});
