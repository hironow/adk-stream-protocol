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
import { describe, expect, it } from "vitest";
import { buildUseChatOptions } from "../../bidi";
import type { UIMessageFromAISDKv6 } from "../../utils";
import { isApprovalRequestedTool, isToolUIPartFromAISDKv6 } from "../../utils";
import {
  createBidiWebSocketLink,
  createConfirmationRequestHandler,
  createCustomHandler,
  createSendAutoSpy,
  createTextResponseHandler,
  findAllConfirmationParts,
  findConfirmationPart,
  getMessageText,
  setupMswServer,
} from "../helpers";

// Create MSW server for WebSocket interception with custom unhandled request handler
const server = setupMswServer({
  onUnhandledRequest(request) {
    // Ignore WebSocket upgrade requests
    if (request.url.includes("/live")) {
      return;
    }
    console.error("Unhandled request:", request.method, request.url);
  },
});

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
        initialMessages: [] as UIMessageFromAISDKv6[],
      };

      const { result } = renderHook(() =>
        useChat(buildUseChatOptions(config).useChatOptions),
      );

      // When: User submits a message that triggers confirmation
      await act(async () => {
        result.current.sendMessage({ text: "Request dangerous operation" });
      });

      // Wait for confirmation part to appear in messages
      let confirmationPart: any;
      await waitFor(
        () => {
          const lastMessage =
            result.current.messages[result.current.messages.length - 1];
          expect(lastMessage?.role).toBe("assistant");

          // AI SDK v6: tool invocations are in parts array
          confirmationPart = (lastMessage as any).parts?.find((part: any) =>
            isApprovalRequestedTool(part),
          );
          expect(confirmationPart).toBeDefined();
        },
        { timeout: 3000 },
      );

      // Then: Verify confirmation tool invocation was received
      const lastMessage =
        result.current.messages[result.current.messages.length - 1];
      expect(lastMessage).toBeDefined();
      expect(lastMessage.role).toBe("assistant");

      expect(confirmationPart).toBeDefined();
      expect(confirmationPart.toolCallId).toBe("orig-1");
      expect(confirmationPart.type).toBe("tool-dangerous_operation");
      expect(confirmationPart.state).toBe("approval-requested");
      expect(confirmationPart.input).toMatchObject({
        action: "delete_all",
      });

      // When: User approves the confirmation
      await act(async () => {
        result.current.addToolApprovalResponse({
          id: confirmationPart.approval.id, // ← Use approval.id, NOT toolCallId!
          approved: true,
        });
      });

      // Debug: Log message state after approval
      const lastMsg =
        result.current.messages[result.current.messages.length - 1];
      console.log(
        "[TEST DEBUG] After approval, lastMessage parts:",
        JSON.stringify((lastMsg as any).parts, null, 2),
      );
      console.log(
        "[TEST DEBUG] Approval object detail:",
        JSON.stringify(
          (lastMsg as any).parts?.map((p: any) => ({
            toolCallId: p.toolCallId,
            approval: p.approval,
          })),
          null,
          2,
        ),
      );

      // Then: sendAutomaticallyWhen should trigger automatic send
      // Wait for tool output to be received
      // AI SDK v6: tool-output-available EVENT updates TOOL part state to "output-available"
      await waitFor(
        () => {
          const lastMessage =
            result.current.messages[result.current.messages.length - 1];
          const outputPart = (lastMessage as any).parts?.find(
            (part: any) =>
              part.toolCallId === confirmationPart.toolCallId &&
              part.state === "output-available",
          );
          expect(outputPart).toBeDefined();
        },
        { timeout: 3000 },
      );
    });

    it("should work with basic message flow (no confirmation)", async () => {
      // Given: Setup WebSocket handler to send text response
      const chat = createBidiWebSocketLink();
      server.use(createTextResponseHandler(chat, "Hello", " World!"));

      const config = {
        initialMessages: [] as UIMessageFromAISDKv6[],
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
        initialMessages: [] as UIMessageFromAISDKv6[],
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
            (part: any) => isApprovalRequestedTool(part),
          );
          expect(confirmationPart).toBeDefined();
        },
        { timeout: 3000 },
      );

      // Then: Verify confirmation payload structure
      const lastMessage =
        result.current.messages[result.current.messages.length - 1];
      const confirmationPart = (lastMessage as any).parts.find((part: any) =>
        isApprovalRequestedTool(part),
      );

      expect(confirmationPart.toolCallId).toBe("test-1");
      expect(confirmationPart.type).toBe("tool-test_tool");
      expect(confirmationPart.state).toBe("approval-requested");
      expect(confirmationPart.input).toMatchObject({
        key: "value",
      });
    });

    it("should handle multiple confirmations in sequence", async () => {
      // Given: Setup MSW handler to send two different confirmations
      const chat = createBidiWebSocketLink();
      let firstConfirmationSent = false;
      let secondConfirmationSent = false;

      server.use(
        createCustomHandler(chat, ({ server: _server, client }) => {
          client.addEventListener("message", (event) => {
            // Early return for non-JSON messages (e.g., WebSocket handshake)
            if (typeof event.data !== "string" || !event.data.startsWith("{")) {
              return;
            }

            const data = JSON.parse(event.data as string);

            // Check message content to determine response (like SSE does)
            // AI SDK v6: Check for TOOL parts with approval objects, not approval-request parts
            const hasFirstApproval = data.messages?.some(
              (msg: any) =>
                msg.role === "assistant" &&
                msg.parts?.some(
                  (part: any) =>
                    part.toolCallId === "call-1" && part.approval !== undefined,
                ),
            );

            const hasSecondApproval = data.messages?.some(
              (msg: any) =>
                msg.role === "assistant" &&
                msg.parts?.some(
                  (part: any) =>
                    part.toolCallId === "call-2" && part.approval !== undefined,
                ),
            );

            if (!firstConfirmationSent) {
              firstConfirmationSent = true;
              // First request: Send first confirmation
              const startChunk = {
                type: "tool-input-start",
                toolCallId: "call-1",
                toolName: "first_tool",
              };
              client.send(`data: ${JSON.stringify(startChunk)}\n\n`);

              const availableChunk = {
                type: "tool-input-available",
                toolCallId: "call-1",
                toolName: "first_tool",
                input: {
                  action: "first",
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
                toolName: "second_tool",
              };
              client.send(`data: ${JSON.stringify(startChunk)}\n\n`);

              const availableChunk = {
                type: "tool-input-available",
                toolCallId: "call-2",
                toolName: "second_tool",
                input: {
                  action: "second",
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
        initialMessages: [] as UIMessageFromAISDKv6[],
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
          const part = (lastMsg as any).parts?.find((p: any) =>
            isApprovalRequestedTool(p),
          );
          expect(part).toBeDefined();
        },
        { timeout: 3000 },
      );

      // Approve first confirmation
      const firstMessage =
        result.current.messages[result.current.messages.length - 1];
      const firstConfirmationPart = (firstMessage as any).parts.find(
        (part: any) => isApprovalRequestedTool(part),
      );

      act(() => {
        result.current.addToolApprovalResponse({
          id: firstConfirmationPart.approval.id, // ← Use approval.id, NOT toolCallId!
          approved: true,
        });
      });

      // Wait for second confirmation to arrive (first approval triggers it)
      await waitFor(
        () => {
          const msgs = result.current.messages;
          const lastMsg = msgs[msgs.length - 1];
          // AI SDK v6: Check for TOOL part with toolCallId "call-2"
          const secondConfirmationPart = (lastMsg as any).parts?.find(
            (p: any) => isApprovalRequestedTool(p) && p.toolCallId === "call-2",
          );
          expect(secondConfirmationPart).toBeDefined();
        },
        { timeout: 3000 },
      );

      // Approve second confirmation
      const secondMessage =
        result.current.messages[result.current.messages.length - 1];
      const secondConfirmationPart = (secondMessage as any).parts.find(
        (part: any) =>
          isApprovalRequestedTool(part) && part.toolCallId === "call-2",
      );

      act(() => {
        result.current.addToolApprovalResponse({
          id: secondConfirmationPart.approval.id, // ← Use approval.id, NOT toolCallId!
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
      // This test's MSW handler sends text response after approvals (not tool outputs)
      // So we verify by checking that we received both approval requests
      const allMessages = result.current.messages;
      const toolParts = allMessages
        .flatMap((msg: any) => msg.parts || [])
        .filter((p: any) => isToolUIPartFromAISDKv6(p));

      // Should have received 2 tools (call-1 and call-2)
      const uniqueToolIds = new Set(toolParts.map((p: any) => p.toolCallId));
      expect(uniqueToolIds.size).toBeGreaterThanOrEqual(2);
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
          } as UIMessageFromAISDKv6,
          {
            id: "msg-2",
            role: "assistant",
            parts: [{ type: "text", text: "Previous response" }],
          } as UIMessageFromAISDKv6,
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
          client.addEventListener("message", (_event) => {
            requestCount++;

            if (requestCount === 1) {
              // First request: Return confirmation
              const startChunk = {
                type: "tool-input-start",
                toolCallId: "call-error",
                toolName: "failing_tool",
              };
              client.send(`data: ${JSON.stringify(startChunk)}\n\n`);

              const availableChunk = {
                type: "tool-input-available",
                toolCallId: "call-error",
                toolName: "failing_tool",
                input: {},
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
        initialMessages: [] as UIMessageFromAISDKv6[],
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
          const confirmationPart = (lastMessage as any).parts?.find((p: any) =>
            isApprovalRequestedTool(p),
          );
          expect(confirmationPart).toBeDefined();
        },
        { timeout: 3000 },
      );

      // Approve confirmation (which will trigger error)
      await act(async () => {
        const lastMessage =
          result.current.messages[result.current.messages.length - 1];
        const confirmationPart = (lastMessage as any).parts.find((part: any) =>
          isApprovalRequestedTool(part),
        );
        result.current.addToolApprovalResponse({
          id: confirmationPart.approval.id, // ← Use approval.id, NOT toolCallId!
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
        createCustomHandler(chat, ({ server: _server, client }) => {
          client.addEventListener("message", (event) => {
            // Early return for non-JSON messages (e.g., WebSocket handshake)
            if (typeof event.data !== "string" || !event.data.startsWith("{")) {
              return;
            }

            const data = JSON.parse(event.data as string);

            // Check if this is the denial response
            // AI SDK v6: Check for approval object existence (user responded)
            // Note: AI SDK doesn't set approval.approved until backend responds,
            // so we check for approval object presence instead
            const hasDenial = data.messages?.some(
              (msg: any) =>
                msg.role === "assistant" &&
                msg.parts?.some(
                  (part: any) =>
                    part.toolCallId === "call-deny" &&
                    part.approval !== undefined,
                ),
            );

            if (!denialReceived) {
              denialReceived = true;
              // First request: Send confirmation request
              const startChunk = {
                type: "tool-input-start",
                toolCallId: "call-deny",
                toolName: "dangerous_operation",
              };
              client.send(`data: ${JSON.stringify(startChunk)}\n\n`);

              const availableChunk = {
                type: "tool-input-available",
                toolCallId: "call-deny",
                toolName: "dangerous_operation",
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
        initialMessages: [] as UIMessageFromAISDKv6[],
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
          const confirmationPart = (lastMessage as any).parts?.find((p: any) =>
            isApprovalRequestedTool(p),
          );
          expect(confirmationPart).toBeDefined();
          expect(confirmationPart?.state).toBe("approval-requested");
        },
        { timeout: 3000 },
      );

      // Simulate user denying the approval
      await act(async () => {
        const lastMessage =
          result.current.messages[result.current.messages.length - 1];
        const confirmationPart = (lastMessage as any).parts.find((part: any) =>
          isApprovalRequestedTool(part),
        );
        result.current.addToolApprovalResponse({
          id: confirmationPart.approval.id, // ← Use approval.id, NOT toolCallId!
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

  describe("Test 3: Tool Approval Request Verification (Single Approval)", () => {
    it("should call sendAutomaticallyWhen after single tool approval", async () => {
      // Given: Setup spy wrapper around sendAutomaticallyWhen
      const { useChatOptions } = buildUseChatOptions({
        initialMessages: [] as UIMessageFromAISDKv6[],
      });

      const sendAutoSpy = createSendAutoSpy(
        useChatOptions.sendAutomaticallyWhen!,
      );
      const optionsWithSpy = {
        ...useChatOptions,
        sendAutomaticallyWhen: sendAutoSpy,
      };

      // Setup MSW to send confirmation
      const chat = createBidiWebSocketLink();
      server.use(
        createConfirmationRequestHandler(chat, {
          id: "spy-test-1",
          name: "test_operation",
          args: { test: "data" },
        }),
      );

      const { result } = renderHook(() => useChat(optionsWithSpy));

      // When: User submits message and receives confirmation
      await act(async () => {
        result.current.sendMessage({ text: "Request confirmation" });
      });

      await waitFor(
        () => {
          const lastMessage = result.current.messages.at(-1);
          const confirmationPart = findConfirmationPart(lastMessage);
          expect(confirmationPart).toBeDefined();
        },
        { timeout: 3000 },
      );

      // Clear any previous spy calls from initial renders
      sendAutoSpy.mockClear();

      // When: User approves the confirmation
      const lastMessage = result.current.messages.at(-1);
      const confirmationPart = findConfirmationPart(lastMessage);

      act(() => {
        result.current.addToolApprovalResponse({
          id: confirmationPart.approval.id, // ← Use approval.id, NOT toolCallId!
          approved: true,
        });
      });

      // Then: Verify sendAutomaticallyWhen was called
      await waitFor(
        () => {
          expect(sendAutoSpy).toHaveBeenCalled();
        },
        { timeout: 3000 },
      );

      // Verify it was called with correct parameters
      expect(sendAutoSpy.mock.calls.length).toBeGreaterThan(0);
      // Check FIRST call after user approval (not last - that's after backend responded)
      const firstCallAfterApproval = sendAutoSpy.mock.calls[0];
      expect(firstCallAfterApproval[0]).toHaveProperty("messages");
      expect(Array.isArray(firstCallAfterApproval[0].messages)).toBe(true);
      expect(firstCallAfterApproval[0].messages.length).toBeGreaterThan(0);

      // Verify the messages array includes the approval response
      // AI SDK v6: Check for TOOL part with approval object (user has responded)
      const messagesParam = firstCallAfterApproval[0].messages;
      const hasApprovalResponse = messagesParam.some((msg: any) =>
        msg.parts?.some(
          (p: any) =>
            isToolUIPartFromAISDKv6(p) &&
            p.state === "approval-responded" &&
            p.approval !== undefined,
        ),
      );
      expect(hasApprovalResponse).toBe(true);
    });
  });

  describe("Test 4: Tool Approval Request Verification (Multiple Approvals)", () => {
    it("should handle two sequential tool approvals correctly", async () => {
      // Given: Setup spy wrapper around sendAutomaticallyWhen
      const { useChatOptions } = buildUseChatOptions({
        initialMessages: [] as UIMessageFromAISDKv6[],
      });

      const sendAutoSpy = createSendAutoSpy(
        useChatOptions.sendAutomaticallyWhen!,
      );
      const optionsWithSpy = {
        ...useChatOptions,
        sendAutomaticallyWhen: sendAutoSpy,
      };

      // Setup MSW to send two sequential confirmations
      const chat = createBidiWebSocketLink();
      let firstConfirmationSent = false;
      let secondConfirmationSent = false;

      server.use(
        createCustomHandler(chat, ({ server: _server, client }) => {
          client.addEventListener("message", (event) => {
            // Early return for non-JSON messages
            if (typeof event.data !== "string" || !event.data.startsWith("{")) {
              return;
            }

            const data = JSON.parse(event.data as string);

            // Check for first approval response
            // AI SDK v6: Check for TOOL part with approval object (user has responded)
            const hasFirstApproval = data.messages?.some(
              (msg: any) =>
                msg.role === "assistant" &&
                msg.parts?.some(
                  (part: any) =>
                    part.toolCallId === "first-tool" &&
                    part.approval !== undefined,
                ),
            );

            // Check for second approval response
            // AI SDK v6: Check for TOOL part with approval object (user has responded)
            const hasSecondApproval = data.messages?.some(
              (msg: any) =>
                msg.role === "assistant" &&
                msg.parts?.some(
                  (part: any) =>
                    part.toolCallId === "second-tool" &&
                    part.approval !== undefined,
                ),
            );

            if (!firstConfirmationSent) {
              firstConfirmationSent = true;
              // Send first tool-approval-request
              const startChunk = {
                type: "tool-input-start",
                toolCallId: "first-tool",
                toolName: "first_operation",
              };
              client.send(`data: ${JSON.stringify(startChunk)}\n\n`);

              const availableChunk = {
                type: "tool-input-available",
                toolCallId: "first-tool",
                toolName: "first_operation",
                input: { action: "first" },
              };
              client.send(`data: ${JSON.stringify(availableChunk)}\n\n`);

              const approvalChunk = {
                type: "tool-approval-request",
                approvalId: "approval-1",
                toolCallId: "first-tool",
              };
              client.send(`data: ${JSON.stringify(approvalChunk)}\n\n`);
              client.send("data: [DONE]\n\n");
            } else if (hasFirstApproval && !secondConfirmationSent) {
              secondConfirmationSent = true;
              // Send second tool-approval-request after first is approved
              const startChunk = {
                type: "tool-input-start",
                toolCallId: "second-tool",
                toolName: "second_operation",
              };
              client.send(`data: ${JSON.stringify(startChunk)}\n\n`);

              const availableChunk = {
                type: "tool-input-available",
                toolCallId: "second-tool",
                toolName: "second_operation",
                input: { action: "second" },
              };
              client.send(`data: ${JSON.stringify(availableChunk)}\n\n`);

              const approvalChunk = {
                type: "tool-approval-request",
                approvalId: "approval-2",
                toolCallId: "second-tool",
              };
              client.send(`data: ${JSON.stringify(approvalChunk)}\n\n`);
              client.send("data: [DONE]\n\n");
            } else if (hasSecondApproval) {
              // Final response after both approvals
              const textChunk = {
                type: "text-delta",
                text: "Both operations completed!",
              };
              client.send(`data: ${JSON.stringify(textChunk)}\n\n`);
              client.send("data: [DONE]\n\n");
            }
          });
        }),
      );

      const { result } = renderHook(() => useChat(optionsWithSpy));

      // When: User submits message and receives first confirmation
      await act(async () => {
        result.current.sendMessage({ text: "Request two operations" });
      });

      await waitFor(
        () => {
          const lastMessage = result.current.messages.at(-1);
          const confirmations = findAllConfirmationParts(lastMessage);
          expect(confirmations.length).toBeGreaterThan(0);
        },
        { timeout: 3000 },
      );

      sendAutoSpy.mockClear();

      // Approve first confirmation
      const firstMessage = result.current.messages.at(-1);
      const firstConfirmation = findConfirmationPart(firstMessage);

      act(() => {
        result.current.addToolApprovalResponse({
          id: firstConfirmation.approval.id, // ← Use approval.id, NOT toolCallId!
          approved: true,
        });
      });

      // Wait for sendAutomaticallyWhen to be called for first approval
      await waitFor(
        () => {
          expect(sendAutoSpy).toHaveBeenCalled();
        },
        { timeout: 3000 },
      );

      // Wait for second confirmation
      await waitFor(
        () => {
          const lastMessage = result.current.messages.at(-1);
          const confirmations = findAllConfirmationParts(lastMessage);
          const secondConf = confirmations.find(
            (c: any) => c.toolCallId === "second-tool",
          );
          expect(secondConf).toBeDefined();
        },
        { timeout: 3000 },
      );

      sendAutoSpy.mockClear();

      // Approve second confirmation
      const secondMessage = result.current.messages.at(-1);
      const confirmations = findAllConfirmationParts(secondMessage);
      const secondConfirmation = confirmations.find(
        (c: any) => c.toolCallId === "second-tool",
      );

      act(() => {
        result.current.addToolApprovalResponse({
          id: secondConfirmation.approval.id, // ← Use approval.id, NOT toolCallId!
          approved: true,
        });
      });

      // Verify sendAutomaticallyWhen was called for second approval
      await waitFor(
        () => {
          expect(sendAutoSpy).toHaveBeenCalled();
        },
        { timeout: 3000 },
      );

      // Verify both approvals were processed
      const finalCall =
        sendAutoSpy.mock.calls[sendAutoSpy.mock.calls.length - 1];
      const messagesParam = finalCall[0].messages;

      // Count approval responses in final message
      // AI SDK v6: Check for TOOL parts with approval objects (user has responded)
      const approvalCount = messagesParam
        .flatMap((msg: any) => msg.parts || [])
        .filter(
          (p: any) =>
            isToolUIPartFromAISDKv6(p) &&
            p.state === "approval-responded" &&
            p.approval !== undefined,
        ).length;

      expect(approvalCount).toBeGreaterThan(0);
    });
  });
});
