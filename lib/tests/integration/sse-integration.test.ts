/**
 * Integration Tests for lib/sse
 *
 * Tests HTTP SSE communication layer with MSW (Mock Service Worker).
 * Verifies request payloads, response handling, and confirmation flow.
 */

import type { UIMessage, UIMessageChunk } from "ai";
import { http } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
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
        { id: "1", role: "user", content: "Test message" },
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
        messages: [{ role: "user", content: "Test message" }],
      });
      expect(chunks).toHaveLength(2);
      expect(chunks[0]).toEqual({ type: "text-delta", textDelta: "Hello" });
      expect(chunks[1]).toEqual({ type: "text-delta", textDelta: " World" });
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
        { id: "1", role: "user", content: "Test ADK" },
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
        messages: [{ role: "user", content: "Test ADK" }],
      });
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toEqual({ type: "text-delta", textDelta: responseText });
    });
  });

  describe("ADK SSE Mode - Confirmation Flow", () => {
    it("handles adk_request_confirmation tool invocation and response", async () => {
      // given
      server.use(
        http.post("http://localhost:8000/stream", async () => {
          return createAdkConfirmationRequest({
            id: "orig-1",
            name: "dangerous_operation",
            args: { param: "value" },
          });
        }),
      );

      const { useChatOptions } = buildUseChatOptions({
        mode: "adk-sse",
        initialMessages: [],
      });

      const messages: UIMessage[] = [
        { id: "1", role: "user", content: "Do dangerous operation" },
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
      const confirmationChunks = chunks.filter(
        (c) =>
          c.type === "tool-invocation" &&
          "toolName" in c &&
          c.toolName === "adk_request_confirmation",
      );
      expect(confirmationChunks).toHaveLength(2); // partial + call states

      const callChunk = confirmationChunks.find((c) => c.state === "call");
      expect(callChunk).toBeDefined();
      expect(callChunk).toHaveProperty("toolCallId", "call-1");
    });

    it("sendAutomaticallyWhen detects confirmation completion", async () => {
      // given
      const messages: UIMessage[] = [
        {
          id: "1",
          role: "assistant",
          content: "",
          parts: [
            {
              type: "tool-adk_request_confirmation",
              state: "output-available",
              toolCallId: "call-1",
              input: {
                originalFunctionCall: {
                  id: "orig-1",
                  name: "dangerous_operation",
                  args: {},
                },
              },
              output: { confirmed: true },
            },
          ],
        } as any,
      ];

      const { useChatOptions } = buildUseChatOptions({
        mode: "adk-sse",
        initialMessages: [],
      });

      // when
      const shouldSend =
        await useChatOptions.sendAutomaticallyWhen!({ messages });

      // then
      expect(shouldSend).toBe(true);
    });
  });
});
