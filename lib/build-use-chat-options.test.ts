import type { UIMessage } from "@ai-sdk/react";
import { describe, expect, it } from "vitest";
import { buildUseChatOptions } from "./build-use-chat-options";

describe("buildUseChatOptions", () => {
  const baseParams = {
    initialMessages: [] as UIMessage[],
  };

  describe("Gemini Direct mode", () => {
    it("should return options with correct api endpoint and mode-specific chatId", () => {
      const options = buildUseChatOptions({
        ...baseParams,
        mode: "gemini",
      });

      expect(options).toMatchObject({
        id: "chat-gemini",
        messages: [],
        api: "/api/chat",
      });
    });

    it("should use default ADK backend URL when not provided", () => {
      const options = buildUseChatOptions({
        ...baseParams,
        mode: "gemini",
      });

      expect(options.api).toBe("/api/chat");
    });
  });

  describe("ADK SSE mode", () => {
    it("should return options with correct api endpoint and mode-specific chatId using default backend URL", () => {
      const options = buildUseChatOptions({
        ...baseParams,
        mode: "adk-sse",
      });

      expect(options).toMatchObject({
        id: "chat-adk-sse",
        messages: [],
        api: "http://localhost:8000/stream",
      });
    });

    it("should use custom backend URL when provided", () => {
      const options = buildUseChatOptions({
        ...baseParams,
        mode: "adk-sse",
        adkBackendUrl: "http://custom-backend:9000",
      });

      expect(options.api).toBe("http://custom-backend:9000/stream");
    });
  });

  describe("ADK BIDI mode", () => {
    it("should return options with WebSocket transport and mode-specific chatId using default backend URL", () => {
      const options = buildUseChatOptions({
        ...baseParams,
        mode: "adk-bidi",
      });

      expect(options).toMatchObject({
        id: "chat-adk-bidi",
        messages: [],
      });
      expect(options).toHaveProperty("transport");
      expect(options.transport).toBeDefined();
      expect(options).not.toHaveProperty("api");
    });

    it("should create WebSocket transport with custom backend URL when provided", () => {
      const options = buildUseChatOptions({
        ...baseParams,
        mode: "adk-bidi",
        adkBackendUrl: "http://custom-backend:9000",
      });

      expect(options).toHaveProperty("transport");
      expect(options.transport).toBeDefined();
    });
  });

  describe("Chat ID isolation", () => {
    it("should generate different chatId for each mode to prevent state sharing", () => {
      const geminiOptions = buildUseChatOptions({
        ...baseParams,
        mode: "gemini",
      });

      const adkSseOptions = buildUseChatOptions({
        ...baseParams,
        mode: "adk-sse",
      });

      const adkBidiOptions = buildUseChatOptions({
        ...baseParams,
        mode: "adk-bidi",
      });

      // Each mode should have a unique chatId
      expect(geminiOptions.id).toBe("chat-gemini");
      expect(adkSseOptions.id).toBe("chat-adk-sse");
      expect(adkBidiOptions.id).toBe("chat-adk-bidi");

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

      const geminiOptions = buildUseChatOptions({
        ...baseParams,
        mode: "gemini",
        initialMessages: messages,
      });

      expect(geminiOptions.messages).toEqual(messages);

      const adkSseOptions = buildUseChatOptions({
        ...baseParams,
        mode: "adk-sse",
        initialMessages: messages,
      });

      expect(adkSseOptions.messages).toEqual(messages);

      const adkBidiOptions = buildUseChatOptions({
        ...baseParams,
        mode: "adk-bidi",
        initialMessages: messages,
      });

      expect(adkBidiOptions.messages).toEqual(messages);
    });
  });
});
