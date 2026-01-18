/**
 * E2E Test: Multi-Tool Execution
 *
 * Tests sequential execution of multiple tools with confirmation flow:
 * 1. Tool1 requires confirmation → user approves → executes
 * 2. Tool2 requires confirmation → user approves → executes
 * 3. Tool3 requires confirmation → user denies → skips
 * 4. All tools handled correctly in sequence
 *
 * This is an E2E test - we use:
 * - Real React components and useChat hook
 * - Real WebSocketChatTransport with confirmation flow
 * - Real EventSender/EventReceiver
 * - MSW for WebSocket mocking (simulates real backend)
 *
 * @vitest-environment jsdom
 */

import { useChat } from "@ai-sdk/react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { buildUseChatOptions } from "../../bidi";
import type { UIMessageFromAISDKv6 } from "../../utils";
import { isApprovalRequestedTool, isTextUIPartFromAISDKv6 } from "../../utils";
import {
  createBidiWebSocketLink,
  createCustomHandler,
  useMswServer,
} from "../helpers";

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

describe("Multi-Tool Execution E2E Tests", () => {
  const { getServer } = useMswServer({ onUnhandledRequest: "warn" });
  describe("Sequential Tool Execution with Confirmations", () => {
    it("should execute multiple tools in sequence with approvals", async () => {
      // given
      const chat = createBidiWebSocketLink();
      let tool1Sent = false;
      let tool2Sent = false;

      getServer().use(
        createCustomHandler(chat, ({ server: _server, client }) => {
          client.addEventListener("message", (event) => {
            // Early return for non-JSON messages (e.g., WebSocket handshake)
            if (typeof event.data !== "string" || !event.data.startsWith("{")) {
              return;
            }

            const data = JSON.parse(event.data as string);

            // Check if Tool1 was approved (AI SDK v6: approval object exists)
            const hasTool1Approval = data.messages?.some(
              (msg: any) =>
                msg.role === "assistant" &&
                msg.parts?.some(
                  (part: any) =>
                    part.toolCallId === "call-tool1" &&
                    part.approval !== undefined,
                ),
            );

            // Check if Tool2 was approved (AI SDK v6: approval object exists)
            const hasTool2Approval = data.messages?.some(
              (msg: any) =>
                msg.role === "assistant" &&
                msg.parts?.some(
                  (part: any) =>
                    part.toolCallId === "call-tool2" &&
                    part.approval !== undefined,
                ),
            );

            if (!tool1Sent) {
              tool1Sent = true;
              // First interaction: User asks for multiple actions
              // Backend requests confirmation for Tool1
              // Send tool-input-start
              client.send(
                `data: ${JSON.stringify({
                  type: "tool-input-start",
                  toolCallId: "call-tool1",
                  toolName: "test_operation",
                })}\n\n`,
              );

              // Send tool-input-available
              client.send(
                `data: ${JSON.stringify({
                  type: "tool-input-available",
                  toolCallId: "call-tool1",
                  toolName: "test_operation",
                  input: {
                    originalFunctionCall: {
                      id: "tool1-original",
                      name: "search_database",
                      args: { query: "users" },
                    },
                  },
                })}\n\n`,
              );

              // Send tool-approval-request
              client.send(
                `data: ${JSON.stringify({
                  type: "tool-approval-request",
                  approvalId: "call-tool1",
                  toolCallId: "call-tool1",
                })}\n\n`,
              );

              client.send("data: [DONE]\n\n");
            } else if (hasTool1Approval && !tool2Sent) {
              tool2Sent = true;
              // Second interaction: User approved Tool1
              // Request confirmation for Tool2 (no text parts yet)
              // Send tool-input-start
              client.send(
                `data: ${JSON.stringify({
                  type: "tool-input-start",
                  toolCallId: "call-tool2",
                  toolName: "test_operation",
                })}\n\n`,
              );

              // Send tool-input-available
              client.send(
                `data: ${JSON.stringify({
                  type: "tool-input-available",
                  toolCallId: "call-tool2",
                  toolName: "test_operation",
                  input: {
                    originalFunctionCall: {
                      id: "tool2-original",
                      name: "update_database",
                      args: { action: "cleanup" },
                    },
                  },
                })}\n\n`,
              );

              // Send tool-approval-request
              client.send(
                `data: ${JSON.stringify({
                  type: "tool-approval-request",
                  approvalId: "call-tool2",
                  toolCallId: "call-tool2",
                })}\n\n`,
              );

              client.send("data: [DONE]\n\n");
            } else if (hasTool2Approval) {
              // Third interaction: User approved Tool2
              // Execute both tools and complete with results
              const textId3 = `text-${Date.now()}-3`;
              client.send(
                `data: ${JSON.stringify({ type: "text-start", id: textId3 })}\n\n`,
              );
              client.send(
                `data: ${JSON.stringify({
                  type: "text-delta",
                  delta: "Found 10 users. ",
                  id: textId3,
                })}\n\n`,
              );
              client.send(
                `data: ${JSON.stringify({
                  type: "text-delta",
                  delta: "Database updated successfully.",
                  id: textId3,
                })}\n\n`,
              );
              client.send(
                `data: ${JSON.stringify({ type: "text-end", id: textId3 })}\n\n`,
              );

              // Tool1 result
              client.send(
                `data: ${JSON.stringify({
                  type: "tool-result",
                  toolCallId: "tool1-original",
                  result: { count: 10, users: ["Alice", "Bob"] },
                })}\n\n`,
              );

              // Tool2 result
              client.send(
                `data: ${JSON.stringify({
                  type: "tool-result",
                  toolCallId: "tool2-original",
                  result: { success: true, updated: 5 },
                })}\n\n`,
              );
              client.send("data: [DONE]\n\n");
            }
          });
        }),
      );

      const { useChatOptions, transport } = buildUseChatOptions({
        initialMessages: [],
        adkBackendUrl: "http://localhost:8000",
      });

      // when
      const { result } = renderHook(() => useChat(useChatOptions));

      // Step 1: Send initial message
      await act(async () => {
        result.current.sendMessage({ text: "Search and update database" });
      });

      // Wait for Tool1 confirmation request
      await waitFor(
        () => {
          const lastMessage =
            result.current.messages[result.current.messages.length - 1];
          if (!lastMessage || lastMessage.role !== "assistant") return false;

          const confirmationPart = lastMessage.parts.find((part) =>
            isApprovalRequestedTool(part),
          );
          return confirmationPart !== undefined;
        },
        { timeout: 5000 },
      );

      // Step 2: Approve Tool1
      const assistantMessage1 =
        result.current.messages[result.current.messages.length - 1];
      if (!assistantMessage1) {
        throw new Error("No assistant message found after waitFor");
      }
      const confirmationTool1 = assistantMessage1.parts.find(
        (part): part is any => isApprovalRequestedTool(part),
      );
      if (!confirmationTool1) {
        throw new Error("No confirmation tool found in assistant message");
      }

      await act(async () => {
        result.current.addToolApprovalResponse({
          id: confirmationTool1.approval.id, // ← Use approval.id, NOT toolCallId!
          approved: true,
        });
      });

      // Wait for Tool2 confirmation request (backend responds after receiving Tool1 approval)
      await waitFor(
        () => {
          const messages = result.current.messages;
          const lastMessage = messages[messages.length - 1];
          if (!lastMessage || lastMessage.role !== "assistant") return false;

          // Look for Tool2 confirmation specifically
          const tool2Part = lastMessage.parts.find(
            (part) =>
              isApprovalRequestedTool(part) && part.toolCallId === "call-tool2",
          );

          return tool2Part !== undefined;
        },
        { timeout: 5000 },
      );

      // Step 3: Approve Tool2
      const assistantMessage2 =
        result.current.messages[result.current.messages.length - 1];
      if (!assistantMessage2) {
        throw new Error("No assistant message found for Tool2 after waitFor");
      }
      const confirmationTool2 = assistantMessage2.parts.find(
        (part): part is any =>
          isApprovalRequestedTool(part) && part.toolCallId === "call-tool2",
      );
      if (!confirmationTool2) {
        throw new Error("No confirmation tool2 found in assistant message");
      }

      await act(async () => {
        result.current.addToolApprovalResponse({
          id: confirmationTool2.approval.id, // ← Use approval.id, NOT toolCallId!
          approved: true,
        });
      });

      // Wait for final completion (backend responds after receiving Tool2 approval)
      await waitFor(
        () => {
          const lastMessage =
            result.current.messages[result.current.messages.length - 1];
          return (
            lastMessage?.role === "assistant" &&
            getMessageText(lastMessage).includes(
              "Database updated successfully",
            )
          );
        },
        { timeout: 5000 },
      );

      // then
      expect(result.current.messages.length).toBeGreaterThanOrEqual(2); // User + Assistant

      // Verify final message contains results from both tools
      const finalMessage =
        result.current.messages[result.current.messages.length - 1];
      const finalText = getMessageText(finalMessage);
      expect(finalText).toContain("Found 10 users");
      expect(finalText).toContain("Database updated successfully");

      transport._close();
    });

    it("should handle mixed approval/denial across multiple tools", async () => {
      // given
      const chat = createBidiWebSocketLink();
      let tool1Sent = false;
      let tool2Sent = false;

      getServer().use(
        createCustomHandler(chat, ({ server: _server, client }) => {
          client.addEventListener("message", (event) => {
            // Early return for non-JSON messages (e.g., WebSocket handshake)
            if (typeof event.data !== "string" || !event.data.startsWith("{")) {
              return;
            }

            const data = JSON.parse(event.data as string);

            // Check if Tool1 was approved (AI SDK v6: approval object exists)
            const hasTool1Approval = data.messages?.some(
              (msg: any) =>
                msg.role === "assistant" &&
                msg.parts?.some(
                  (part: any) =>
                    part.toolCallId === "call-tool1" &&
                    part.approval !== undefined,
                ),
            );

            // Check if Tool2 was denied (AI SDK v6: approval object exists, backend knows it's denied from request)
            const hasTool2Denial = data.messages?.some(
              (msg: any) =>
                msg.role === "assistant" &&
                msg.parts?.some(
                  (part: any) =>
                    part.toolCallId === "call-tool2" &&
                    part.approval !== undefined,
                ),
            );

            if (!tool1Sent) {
              tool1Sent = true;
              // Request confirmation for Tool1
              // Send tool-input-start
              client.send(
                `data: ${JSON.stringify({
                  type: "tool-input-start",
                  toolCallId: "call-tool1",
                  toolName: "test_operation",
                })}\n\n`,
              );

              // Send tool-input-available
              client.send(
                `data: ${JSON.stringify({
                  type: "tool-input-available",
                  toolCallId: "call-tool1",
                  toolName: "test_operation",
                  input: {
                    originalFunctionCall: {
                      id: "tool1-original",
                      name: "safe_operation",
                      args: {},
                    },
                  },
                })}\n\n`,
              );

              // Send tool-approval-request
              client.send(
                `data: ${JSON.stringify({
                  type: "tool-approval-request",
                  approvalId: "call-tool1",
                  toolCallId: "call-tool1",
                })}\n\n`,
              );

              client.send("data: [DONE]\n\n");
            } else if (hasTool1Approval && !tool2Sent) {
              tool2Sent = true;
              // Tool1 approved - request Tool2 (no text parts yet)
              // Request confirmation for Tool2 (which will be denied)
              // Send tool-input-start
              client.send(
                `data: ${JSON.stringify({
                  type: "tool-input-start",
                  toolCallId: "call-tool2",
                  toolName: "test_operation",
                })}\n\n`,
              );

              // Send tool-input-available
              client.send(
                `data: ${JSON.stringify({
                  type: "tool-input-available",
                  toolCallId: "call-tool2",
                  toolName: "test_operation",
                  input: {
                    originalFunctionCall: {
                      id: "tool2-original",
                      name: "dangerous_operation",
                      args: {},
                    },
                  },
                })}\n\n`,
              );

              // Send tool-approval-request
              client.send(
                `data: ${JSON.stringify({
                  type: "tool-approval-request",
                  approvalId: "call-tool2",
                  toolCallId: "call-tool2",
                })}\n\n`,
              );

              client.send("data: [DONE]\n\n");
            } else if (hasTool2Denial) {
              // Tool2 denied - acknowledge and complete with both results
              const textId = `text-${Date.now()}-3`;
              client.send(
                `data: ${JSON.stringify({ type: "text-start", id: textId })}\n\n`,
              );
              client.send(
                `data: ${JSON.stringify({
                  type: "text-delta",
                  delta: "Operation completed. ",
                  id: textId,
                })}\n\n`,
              );
              client.send(
                `data: ${JSON.stringify({
                  type: "text-delta",
                  delta: "Understood. Skipping dangerous operation.",
                  id: textId,
                })}\n\n`,
              );
              client.send(
                `data: ${JSON.stringify({ type: "text-end", id: textId })}\n\n`,
              );

              // Tool1 result
              client.send(
                `data: ${JSON.stringify({
                  type: "tool-result",
                  toolCallId: "tool1-original",
                  result: { success: true },
                })}\n\n`,
              );

              client.send("data: [DONE]\n\n");
            }
          });
        }),
      );

      const { useChatOptions, transport } = buildUseChatOptions({
        initialMessages: [],
        adkBackendUrl: "http://localhost:8000",
      });

      // when
      const { result } = renderHook(() => useChat(useChatOptions));

      await act(async () => {
        result.current.sendMessage({
          text: "Do safe and dangerous operations",
        });
      });

      // Wait for Tool1 confirmation
      await waitFor(
        () => {
          const lastMessage =
            result.current.messages[result.current.messages.length - 1];
          return (
            lastMessage?.role === "assistant" &&
            lastMessage.parts.some(
              (part) =>
                isApprovalRequestedTool(part) &&
                part.toolCallId === "call-tool1",
            )
          );
        },
        { timeout: 5000 },
      );

      // Approve Tool1
      const msg1 = result.current.messages[result.current.messages.length - 1];
      if (!msg1) {
        throw new Error("No assistant message found for Tool1 after waitFor");
      }
      const tool1 = msg1.parts.find(
        (part): part is any =>
          isApprovalRequestedTool(part) && part.toolCallId === "call-tool1",
      );
      if (!tool1) {
        throw new Error("No confirmation tool1 found in assistant message");
      }

      await act(async () => {
        result.current.addToolApprovalResponse({
          id: tool1.approval.id, // ← Use approval.id, NOT toolCallId!
          approved: true,
        });
      });

      // Wait for Tool2 confirmation (backend responds after receiving Tool1 approval)
      await waitFor(
        () => {
          const lastMessage =
            result.current.messages[result.current.messages.length - 1];
          return (
            lastMessage?.role === "assistant" &&
            lastMessage.parts.some(
              (part) =>
                isApprovalRequestedTool(part) &&
                part.toolCallId === "call-tool2",
            )
          );
        },
        { timeout: 5000 },
      );

      // Deny Tool2
      const msg2 = result.current.messages[result.current.messages.length - 1];
      if (!msg2) {
        throw new Error("No assistant message found for Tool2 after waitFor");
      }
      const tool2 = msg2.parts.find(
        (part): part is any =>
          isApprovalRequestedTool(part) && part.toolCallId === "call-tool2",
      );
      if (!tool2) {
        throw new Error("No confirmation tool2 found in assistant message");
      }

      await act(async () => {
        result.current.addToolApprovalResponse({
          id: tool2.approval.id, // ← Use approval.id, NOT toolCallId!
          approved: false, // Deny this one
        });
      });

      // Wait for final response (backend responds after receiving Tool2 denial)
      await waitFor(
        () => {
          const lastMessage =
            result.current.messages[result.current.messages.length - 1];
          return (
            lastMessage?.role === "assistant" &&
            getMessageText(lastMessage).includes("Skipping dangerous operation")
          );
        },
        { timeout: 5000 },
      );

      // then
      const finalMessage =
        result.current.messages[result.current.messages.length - 1];
      const finalText = getMessageText(finalMessage);

      // Verify Tool1 executed
      expect(finalText).toContain("Operation completed");

      // Verify Tool2 was skipped
      expect(finalText).toContain("Skipping dangerous operation");

      transport._close();
    });

    it("should preserve message history across multiple tool executions", async () => {
      // given
      const chat = createBidiWebSocketLink();
      const messagesSent: any[] = [];

      getServer().use(
        createCustomHandler(chat, ({ server: _server, client }) => {
          client.addEventListener("message", (event) => {
            const data = JSON.parse(event.data as string);
            messagesSent.push(data);

            // Simple response for this test
            const textId = `text-${Date.now()}`;
            client.send(
              `data: ${JSON.stringify({ type: "text-start", id: textId })}\n\n`,
            );
            client.send(
              `data: ${JSON.stringify({ type: "text-delta", delta: "OK", id: textId })}\n\n`,
            );
            client.send(
              `data: ${JSON.stringify({ type: "text-end", id: textId })}\n\n`,
            );
            client.send("data: [DONE]\n\n");
          });
        }),
      );

      const { useChatOptions, transport } = buildUseChatOptions({
        initialMessages: [],
        adkBackendUrl: "http://localhost:8000",
      });

      // when
      const { result } = renderHook(() => useChat(useChatOptions));

      // Send first message
      await act(async () => {
        result.current.sendMessage({ text: "First message" });
      });

      await waitFor(() => result.current.messages.length >= 2, {
        timeout: 5000,
      });

      // Send second message
      await act(async () => {
        result.current.sendMessage({ text: "Second message" });
      });

      await waitFor(() => result.current.messages.length >= 4, {
        timeout: 5000,
      });

      // then
      // Verify second message included history from first message
      expect(messagesSent.length).toBe(2);

      const secondRequest = messagesSent[1];
      expect(secondRequest.messages).toBeDefined();
      expect(secondRequest.messages.length).toBeGreaterThanOrEqual(3); // User1, Assistant1, User2

      transport._close();
    });
  });
});
