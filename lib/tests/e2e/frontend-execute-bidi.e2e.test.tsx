/**
 * E2E Test: BIDI Mode with Frontend Execute Pattern
 *
 * Tests the complete flow where frontend executes tools (browser APIs) and sends results:
 * 1. Backend requests tool confirmation
 * 2. User approves with addToolApprovalResponse()
 * 3. Frontend executes browser API
 * 4. Frontend sends result with addToolOutput()
 * 5. Backend receives result and continues
 *
 * This differs from Server Execute pattern where backend executes tools.
 *
 * @vitest-environment jsdom
 */

import { useChat } from "@ai-sdk/react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildUseChatOptions } from "../../bidi";
import type { UIMessageFromAISDKv6 } from "../../utils";
import {
  isApprovalRequestedTool,
  isApprovalRespondedTool,
  isTextUIPartFromAISDKv6,
} from "../../utils";
import {
  createBidiWebSocketLink,
  createCustomHandler,
} from "../helpers/bidi-ws-handlers";
import { createMswServer } from "../mocks/msw-server";

/**
 * Helper function to extract text content from UIMessageFromAISDKv6 parts
 */
function getMessageText(message: UIMessageFromAISDKv6 | undefined): string {
  if (!message) return "";
  return message.parts
    .filter((part): part is { type: "text"; text: string } =>
      isTextUIPartFromAISDKv6(part),
    )
    .map((part) => part.text)
    .join("");
}

// Create MSW server for WebSocket interception
const server = createMswServer();

// Track transport instances for cleanup
let currentTransport: any = null;

beforeAll(() => server.listen({ onUnhandledRequest: "warn" }));
afterEach(() => {
  // Ensure WebSocket cleanup even if test fails
  if (currentTransport) {
    try {
      currentTransport._close();
    } catch (error) {
      console.error("Error closing transport:", error);
    }
    currentTransport = null;
  }
  server.resetHandlers();
});
afterAll(() => server.close());

describe("BIDI Mode - Frontend Execute Pattern", () => {
  describe("Single Tool Frontend Execution", () => {
    it("should execute tool on frontend and send result with addToolOutput", async () => {
      // Given: Backend sends confirmation, frontend executes, sends result
      const chat = createBidiWebSocketLink();
      let toolResultReceived = false;

      server.use(
        createCustomHandler(chat, ({ server: _server, client }) => {
          // Add error handling for WebSocket
          client.addEventListener("error", (error) => {
            console.error("WebSocket error in test:", error);
          });

          client.addEventListener("close", (event) => {
            console.log("WebSocket closed:", event);
          });

          client.addEventListener("message", (event) => {
            // Early return for non-JSON messages (e.g., WebSocket handshake)
            if (typeof event.data !== "string" || !event.data.startsWith("{")) {
              return;
            }

            const data = JSON.parse(event.data as string);

            console.log("[MSW Handler] Received message:", {
              type: data.type,
              trigger: data.trigger,
              messageCount: data.messages?.length,
              lastMessage: data.messages?.[data.messages.length - 1],
            });

            // Check if this is approval response (assistant message with approval-responded)
            const hasApprovalResponse = data.messages?.some(
              (msg: any) =>
                msg.role === "assistant" &&
                msg.parts?.some(
                  (part: any) =>
                    isApprovalRespondedTool(part),
                ),
            );

            // Check if frontend sent tool output (addToolOutput updates assistant message)
            const hasToolOutput = data.messages?.some(
              (msg: any) =>
                msg.role === "assistant" &&
                msg.parts?.some(
                  (part: any) =>
                    part.toolCallId === "orig-location" &&
                    part.state === "output-available",
                ),
            );

            console.log("[MSW Handler] Check results:", {
              hasApprovalResponse,
              hasToolOutput,
              toolResultReceived,
            });

            if (hasToolOutput) {
              // Frontend sent tool-result
              toolResultReceived = true;

              // Backend continues with AI response
              const textId = `text-${Date.now()}`;
              client.send(
                `data: ${JSON.stringify({ type: "text-start", id: textId })}\n\n`,
              );
              client.send(
                `data: ${JSON.stringify({
                  type: "text-delta",
                  delta:
                    "Your location is Tokyo, Japan (35.6762°N, 139.6503°E).",
                  id: textId,
                })}\n\n`,
              );
              client.send(
                `data: ${JSON.stringify({ type: "text-end", id: textId })}\n\n`,
              );
              client.send("data: [DONE]\n\n");
            } else if (hasApprovalResponse) {
              // Approval received, send [DONE] to complete this turn
              // Tool output will come in next message
              client.send("data: [DONE]\n\n");
              return;
            } else {
              // First message: Send original tool + confirmation request
              // NOTE: No text-* events here (unlike real backend) to match SSE E2E pattern
              // This allows sendAutomaticallyWhen to work correctly

              // Send original tool chunks first
              client.send(
                `data: ${JSON.stringify({
                  type: "tool-input-start",
                  toolCallId: "orig-location",
                  toolName: "get_location",
                })}\n\n`,
              );

              client.send(
                `data: ${JSON.stringify({
                  type: "tool-input-available",
                  toolCallId: "orig-location",
                  toolName: "get_location",
                  input: {},
                })}\n\n`,
              );

              // Then send confirmation tool chunks
              client.send(
                `data: ${JSON.stringify({
                  type: "tool-input-start",
                  toolCallId: "call-location",
                  toolName: "test_operation",
                })}\n\n`,
              );

              client.send(
                `data: ${JSON.stringify({
                  type: "tool-input-available",
                  toolCallId: "call-location",
                  toolName: "test_operation",
                  input: {
                    originalFunctionCall: {
                      id: "orig-location",
                      name: "get_location",
                      args: {},
                    },
                    toolConfirmation: {
                      hint: "Please approve or reject the tool call get_location()",
                      confirmed: false,
                    },
                  },
                })}\n\n`,
              );

              // Send tool-approval-request (AI SDK v6 standard event)
              // Reference: ADR 0002 - Tool Approval Architecture
              client.send(
                `data: ${JSON.stringify({
                  type: "tool-approval-request",
                  toolCallId: "call-location",
                  approvalId: "call-location",
                })}\n\n`,
              );

              // Send [DONE] to complete this turn
              // Approval response will come in a separate message
              client.send("data: [DONE]\n\n");
            }
          });
        }),
      );

      const { useChatOptions, transport } = buildUseChatOptions({
        initialMessages: [],
        adkBackendUrl: "http://localhost:8000",
        forceNewInstance: true,
      });

      // Register transport for cleanup
      currentTransport = transport;

      // When: User sends message
      const { result } = renderHook(() => useChat(useChatOptions));

      await act(async () => {
        result.current.sendMessage({ text: "What's my location?" });
      });

      // Wait for confirmation to arrive
      await waitFor(
        () => {
          const lastMessage =
            result.current.messages[result.current.messages.length - 1];
          return (
            lastMessage?.role === "assistant" &&
            lastMessage.parts.some(
              (part: any) =>
                isApprovalRequestedTool(part) &&
                part.state === "approval-requested",
            )
          );
        },
        { timeout: 3000 },
      );

      // User approves confirmation
      const confirmationMessage =
        result.current.messages[result.current.messages.length - 1];
      const confirmationPart = confirmationMessage.parts.find((part: any) =>
        isApprovalRequestedTool(part),
      ) as any;

      await act(async () => {
        result.current.addToolApprovalResponse({
          id: confirmationPart.approval.id, // ← Use approval.id, NOT toolCallId!
          approved: true,
        });
      });

      // Wait for state to change to approval-responded (AI SDK v6 standard behavior)
      await waitFor(
        () => {
          const msg =
            result.current.messages[result.current.messages.length - 1];
          const part = msg.parts.find((p: any) =>
            isApprovalRespondedTool(p),
          ) as any;
          expect(part).toBeDefined();
          expect(part?.state).toBe("approval-responded");
        },
        { timeout: 3000 },
      );

      // Frontend executes browser API (mocked)
      const locationResult = {
        lat: 35.6762,
        lng: 139.6503,
        accuracy: 10,
      };

      // Frontend sends result with addToolOutput
      await act(async () => {
        result.current.addToolOutput({
          tool: "get_location",
          toolCallId: "orig-location",
          output: JSON.stringify(locationResult),
        });
      });

      // Wait for AI response
      await waitFor(
        () => {
          const lastMessage =
            result.current.messages[result.current.messages.length - 1];
          const text = getMessageText(lastMessage);
          return text.includes("Tokyo, Japan");
        },
        { timeout: 5000 },
      );

      // Then: Verify flow
      expect(toolResultReceived).toBe(true);

      const finalMessage =
        result.current.messages[result.current.messages.length - 1];
      const finalText = getMessageText(finalMessage);
      expect(finalText).toContain("Tokyo, Japan");
      expect(finalText).toContain("35.6762");

      // Transport cleanup handled by afterEach
    });

    it("should handle frontend execution failure", async () => {
      // Given: Frontend execution fails
      const chat = createBidiWebSocketLink();
      let toolResultReceived = false;

      server.use(
        createCustomHandler(chat, ({ server: _server, client }) => {
          // Add error handling for WebSocket
          client.addEventListener("error", (error) => {
            console.error("WebSocket error in test:", error);
          });

          client.addEventListener("close", (event) => {
            console.log("WebSocket closed:", event);
          });

          client.addEventListener("message", (event) => {
            // Early return for non-JSON messages (e.g., WebSocket handshake)
            if (typeof event.data !== "string" || !event.data.startsWith("{")) {
              return;
            }

            const data = JSON.parse(event.data as string);

            // Debug: Log all messages structure
            console.log("[MSW Handler] Message structure:", {
              messageCount: data.messages?.length,
              messages: data.messages?.map((m: any) => ({
                role: m.role,
                id: m.id,
                partsCount: m.parts?.length,
                parts: m.parts?.map((p: any) => ({
                  type: p.type,
                  state: p.state,
                  toolCallId: p.toolCallId,
                })),
              })),
            });

            // Check if this is approval response
            const hasApprovalResponse = data.messages?.some(
              (msg: any) =>
                msg.role === "assistant" &&
                msg.parts?.some(
                  (part: any) =>
                    isApprovalRespondedTool(part),
                ),
            );

            const hasToolOutput = data.messages?.some(
              (msg: any) =>
                msg.role === "assistant" &&
                msg.parts?.some(
                  (part: any) =>
                    part.toolCallId === "orig-camera" &&
                    part.state === "output-available",
                ),
            );

            console.log("[MSW Handler] Detection results:", {
              hasApprovalResponse,
              hasToolOutput,
            });

            if (hasToolOutput) {
              // Frontend sent tool-result
              toolResultReceived = true;

              // Error response
              const textId = `text-${Date.now()}`;
              client.send(
                `data: ${JSON.stringify({ type: "text-start", id: textId })}\n\n`,
              );
              client.send(
                `data: ${JSON.stringify({
                  type: "text-delta",
                  delta: "Unable to access camera. Permission denied.",
                  id: textId,
                })}\n\n`,
              );
              client.send(
                `data: ${JSON.stringify({ type: "text-end", id: textId })}\n\n`,
              );
              client.send("data: [DONE]\n\n");
            } else if (hasApprovalResponse) {
              // Approval received, send [DONE] to complete this turn
              // Tool output will come in next message
              client.send("data: [DONE]\n\n");
              return;
            } else {
              // Send original tool chunks first
              client.send(
                `data: ${JSON.stringify({
                  type: "tool-input-start",
                  toolCallId: "orig-camera",
                  toolName: "take_photo",
                })}\n\n`,
              );

              client.send(
                `data: ${JSON.stringify({
                  type: "tool-input-available",
                  toolCallId: "orig-camera",
                  toolName: "take_photo",
                  input: {},
                })}\n\n`,
              );

              // Then send confirmation
              client.send(
                `data: ${JSON.stringify({
                  type: "tool-input-start",
                  toolCallId: "call-camera",
                  toolName: "test_operation",
                })}\n\n`,
              );

              client.send(
                `data: ${JSON.stringify({
                  type: "tool-input-available",
                  toolCallId: "call-camera",
                  toolName: "test_operation",
                  input: {
                    originalFunctionCall: {
                      id: "orig-camera",
                      name: "take_photo",
                      args: {},
                    },
                    toolConfirmation: {
                      hint: "Please approve or reject the tool call take_photo()",
                      confirmed: false,
                    },
                  },
                })}\n\n`,
              );

              // Send tool-approval-request (AI SDK v6 standard event)
              // Reference: ADR 0002 - Tool Approval Architecture
              client.send(
                `data: ${JSON.stringify({
                  type: "tool-approval-request",
                  toolCallId: "call-camera",
                  approvalId: "call-camera",
                })}\n\n`,
              );

              // Send [DONE] to complete this stream
              // Approval response will come in a separate message
              client.send("data: [DONE]\n\n");
            }
          });
        }),
      );

      const { useChatOptions, transport } = buildUseChatOptions({
        initialMessages: [],
        adkBackendUrl: "http://localhost:8000",
        forceNewInstance: true,
      });

      // Register transport for cleanup
      currentTransport = transport;

      const { result } = renderHook(() => useChat(useChatOptions));

      await act(async () => {
        result.current.sendMessage({ text: "Take a photo" });
      });

      // Wait for confirmation
      await waitFor(
        () => {
          const msg =
            result.current.messages[result.current.messages.length - 1];
          return msg?.parts?.some(
            (p: any) =>
              isApprovalRequestedTool(p) && p.state === "approval-requested",
          );
        },
        { timeout: 3000 },
      );

      // Approve
      const msg = result.current.messages[result.current.messages.length - 1];
      const part = msg.parts.find((p: any) => isApprovalRequestedTool(p)) as any;

      await act(async () => {
        result.current.addToolApprovalResponse({
          id: part.approval.id, // ← Use approval.id, NOT toolCallId!
          approved: true,
        });
      });

      // Wait for approval state to update to approval-responded
      await waitFor(
        () => {
          const msg =
            result.current.messages[result.current.messages.length - 1];
          const confirmationPart = msg.parts.find((p: any) =>
            isApprovalRespondedTool(p),
          ) as any;
          expect(confirmationPart).toBeDefined();
          expect(confirmationPart?.state).toBe("approval-responded");
        },
        { timeout: 3000 },
      );

      // Frontend execution fails
      await act(async () => {
        result.current.addToolOutput({
          tool: "take_photo",
          toolCallId: "orig-camera",
          output: JSON.stringify({
            error: "NotAllowedError",
            message: "Permission denied",
          }),
        });
      });

      // Wait for error response
      await waitFor(
        () => {
          const lastMsg =
            result.current.messages[result.current.messages.length - 1];
          const text = getMessageText(lastMsg);
          return text.includes("Permission denied");
        },
        { timeout: 5000 },
      );

      // Verify error handling
      const finalText = getMessageText(
        result.current.messages[result.current.messages.length - 1],
      );
      expect(finalText).toContain("Permission denied");
      expect(toolResultReceived).toBe(true);

      // Transport cleanup handled by afterEach
    });
  });

  describe("Approval Denial", () => {
    it("should handle user denying frontend tool execution", async () => {
      // Given: User denies permission
      const chat = createBidiWebSocketLink();

      server.use(
        createCustomHandler(chat, ({ server: _server, client }) => {
          // Add error handling for WebSocket
          client.addEventListener("error", (error) => {
            console.error("WebSocket error in test:", error);
          });

          client.addEventListener("close", (event) => {
            console.log("WebSocket closed:", event);
          });

          client.addEventListener("message", (event) => {
            // Early return for non-JSON messages (e.g., WebSocket handshake)
            if (typeof event.data !== "string" || !event.data.startsWith("{")) {
              return;
            }

            const data = JSON.parse(event.data as string);

            const hasDenial = data.messages?.some(
              (msg: any) =>
                msg.role === "assistant" &&
                msg.parts?.some(
                  (part: any) =>
                    isApprovalRespondedTool(part) &&
                    part.approval?.approved === false,
                ),
            );

            if (!hasDenial) {
              // Send confirmation
              client.send(
                `data: ${JSON.stringify({
                  type: "tool-input-start",
                  toolCallId: "call-mic",
                  toolName: "test_operation",
                })}\n\n`,
              );

              client.send(
                `data: ${JSON.stringify({
                  type: "tool-input-available",
                  toolCallId: "call-mic",
                  toolName: "test_operation",
                  input: {
                    originalFunctionCall: {
                      id: "orig-mic",
                      name: "record_audio",
                      args: { duration: 5 },
                    },
                  },
                })}\n\n`,
              );

              client.send(
                `data: ${JSON.stringify({
                  type: "tool-approval-request",
                  approvalId: "call-mic",
                  toolCallId: "call-mic",
                })}\n\n`,
              );

              client.send("data: [DONE]\n\n");
            } else {
              // User denied
              const textId = `text-${Date.now()}`;
              client.send(
                `data: ${JSON.stringify({ type: "text-start", id: textId })}\n\n`,
              );
              client.send(
                `data: ${JSON.stringify({
                  type: "text-delta",
                  delta: "Understood. I won't access your microphone.",
                  id: textId,
                })}\n\n`,
              );
              client.send(
                `data: ${JSON.stringify({ type: "text-end", id: textId })}\n\n`,
              );
              client.send("data: [DONE]\n\n");
            }
          });
        }),
      );

      const { useChatOptions, transport } = buildUseChatOptions({
        initialMessages: [],
        adkBackendUrl: "http://localhost:8000",
        forceNewInstance: true,
      });

      // Register transport for cleanup
      currentTransport = transport;

      const { result } = renderHook(() => useChat(useChatOptions));

      await act(async () => {
        result.current.sendMessage({ text: "Record audio" });
      });

      // Wait for confirmation
      await waitFor(
        () => {
          const msg =
            result.current.messages[result.current.messages.length - 1];
          return msg?.parts?.some(
            (p: any) =>
              isApprovalRequestedTool(p) && p.state === "approval-requested",
          );
        },
        { timeout: 3000 },
      );

      // Deny
      const msg = result.current.messages[result.current.messages.length - 1];
      const part = msg.parts.find((p: any) => isApprovalRequestedTool(p)) as any;

      await act(async () => {
        result.current.addToolApprovalResponse({
          id: part.approval.id, // ← Use approval.id, NOT toolCallId!
          approved: false,
        });
      });

      // Wait for denial response (NO addToolOutput call)
      await waitFor(
        () => {
          const lastMsg =
            result.current.messages[result.current.messages.length - 1];
          const text = getMessageText(lastMsg);
          return text.includes("won't access");
        },
        { timeout: 5000 },
      );

      expect(
        getMessageText(
          result.current.messages[result.current.messages.length - 1],
        ),
      ).toContain("won't access your microphone");

      // Transport cleanup handled by afterEach
    });
  });

  describe("Multiple Sequential Approvals (BIDI)", () => {
    it("should handle two sequential tool approvals (Alice → Bob)", async () => {
      // Given: Backend sends two approval requests sequentially (BIDI mode behavior)
      // Turn 1: Alice approval request
      // Turn 2: Alice execution + Bob approval request
      // Turn 3: Bob execution + final response
      const chat = createBidiWebSocketLink();
      let aliceApprovalReceived = false;
      let bobApprovalReceived = false;

      server.use(
        createCustomHandler(chat, ({ server: _server, client }) => {
          client.addEventListener("error", (error) => {
            console.error("WebSocket error in test:", error);
          });

          client.addEventListener("message", async (event) => {
            if (typeof event.data !== "string" || !event.data.startsWith("{")) {
              return;
            }

            const msg = JSON.parse(event.data);
            console.log("[Test Mock Server] Received:", msg.type, msg);

            // Turn 1: Initial message → Alice approval request
            if (msg.type === "message" && msg.messages) {
              const lastMsg = msg.messages[msg.messages.length - 1];

              // Check if this is the initial user message (ADR 0002: no tool-adk_request_confirmation in initial message)
              if (
                !aliceApprovalReceived &&
                lastMsg.role === "user" &&
                !lastMsg.parts?.some(
                  (p: any) => p.type === "tool-adk_request_confirmation",
                )
              ) {
                console.log(
                  "[Test Mock Server] Turn 1: Sending Alice approval request",
                );

                // Send start event
                client.send(
                  'data: {"type": "start", "messageId": "msg-1"}\n\n',
                );

                // Send Alice process_payment tool input
                client.send(
                  'data: {"type": "tool-input-start", "toolCallId": "alice-tool-id", "toolName": "process_payment"}\n\n',
                );
                client.send(
                  'data: {"type": "tool-input-available", "toolCallId": "alice-tool-id", "toolName": "process_payment", "input": {"amount": 30, "recipient": "Alice", "currency": "USD"}}\n\n',
                );

                // Send approval request for Alice
                client.send(
                  'data: {"type": "tool-approval-request", "toolCallId": "alice-tool-id", "approvalId": "alice-approval-id"}\n\n',
                );

                // Send [DONE] to complete Turn 1
                client.send("data: [DONE]\n\n");

                aliceApprovalReceived = true;
                return;
              }

              // Turn 2: Alice approval → Alice execution + Bob approval request
              // ADR 0002: Check for actual tool part (tool-process_payment) with approval-responded state
              if (
                aliceApprovalReceived &&
                !bobApprovalReceived &&
                lastMsg.parts?.some(
                  (p: any) =>
                    p.type === "tool-process_payment" &&
                    "approval-responded" === p.state &&
                    p.approval?.id === "alice-approval-id",
                )
              ) {
                console.log(
                  "[Test Mock Server] Turn 2: Sending Alice execution + Bob approval request",
                );

                // Send Alice execution result
                client.send(
                  'data: {"type": "tool-output-available", "toolCallId": "alice-tool-id", "output": {"success": true, "transaction_id": "txn-alice", "amount": 30, "recipient": "Alice"}}\n\n',
                );

                // Send Bob process_payment tool input
                client.send(
                  'data: {"type": "tool-input-start", "toolCallId": "bob-tool-id", "toolName": "process_payment"}\n\n',
                );
                client.send(
                  'data: {"type": "tool-input-available", "toolCallId": "bob-tool-id", "toolName": "process_payment", "input": {"amount": 40, "recipient": "Bob", "currency": "USD"}}\n\n',
                );

                // Send approval request for Bob
                client.send(
                  'data: {"type": "tool-approval-request", "toolCallId": "bob-tool-id", "approvalId": "bob-approval-id"}\n\n',
                );

                // Send [DONE] to complete Turn 2
                client.send("data: [DONE]\n\n");

                bobApprovalReceived = true;
                return;
              }

              // Turn 3: Bob approval → Bob execution + final response
              // ADR 0002: Check for actual tool part (tool-process_payment) with approval-responded state
              if (
                bobApprovalReceived &&
                lastMsg.parts?.some(
                  (p: any) =>
                    p.type === "tool-process_payment" &&
                    "approval-responded" === p.state &&
                    p.approval?.id === "bob-approval-id",
                )
              ) {
                console.log(
                  "[Test Mock Server] Turn 3: Sending Bob execution + final response",
                );

                // Send Bob execution result
                client.send(
                  'data: {"type": "tool-output-available", "toolCallId": "bob-tool-id", "output": {"success": true, "transaction_id": "txn-bob", "amount": 40, "recipient": "Bob"}}\n\n',
                );

                // Send AI response
                client.send('data: {"type": "text-start", "id": "text-1"}\n\n');
                client.send(
                  'data: {"type": "text-delta", "id": "text-1", "delta": "Both payments completed successfully."}\n\n',
                );
                client.send('data: {"type": "text-end", "id": "text-1"}\n\n');

                // Send finish
                client.send(
                  'data: {"type": "finish", "finishReason": "stop"}\n\n',
                );
                client.send("data: [DONE]\n\n");
                return;
              }
            }
          });
        }),
      );

      // When: User sends message requesting two payments
      const { useChatOptions, transport } = buildUseChatOptions({
        initialMessages: [],
        adkBackendUrl: "http://localhost:8000",
        forceNewInstance: true,
      });

      currentTransport = transport;

      const { result } = renderHook(() => useChat(useChatOptions));

      await act(async () => {
        result.current.sendMessage({
          text: "Aliceに30ドル、Bobに40ドル送金してください",
        });
      });

      // Then: Should receive Alice approval request first
      await waitFor(
        () => {
          const lastMsg =
            result.current.messages[result.current.messages.length - 1];
          const aliceTool = lastMsg?.parts?.find(
            (p: any) =>
              p.type === "tool-process_payment" &&
              p.input?.recipient === "Alice",
          );
          return aliceTool?.state === "approval-requested";
        },
        { timeout: 5000 },
      );

      console.log("[Test] ✓ Alice approval request received");
      const aliceTool = result.current.messages[
        result.current.messages.length - 1
      ]?.parts?.find(
        (p: any) =>
          p.type === "tool-process_payment" && p.input?.recipient === "Alice",
      );
      expect(aliceTool).toBeDefined();
      expect(aliceTool?.state).toBe("approval-requested");

      // When: User approves Alice payment
      console.log("[Test] Sending Alice approval:", {
        approvalId: aliceTool?.approval?.id,
        toolCallId: aliceTool?.toolCallId,
      });
      await act(async () => {
        result.current.addToolApprovalResponse({
          id: aliceTool?.approval?.id,
          approved: true,
        });
      });
      console.log("[Test] Alice approval sent");

      // Then: Should receive Bob approval request
      await waitFor(
        () => {
          const lastMsg =
            result.current.messages[result.current.messages.length - 1];
          const bobTool = lastMsg?.parts?.find(
            (p: any) =>
              p.type === "tool-process_payment" && p.input?.recipient === "Bob",
          );
          return bobTool?.state === "approval-requested";
        },
        { timeout: 5000 },
      );

      console.log("[Test] ✓ Bob approval request received");
      const bobTool = result.current.messages[
        result.current.messages.length - 1
      ]?.parts?.find(
        (p: any) =>
          p.type === "tool-process_payment" && p.input?.recipient === "Bob",
      );
      expect(bobTool).toBeDefined();
      expect(bobTool?.state).toBe("approval-requested");

      // When: User approves Bob payment
      await act(async () => {
        result.current.addToolApprovalResponse({
          id: bobTool?.approval?.id,
          approved: true,
        });
      });

      // Then: Should receive final AI response
      await waitFor(
        () => {
          const text = getMessageText(
            result.current.messages[result.current.messages.length - 1],
          );
          return text.includes("completed");
        },
        { timeout: 5000 },
      );

      console.log("[Test] ✓ Final response received");
      expect(
        getMessageText(
          result.current.messages[result.current.messages.length - 1],
        ),
      ).toContain("completed");

      // Transport cleanup handled by afterEach
    });
  });
});
