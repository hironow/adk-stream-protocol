import type { UIMessage } from "@ai-sdk/react";
import { describe, expect, it } from "vitest";
import { buildUseChatOptions } from "./build-use-chat-options";

describe("buildUseChatOptions", () => {
  const baseParams = {
    initialMessages: [] as UIMessage[],
  };

  describe("Gemini Direct mode", () => {
    it("should return options with correct api endpoint and mode-specific chatId", () => {
      const { useChatOptions } = buildUseChatOptions({
        ...baseParams,
        mode: "gemini",
      });

      expect(useChatOptions.id).toContain("chat-gemini");
      expect(useChatOptions.messages).toEqual([]);
      expect(useChatOptions).toHaveProperty("transport");
    });

    it("should use default ADK backend URL when not provided", () => {
      const { useChatOptions } = buildUseChatOptions({
        ...baseParams,
        mode: "gemini",
      });

      expect(useChatOptions).toHaveProperty("transport");
    });
  });

  describe("ADK SSE mode", () => {
    it("should return options with correct api endpoint and mode-specific chatId using default backend URL", () => {
      const { useChatOptions } = buildUseChatOptions({
        ...baseParams,
        mode: "adk-sse",
      });

      expect(useChatOptions.id).toContain("chat-adk-sse");
      expect(useChatOptions.messages).toEqual([]);
      expect(useChatOptions).toHaveProperty("transport");
    });

    it("should use custom backend URL when provided", () => {
      const { useChatOptions } = buildUseChatOptions({
        ...baseParams,
        mode: "adk-sse",
        adkBackendUrl: "http://custom-backend:9000",
      });

      expect(useChatOptions).toHaveProperty("transport");
    });
  });

  describe("ADK BIDI mode", () => {
    it("should return options with WebSocket transport and mode-specific chatId using default backend URL", () => {
      const { useChatOptions, transport } = buildUseChatOptions({
        ...baseParams,
        mode: "adk-bidi",
      });

      expect(useChatOptions.id).toContain("chat-adk-bidi");
      expect(useChatOptions.messages).toEqual([]);
      expect(useChatOptions).toHaveProperty("transport");
      expect(transport).toBeDefined();
    });

    it("should create WebSocket transport with custom backend URL when provided", () => {
      const { useChatOptions, transport } = buildUseChatOptions({
        ...baseParams,
        mode: "adk-bidi",
        adkBackendUrl: "http://custom-backend:9000",
      });

      expect(useChatOptions).toHaveProperty("transport");
      expect(transport).toBeDefined();
    });
  });

  describe("Chat ID isolation", () => {
    it("should generate different chatId for each mode to prevent state sharing", () => {
      const { useChatOptions: geminiOptions } = buildUseChatOptions({
        ...baseParams,
        mode: "gemini",
      });

      const { useChatOptions: adkSseOptions } = buildUseChatOptions({
        ...baseParams,
        mode: "adk-sse",
      });

      const { useChatOptions: adkBidiOptions } = buildUseChatOptions({
        ...baseParams,
        mode: "adk-bidi",
      });

      // Each mode should have a unique chatId (with endpoint info)
      expect(geminiOptions.id).toContain("chat-gemini");
      expect(adkSseOptions.id).toContain("chat-adk-sse");
      expect(adkBidiOptions.id).toContain("chat-adk-bidi");

      // All IDs should be different
      const ids = [geminiOptions.id, adkSseOptions.id, adkBidiOptions.id];
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(3);
    });
  });

  describe("Message history preservation", () => {
    it("should preserve initialMessages in all modes", () => {
      const messages: UIMessage[] = [
        {
          id: "msg-1",
          role: "user",
          parts: [{ type: "text", text: "Hello" }],
        },
      ] as any;

      const { useChatOptions: geminiOptions } = buildUseChatOptions({
        ...baseParams,
        mode: "gemini",
        initialMessages: messages,
      });

      expect(geminiOptions.messages).toEqual(messages);

      const { useChatOptions: adkSseOptions } = buildUseChatOptions({
        ...baseParams,
        mode: "adk-sse",
        initialMessages: messages,
      });

      expect(adkSseOptions.messages).toEqual(messages);

      const { useChatOptions: adkBidiOptions } = buildUseChatOptions({
        ...baseParams,
        mode: "adk-bidi",
        initialMessages: messages,
      });

      expect(adkBidiOptions.messages).toEqual(messages);
    });
  });
});
