/**
 * Integration Tests for lib/sse
 *
 * Tests HTTP SSE communication layer with MSW (Mock Service Worker).
 * Verifies request payloads, response handling, and confirmation flow.
 */

import { http } from "msw";
import { describe, expect, it } from "vitest";
import { isApprovalRequestPart, isApprovalRespondedTool } from "@/lib/utils";
import { buildUseChatOptions } from "../../sse";
import type {
  UIMessageChunkFromAISDKv6,
  UIMessageFromAISDKv6,
} from "../../utils";
import {
  createAdkConfirmationRequest,
  createTextResponse,
  setupMswServer,
} from "../helpers";

// Create MSW server with standard lifecycle
const server = setupMswServer();

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

      const messages: UIMessageFromAISDKv6[] = [
        {
          id: "1",
          role: "user",
          parts: [{ type: "text", text: "Test message" }],
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

      const messages: UIMessageFromAISDKv6[] = [
        {
          id: "1",
          role: "user",
          parts: [{ type: "text", text: "Test ADK" }],
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

      const messages: UIMessageFromAISDKv6[] = [
        {
          id: "1",
          role: "user",
          parts: [{ type: "text", text: "Do dangerous operation" }],
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

      // then - verify confirmation tool invocation was received
      // AI SDK v6: tool chunks should include tool-input-start and tool-input-available
      const confirmationChunks = chunks.filter(
        (c) =>
          (c.type === "tool-input-start" ||
            c.type === "tool-input-available") &&
          "toolName" in c &&
          c.toolName === "dangerous_operation",
      );

      expect(confirmationChunks).toHaveLength(2); // start + available

      const startChunk = confirmationChunks.find(
        (c) => c.type === "tool-input-start",
      );
      expect(startChunk).toBeDefined();
      // createAdkConfirmationRequest uses originalFunctionCall.id as toolCallId
      expect(startChunk).toHaveProperty("toolCallId", "orig-1");

      const availableChunk = confirmationChunks.find(
        (c) => c.type === "tool-input-available",
      );
      expect(availableChunk).toBeDefined();
      expect(availableChunk).toHaveProperty("toolCallId", "orig-1");
      expect(availableChunk).toHaveProperty("input");
    });

    it("sendAutomaticallyWhen detects confirmation completion", async () => {
      // AI SDK v6: State changes from approval-requested to approval-responded
      // when user calls addToolApprovalResponse() with correct approval.id
      const { useChatOptions } = buildUseChatOptions({
        mode: "adk-sse",
        initialMessages: [],
      });

      // when: Tool is waiting for approval (approval-requested state)
      const messagesWaiting: UIMessageFromAISDKv6[] = [
        {
          id: "1",
          role: "assistant",
          content: "",
          parts: [
            {
              type: "tool-dangerous_operation",
              state: "approval-requested", // User hasn't responded yet
              toolCallId: "orig-1",
              toolName: "dangerous_operation",
              input: {},
              approval: {
                id: "approval-1", // Approval request exists, but no user response yet
              },
            },
          ],
        } as any,
      ];

      const waitingCall = await useChatOptions.sendAutomaticallyWhen!({
        messages: messagesWaiting,
      });

      // then: Should return false (wait for user to respond)
      expect(waitingCall).toBe(false);

      // when: User has approved (state changed to approval-responded)
      const messagesApproved: UIMessageFromAISDKv6[] = [
        {
          id: "1",
          role: "assistant",
          content: "",
          parts: [
            {
              type: "tool-dangerous_operation",
              state: "approval-responded", // State changed after addToolApprovalResponse
              toolCallId: "orig-1",
              toolName: "dangerous_operation",
              input: {},
              approval: {
                id: "approval-1",
                approved: true, // User's decision
                reason: undefined,
              },
            },
          ],
        } as any,
      ];

      const approvedCall = await useChatOptions.sendAutomaticallyWhen!({
        messages: messagesApproved,
      });

      // then: Should return true (send approval to backend)
      expect(approvedCall).toBe(true);
    });

    it("sendAutomaticallyWhen detects confirmation denial", async () => {
      // AI SDK v6: Denial works same as approval - state changes to approval-responded
      // The actual approval/denial decision (approved: false) is included in the state
      const { useChatOptions } = buildUseChatOptions({
        mode: "adk-sse",
        initialMessages: [],
      });

      // when: Tool is waiting for approval (approval-requested state)
      const messagesWaiting: UIMessageFromAISDKv6[] = [
        {
          id: "2",
          role: "assistant",
          content: "",
          parts: [
            {
              type: "tool-dangerous_operation",
              state: "approval-requested", // User hasn't responded yet
              toolCallId: "orig-2",
              toolName: "dangerous_operation",
              input: {},
              approval: {
                id: "approval-2", // Approval request exists, but no user response yet
              },
            },
          ],
        } as any,
      ];

      const waitingCall = await useChatOptions.sendAutomaticallyWhen!({
        messages: messagesWaiting,
      });

      // then: Should return false (wait for user to respond)
      expect(waitingCall).toBe(false);

      // when: User has denied (state changed to approval-responded with approved: false)
      const messagesDenied: UIMessageFromAISDKv6[] = [
        {
          id: "2",
          role: "assistant",
          content: "",
          parts: [
            {
              type: "tool-dangerous_operation",
              state: "approval-responded", // State changed after addToolApprovalResponse
              toolCallId: "orig-2",
              toolName: "dangerous_operation",
              input: {},
              approval: {
                id: "approval-2",
                approved: false, // User denied
                reason: undefined,
              },
            },
          ],
        } as any,
      ];

      const deniedCall = await useChatOptions.sendAutomaticallyWhen!({
        messages: messagesDenied,
      });

      // then: Should return true (send denial to backend)
      expect(deniedCall).toBe(true);
    });
  });
});
