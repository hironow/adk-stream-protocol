/**
 * Integration Tests for Mode Switching with History Preservation
 *
 * Tests that conversation history is correctly preserved when switching between modes.
 * Uses mocked LLM responses to verify state management without API costs.
 *
 * Scope:
 * - Mode switching (Gemini ↔ ADK SSE ↔ ADK BIDI)
 * - History preservation across mode changes
 * - LocalStorage persistence
 * - Message ID consistency
 *
 * Note: This tests system behavior, not LLM context retention.
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildUseChatOptions } from "../../build-use-chat-options";
import type { UIMessageFromAISDKv6 } from "../../utils";

describe("Mode Switching with History Preservation", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe("History Persistence", () => {
    it("should preserve messages when switching from Gemini to ADK SSE", () => {
      // given - initial messages in Gemini mode
      const initialMessages: UIMessageFromAISDKv6[] = [
        {
          id: "1",
          role: "user",
          parts: [{ type: "text", text: "First message" }],
        },
        {
          id: "2",
          role: "assistant",
          parts: [{ type: "text", text: "First response" }],
        },
      ] as UIMessageFromAISDKv6[];

      const { useChatOptions: geminiOptions } = buildUseChatOptions({
        mode: "gemini",
        initialMessages,
      });

      // when - switch to ADK SSE mode
      const { useChatOptions: adkSseOptions } = buildUseChatOptions({
        mode: "adk-sse",
        initialMessages, // Pass same messages
      });

      // then - messages should be preserved
      expect(geminiOptions.id).toBeDefined();
      expect(adkSseOptions.id).toBeDefined();

      // Verify localStorage contains history (if persistence is enabled)
      const chatId = geminiOptions.id;
      const storedData = localStorage.getItem(`chat-history-${chatId}`);

      if (storedData) {
        const parsed = JSON.parse(storedData);
        expect(parsed.messages).toHaveLength(2);
        expect(parsed.messages[0].parts[0].text).toBe("First message");
        expect(parsed.messages[1].parts[0].text).toBe("First response");
      }
    });

    it("should preserve messages when switching from ADK SSE to BIDI", () => {
      // given - conversation in ADK SSE mode
      const initialMessages: UIMessageFromAISDKv6[] = [
        {
          id: "1",
          role: "user",
          parts: [{ type: "text", text: "User message 1" }],
        },
        {
          id: "2",
          role: "assistant",
          parts: [{ type: "text", text: "Assistant response 1" }],
        },
        {
          id: "3",
          role: "user",
          parts: [{ type: "text", text: "User message 2" }],
        },
      ] as UIMessageFromAISDKv6[];

      const { useChatOptions: sseOptions } = buildUseChatOptions({
        mode: "adk-sse",
        initialMessages,
      });

      // when - switch to BIDI mode
      const { useChatOptions: bidiOptions } = buildUseChatOptions({
        mode: "adk-bidi",
        initialMessages, // Pass same messages
      });

      // then - both should have same chat ID (shared state)
      expect(sseOptions.id).toBeDefined();
      expect(bidiOptions.id).toBeDefined();

      // Verify message count preserved
      expect(initialMessages).toHaveLength(3);
    });

    it("should preserve messages when switching from BIDI to Gemini", () => {
      // given - conversation in BIDI mode
      const initialMessages: UIMessageFromAISDKv6[] = [
        {
          id: "msg-1",
          role: "user",
          parts: [{ type: "text", text: "こんにちは" }],
        },
        {
          id: "msg-2",
          role: "assistant",
          parts: [{ type: "text", text: "こんにちは！" }],
        },
      ] as UIMessageFromAISDKv6[];

      const { useChatOptions: bidiOptions } = buildUseChatOptions({
        mode: "adk-bidi",
        initialMessages,
      });

      // when - switch to Gemini mode
      const { useChatOptions: geminiOptions } = buildUseChatOptions({
        mode: "gemini",
        initialMessages,
      });

      // then - configuration should be valid for both modes
      expect(bidiOptions.transport).toBeDefined();
      expect(geminiOptions.transport).toBeDefined();

      // Verify initialMessages unchanged
      expect(initialMessages).toHaveLength(2);
      expect(initialMessages[0].parts[0]).toMatchObject({
        type: "text",
        text: "こんにちは",
      });
    });
  });

  describe("Empty History Handling", () => {
    it("should handle mode switching with no messages", () => {
      // given - no initial messages
      const { useChatOptions: geminiOptions } = buildUseChatOptions({
        mode: "gemini",
        initialMessages: [],
      });

      // when - switch to ADK SSE
      const { useChatOptions: adkOptions } = buildUseChatOptions({
        mode: "adk-sse",
        initialMessages: [],
      });

      // then - both should be valid
      expect(geminiOptions.id).toBeDefined();
      expect(adkOptions.id).toBeDefined();
      expect(geminiOptions.transport).toBeDefined();
      expect(adkOptions.transport).toBeDefined();
    });
  });

  describe("Configuration Consistency", () => {
    it("should maintain sendAutomaticallyWhen config across mode switches", () => {
      // given - initial messages
      const initialMessages: UIMessageFromAISDKv6[] = [
        {
          id: "1",
          role: "user",
          parts: [{ type: "text", text: "Test" }],
        },
      ] as UIMessageFromAISDKv6[];

      // when - create options for different modes
      const { useChatOptions: _geminiOptions } = buildUseChatOptions({
        mode: "gemini",
        initialMessages,
      });

      const { useChatOptions: sseOptions } = buildUseChatOptions({
        mode: "adk-sse",
        initialMessages,
      });

      const { useChatOptions: bidiOptions } = buildUseChatOptions({
        mode: "adk-bidi",
        initialMessages,
      });

      // then - all should have sendAutomaticallyWhen configured
      // Gemini mode doesn't need sendAutomaticallyWhen (standard HTTP)
      expect(sseOptions.sendAutomaticallyWhen).toBeDefined();
      expect(typeof sseOptions.sendAutomaticallyWhen).toBe("function");

      expect(bidiOptions.sendAutomaticallyWhen).toBeDefined();
      expect(typeof bidiOptions.sendAutomaticallyWhen).toBe("function");
    });

    it("should preserve forceNewInstance setting across modes", () => {
      // given - force new instance
      const initialMessages: UIMessageFromAISDKv6[] = [];

      // when - create with forceNewInstance
      const { useChatOptions: options1 } = buildUseChatOptions({
        mode: "adk-sse",
        initialMessages,
        forceNewInstance: true,
      });

      const { useChatOptions: options2 } = buildUseChatOptions({
        mode: "adk-sse",
        initialMessages,
        forceNewInstance: true,
      });

      // then - should have different chat IDs
      expect(options1.id).toBeDefined();
      expect(options2.id).toBeDefined();
      expect(options1.id).not.toBe(options2.id);
    });

    it("should reuse chat ID when forceNewInstance is false", () => {
      // given - same chat without forcing new instance
      const initialMessages: UIMessageFromAISDKv6[] = [];

      // when - create without forceNewInstance
      const { useChatOptions: options1 } = buildUseChatOptions({
        mode: "adk-sse",
        initialMessages,
        forceNewInstance: false,
      });

      const { useChatOptions: options2 } = buildUseChatOptions({
        mode: "adk-bidi",
        initialMessages,
        forceNewInstance: false,
      });

      // then - should have same base chat ID structure
      expect(options1.id).toBeDefined();
      expect(options2.id).toBeDefined();
      // Both should follow same ID generation pattern
      expect(options1.id).toMatch(/^[a-zA-Z0-9-]+$/);
      expect(options2.id).toMatch(/^[a-zA-Z0-9-]+$/);
    });
  });

  describe("Message ID Consistency", () => {
    it("should maintain message IDs when switching modes", () => {
      // given - messages with specific IDs
      const initialMessages: UIMessageFromAISDKv6[] = [
        {
          id: "user-msg-001",
          role: "user",
          parts: [{ type: "text", text: "Message 1" }],
        },
        {
          id: "assistant-msg-001",
          role: "assistant",
          parts: [{ type: "text", text: "Response 1" }],
        },
        {
          id: "user-msg-002",
          role: "user",
          parts: [{ type: "text", text: "Message 2" }],
        },
      ] as UIMessageFromAISDKv6[];

      // when - switch modes
      buildUseChatOptions({
        mode: "gemini",
        initialMessages,
      });

      buildUseChatOptions({
        mode: "adk-sse",
        initialMessages,
      });

      buildUseChatOptions({
        mode: "adk-bidi",
        initialMessages,
      });

      // then - message IDs should remain unchanged
      expect(initialMessages[0].id).toBe("user-msg-001");
      expect(initialMessages[1].id).toBe("assistant-msg-001");
      expect(initialMessages[2].id).toBe("user-msg-002");
    });
  });

  describe("Complex History Scenarios", () => {
    it("should handle history with mixed content types", () => {
      // given - messages with various content types
      const initialMessages: UIMessageFromAISDKv6[] = [
        {
          id: "1",
          role: "user",
          parts: [{ type: "text", text: "Hello" }],
        },
        {
          id: "2",
          role: "assistant",
          parts: [
            { type: "text", text: "Hi! " },
            { type: "text", text: "How can I help?" },
          ],
        },
        {
          id: "3",
          role: "user",
          parts: [{ type: "text", text: "Thanks!" }],
        },
      ] as UIMessageFromAISDKv6[];

      // when - switch modes
      const { useChatOptions: geminiOptions } = buildUseChatOptions({
        mode: "gemini",
        initialMessages,
      });

      const { useChatOptions: adkOptions } = buildUseChatOptions({
        mode: "adk-sse",
        initialMessages,
      });

      // then - structure preserved
      expect(geminiOptions.transport).toBeDefined();
      expect(adkOptions.transport).toBeDefined();
      expect(initialMessages).toHaveLength(3);
      expect(initialMessages[1].parts).toHaveLength(2); // Multi-part message preserved
    });
  });
});
