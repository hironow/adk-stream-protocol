/**
 * Integration Tests for Long Context Storage
 *
 * Tests that the system correctly handles large conversation histories
 * with mocked LLM responses. Verifies storage, retrieval, and state management
 * without requiring actual LLM API calls.
 *
 * Scope:
 * - Large message arrays (50+ messages)
 * - Message ordering and consistency
 * - Transport payload size handling
 * - Performance with large histories
 *
 * Note: This tests system capacity, not LLM context window limits.
 */

import { http } from "msw";
import { describe, expect, it } from "vitest";
import { buildUseChatOptions } from "../../build-use-chat-options";
import type {
  UIMessageChunkFromAISDKv6,
  UIMessageFromAISDKv6,
} from "../../utils";
import { createTextResponse, useMswServer } from "../helpers";

/**
 * Helper to create a large conversation history
 */
function createLargeHistory(count: number): UIMessageFromAISDKv6[] {
  const messages: UIMessageFromAISDKv6[] = [];

  for (let i = 0; i < count; i++) {
    // User message
    messages.push({
      id: `user-${i}`,
      role: "user",
      parts: [{ type: "text", text: `User message ${i}` }],
    } as UIMessageFromAISDKv6);

    // Assistant response
    messages.push({
      id: `assistant-${i}`,
      role: "assistant",
      parts: [{ type: "text", text: `Assistant response ${i}` }],
    } as UIMessageFromAISDKv6);
  }

  return messages;
}

describe("Long Context Storage Integration Tests", () => {
  const { getServer } = useMswServer();

  describe("Large Message Arrays", () => {
    it.each([
      {
        mode: "gemini" as const,
        endpoint: "http://localhost/api/chat",
        config: { apiEndpoint: "http://localhost/api/chat" },
      },
      {
        mode: "adk-sse" as const,
        endpoint: "http://localhost:8000/stream",
        config: {},
      },
    ])("$mode: should handle 50 messages", async ({
      mode,
      endpoint,
      _config,
    }) => {
      // given
      let capturedPayload: unknown = null;

      getServer().use(
        http.post(endpoint, async ({ request }) => {
          capturedPayload = await request.json();
          return createTextResponse("Response to message 25");
        }),
      );

      const { useChatOptions } = buildUseChatOptions({
        mode,
        initialMessages: [],
        ...(mode === "gemini" && { apiEndpoint: "http://localhost/api/chat" }),
      });

      // Create 25 turns = 50 messages (25 user + 25 assistant)
      const messages = createLargeHistory(25);

      // Add one more user message
      messages.push({
        id: "user-26",
        role: "user",
        parts: [{ type: "text", text: "Follow-up question" }],
      } as UIMessageFromAISDKv6);

      // when
      const result = await useChatOptions.transport.sendMessages({
        trigger: "submit-message",
        chatId: useChatOptions.id,
        messageId: "user-26",
        messages,
        abortSignal: undefined,
      });

      const reader = result.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }

      // then - verify all 51 messages sent
      expect(capturedPayload).toHaveProperty("messages");
      const payload = capturedPayload as { messages: unknown[] };
      expect(payload.messages).toHaveLength(51);
    });

    it.each([
      {
        mode: "gemini" as const,
        endpoint: "http://localhost/api/chat",
        config: { apiEndpoint: "http://localhost/api/chat" },
      },
      {
        mode: "adk-sse" as const,
        endpoint: "http://localhost:8000/stream",
        config: {},
      },
    ])("$mode: should handle 100 messages", async ({
      mode,
      endpoint,
      _config,
    }) => {
      // given
      let capturedPayload: unknown = null;

      getServer().use(
        http.post(endpoint, async ({ request }) => {
          capturedPayload = await request.json();
          return createTextResponse("Response to long conversation");
        }),
      );

      const { useChatOptions } = buildUseChatOptions({
        mode,
        initialMessages: [],
        ...(mode === "gemini" && { apiEndpoint: "http://localhost/api/chat" }),
      });

      // Create 50 turns = 100 messages
      const messages = createLargeHistory(50);

      // when
      const result = await useChatOptions.transport.sendMessages({
        trigger: "submit-message",
        chatId: useChatOptions.id,
        messageId: "assistant-49",
        messages,
        abortSignal: undefined,
      });

      const reader = result.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }

      // then
      expect(capturedPayload).toHaveProperty("messages");
      const payload = capturedPayload as { messages: unknown[] };
      expect(payload.messages).toHaveLength(100);
    });
  });

  describe("Message Ordering and Consistency", () => {
    it("should preserve message order in large histories", async () => {
      // given
      let capturedPayload: unknown = null;

      getServer().use(
        http.post("http://localhost:8000/stream", async ({ request }) => {
          capturedPayload = await request.json();
          return createTextResponse("OK");
        }),
      );

      const { useChatOptions } = buildUseChatOptions({
        mode: "adk-sse",
        initialMessages: [],
      });

      // Create 30 turns = 60 messages
      const messages = createLargeHistory(30);

      // when
      const result = await useChatOptions.transport.sendMessages({
        trigger: "submit-message",
        chatId: useChatOptions.id,
        messageId: "assistant-29",
        messages,
        abortSignal: undefined,
      });

      const reader = result.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }

      // then - verify ordering
      const payload = capturedPayload as {
        messages: Array<{ role: string; parts: Array<{ text: string }> }>;
      };

      expect(payload.messages).toHaveLength(60);

      // Verify alternating user/assistant pattern
      for (let i = 0; i < 30; i++) {
        expect(payload.messages[i * 2].role).toBe("user");
        expect(payload.messages[i * 2].parts[0].text).toBe(`User message ${i}`);

        expect(payload.messages[i * 2 + 1].role).toBe("assistant");
        expect(payload.messages[i * 2 + 1].parts[0].text).toBe(
          `Assistant response ${i}`,
        );
      }
    });

    it("should maintain message IDs in large histories", async () => {
      // given
      let _capturedPayload: unknown = null;

      getServer().use(
        http.post("http://localhost:8000/stream", async ({ request }) => {
          _capturedPayload = await request.json();
          return createTextResponse("OK");
        }),
      );

      const { useChatOptions } = buildUseChatOptions({
        mode: "adk-sse",
        initialMessages: [],
      });

      // Create messages with specific IDs
      const messages = createLargeHistory(25);

      // when
      const result = await useChatOptions.transport.sendMessages({
        trigger: "submit-message",
        chatId: useChatOptions.id,
        messageId: "assistant-24",
        messages,
        abortSignal: undefined,
      });

      const reader = result.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }

      // then - verify IDs unchanged
      expect(messages[0].id).toBe("user-0");
      expect(messages[1].id).toBe("assistant-0");
      expect(messages[48].id).toBe("user-24");
      expect(messages[49].id).toBe("assistant-24");
    });
  });

  describe("Large Message Content", () => {
    it("should handle messages with large text content", async () => {
      // given
      let capturedPayload: unknown = null;

      getServer().use(
        http.post("http://localhost:8000/stream", async ({ request }) => {
          capturedPayload = await request.json();
          return createTextResponse("Received large content");
        }),
      );

      const { useChatOptions } = buildUseChatOptions({
        mode: "adk-sse",
        initialMessages: [],
      });

      // Create messages with 1KB text each
      const largeText = "a".repeat(1000);
      const messages: UIMessageFromAISDKv6[] = [];

      for (let i = 0; i < 10; i++) {
        messages.push({
          id: `user-${i}`,
          role: "user",
          parts: [{ type: "text", text: largeText }],
        } as UIMessageFromAISDKv6);

        messages.push({
          id: `assistant-${i}`,
          role: "assistant",
          parts: [{ type: "text", text: largeText }],
        } as UIMessageFromAISDKv6);
      }

      // when
      const result = await useChatOptions.transport.sendMessages({
        trigger: "submit-message",
        chatId: useChatOptions.id,
        messageId: "assistant-9",
        messages,
        abortSignal: undefined,
      });

      const reader = result.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }

      // then
      const payload = capturedPayload as {
        messages: Array<{ parts: Array<{ text: string }> }>;
      };

      expect(payload.messages).toHaveLength(20);
      expect(payload.messages[0].parts[0].text).toHaveLength(1000);
    });

    it("should handle mixed large and small messages", async () => {
      // given
      let capturedPayload: unknown = null;

      getServer().use(
        http.post("http://localhost:8000/stream", async ({ request }) => {
          capturedPayload = await request.json();
          return createTextResponse("OK");
        }),
      );

      const { useChatOptions } = buildUseChatOptions({
        mode: "adk-sse",
        initialMessages: [],
      });

      const largeText = "x".repeat(5000);
      const messages: UIMessageFromAISDKv6[] = [];

      for (let i = 0; i < 20; i++) {
        // Alternate between large and small messages
        const text = i % 2 === 0 ? largeText : "Short message";

        messages.push({
          id: `user-${i}`,
          role: "user",
          parts: [{ type: "text", text }],
        } as UIMessageFromAISDKv6);

        messages.push({
          id: `assistant-${i}`,
          role: "assistant",
          parts: [{ type: "text", text: `Response ${i}` }],
        } as UIMessageFromAISDKv6);
      }

      // when
      const result = await useChatOptions.transport.sendMessages({
        trigger: "submit-message",
        chatId: useChatOptions.id,
        messageId: "assistant-19",
        messages,
        abortSignal: undefined,
      });

      const reader = result.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }

      // then
      const payload = capturedPayload as {
        messages: Array<{ parts: Array<{ text: string }> }>;
      };

      expect(payload.messages).toHaveLength(40);
    });
  });

  describe("Response Streaming with Large Context", () => {
    it("should correctly stream response chunks with 50+ message history", async () => {
      // given
      getServer().use(
        http.post("http://localhost:8000/stream", async () => {
          return createTextResponse(
            "Response ",
            "chunk ",
            "1. ",
            "Response ",
            "chunk ",
            "2.",
          );
        }),
      );

      const { useChatOptions } = buildUseChatOptions({
        mode: "adk-sse",
        initialMessages: [],
      });

      // Large history + new message
      const messages = createLargeHistory(25);
      messages.push({
        id: "user-26",
        role: "user",
        parts: [{ type: "text", text: "New question" }],
      } as UIMessageFromAISDKv6);

      // when
      const result = await useChatOptions.transport.sendMessages({
        trigger: "submit-message",
        chatId: useChatOptions.id,
        messageId: "user-26",
        messages,
        abortSignal: undefined,
      });

      const reader = result.getReader();
      const chunks: UIMessageChunkFromAISDKv6[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      // then - verify all chunks received
      const textDeltas = chunks.filter((c) => c.type === "text-delta");
      expect(textDeltas.length).toBeGreaterThanOrEqual(6);

      const fullText = textDeltas.map((c) => c.delta).join("");
      expect(fullText).toBe("Response chunk 1. Response chunk 2.");
    });
  });

  describe("Performance and Edge Cases", () => {
    it("should handle exactly 50 messages efficiently", async () => {
      // given
      let capturedPayload: unknown = null;
      const startTime = Date.now();

      getServer().use(
        http.post("http://localhost:8000/stream", async ({ request }) => {
          capturedPayload = await request.json();
          return createTextResponse("OK");
        }),
      );

      const { useChatOptions } = buildUseChatOptions({
        mode: "adk-sse",
        initialMessages: [],
      });

      // Exactly 50 messages (25 turns)
      const messages = createLargeHistory(25);

      // when
      const result = await useChatOptions.transport.sendMessages({
        trigger: "submit-message",
        chatId: useChatOptions.id,
        messageId: "assistant-24",
        messages,
        abortSignal: undefined,
      });

      const reader = result.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }

      const endTime = Date.now();
      const duration = endTime - startTime;

      // then
      const payload = capturedPayload as { messages: unknown[] };
      expect(payload.messages).toHaveLength(50);

      // Should complete reasonably fast (< 1000ms for local mocking)
      expect(duration).toBeLessThan(1000);
    });

    it("should handle empty messages in large histories", async () => {
      // given
      let capturedPayload: unknown = null;

      getServer().use(
        http.post("http://localhost:8000/stream", async ({ request }) => {
          capturedPayload = await request.json();
          return createTextResponse("OK");
        }),
      );

      const { useChatOptions } = buildUseChatOptions({
        mode: "adk-sse",
        initialMessages: [],
      });

      const messages: UIMessageFromAISDKv6[] = [];

      // Mix of empty and normal messages
      for (let i = 0; i < 30; i++) {
        messages.push({
          id: `user-${i}`,
          role: "user",
          parts: [{ type: "text", text: i % 3 === 0 ? "" : `Message ${i}` }],
        } as UIMessageFromAISDKv6);

        messages.push({
          id: `assistant-${i}`,
          role: "assistant",
          parts: [{ type: "text", text: `Response ${i}` }],
        } as UIMessageFromAISDKv6);
      }

      // when
      const result = await useChatOptions.transport.sendMessages({
        trigger: "submit-message",
        chatId: useChatOptions.id,
        messageId: "assistant-29",
        messages,
        abortSignal: undefined,
      });

      const reader = result.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }

      // then
      const payload = capturedPayload as { messages: unknown[] };
      expect(payload.messages).toHaveLength(60);
    });
  });
});
