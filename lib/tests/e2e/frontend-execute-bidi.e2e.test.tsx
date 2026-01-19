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
import { describe, expect, it } from "vitest";
import { buildUseChatOptions } from "../../bidi";
import type { UIMessageFromAISDKv6 } from "../../utils";
import {
  isApprovalRequestedTool,
  isApprovalRespondedTool,
  isTextUIPartFromAISDKv6,
} from "../../utils";
import { useMockWebSocket } from "../helpers/mock-websocket";

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

describe("BIDI Mode - Frontend Execute Pattern", () => {
  const { setDefaultHandler } = useMockWebSocket();

  describe("Single Tool Frontend Execution", () => {
    it("should execute tool on frontend and send result with addToolOutput", async () => {
      // Given: Backend sends confirmation, frontend executes, sends result
      let toolResultReceived = false;

      setDefaultHandler((ws) => {
        ws.onClientMessage((data) => {
          if (!data.startsWith("{")) {
            return;
          }

          const msg = JSON.parse(data);

          console.log("[Test Mock Server] Received message:", {
            type: msg.type,
            trigger: msg.trigger,
            messageCount: msg.messages?.length,
            lastMessage: msg.messages?.[msg.messages.length - 1],
          });

          // Check if this is approval response (assistant message with approval-responded)
          const hasApprovalResponse = msg.messages?.some(
            // biome-ignore lint/suspicious/noExplicitAny: Test helper
            (m: any) =>
              m.role === "assistant" &&
              m.parts?.some((part: any) => isApprovalRespondedTool(part)),
          );

          // Check if frontend sent tool output (addToolOutput updates assistant message)
          const hasToolOutput = msg.messages?.some(
            // biome-ignore lint/suspicious/noExplicitAny: Test helper
            (m: any) =>
              m.role === "assistant" &&
              m.parts?.some(
                (part: any) =>
                  part.toolCallId === "orig-location" &&
                  part.state === "output-available",
              ),
          );

          console.log("[Test Mock Server] Check results:", {
            hasApprovalResponse,
            hasToolOutput,
            toolResultReceived,
          });

          if (hasToolOutput) {
            // Frontend sent tool-result
            toolResultReceived = true;

            // Backend continues with AI response
            const textId = `text-${Date.now()}`;
            ws.simulateServerMessage({ type: "text-start", id: textId });
            ws.simulateServerMessage({
              type: "text-delta",
              delta: "Your location is Tokyo, Japan (35.6762°N, 139.6503°E).",
              id: textId,
            });
            ws.simulateServerMessage({ type: "text-end", id: textId });
            ws.simulateDone();
          } else if (hasApprovalResponse) {
            // Approval received, send [DONE] to complete this turn
            // Tool output will come in next message
            ws.simulateDone();
            return;
          } else {
            // First message: Send original tool + confirmation request

            // Send original tool chunks first
            ws.simulateServerMessage({
              type: "tool-input-start",
              toolCallId: "orig-location",
              toolName: "get_location",
            });

            ws.simulateServerMessage({
              type: "tool-input-available",
              toolCallId: "orig-location",
              toolName: "get_location",
              input: {},
            });

            // Then send confirmation tool chunks
            ws.simulateServerMessage({
              type: "tool-input-start",
              toolCallId: "call-location",
              toolName: "test_operation",
            });

            ws.simulateServerMessage({
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
            });

            // Send tool-approval-request (AI SDK v6 standard event)
            ws.simulateServerMessage({
              type: "tool-approval-request",
              toolCallId: "call-location",
              approvalId: "call-location",
            });

            // Send [DONE] to complete this turn
            ws.simulateDone();
          }
        });
      });

      const { useChatOptions } = buildUseChatOptions({
        initialMessages: [],
        adkBackendUrl: "http://localhost:8000",
        forceNewInstance: true,
      });

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

    });

    it("should handle frontend execution failure", async () => {
      // Given: Frontend execution fails
      let toolResultReceived = false;

      setDefaultHandler((ws) => {
        ws.onClientMessage((data) => {
          if (!data.startsWith("{")) {
            return;
          }

          const msg = JSON.parse(data);

          // Check if this is approval response
          const hasApprovalResponse = msg.messages?.some(
            // biome-ignore lint/suspicious/noExplicitAny: Test helper
            (m: any) =>
              m.role === "assistant" &&
              m.parts?.some((part: any) => isApprovalRespondedTool(part)),
          );

          const hasToolOutput = msg.messages?.some(
            // biome-ignore lint/suspicious/noExplicitAny: Test helper
            (m: any) =>
              m.role === "assistant" &&
              m.parts?.some(
                (part: any) =>
                  part.toolCallId === "orig-camera" &&
                  part.state === "output-available",
              ),
          );

          if (hasToolOutput) {
            // Frontend sent tool-result
            toolResultReceived = true;

            // Error response
            const textId = `text-${Date.now()}`;
            ws.simulateServerMessage({ type: "text-start", id: textId });
            ws.simulateServerMessage({
              type: "text-delta",
              delta: "Unable to access camera. Permission denied.",
              id: textId,
            });
            ws.simulateServerMessage({ type: "text-end", id: textId });
            ws.simulateDone();
          } else if (hasApprovalResponse) {
            // Approval received, send [DONE] to complete this turn
            ws.simulateDone();
            return;
          } else {
            // Send original tool chunks first
            ws.simulateServerMessage({
              type: "tool-input-start",
              toolCallId: "orig-camera",
              toolName: "take_photo",
            });

            ws.simulateServerMessage({
              type: "tool-input-available",
              toolCallId: "orig-camera",
              toolName: "take_photo",
              input: {},
            });

            // Then send confirmation
            ws.simulateServerMessage({
              type: "tool-input-start",
              toolCallId: "call-camera",
              toolName: "test_operation",
            });

            ws.simulateServerMessage({
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
            });

            // Send tool-approval-request (AI SDK v6 standard event)
            ws.simulateServerMessage({
              type: "tool-approval-request",
              toolCallId: "call-camera",
              approvalId: "call-camera",
            });

            // Send [DONE] to complete this stream
            ws.simulateDone();
          }
        });
      });

      const { useChatOptions } = buildUseChatOptions({
        initialMessages: [],
        adkBackendUrl: "http://localhost:8000",
        forceNewInstance: true,
      });

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
      const part = msg.parts.find((p: any) =>
        isApprovalRequestedTool(p),
      ) as any;

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
    });
  });

  describe("Approval Denial", () => {
    it("should handle user denying frontend tool execution", async () => {
      // Given: User denies permission
      setDefaultHandler((ws) => {
        ws.onClientMessage((data) => {
          if (!data.startsWith("{")) {
            return;
          }

          const msg = JSON.parse(data);

          const hasDenial = msg.messages?.some(
            // biome-ignore lint/suspicious/noExplicitAny: Test helper
            (m: any) =>
              m.role === "assistant" &&
              m.parts?.some(
                (part: any) =>
                  isApprovalRespondedTool(part) &&
                  part.approval?.approved === false,
              ),
          );

          if (!hasDenial) {
            // Send confirmation
            ws.simulateServerMessage({
              type: "tool-input-start",
              toolCallId: "call-mic",
              toolName: "test_operation",
            });

            ws.simulateServerMessage({
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
            });

            ws.simulateServerMessage({
              type: "tool-approval-request",
              approvalId: "call-mic",
              toolCallId: "call-mic",
            });

            ws.simulateDone();
          } else {
            // User denied
            const textId = `text-${Date.now()}`;
            ws.simulateServerMessage({ type: "text-start", id: textId });
            ws.simulateServerMessage({
              type: "text-delta",
              delta: "Understood. I won't access your microphone.",
              id: textId,
            });
            ws.simulateServerMessage({ type: "text-end", id: textId });
            ws.simulateDone();
          }
        });
      });

      const { useChatOptions } = buildUseChatOptions({
        initialMessages: [],
        adkBackendUrl: "http://localhost:8000",
        forceNewInstance: true,
      });

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
      const part = msg.parts.find((p: any) =>
        isApprovalRequestedTool(p),
      ) as any;

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
    });
  });

  describe("Multiple Sequential Approvals (BIDI)", () => {
    it("should handle two sequential tool approvals (Alice → Bob)", async () => {
      // Given: Backend sends two approval requests sequentially (BIDI mode behavior)
      // Turn 1: Alice approval request
      // Turn 2: Alice execution + Bob approval request
      // Turn 3: Bob execution + final response
      let aliceApprovalReceived = false;
      let bobApprovalReceived = false;

      setDefaultHandler((ws) => {
        ws.onClientMessage((data) => {
          if (!data.startsWith("{")) {
            return;
          }

          const msg = JSON.parse(data);
          console.log("[Test Mock Server] Received:", msg.type, msg);

          // Turn 1: Initial message → Alice approval request
          if (msg.type === "message" && msg.messages) {
            const lastMsg = msg.messages[msg.messages.length - 1];

            // Check if this is the initial user message
            if (
              !aliceApprovalReceived &&
              lastMsg.role === "user" &&
              // biome-ignore lint/suspicious/noExplicitAny: Test helper
              !lastMsg.parts?.some(
                (p: any) => p.type === "tool-adk_request_confirmation",
              )
            ) {
              console.log(
                "[Test Mock Server] Turn 1: Sending Alice approval request",
              );

              ws.simulateServerMessage({ type: "start", messageId: "msg-1" });
              ws.simulateServerMessage({
                type: "tool-input-start",
                toolCallId: "alice-tool-id",
                toolName: "process_payment",
              });
              ws.simulateServerMessage({
                type: "tool-input-available",
                toolCallId: "alice-tool-id",
                toolName: "process_payment",
                input: { amount: 30, recipient: "Alice", currency: "USD" },
              });
              ws.simulateServerMessage({
                type: "tool-approval-request",
                toolCallId: "alice-tool-id",
                approvalId: "alice-approval-id",
              });
              ws.simulateDone();

              aliceApprovalReceived = true;
              return;
            }

            // Turn 2: Alice approval → Alice execution + Bob approval request
            if (
              aliceApprovalReceived &&
              !bobApprovalReceived &&
              lastMsg.parts?.some(
                // biome-ignore lint/suspicious/noExplicitAny: Test helper
                (p: any) =>
                  p.type === "tool-process_payment" &&
                  "approval-responded" === p.state &&
                  p.approval?.id === "alice-approval-id",
              )
            ) {
              console.log(
                "[Test Mock Server] Turn 2: Sending Alice execution + Bob approval request",
              );

              ws.simulateServerMessage({
                type: "tool-output-available",
                toolCallId: "alice-tool-id",
                output: {
                  success: true,
                  transaction_id: "txn-alice",
                  amount: 30,
                  recipient: "Alice",
                },
              });
              ws.simulateServerMessage({
                type: "tool-input-start",
                toolCallId: "bob-tool-id",
                toolName: "process_payment",
              });
              ws.simulateServerMessage({
                type: "tool-input-available",
                toolCallId: "bob-tool-id",
                toolName: "process_payment",
                input: { amount: 40, recipient: "Bob", currency: "USD" },
              });
              ws.simulateServerMessage({
                type: "tool-approval-request",
                toolCallId: "bob-tool-id",
                approvalId: "bob-approval-id",
              });
              ws.simulateDone();

              bobApprovalReceived = true;
              return;
            }

            // Turn 3: Bob approval → Bob execution + final response
            if (
              bobApprovalReceived &&
              lastMsg.parts?.some(
                // biome-ignore lint/suspicious/noExplicitAny: Test helper
                (p: any) =>
                  p.type === "tool-process_payment" &&
                  "approval-responded" === p.state &&
                  p.approval?.id === "bob-approval-id",
              )
            ) {
              console.log(
                "[Test Mock Server] Turn 3: Sending Bob execution + final response",
              );

              ws.simulateServerMessage({
                type: "tool-output-available",
                toolCallId: "bob-tool-id",
                output: {
                  success: true,
                  transaction_id: "txn-bob",
                  amount: 40,
                  recipient: "Bob",
                },
              });
              ws.simulateServerMessage({ type: "text-start", id: "text-1" });
              ws.simulateServerMessage({
                type: "text-delta",
                id: "text-1",
                delta: "Both payments completed successfully.",
              });
              ws.simulateServerMessage({ type: "text-end", id: "text-1" });
              ws.simulateServerMessage({
                type: "finish",
                finishReason: "stop",
              });
              ws.simulateDone();
              return;
            }
          }
        });
      });

      // When: User sends message requesting two payments
      const { useChatOptions } = buildUseChatOptions({
        initialMessages: [],
        adkBackendUrl: "http://localhost:8000",
        forceNewInstance: true,
      });

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
    });
  });
});
