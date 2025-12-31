/**
 * Integration Tests for Message Processing
 *
 * Tests basic message send/receive functionality with mocked LLM responses.
 * Verifies that the system correctly handles message processing across all modes
 * without requiring actual LLM API calls.
 *
 * Scope:
 * - Message format conversion (UI Message ↔ Backend Format)
 * - Response streaming and chunking
 * - Message state management
 * - Multi-turn conversation handling
 *
 * Note: LLM-dependent features (tool invocation, confirmation) are tested in E2E.
 */

import { http } from "msw";
import { describe, expect, it } from "vitest";
import { buildUseChatOptions } from "../../build-use-chat-options";
import type {
  UIMessageChunkFromAISDKv6,
  UIMessageFromAISDKv6,
} from "../../utils";
import { createTextResponse, setupMswServer } from "../helpers";

// Create MSW server with standard lifecycle
const server = setupMswServer();

describe("Message Processing Integration Tests", () => {
  describe("Basic Message Send/Receive", () => {
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
    ])("$mode: should handle text message correctly", async ({ mode, endpoint, config }) => {
      // given
      let capturedPayload: unknown = null;

      server.use(
        http.post(endpoint, async ({ request }) => {
          capturedPayload = await request.json();
          return createTextResponse("こんにちは", "世界");
        }),
      );

      const { useChatOptions } = buildUseChatOptions({
        mode,
        initialMessages: [],
        ...config,
      });

      const messages: UIMessageFromAISDKv6[] = [
        {
          id: "1",
          role: "user",
          parts: [{ type: "text", text: "テストメッセージ" }],
        } as UIMessageFromAISDKv6,
      ];

      // when
      const result = await useChatOptions.transport.sendMessages({
        trigger: "submit-message",
        chatId: useChatOptions.id,
        messageId: "msg-1",
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

      // then - verify request was sent
      expect(capturedPayload).toMatchObject({
        messages: [
          {
            role: "user",
            parts: expect.arrayContaining([
              expect.objectContaining({ type: "text", text: "テストメッセージ" }),
            ]),
          },
        ],
      });

      // then - verify response chunks
      const textDeltas = chunks.filter((c) => c.type === "text-delta");
      expect(textDeltas.length).toBeGreaterThanOrEqual(2);
      expect(textDeltas[0]).toMatchObject({
        type: "text-delta",
        delta: "こんにちは",
      });
      expect(textDeltas[1]).toMatchObject({
        type: "text-delta",
        delta: "世界",
      });
    });
  });

  describe("Multi-turn Conversation", () => {
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
    ])("$mode: should send conversation history", async ({ mode, endpoint, config }) => {
      // given
      let capturedPayload: unknown = null;

      server.use(
        http.post(endpoint, async ({ request }) => {
          capturedPayload = await request.json();
          return createTextResponse("Response to follow-up");
        }),
      );

      const { useChatOptions } = buildUseChatOptions({
        mode,
        initialMessages: [],
        ...config,
      });

      // Multi-turn conversation
      const messages: UIMessageFromAISDKv6[] = [
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
        {
          id: "3",
          role: "user",
          parts: [{ type: "text", text: "Follow-up question" }],
        },
      ] as UIMessageFromAISDKv6[];

      // when
      const result = await useChatOptions.transport.sendMessages({
        trigger: "submit-message",
        chatId: useChatOptions.id,
        messageId: "msg-3",
        messages,
        abortSignal: undefined,
      });

      const reader = result.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }

      // then - verify all messages sent to backend
      expect(capturedPayload).toMatchObject({
        messages: [
          {
            role: "user",
            parts: expect.arrayContaining([
              expect.objectContaining({ type: "text", text: "First message" }),
            ]),
          },
          {
            role: "assistant",
            parts: expect.arrayContaining([
              expect.objectContaining({ type: "text", text: "First response" }),
            ]),
          },
          {
            role: "user",
            parts: expect.arrayContaining([
              expect.objectContaining({
                type: "text",
                text: "Follow-up question",
              }),
            ]),
          },
        ],
      });
    });
  });

  describe("Empty and Edge Cases", () => {
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
    ])("$mode: should handle empty assistant response", async ({ mode, endpoint, config }) => {
      // given
      server.use(
        http.post(endpoint, async () => {
          return createTextResponse(""); // Empty response
        }),
      );

      const { useChatOptions } = buildUseChatOptions({
        mode,
        initialMessages: [],
        ...config,
      });

      const messages: UIMessageFromAISDKv6[] = [
        {
          id: "1",
          role: "user",
          parts: [{ type: "text", text: "Test" }],
        } as UIMessageFromAISDKv6,
      ];

      // when
      const result = await useChatOptions.transport.sendMessages({
        trigger: "submit-message",
        chatId: useChatOptions.id,
        messageId: "msg-1",
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

      // then - should complete without errors
      expect(chunks.length).toBeGreaterThanOrEqual(1);
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
    ])("$mode: should handle whitespace-only messages", async ({ mode, endpoint, config }) => {
      // given
      let capturedPayload: unknown = null;

      server.use(
        http.post(endpoint, async ({ request }) => {
          capturedPayload = await request.json();
          return createTextResponse("Received");
        }),
      );

      const { useChatOptions } = buildUseChatOptions({
        mode,
        initialMessages: [],
        ...config,
      });

      const messages: UIMessageFromAISDKv6[] = [
        {
          id: "1",
          role: "user",
          parts: [{ type: "text", text: "   \n\t  " }],
        } as UIMessageFromAISDKv6,
      ];

      // when
      const result = await useChatOptions.transport.sendMessages({
        trigger: "submit-message",
        chatId: useChatOptions.id,
        messageId: "msg-1",
        messages,
        abortSignal: undefined,
      });

      const reader = result.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }

      // then - whitespace preserved in payload
      expect(capturedPayload).toMatchObject({
        messages: [
          {
            role: "user",
            parts: expect.arrayContaining([
              expect.objectContaining({ type: "text", text: "   \n\t  " }),
            ]),
          },
        ],
      });
    });
  });

  describe("Response Chunking", () => {
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
    ])("$mode: should correctly stream multi-chunk response", async ({ mode, endpoint, config }) => {
      // given
      server.use(
        http.post(endpoint, async () => {
          return createTextResponse("First ", "chunk. ", "Second ", "chunk.");
        }),
      );

      const { useChatOptions } = buildUseChatOptions({
        mode,
        initialMessages: [],
        ...config,
      });

      const messages: UIMessageFromAISDKv6[] = [
        {
          id: "1",
          role: "user",
          parts: [{ type: "text", text: "Test" }],
        } as UIMessageFromAISDKv6,
      ];

      // when
      const result = await useChatOptions.transport.sendMessages({
        trigger: "submit-message",
        chatId: useChatOptions.id,
        messageId: "msg-1",
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

      // then - verify all chunks received in order
      const textDeltas = chunks.filter((c) => c.type === "text-delta");
      expect(textDeltas.length).toBeGreaterThanOrEqual(4);
      expect(textDeltas[0]).toMatchObject({ delta: "First " });
      expect(textDeltas[1]).toMatchObject({ delta: "chunk. " });
      expect(textDeltas[2]).toMatchObject({ delta: "Second " });
      expect(textDeltas[3]).toMatchObject({ delta: "chunk." });
    });
  });
});
