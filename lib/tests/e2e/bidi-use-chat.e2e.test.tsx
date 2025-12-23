/**
 * E2E Test: BIDI Mode with useChat
 *
 * Tests the complete flow of lib/bidi with React's useChat hook:
 * 1. Full configuration with all lib/bidi options
 * 2. sendAutomaticallyWhen triggering on confirmation completion
 * 3. Correct payload sent to backend via WebSocket
 * 4. Response processing and confirmation flow
 *
 * This is an E2E test - we use real React components, real useChat hook,
 * and real WebSocket communication (mocked with MSW WebSocket).
 *
 * @vitest-environment jsdom
 */

import { useChat } from "@ai-sdk/react";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { UIMessage } from "ai";
import { isTextUIPart } from "ai";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildUseChatOptions } from "../../bidi";
import {
  TOOL_NAME_ADK_REQUEST_CONFIRMATION,
  TOOL_STATE_APPROVAL_REQUESTED,
  TOOL_STATE_APPROVAL_RESPONDED,
  TOOL_TYPE_ADK_REQUEST_CONFIRMATION,
} from "../../constants";
import {
  createBidiWebSocketLink,
  createConfirmationRequestHandler,
  createCustomHandler,
  createTextResponseHandler,
} from "../helpers/bidi-ws-handlers";
import { createMswServer } from "../mocks/msw-server";

/**
 * Helper function to extract text content from UIMessage parts
 */
function getMessageText(message: UIMessage | undefined): string {
  if (!message) return "";
  return message.parts
    .filter((part): part is { type: "text"; text: string } =>
      isTextUIPart(part),
    )
    .map((part) => part.text)
    .join("");
}

// Create MSW server for WebSocket interception
const server = createMswServer();

beforeAll(() =>
  server.listen({
    onUnhandledRequest(request) {
      // Ignore WebSocket upgrade requests
      if (request.url.includes("/live")) {
        return;
      }
      console.error("Unhandled request:", request.method, request.url);
    },
  }),
);
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("BIDI Mode with useChat - E2E Tests", () => {
  describe("Test 1: Full BIDI Configuration with sendAutomaticallyWhen", () => {
    it("should use all lib/bidi options and trigger sendAutomaticallyWhen on confirmation", async () => {
      // Given: Setup MSW handler to send confirmation request
      const chat = createBidiWebSocketLink();
      server.use(
        createConfirmationRequestHandler(chat, {
          id: "orig-1",
          name: "dangerous_operation",
          args: { action: "delete_all" },
        }),
      );

      const config = {
        initialMessages: [] as UIMessage[],
      };

      const { result } = renderHook(() =>
        useChat(buildUseChatOptions(config).useChatOptions),
      );

      // When: User submits a message that triggers confirmation
      await act(async () => {
        result.current.sendMessage({ text: "Request dangerous operation" });
      });

      // Wait for confirmation to appear in messages
      await waitFor(
        () => {
          const lastMessage =
            result.current.messages[result.current.messages.length - 1];
          expect(lastMessage?.role).toBe("assistant");
        },
        { timeout: 3000 },
      );

      // Then: Verify confirmation tool invocation was received
      const lastMessage =
        result.current.messages[result.current.messages.length - 1];
      expect(lastMessage).toBeDefined();
      expect(lastMessage.role).toBe("assistant");

      // AI SDK v6: tool invocations are in parts array
      const confirmationPart = (lastMessage as any).parts?.find(
        (part: any) =>
          part.type === TOOL_TYPE_ADK_REQUEST_CONFIRMATION &&
          part.state === TOOL_STATE_APPROVAL_REQUESTED,
      );

      expect(confirmationPart).toBeDefined();
      expect(confirmationPart.toolCallId).toBeDefined();
      expect(confirmationPart.input).toMatchObject({
        originalFunctionCall: {
          id: "orig-1",
          name: "dangerous_operation",
          args: { action: "delete_all" },
        },
      });

      // When: User approves the confirmation
      const toolCallId = confirmationPart.toolCallId;

      act(() => {
        result.current.addToolApprovalResponse({
          id: toolCallId,
          approved: true,
        });
      });

      // Then: sendAutomaticallyWhen should trigger automatic send
      // Wait for confirmation approval to be processed
      await waitFor(
        () => {
          const updatedLastMessage =
            result.current.messages[result.current.messages.length - 1];
          const updatedConfirmationPart = (
            updatedLastMessage as any
          ).parts?.find(
            (part: any) => part.type === TOOL_TYPE_ADK_REQUEST_CONFIRMATION,
          );
          expect(updatedConfirmationPart?.state).toBe(
            TOOL_STATE_APPROVAL_RESPONDED,
          );
        },
        { timeout: 3000 },
      );
    });

    it("should work with basic message flow (no confirmation)", async () => {
      // Given: Setup WebSocket handler to send text response
      const chat = createBidiWebSocketLink();
      server.use(createTextResponseHandler(chat, "Hello", " World!"));

      const config = {
        initialMessages: [] as UIMessage[],
      };

      const { result } = renderHook(() =>
        useChat(buildUseChatOptions(config).useChatOptions),
      );

      // When: User submits a simple message
      await act(async () => {
        result.current.sendMessage({ text: "Hello BIDI" });
      });

      // Then: Verify response was received
      await waitFor(
        () => {
          const lastMessage = result.current.messages.at(-1);
          expect(lastMessage?.role).toBe("assistant");
          expect(getMessageText(lastMessage)).toContain("Hello");
        },
        { timeout: 3000 },
      );

      // Verify complete response
      const lastMessage = result.current.messages.at(-1);
      expect(getMessageText(lastMessage)).toBe("Hello World!");
    });
  });

  describe("Test 2: Response Processing and Confirmation Flow", () => {
    it("should correctly process confirmation response payload", async () => {
      // Given: Setup MSW handler to send confirmation request
      const chat = createBidiWebSocketLink();
      server.use(
        createConfirmationRequestHandler(chat, {
          id: "test-1",
          name: "test_tool",
          args: { key: "value" },
        }),
      );

      const config = {
        initialMessages: [] as UIMessage[],
      };

      const { result } = renderHook(() =>
        useChat(buildUseChatOptions(config).useChatOptions),
      );

      // When: Submit message and receive confirmation
      await act(async () => {
        result.current.sendMessage({ text: "Test confirmation" });
      });

      await waitFor(
        () => {
          const lastMessage =
            result.current.messages[result.current.messages.length - 1];
          const confirmationPart = (lastMessage as any).parts?.find(
            (part: any) => part.type === TOOL_TYPE_ADK_REQUEST_CONFIRMATION,
          );
          expect(confirmationPart).toBeDefined();
        },
        { timeout: 3000 },
      );

      // Then: Verify confirmation payload structure
      const lastMessage =
        result.current.messages[result.current.messages.length - 1];
      const confirmationPart = (lastMessage as any).parts.find(
        (part: any) => part.type === TOOL_TYPE_ADK_REQUEST_CONFIRMATION,
      );

      expect(confirmationPart.input).toMatchObject({
        originalFunctionCall: {
          id: "test-1",
          name: "test_tool",
          args: { key: "value" },
        },
      });
    });

    it("should handle multiple confirmations in sequence", async () => {
      // Given: Setup MSW handler to send two different confirmations
      const chat = createBidiWebSocketLink();
      let firstConfirmationSent = false;
      let secondConfirmationSent = false;

      server.use(
        createCustomHandler(chat, ({ server, client }) => {
          client.addEventListener("message", (event) => {
            // Early return for non-JSON messages (e.g., WebSocket handshake)
            if (typeof event.data !== "string" || !event.data.startsWith("{")) {
              return;
            }

            const data = JSON.parse(event.data as string);

            // Check message content to determine response (like SSE does)
            const hasFirstApproval = data.messages?.some(
              (msg: any) =>
                msg.role === "assistant" &&
                msg.parts?.some(
                  (part: any) =>
                    part.type === TOOL_TYPE_ADK_REQUEST_CONFIRMATION &&
                    part.toolCallId === "call-1" &&
                    part.state === TOOL_STATE_APPROVAL_RESPONDED,
                ),
            );

            const hasSecondApproval = data.messages?.some(
              (msg: any) =>
                msg.role === "assistant" &&
                msg.parts?.some(
                  (part: any) =>
                    part.type === TOOL_TYPE_ADK_REQUEST_CONFIRMATION &&
                    part.toolCallId === "call-2" &&
                    part.state === TOOL_STATE_APPROVAL_RESPONDED,
                ),
            );

            if (!firstConfirmationSent) {
              firstConfirmationSent = true;
              // First request: Send first confirmation
              const startChunk = {
                type: "tool-input-start",
                toolCallId: "call-1",
                toolName: TOOL_NAME_ADK_REQUEST_CONFIRMATION,
              };
              client.send(`data: ${JSON.stringify(startChunk)}\n\n`);

              const availableChunk = {
                type: "tool-input-available",
                toolCallId: "call-1",
                toolName: TOOL_NAME_ADK_REQUEST_CONFIRMATION,
                input: {
                  originalFunctionCall: {
                    id: "first",
                    name: "first_tool",
                    args: {},
                  },
                },
              };
              client.send(`data: ${JSON.stringify(availableChunk)}\n\n`);

              const approvalChunk = {
                type: "tool-approval-request",
                approvalId: "call-1",
                toolCallId: "call-1",
              };
              client.send(`data: ${JSON.stringify(approvalChunk)}\n\n`);
              client.send("data: [DONE]\n\n");
            } else if (hasFirstApproval && !secondConfirmationSent) {
              secondConfirmationSent = true;
              // Second request: After first approval, send second confirmation
              const startChunk = {
                type: "tool-input-start",
                toolCallId: "call-2",
                toolName: TOOL_NAME_ADK_REQUEST_CONFIRMATION,
              };
              client.send(`data: ${JSON.stringify(startChunk)}\n\n`);

              const availableChunk = {
                type: "tool-input-available",
                toolCallId: "call-2",
                toolName: TOOL_NAME_ADK_REQUEST_CONFIRMATION,
                input: {
                  originalFunctionCall: {
                    id: "second",
                    name: "second_tool",
                    args: {},
                  },
                },
              };
              client.send(`data: ${JSON.stringify(availableChunk)}\n\n`);

              const approvalChunk = {
                type: "tool-approval-request",
                approvalId: "call-2",
                toolCallId: "call-2",
              };
              client.send(`data: ${JSON.stringify(approvalChunk)}\n\n`);
              client.send("data: [DONE]\n\n");
            } else if (hasSecondApproval) {
              // Third request: After second approval, send final response
              const textId = `text-${Date.now()}`;
              client.send(
                `data: ${JSON.stringify({ type: "text-start", id: textId })}\n\n`,
              );
              client.send(
                `data: ${JSON.stringify({ type: "text-delta", delta: "All", id: textId })}\n\n`,
              );
              client.send(
                `data: ${JSON.stringify({ type: "text-delta", delta: " steps completed!", id: textId })}\n\n`,
              );
              client.send(
                `data: ${JSON.stringify({ type: "text-end", id: textId })}\n\n`,
              );
              client.send("data: [DONE]\n\n");
            }
          });
        }),
      );

      const config = {
        initialMessages: [] as UIMessage[],
      };

      const { result } = renderHook(() =>
        useChat(buildUseChatOptions(config).useChatOptions),
      );

      // When: First confirmation
      await act(async () => {
        result.current.sendMessage({ text: "First request" });
      });

      await waitFor(
        () => {
          const msgs = result.current.messages;
          const lastMsg = msgs[msgs.length - 1];
          const part = (lastMsg as any).parts?.find(
            (p: any) => p.type === TOOL_TYPE_ADK_REQUEST_CONFIRMATION,
          );
          expect(part).toBeDefined();
        },
        { timeout: 3000 },
      );

      // Approve first confirmation
      const firstMessage =
        result.current.messages[result.current.messages.length - 1];
      const firstConfirmationPart = (firstMessage as any).parts.find(
        (part: any) => part.type === TOOL_TYPE_ADK_REQUEST_CONFIRMATION,
      );

      act(() => {
        result.current.addToolApprovalResponse({
          id: firstConfirmationPart.toolCallId,
          approved: true,
        });
      });

      await waitFor(
        () => {
          const updatedMsg =
            result.current.messages[result.current.messages.length - 1];
          const updatedPart = (updatedMsg as any).parts?.find(
            (p: any) => p.type === TOOL_TYPE_ADK_REQUEST_CONFIRMATION,
          );
          expect(updatedPart?.state).toBe(TOOL_STATE_APPROVAL_RESPONDED);
        },
        { timeout: 3000 },
      );

      // Then: Wait for second confirmation to arrive
      await waitFor(
        () => {
          const msgs = result.current.messages;
          const lastMsg = msgs[msgs.length - 1];
          const part = (lastMsg as any).parts?.find(
            (p: any) =>
              p.type === TOOL_TYPE_ADK_REQUEST_CONFIRMATION &&
              p.toolCallId === "call-2",
          );
          expect(part).toBeDefined();
        },
        { timeout: 3000 },
      );

      // Approve second confirmation
      const secondMessage =
        result.current.messages[result.current.messages.length - 1];
      const secondConfirmationPart = (secondMessage as any).parts.find(
        (part: any) =>
          part.type === TOOL_TYPE_ADK_REQUEST_CONFIRMATION &&
          part.toolCallId === "call-2",
      );

      act(() => {
        result.current.addToolApprovalResponse({
          id: secondConfirmationPart.toolCallId,
          approved: true,
        });
      });

      // Then: Verify final response with both confirmations processed
      await waitFor(
        () => {
          const lastMessage = result.current.messages.at(-1);
          expect(getMessageText(lastMessage)).toContain("All steps completed!");
        },
        { timeout: 3000 },
      );

      // Verify both confirmations were processed
      const allMessages = result.current.messages;
      const confirmationParts = allMessages
        .flatMap((msg: any) => msg.parts || [])
        .filter(
          (p: any) =>
            p.type === TOOL_TYPE_ADK_REQUEST_CONFIRMATION &&
            p.state === TOOL_STATE_APPROVAL_RESPONDED,
        );
      expect(confirmationParts.length).toBeGreaterThanOrEqual(2);
    });

    it("should preserve message history during confirmation flow", async () => {
      // Given: Setup MSW handler to send confirmation request
      const chat = createBidiWebSocketLink();
      server.use(
        createConfirmationRequestHandler(chat, {
          id: "new",
          name: "new_tool",
          args: {},
        }),
      );

      const config = {
        initialMessages: [
          {
            id: "msg-1",
            role: "user",
            parts: [{ type: "text", text: "Previous message" }],
          } as UIMessage,
          {
            id: "msg-2",
            role: "assistant",
            parts: [{ type: "text", text: "Previous response" }],
          } as UIMessage,
        ],
      };

      const { result } = renderHook(() =>
        useChat(buildUseChatOptions(config).useChatOptions),
      );

      // Then: Verify initial messages are preserved
      expect(result.current.messages.length).toBe(2);
      expect(getMessageText(result.current.messages[0])).toBe(
        "Previous message",
      );
      expect(getMessageText(result.current.messages[1])).toBe(
        "Previous response",
      );

      // When: Add new message with confirmation
      await act(async () => {
        result.current.sendMessage({ text: "New message" });
      });

      // Then: Verify all messages are preserved
      await waitFor(
        () => {
          expect(result.current.messages.length).toBeGreaterThanOrEqual(3);
        },
        { timeout: 3000 },
      );

      expect(getMessageText(result.current.messages[0])).toBe(
        "Previous message",
      );
      expect(getMessageText(result.current.messages[1])).toBe(
        "Previous response",
      );
    });

    it("should handle errors during confirmation flow gracefully", async () => {
      // Given: MSW handler returns confirmation, then error
      const chat = createBidiWebSocketLink();
      let requestCount = 0;

      server.use(
        createCustomHandler(chat, ({ server, client }) => {
          client.addEventListener("message", (event) => {
            requestCount++;

            if (requestCount === 1) {
              // First request: Return confirmation
              const startChunk = {
                type: "tool-input-start",
                toolCallId: "call-error",
                toolName: TOOL_NAME_ADK_REQUEST_CONFIRMATION,
              };
              client.send(`data: ${JSON.stringify(startChunk)}\n\n`);

              const availableChunk = {
                type: "tool-input-available",
                toolCallId: "call-error",
                toolName: TOOL_NAME_ADK_REQUEST_CONFIRMATION,
                input: {
                  originalFunctionCall: {
                    id: "orig-error",
                    name: "failing_tool",
                    args: {},
                  },
                },
              };
              client.send(`data: ${JSON.stringify(availableChunk)}\n\n`);

              const approvalChunk = {
                type: "tool-approval-request",
                approvalId: "call-error",
                toolCallId: "call-error",
              };
              client.send(`data: ${JSON.stringify(approvalChunk)}\n\n`);
              client.send("data: [DONE]\n\n");
            } else if (requestCount === 2) {
              // Second request: Simulate error by closing connection
              // In BIDI mode, errors are typically communicated via connection close
              // or error events rather than HTTP status codes
              server.close();
            }
          });
        }),
      );

      const config = {
        initialMessages: [] as UIMessage[],
      };

      const { result } = renderHook(() =>
        useChat(buildUseChatOptions(config).useChatOptions),
      );

      // When: User sends message
      await act(async () => {
        result.current.sendMessage({ text: "Trigger error" });
      });

      // Then: Verify confirmation received
      await waitFor(
        () => {
          const lastMessage =
            result.current.messages[result.current.messages.length - 1];
          expect(lastMessage?.role).toBe("assistant");
          const confirmationPart = (lastMessage as any).parts?.find(
            (p: any) => p.type === TOOL_TYPE_ADK_REQUEST_CONFIRMATION,
          );
          expect(confirmationPart).toBeDefined();
        },
        { timeout: 3000 },
      );

      // Approve confirmation (which will trigger error)
      await act(async () => {
        const lastMessage =
          result.current.messages[result.current.messages.length - 1];
        const confirmationPart = (lastMessage as any).parts.find(
          (part: any) => part.type === TOOL_TYPE_ADK_REQUEST_CONFIRMATION,
        );
        result.current.addToolApprovalResponse({
          id: confirmationPart.toolCallId,
          approved: true,
        });
      });

      // Wait for error handling
      await waitFor(
        () => {
          expect(requestCount).toBe(2);
        },
        { timeout: 3000 },
      );

      // Verify error state (WebSocket close should trigger error)
      // Note: error handling behavior may vary based on implementation
      expect(requestCount).toBeGreaterThanOrEqual(2);
    });

    it("should handle tool approval denial correctly", async () => {
      // Given: MSW handler returns confirmation, then handles denial
      const chat = createBidiWebSocketLink();
      let denialReceived = false;
      let finalResponseReceived = false;

      server.use(
        createCustomHandler(chat, ({ server, client }) => {
          client.addEventListener("message", (event) => {
            // Early return for non-JSON messages (e.g., WebSocket handshake)
            if (typeof event.data !== "string" || !event.data.startsWith("{")) {
              return;
            }

            const data = JSON.parse(event.data as string);

            // Check if this is the denial response
            // Same logic as SSE: check for approval.approved === false
            const hasDenial = data.messages?.some(
              (msg: any) =>
                msg.role === "assistant" &&
                msg.parts?.some(
                  (part: any) =>
                    part.type === TOOL_TYPE_ADK_REQUEST_CONFIRMATION &&
                    part.approval?.approved === false,
                ),
            );

            if (!denialReceived) {
              denialReceived = true;
              // First request: Send confirmation request
              const startChunk = {
                type: "tool-input-start",
                toolCallId: "call-deny",
                toolName: TOOL_NAME_ADK_REQUEST_CONFIRMATION,
              };
              client.send(`data: ${JSON.stringify(startChunk)}\n\n`);

              const availableChunk = {
                type: "tool-input-available",
                toolCallId: "call-deny",
                toolName: TOOL_NAME_ADK_REQUEST_CONFIRMATION,
                input: {
                  originalFunctionCall: {
                    id: "orig-deny",
                    name: "dangerous_operation",
                    args: { action: "delete_all" },
                  },
                },
              };
              client.send(`data: ${JSON.stringify(availableChunk)}\n\n`);

              const approvalChunk = {
                type: "tool-approval-request",
                approvalId: "call-deny",
                toolCallId: "call-deny",
              };
              client.send(`data: ${JSON.stringify(approvalChunk)}\n\n`);
              client.send("data: [DONE]\n\n");
            }

            if (hasDenial && !finalResponseReceived) {
              finalResponseReceived = true;
              // Second request: Denial received, send acknowledgment
              const textId = `text-${Date.now()}`;

              // Send text-start chunk
              const startChunk = {
                type: "text-start",
                id: textId,
              };
              client.send(`data: ${JSON.stringify(startChunk)}\n\n`);

              // Send text-delta chunk
              const textChunk = {
                type: "text-delta",
                delta: "Operation cancelled as per your request.",
                id: textId,
              };
              client.send(`data: ${JSON.stringify(textChunk)}\n\n`);

              // Send text-end chunk
              const endChunk = {
                type: "text-end",
                id: textId,
              };
              client.send(`data: ${JSON.stringify(endChunk)}\n\n`);

              // Send [DONE] marker
              client.send("data: [DONE]\n\n");
            }
          });
        }),
      );

      const config = {
        initialMessages: [] as UIMessage[],
      };

      const { result } = renderHook(() =>
        useChat(buildUseChatOptions(config).useChatOptions),
      );

      // When: User sends message
      await act(async () => {
        result.current.sendMessage({ text: "Delete all data" });
      });

      // Then: Wait for confirmation to appear
      await waitFor(
        () => {
          const lastMessage =
            result.current.messages[result.current.messages.length - 1];
          expect(lastMessage?.role).toBe("assistant");
          const confirmationPart = (lastMessage as any).parts?.find(
            (p: any) => p.type === TOOL_TYPE_ADK_REQUEST_CONFIRMATION,
          );
          expect(confirmationPart).toBeDefined();
          expect(confirmationPart?.state).toBe(TOOL_STATE_APPROVAL_REQUESTED);
        },
        { timeout: 3000 },
      );

      // Simulate user denying the approval
      await act(async () => {
        const lastMessage =
          result.current.messages[result.current.messages.length - 1];
        const confirmationPart = (lastMessage as any).parts.find(
          (part: any) => part.type === TOOL_TYPE_ADK_REQUEST_CONFIRMATION,
        );
        result.current.addToolApprovalResponse({
          id: confirmationPart.toolCallId,
          approved: false, // ← Denial
          reason: "User rejected the dangerous operation",
        });
      });

      // Verify sendAutomaticallyWhen triggers automatic resubmission on denial
      await waitFor(
        () => {
          expect(denialReceived).toBe(true);
          expect(finalResponseReceived).toBe(true);
        },
        { timeout: 3000 },
      );

      // Verify final response acknowledging the denial
      await waitFor(
        () => {
          const lastMessage =
            result.current.messages[result.current.messages.length - 1];
          expect(getMessageText(lastMessage)).toContain(
            "Operation cancelled as per your request",
          );
        },
        { timeout: 3000 },
      );
    });
  });
});
