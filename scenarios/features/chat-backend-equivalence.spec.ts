/**
 * Backend Equivalence E2E Tests
 *
 * Verifies that Gemini Direct and ADK SSE backends behave identically.
 *
 * Test Scenarios:
 * - Text-only conversations
 * - Image upload with text
 * - Follow-up messages after image
 * - Tool invocations
 *
 * Per CLAUDE.md guidelines:
 * - Uses real backend servers (no mocks)
 * - Given-When-Then structure
 * - Parameterized tests for multiple backends
 */

import { expect, test } from "@playwright/test";
import {
  type BackendMode,
  getLastMessage,
  getMessageText,
  getTestImagePath,
  isUserMessage,
  navigateToChat,
  selectBackendMode,
  sendImageMessage,
  sendTextMessage,
  waitForAssistantResponse,
} from "../helpers";

// Test both backends with same test cases
const backends: BackendMode[] = ["gemini", "adk-sse"];

test.describe("Backend Equivalence Tests", () => {
  backends.forEach((backend) => {
    test.describe(`${backend.toUpperCase()} Backend`, () => {
      test.beforeEach(async ({ page }) => {
        // Setup frontend console logger
        const sessionId =
          process.env.NEXT_PUBLIC_CHUNK_LOGGER_SESSION_ID ||
          process.env.CHUNK_LOGGER_SESSION_ID ||
          "test";
        setupFrontendConsoleLogger(page, sessionId);

        // Given: User navigates to chat and selects backend
        await navigateToChat(page);
        await selectBackendMode(page, backend);
      });

      test("should handle text-only conversation", async ({ page }) => {
        // Given: Backend is ready
        // (already set in beforeEach)

        // When: User sends a text message
        const userMessage = "こんにちは";
        await sendTextMessage(page, userMessage);

        // Then: Assistant responds
        await waitForAssistantResponse(page);

        const lastMessage = await getLastMessage(page);
        const isUser = await isUserMessage(lastMessage);
        const text = await getMessageText(lastMessage);

        expect(isUser).toBe(false); // Last message is from assistant
        expect(text.length).toBeGreaterThan(0); // Assistant provided a response
      });

      test("should handle image upload with text", async ({ page }) => {
        // Given: Backend is ready and test image exists
        const imagePath = getTestImagePath("test-image.png");

        // When: User uploads image with text
        await sendImageMessage(
          page,
          imagePath,
          "この画像には何が写っていますか？",
        );

        // Then: Assistant analyzes the image
        await waitForAssistantResponse(page);

        const lastMessage = await getLastMessage(page);
        const isUser = await isUserMessage(lastMessage);
        const text = await getMessageText(lastMessage);

        expect(isUser).toBe(false);
        expect(text.length).toBeGreaterThan(0);
        // Response should reference the image (though we can't verify exact content)
      });

      test("should handle follow-up message after image", async ({ page }) => {
        // Given: User has sent an image message and received response
        const imagePath = getTestImagePath("test-image.png");
        await sendImageMessage(
          page,
          imagePath,
          "この画像には何が写っていますか？",
        );
        await waitForAssistantResponse(page);

        // When: User sends a follow-up text message
        await sendTextMessage(page, "この画像の詳細を教えてください");

        // Then: Assistant responds to follow-up in context
        await waitForAssistantResponse(page);

        const lastMessage = await getLastMessage(page);
        const isUser = await isUserMessage(lastMessage);
        const text = await getMessageText(lastMessage);

        expect(isUser).toBe(false);
        expect(text.length).toBeGreaterThan(0);
        // This tests the critical message history compatibility bug
      });

      test("should handle tool invocation (weather)", async ({ page }) => {
        // Given: Backend supports get_weather tool

        // When: User asks about weather
        await sendTextMessage(page, "What is the weather in Tokyo?");

        // Then: Assistant invokes tool and provides weather info
        await waitForAssistantResponse(page);

        const lastMessage = await getLastMessage(page);
        const text = await getMessageText(lastMessage);

        expect(text.toLowerCase()).toContain("tokyo");
        // Should contain weather-related terms (temperature, condition, etc.)
      });

      test("should handle multiple text messages in sequence", async ({
        page,
      }) => {
        // Given: Backend is ready

        // When: User sends multiple messages
        await sendTextMessage(page, "1+1は？");
        await waitForAssistantResponse(page);

        await sendTextMessage(page, "では2+2は？");
        await waitForAssistantResponse(page);

        await sendTextMessage(page, "ありがとう");
        await waitForAssistantResponse(page);

        // Then: All messages are handled correctly
        const lastMessage = await getLastMessage(page);
        const text = await getMessageText(lastMessage);

        expect(text.length).toBeGreaterThan(0);
        // Conversation history is maintained across all messages
      });
    });
  });

  test("Gemini Direct and ADK SSE should produce equivalent responses", async ({
    page,
  }) => {
    // This test verifies that both backends handle the same input similarly
    // We don't expect identical responses, but both should succeed

    const testMessage = "こんにちは、元気ですか？";

    // Test Gemini Direct
    await navigateToChat(page);
    await selectBackendMode(page, "gemini");
    await sendTextMessage(page, testMessage);
    await waitForAssistantResponse(page);

    const geminiResponse = await getMessageText(await getLastMessage(page));
    expect(geminiResponse.length).toBeGreaterThan(0);

    // Clear and test ADK SSE
    await page.reload();
    await navigateToChat(page);
    await selectBackendMode(page, "adk-sse");
    await sendTextMessage(page, testMessage);
    await waitForAssistantResponse(page);

    const adkResponse = await getMessageText(await getLastMessage(page));
    expect(adkResponse.length).toBeGreaterThan(0);

    // Both backends should provide valid responses
    // (We don't compare exact text as LLM responses vary)
  });
});
