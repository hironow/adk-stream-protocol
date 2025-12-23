/**
 * Integration Tests for lib/sse
 *
 * Tests HTTP SSE communication layer with MSW (Mock Service Worker).
 * Verifies request payloads, response handling, and confirmation flow.
 */

import type { UIMessage, UIMessageChunk } from "ai";
import { http } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  TOOL_CHUNK_TYPE_INPUT_AVAILABLE,
  TOOL_CHUNK_TYPE_INPUT_START,
  TOOL_NAME_ADK_REQUEST_CONFIRMATION,
  TOOL_STATE_APPROVAL_RESPONDED,
  TOOL_STATE_OUTPUT_AVAILABLE,
  TOOL_TYPE_ADK_REQUEST_CONFIRMATION,
} from "../../constants";
import { buildUseChatOptions } from "../../sse";
import {
  createAdkConfirmationRequest,
  createTextResponse,
} from "../helpers/sse-response-builders";
import { createMswServer } from "../mocks/msw-server";

// Create MSW server
const server = createMswServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("lib/sse Integration Tests", () => {
  describe("Gemini Mode - HTTP SSE Communication", () => {
    it("sends correct request payload to /api/chat endpoint", async () => {
      // given
      let capturedPayload: unknown = null;

      server.use(
        http.post("http://localhost/api/chat", async ({ request }) => {
          capturedPayload = await request.json();
          return createTextResponse("Hello", " World");
        }),
      );

      const { useChatOptions } = buildUseChatOptions({
        mode: "gemini",
        initialMessages: [],
        apiEndpoint: "http://localhost/api/chat",
      });

      const messages: UIMessage[] = [
        {
          id: "1",
          role: "user",
          parts: [{ type: "text", text: "Test message" }],
        } as UIMessage,
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
      const chunks: UIMessageChunk[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      // then
      expect(capturedPayload).toMatchObject({
        messages: [
          {
            role: "user",
            parts: expect.arrayContaining([
              expect.objectContaining({ type: "text", text: "Test message" }),
            ]),
          },
        ],
      });
      // AI SDK v6 sends: text-start, text-delta(s), text-end
      expect(chunks.length).toBeGreaterThanOrEqual(2);
      const textDeltas = chunks.filter((c) => c.type === "text-delta");
      expect(textDeltas).toHaveLength(2);
      expect(textDeltas[0]).toMatchObject({
        type: "text-delta",
        delta: "Hello",
      });
      expect(textDeltas[1]).toMatchObject({
        type: "text-delta",
        delta: " World",
      });
    });
  });

  describe("ADK SSE Mode - HTTP SSE Communication", () => {
    it.each([
      {
        name: "sends correct request payload to ADK backend with default URL",
        adkBackendUrl: undefined,
        expectedEndpoint: "http://localhost:8000/stream",
        responseText: "ADK",
      },
      {
        name: "sends correct request payload to custom ADK backend",
        adkBackendUrl: "http://example.com:9000",
        expectedEndpoint: "http://example.com:9000/stream",
        responseText: "Custom",
      },
    ])("$name", async ({ adkBackendUrl, expectedEndpoint, responseText }) => {
      // given
      let capturedPayload: unknown = null;
      let capturedEndpoint: string | null = null;

      server.use(
        http.post("http://localhost:8000/stream", async ({ request }) => {
          capturedEndpoint = request.url;
          capturedPayload = await request.json();
          return createTextResponse("ADK");
        }),
        http.post("http://example.com:9000/stream", async ({ request }) => {
          capturedEndpoint = request.url;
          capturedPayload = await request.json();
          return createTextResponse("Custom");
        }),
      );

      const { useChatOptions } = buildUseChatOptions({
        mode: "adk-sse",
        initialMessages: [],
        ...(adkBackendUrl && { adkBackendUrl }),
      });

      const messages: UIMessage[] = [
        {
          id: "1",
          role: "user",
          parts: [{ type: "text", text: "Test ADK" }],
        } as UIMessage,
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
      const chunks: UIMessageChunk[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      // then
      expect(capturedEndpoint).toBe(expectedEndpoint);
      expect(capturedPayload).toMatchObject({
        messages: [
          {
            role: "user",
            parts: expect.arrayContaining([
              expect.objectContaining({ type: "text", text: "Test ADK" }),
            ]),
          },
        ],
      });
      // AI SDK v6 sends: text-start, text-delta(s), text-end
      const textDeltas = chunks.filter((c) => c.type === "text-delta");
      expect(textDeltas).toHaveLength(1);
      expect(textDeltas[0]).toMatchObject({
        type: "text-delta",
        delta: responseText,
      });
    });
  });

  describe("ADK SSE Mode - Confirmation Flow", () => {
    it("handles adk_request_confirmation tool invocation and response", async () => {
      // given
      server.use(
        http.post("http://localhost:8000/stream", async () => {
          return createAdkConfirmationRequest({
            originalFunctionCall: {
              id: "orig-1",
              name: "dangerous_operation",
              args: { param: "value" },
            },
          });
        }),
      );

      const { useChatOptions } = buildUseChatOptions({
        mode: "adk-sse",
        initialMessages: [],
      });

      const messages: UIMessage[] = [
        {
          id: "1",
          role: "user",
          parts: [{ type: "text", text: "Do dangerous operation" }],
        } as UIMessage,
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
      const chunks: UIMessageChunk[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      // then - verify confirmation tool invocation was received
      // AI SDK v6: tool chunks should include tool-input-start and tool-input-available
      const confirmationChunks = chunks.filter(
        (c) =>
          (c.type === TOOL_CHUNK_TYPE_INPUT_START ||
            c.type === TOOL_CHUNK_TYPE_INPUT_AVAILABLE) &&
          "toolName" in c &&
          c.toolName === TOOL_NAME_ADK_REQUEST_CONFIRMATION,
      );

      expect(confirmationChunks).toHaveLength(2); // start + available

      const startChunk = confirmationChunks.find(
        (c) => c.type === TOOL_CHUNK_TYPE_INPUT_START,
      );
      expect(startChunk).toBeDefined();
      expect(startChunk).toHaveProperty("toolCallId", "call-1");

      const availableChunk = confirmationChunks.find(
        (c) => c.type === TOOL_CHUNK_TYPE_INPUT_AVAILABLE,
      );
      expect(availableChunk).toBeDefined();
      expect(availableChunk).toHaveProperty("toolCallId", "call-1");
      expect(availableChunk).toHaveProperty("input");
    });

    it("sendAutomaticallyWhen detects confirmation completion", async () => {
      // given - AI SDK v6 approval flow uses "approval-responded" state
      const messages: UIMessage[] = [
        {
          id: "1",
          role: "assistant",
          content: "",
          parts: [
            {
              type: TOOL_TYPE_ADK_REQUEST_CONFIRMATION,
              state: TOOL_STATE_APPROVAL_RESPONDED,
              toolCallId: "call-1",
              input: {
                originalFunctionCall: {
                  id: "orig-1",
                  name: "dangerous_operation",
                  args: {},
                },
              },
              approval: {
                id: "call-1",
                approved: true,
              },
            },
          ],
        } as any,
      ];

      const { useChatOptions } = buildUseChatOptions({
        mode: "adk-sse",
        initialMessages: [],
      });

      // when
      const shouldSend = await useChatOptions.sendAutomaticallyWhen!({
        messages,
      });

      // then
      expect(shouldSend).toBe(true);
    });

    it("sendAutomaticallyWhen detects confirmation denial", async () => {
      // given - AI SDK v6 denial flow uses "approval-responded" state with approved: false
      const messages: UIMessage[] = [
        {
          id: "1",
          role: "assistant",
          content: "",
          parts: [
            {
              type: TOOL_TYPE_ADK_REQUEST_CONFIRMATION,
              state: TOOL_STATE_APPROVAL_RESPONDED,
              toolCallId: "call-1",
              input: {
                originalFunctionCall: {
                  id: "orig-1",
                  name: "dangerous_operation",
                  args: {},
                },
              },
              approval: {
                id: "call-1",
                approved: false, // ← Key difference: approved is false
                reason: "User rejected the operation",
              },
            },
          ],
        } as any,
      ];

      const { useChatOptions } = buildUseChatOptions({
        mode: "adk-sse",
        initialMessages: [],
      });

      // when
      const shouldSend = await useChatOptions.sendAutomaticallyWhen!({
        messages,
      });

      // then
      expect(shouldSend).toBe(true);
    });
  });
});
