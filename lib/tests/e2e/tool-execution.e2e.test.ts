/**
 * E2E Test: Tool Execution
 *
 * Tests complete tool calling flow from AI request to execution result.
 * Includes: tool calls, approval flow, result handling.
 *
 * @vitest-environment jsdom
 */

import { useChat } from "@ai-sdk/react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { buildUseChatOptions as buildBidiOptions } from "../../bidi";
import type { UIMessageFromAISDKv6 } from "../../utils";
import {
  isApprovalRequestedTool,
  isTextUIPartFromAISDKv6,
  isToolUIPartFromAISDKv6,
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

/**
 * Helper to find tool invocation parts
 */
function findToolParts(message: UIMessageFromAISDKv6 | undefined) {
  if (!message) return [];
  return message.parts.filter((part) => isToolUIPartFromAISDKv6(part));
}

describe("Tool Execution E2E", () => {
  const { setDefaultHandler } = useMockWebSocket();

  describe("Auto-execution Tools", () => {
    it("should execute get_weather tool automatically", async () => {
      // Given: Setup handler that sends tool call and immediate result
      setDefaultHandler((ws) => {
        ws.onClientMessage((rawData) => {
          let data: any;
          try {
            data = JSON.parse(rawData);
            if (data.type === "ping") return;
          } catch {
            return;
          }

          // Check for tool result in message
          const hasToolResult = data.messages?.some((msg: any) =>
            msg.parts?.some(
              (p: any) => p.type?.startsWith("tool-") && p.output,
            ),
          );

          if (hasToolResult) {
            // Tool executed, send final response
            const textId = `text-${Date.now()}`;
            ws.sendTextStart(textId);
            ws.sendTextDelta(textId, "The weather in Tokyo is sunny, 25°C.");
            ws.sendTextEnd(textId);
            ws.simulateDone();
            return;
          }

          // First message: send tool call
          const toolCallId = "tool-weather-1";
          ws.simulateServerMessage({
            type: "tool-input-start",
            toolCallId,
            toolName: "get_weather",
          });
          ws.simulateServerMessage({
            type: "tool-input-available",
            toolCallId,
            toolName: "get_weather",
            input: { location: "Tokyo" },
          });
          // For auto-execution tools, send output immediately
          ws.simulateServerMessage({
            type: "tool-output-available",
            toolCallId,
            toolName: "get_weather",
            output: { temperature: 25, condition: "sunny" },
          });
          ws.simulateDone();
        });
      });

      const { result } = renderHook(() =>
        useChat(buildBidiOptions({ initialMessages: [] }).useChatOptions),
      );

      // When: User sends message
      await act(async () => {
        result.current.sendMessage({ text: "What's the weather in Tokyo?" });
      });

      // Then: Should receive tool output and final response
      await waitFor(
        () => {
          const messages = result.current.messages;
          expect(messages.length).toBeGreaterThanOrEqual(2);

          const lastMessage = messages[messages.length - 1];
          const toolParts = findToolParts(lastMessage);

          // Should have tool invocation with output
          expect(
            toolParts.some((p: any) => p.type === "tool-get_weather"),
          ).toBe(true);
        },
        { timeout: 3000 },
      );
    });

    it("should handle tool execution errors", async () => {
      // Given: Setup handler that sends tool error
      setDefaultHandler((ws) => {
        ws.onClientMessage((rawData) => {
          let data: any;
          try {
            data = JSON.parse(rawData);
            if (data.type === "ping") return;
          } catch {
            return;
          }

          const toolCallId = "tool-error-1";
          ws.simulateServerMessage({
            type: "tool-input-start",
            toolCallId,
            toolName: "failing_tool",
          });
          ws.simulateServerMessage({
            type: "tool-input-available",
            toolCallId,
            toolName: "failing_tool",
            input: {},
          });
          // Send error response
          ws.simulateServerMessage({
            type: "error",
            error: { message: "Tool execution failed", code: "TOOL_ERROR" },
          });
          ws.simulateDone();
        });
      });

      const { result } = renderHook(() =>
        useChat(buildBidiOptions({ initialMessages: [] }).useChatOptions),
      );

      // When: User triggers failing tool
      await act(async () => {
        result.current.sendMessage({ text: "Run failing tool" });
      });

      // Then: Error should be captured
      await waitFor(
        () => {
          expect(result.current.error).toBeDefined();
        },
        { timeout: 3000 },
      );
    });

    it("should execute multiple tools in sequence", async () => {
      // Given: Setup handler that sends multiple tool calls
      let messageCount = 0;

      setDefaultHandler((ws) => {
        ws.onClientMessage((rawData) => {
          let data: any;
          try {
            data = JSON.parse(rawData);
            if (data.type === "ping") return;
          } catch {
            return;
          }

          messageCount++;

          if (messageCount === 1) {
            // First tool
            ws.simulateServerMessage({
              type: "tool-input-start",
              toolCallId: "tool-1",
              toolName: "get_weather",
            });
            ws.simulateServerMessage({
              type: "tool-input-available",
              toolCallId: "tool-1",
              toolName: "get_weather",
              input: { location: "Tokyo" },
            });
            ws.simulateServerMessage({
              type: "tool-output-available",
              toolCallId: "tool-1",
              toolName: "get_weather",
              output: { temperature: 25 },
            });

            // Second tool
            ws.simulateServerMessage({
              type: "tool-input-start",
              toolCallId: "tool-2",
              toolName: "get_time",
            });
            ws.simulateServerMessage({
              type: "tool-input-available",
              toolCallId: "tool-2",
              toolName: "get_time",
              input: { timezone: "JST" },
            });
            ws.simulateServerMessage({
              type: "tool-output-available",
              toolCallId: "tool-2",
              toolName: "get_time",
              output: { time: "14:30" },
            });

            ws.simulateDone();
          }
        });
      });

      const { result } = renderHook(() =>
        useChat(buildBidiOptions({ initialMessages: [] }).useChatOptions),
      );

      // When: User sends message
      await act(async () => {
        result.current.sendMessage({
          text: "What's the weather and time in Tokyo?",
        });
      });

      // Then: Should have both tool invocations
      await waitFor(
        () => {
          const messages = result.current.messages;
          const lastMessage = messages[messages.length - 1];
          const toolParts = findToolParts(lastMessage);

          expect(toolParts.length).toBeGreaterThanOrEqual(2);
        },
        { timeout: 3000 },
      );
    });
  });

  describe("Approval Required Tools", () => {
    it("should show approval UI for get_location", async () => {
      // Given: Setup handler that sends approval request
      setDefaultHandler((ws) => {
        ws.onClientMessage((rawData) => {
          let data: any;
          try {
            data = JSON.parse(rawData);
            if (data.type === "ping") return;
          } catch {
            return;
          }

          ws.sendToolWithApproval(
            "tool-location-1",
            "get_location",
            { precision: "high" },
            "tool-location-1",
          );
          ws.simulateDone();
        });
      });

      const { result } = renderHook(() =>
        useChat(buildBidiOptions({ initialMessages: [] }).useChatOptions),
      );

      // When: User sends message triggering approval tool
      await act(async () => {
        result.current.sendMessage({ text: "Get my location" });
      });

      // Then: Should have approval-requested tool part
      await waitFor(
        () => {
          const messages = result.current.messages;
          const lastMessage = messages[messages.length - 1];
          const approvalPart = lastMessage?.parts.find((p: any) =>
            isApprovalRequestedTool(p),
          );

          expect(approvalPart).toBeDefined();
          expect((approvalPart as any).toolCallId).toBe("tool-location-1");
        },
        { timeout: 3000 },
      );
    });

    it("should handle approval rejection", async () => {
      // Given: Setup handler for rejection flow
      let approvalReceived = false;

      setDefaultHandler((ws) => {
        ws.onClientMessage((rawData) => {
          let data: any;
          try {
            data = JSON.parse(rawData);
            if (data.type === "ping") return;
          } catch {
            return;
          }

          // Check for approval response (state changes to "approval-responded" after addToolApprovalResponse)
          const hasApprovalResponse = data.messages?.some((msg: any) =>
            msg.parts?.some((p: any) => p.state === "approval-responded"),
          );

          if (hasApprovalResponse) {
            // User responded (approved or denied), send acknowledgment
            const textId = `text-${Date.now()}`;
            ws.sendTextStart(textId);
            ws.sendTextDelta(textId, "Understood. Location access was denied.");
            ws.sendTextEnd(textId);
            ws.simulateDone();
            return;
          }

          if (!approvalReceived) {
            approvalReceived = true;
            // Send approval request
            ws.sendToolWithApproval(
              "tool-location-deny",
              "get_location",
              {},
              "tool-location-deny",
            );
            ws.simulateDone();
          }
        });
      });

      const { result } = renderHook(() =>
        useChat(buildBidiOptions({ initialMessages: [] }).useChatOptions),
      );

      // When: User triggers approval tool
      await act(async () => {
        result.current.sendMessage({ text: "Get my location" });
      });

      // Wait for approval request
      await waitFor(
        () => {
          const lastMessage =
            result.current.messages[result.current.messages.length - 1];
          const approvalPart = lastMessage?.parts.find((p: any) =>
            isApprovalRequestedTool(p),
          );
          expect(approvalPart).toBeDefined();
        },
        { timeout: 3000 },
      );

      // When: User denies
      await act(async () => {
        const lastMessage =
          result.current.messages[result.current.messages.length - 1];
        const approvalPart = lastMessage?.parts.find((p: any) =>
          isApprovalRequestedTool(p),
        ) as any;

        result.current.addToolApprovalResponse({
          id: approvalPart.approval.id, // ← Use approval.id, NOT toolCallId!
          approved: false,
          reason: "User denied",
        });
      });

      // Then: Should receive denial acknowledgment
      await waitFor(
        () => {
          const lastMessage =
            result.current.messages[result.current.messages.length - 1];
          const text = getMessageText(lastMessage);
          expect(text).toContain("denied");
        },
        { timeout: 3000 },
      );
    });

    it("should handle approval timeout", async () => {
      // Given: Setup handler that never responds to approval
      setDefaultHandler((ws) => {
        ws.onClientMessage((rawData) => {
          let data: any;
          try {
            data = JSON.parse(rawData);
            if (data.type === "ping") return;
          } catch {
            return;
          }

          // Send approval request but never respond
          ws.sendToolWithApproval(
            "tool-timeout-1",
            "slow_tool",
            {},
            "tool-timeout-1",
          );
          ws.simulateDone();
          // Don't send any more responses - simulate timeout
        });
      });

      const { result } = renderHook(() =>
        useChat(buildBidiOptions({ initialMessages: [] }).useChatOptions),
      );

      // When: User triggers approval tool
      await act(async () => {
        result.current.sendMessage({ text: "Run slow tool" });
      });

      // Then: Should be in approval-requested state
      await waitFor(
        () => {
          const lastMessage =
            result.current.messages[result.current.messages.length - 1];
          const approvalPart = lastMessage?.parts.find((p: any) =>
            isApprovalRequestedTool(p),
          );
          expect(approvalPart).toBeDefined();
        },
        { timeout: 3000 },
      );

      // Approval remains pending (no timeout handling in this test)
      const lastMessage =
        result.current.messages[result.current.messages.length - 1];
      const approvalPart = lastMessage?.parts.find((p: any) =>
        isApprovalRequestedTool(p),
      );
      expect((approvalPart as any).state).toBe("approval-requested");
    });

    it("should handle multiple pending approvals", async () => {
      // Given: Setup handler that sends multiple approval requests
      setDefaultHandler((ws) => {
        ws.onClientMessage((rawData) => {
          let data: any;
          try {
            data = JSON.parse(rawData);
            if (data.type === "ping") return;
          } catch {
            return;
          }

          // Send two approval requests (first with done: false to avoid premature [DONE])
          ws.sendToolWithApproval(
            "tool-multi-1",
            "approval_tool_1",
            { index: 1 },
            "tool-multi-1",
            { done: false },
          );
          // Second one will call simulateDone() by default
          ws.sendToolWithApproval(
            "tool-multi-2",
            "approval_tool_2",
            { index: 2 },
            "tool-multi-2",
          );
        });
      });

      const { result } = renderHook(() =>
        useChat(buildBidiOptions({ initialMessages: [] }).useChatOptions),
      );

      // When: User triggers multiple approval tools
      await act(async () => {
        result.current.sendMessage({ text: "Run multiple tools" });
      });

      // Then: Should have multiple approval-requested parts
      await waitFor(
        () => {
          const lastMessage =
            result.current.messages[result.current.messages.length - 1];
          const approvalParts =
            lastMessage?.parts.filter((p: any) => isApprovalRequestedTool(p)) ||
            [];
          expect(approvalParts.length).toBe(2);
        },
        { timeout: 3000 },
      );
    });
  });

  describe("Frontend Delegate Tools", () => {
    it("should execute change_bgm tool client-side", async () => {
      // Given: Setup handler for frontend delegate tool
      let toolSent = false;
      let toolResultReceived = false;

      setDefaultHandler((ws) => {
        ws.onClientMessage((rawData) => {
          let data: any;
          try {
            data = JSON.parse(rawData);
            if (data.type === "ping") return;
          } catch {
            return;
          }

          // Check for tool result
          const hasToolOutput = data.messages?.some((msg: any) =>
            msg.parts?.some((p: any) => p.output !== undefined),
          );

          if (hasToolOutput && !toolResultReceived) {
            toolResultReceived = true;
            const textId = `text-${Date.now()}`;
            ws.sendTextStart(textId);
            ws.sendTextDelta(textId, "BGM changed successfully!");
            ws.sendTextEnd(textId);
            ws.simulateDone();
            return;
          }

          // Send tool request only once (first message from user)
          if (toolSent) return;
          toolSent = true;

          const toolCallId = "tool-bgm-1";
          ws.simulateServerMessage({
            type: "tool-input-start",
            toolCallId,
            toolName: "change_bgm",
          });
          ws.simulateServerMessage({
            type: "tool-input-available",
            toolCallId,
            toolName: "change_bgm",
            input: { track: "relaxing_music.mp3" },
          });
          ws.simulateDone();
        });
      });

      const { result } = renderHook(() =>
        useChat(buildBidiOptions({ initialMessages: [] }).useChatOptions),
      );

      // When: User requests BGM change
      await act(async () => {
        result.current.sendMessage({ text: "Play relaxing music" });
      });

      // Wait for tool invocation
      await waitFor(
        () => {
          const lastMessage =
            result.current.messages[result.current.messages.length - 1];
          const toolParts = findToolParts(lastMessage);
          // AI SDK v6: Tool type is "tool-<name>", so check type contains tool name
          expect(toolParts.some((p: any) => p.type === "tool-change_bgm")).toBe(
            true,
          );
        },
        { timeout: 3000 },
      );

      // Simulate frontend executing and sending result
      await act(async () => {
        result.current.addToolOutput({
          toolCallId: "tool-bgm-1",
          output: { success: true, track: "relaxing_music.mp3" },
        });
      });

      // Then: Should receive confirmation
      await waitFor(
        () => {
          const lastMessage =
            result.current.messages[result.current.messages.length - 1];
          const text = getMessageText(lastMessage);
          expect(text).toContain("BGM");
        },
        { timeout: 3000 },
      );
    });

    it("should handle frontend tool execution errors", async () => {
      // Given: Setup handler for frontend tool error
      let toolSent = false;
      let errorHandled = false;

      setDefaultHandler((ws) => {
        ws.onClientMessage((rawData) => {
          let data: any;
          try {
            data = JSON.parse(rawData);
            if (data.type === "ping") return;
          } catch {
            return;
          }

          // Check for error in tool output
          const hasError = data.messages?.some((msg: any) =>
            msg.parts?.some((p: any) => p.output?.error),
          );

          if (hasError && !errorHandled) {
            errorHandled = true;
            const textId = `text-${Date.now()}`;
            ws.sendTextStart(textId);
            ws.sendTextDelta(
              textId,
              "Sorry, I couldn't change the BGM due to an error.",
            );
            ws.sendTextEnd(textId);
            ws.simulateDone();
            return;
          }

          // Send tool request only once
          if (toolSent) return;
          toolSent = true;

          const toolCallId = "tool-bgm-error";
          ws.simulateServerMessage({
            type: "tool-input-start",
            toolCallId,
            toolName: "change_bgm",
          });
          ws.simulateServerMessage({
            type: "tool-input-available",
            toolCallId,
            toolName: "change_bgm",
            input: { track: "invalid.mp3" },
          });
          ws.simulateDone();
        });
      });

      const { result } = renderHook(() =>
        useChat(buildBidiOptions({ initialMessages: [] }).useChatOptions),
      );

      // When: User requests BGM change
      await act(async () => {
        result.current.sendMessage({ text: "Play invalid track" });
      });

      // Wait for tool invocation
      await waitFor(
        () => {
          const lastMessage =
            result.current.messages[result.current.messages.length - 1];
          const toolParts = findToolParts(lastMessage);
          expect(toolParts.length).toBeGreaterThan(0);
        },
        { timeout: 3000 },
      );

      // Simulate frontend error
      await act(async () => {
        result.current.addToolOutput({
          toolCallId: "tool-bgm-error",
          output: { error: "File not found" },
        });
      });

      // Then: Should receive error handling response
      await waitFor(
        () => {
          const lastMessage =
            result.current.messages[result.current.messages.length - 1];
          const text = getMessageText(lastMessage);
          expect(text.toLowerCase()).toContain("error");
        },
        { timeout: 3000 },
      );
    });
  });

  describe("Complex Tool Scenarios", () => {
    it("should handle mixed auto and approval tools", async () => {
      // Given: Setup handler with mixed tool types
      let phase = 0;

      setDefaultHandler((ws) => {
        ws.onClientMessage((rawData) => {
          let data: any;
          try {
            data = JSON.parse(rawData);
            if (data.type === "ping") return;
          } catch {
            return;
          }

          phase++;

          if (phase === 1) {
            // Send auto-execute tool
            ws.simulateServerMessage({
              type: "tool-input-start",
              toolCallId: "auto-1",
              toolName: "get_weather",
            });
            ws.simulateServerMessage({
              type: "tool-input-available",
              toolCallId: "auto-1",
              toolName: "get_weather",
              input: { location: "Tokyo" },
            });
            ws.simulateServerMessage({
              type: "tool-output-available",
              toolCallId: "auto-1",
              toolName: "get_weather",
              output: { temp: 25 },
            });

            // Send approval-required tool
            ws.sendToolWithApproval(
              "approval-1",
              "get_location",
              {},
              "approval-1",
            );

            ws.simulateDone();
          }
        });
      });

      const { result } = renderHook(() =>
        useChat(buildBidiOptions({ initialMessages: [] }).useChatOptions),
      );

      // When: User sends message
      await act(async () => {
        result.current.sendMessage({
          text: "Get weather and location",
        });
      });

      // Then: Should have both tool types
      await waitFor(
        () => {
          const lastMessage =
            result.current.messages[result.current.messages.length - 1];
          const toolParts = findToolParts(lastMessage);

          // Has auto-executed tool (with output)
          const autoTool = toolParts.find(
            (p: any) => p.type === "tool-get_weather",
          );
          expect(autoTool).toBeDefined();

          // Has approval-requested tool
          const approvalTool = toolParts.find((p: any) =>
            isApprovalRequestedTool(p),
          );
          expect(approvalTool).toBeDefined();
        },
        { timeout: 3000 },
      );
    });

    it("should handle tool calls with large payloads", async () => {
      // Given: Setup handler with large data
      const largeData = Array(100)
        .fill(null)
        .map((_, i) => ({
          id: i,
          name: `Item ${i}`,
          data: "x".repeat(100),
        }));
      let toolSent = false;

      setDefaultHandler((ws) => {
        ws.onClientMessage((rawData) => {
          let data: any;
          try {
            data = JSON.parse(rawData);
            if (data.type === "ping") return;
          } catch {
            return;
          }

          // Only send tool once (first message from user)
          if (toolSent) return;
          toolSent = true;

          ws.simulateServerMessage({
            type: "tool-input-start",
            toolCallId: "large-1",
            toolName: "process_data",
          });
          ws.simulateServerMessage({
            type: "tool-input-available",
            toolCallId: "large-1",
            toolName: "process_data",
            input: { data: largeData },
          });
          ws.simulateServerMessage({
            type: "tool-output-available",
            toolCallId: "large-1",
            toolName: "process_data",
            output: { processed: largeData.length, status: "success" },
          });
          ws.simulateDone();
        });
      });

      const { result } = renderHook(() =>
        useChat(buildBidiOptions({ initialMessages: [] }).useChatOptions),
      );

      // When: User sends message
      await act(async () => {
        result.current.sendMessage({ text: "Process large data" });
      });

      // Then: Should handle large payload
      await waitFor(
        () => {
          const lastMessage =
            result.current.messages[result.current.messages.length - 1];
          const toolParts = findToolParts(lastMessage);
          const processDataTool = toolParts.find(
            (p: any) => p.type === "tool-process_data",
          );

          expect(processDataTool).toBeDefined();
          expect((processDataTool as any).input.data.length).toBe(100);
        },
        { timeout: 5000 },
      );
    });
  });
});
