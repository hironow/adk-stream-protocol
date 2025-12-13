/**
 * useChat Integration Tests
 *
 * Tests that buildUseChatOptions creates valid configuration compatible with AI SDK v6's useChat.
 * This is a compatibility test - we verify our options work with useChat without errors.
 *
 * Components under test (3-way integration):
 * 1. buildUseChatOptions (our code)
 * 2. WebSocketChatTransport / DefaultChatTransport (our code)
 * 3. useChat from AI SDK v6 (external library - not our code)
 *
 * Focus:
 * - Verify buildUseChatOptions output is accepted by useChat API
 * - Verify transport reference is accessible for imperative control
 * - Verify options structure matches useChat expectations
 *
 * Note: We test the configuration and transport reference, not useChat's internal behavior.
 * WebSocket lifecycle is tested in websocket-chat-transport.test.ts.
 *
 * @vitest-environment jsdom
 */

import { useChat } from "@ai-sdk/react";
import { act, renderHook } from "@testing-library/react";
import type { UIMessage } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildUseChatOptions } from "./build-use-chat-options";
import { WebSocketChatTransport } from "./websocket-chat-transport";

// Mock WebSocket for transport testing
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;

  sentMessages: string[] = [];
  url: string;

  constructor(url: string) {
    this.url = url;
    // Simulate connection opening
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      if (this.onopen) {
        this.onopen(new Event("open"));
      }
    }, 0);
  }

  send(data: string): void {
    this.sentMessages.push(data);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose(new CloseEvent("close"));
    }
  }

  // Helper: Simulate receiving SSE message from server
  simulateMessage(data: Record<string, unknown>): void {
    if (this.onmessage) {
      const sseMessage = "data: " + JSON.stringify(data);
      this.onmessage(
        new MessageEvent("message", {
          data: sseMessage,
        }),
      );
    }
  }
}

describe("useChat Integration", () => {
  describe("ADK BIDI Mode with useChat", () => {
    let originalWebSocket: typeof WebSocket;

    // Setup WebSocket mock for BIDI tests only
    beforeEach(() => {
      originalWebSocket = global.WebSocket as typeof WebSocket;
      // Replace with mock (same pattern as websocket-chat-transport.test.ts)
      global.WebSocket = MockWebSocket as any;
    });

    afterEach(() => {
      global.WebSocket = originalWebSocket;
      vi.clearAllMocks();
    });
    it("should accept buildUseChatOptions configuration for ADK BIDI mode", async () => {
      // Given: Build options for ADK BIDI mode
      const options = buildUseChatOptions({
        mode: "adk-bidi",
        initialMessages: [],
        adkBackendUrl: "http://localhost:8000",
      });

      // When: Using with useChat hook
      const { result } = renderHook(() => useChat(options.useChatOptions));

      // Then: useChat should accept our configuration without errors
      expect(result.current.messages).toBeDefined();
      expect(options.transport).toBeDefined();
      expect(options.transport).toBeInstanceOf(WebSocketChatTransport);
    });

    it("should expose transport reference for imperative control", async () => {
      // Given: Options with transport reference
      const options = buildUseChatOptions({
        mode: "adk-bidi",
        initialMessages: [],
        adkBackendUrl: "http://localhost:8000",
      });

      const transport = options.transport!;

      // When: Using with useChat
      const { result } = renderHook(() => useChat(options.useChatOptions));

      // Then: Transport reference should be available for imperative control
      expect(result.current.messages).toBeDefined();
      expect(transport).toBeDefined();
      expect(transport.startAudio).toBeDefined();
      expect(transport.stopAudio).toBeDefined();
      // Note: sendToolResult() removed - use addToolApprovalResponse() instead
      // Actual behavior tested in websocket-chat-transport.test.ts
    });

    // Note: Tool approval is handled natively by AI SDK v6's addToolApprovalResponse
    // The tool-approval-request events flow through UIMessageChunk stream to useChat
    // See websocket-chat-transport.ts:handleCustomEventsWithSkip for implementation details

    it("should verify AI SDK v6 calls transport.sendMessages() on user message (ADK BIDI)", async () => {
      // Given: ADK BIDI mode
      const options = buildUseChatOptions({
        mode: "adk-bidi",
        initialMessages: [],
        adkBackendUrl: "http://localhost:8000",
      });

      const transport = options.transport!;
      const sendMessagesSpy = vi.spyOn(transport, "sendMessages");

      // When: Using with useChat and sending a message
      const { result } = renderHook(() => useChat(options.useChatOptions));

      // Simulate user sending a message (Step 1)
      // Note: Don't await sendMessage - it only resolves after the entire stream completes
      await act(async () => {
        result.current.sendMessage({ text: "Test message" });
      });

      // Then: AI SDK v6 should have called transport.sendMessages() (Step 2)
      await vi.waitFor(() => {
        expect(sendMessagesSpy).toHaveBeenCalled();
      });

      // Verify the call includes the user message
      const calls = sendMessagesSpy.mock.calls;
      const lastCall = calls[calls.length - 1];
      expect(lastCall[0].messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            parts: expect.arrayContaining([
              expect.objectContaining({
                type: "text",
                text: "Test message",
              }),
            ]),
          }),
        ]),
      );

      // Note: WebSocket functionality is tested in websocket-chat-transport.test.ts
      // This test verifies the integration: useChat → transport.sendMessages() → protocol conversion
    }, 10000); // Increased timeout for WebSocket connection

    it("should verify AI SDK v6 calls transport.sendMessages() on tool approval (ADK BIDI)", async () => {
      // Given: ADK BIDI mode with SINGLE tool waiting for approval
      // Note: This test uses approved=true (see also: single-tool test with approved=false)
      const initialMessages: UIMessage[] = [
        {
          id: "msg-1",
          role: "user" as const,
          parts: [
            {
              type: "text" as const,
              text: "Search for latest AI news",
            },
          ],
        },
        {
          id: "msg-2",
          role: "assistant" as const,
          parts: [
            {
              type: "tool-use" as const,
              toolCallId: "call-1",
              toolName: "web_search",
              args: { query: "latest AI news" },
              state: "approval-requested" as const,
              approval: {
                id: "approval-1",
                approved: undefined,
                reason: undefined,
              },
            },
          ],
        },
      ];

      const options = buildUseChatOptions({
        mode: "adk-bidi",
        initialMessages,
        adkBackendUrl: "http://localhost:8000",
      });

      const transport = options.transport!;
      const sendMessagesSpy = vi.spyOn(transport, "sendMessages");

      // When: Using with useChat and approving the tool
      const { result } = renderHook(() => useChat(options.useChatOptions));

      // Simulate user approving the tool (Step 6)
      await act(async () => {
        result.current.addToolApprovalResponse({
          id: "approval-1",
          approved: true,
          reason: "User approved",
        });
      });

      // Then: Auto-submit happens IMMEDIATELY after addToolApprovalResponse
      // Reason: This is a SINGLE tool scenario
      //   - Condition 1: Has approval-responded ✅
      //   - Condition 2: All tools complete ✅ (only 1 tool, now in approval-responded state)
      // Note: approved=false would also trigger immediate auto-submit (see single-tool test)
      // The key is NOT the approved value, but that ALL tools are now complete
      await vi.waitFor(() => {
        expect(sendMessagesSpy).toHaveBeenCalled();
      });

      // Verify the call includes the approved message
      const calls = sendMessagesSpy.mock.calls;
      const lastCall = calls[calls.length - 1];
      const lastMessage = lastCall[0].messages[lastCall[0].messages.length - 1];

      // Check that the last message contains the approved tool part
      expect(lastMessage.parts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "tool-use",
            toolCallId: "call-1",
            state: "approval-responded",
            approval: expect.objectContaining({
              id: "approval-1",
              approved: true,
              reason: "User approved",
            }),
          }),
        ]),
      );

      // Note: This verifies single-tool approval flow (approved=true):
      // - addToolApprovalResponse({ approved: true })
      //   → state becomes "approval-responded"
      //   → All tools complete (only 1 tool exists)
      //   → Auto-submit triggered
      //   → Backend receives approval-responded state with approved=true
      //
      // IMPORTANT: This is SINGLE tool behavior. In MULTIPLE tool scenarios,
      // auto-submit would wait until ALL tools are complete (see mixed test).
      // The approved value (true/false) does NOT affect auto-submit timing.
    }, 10000); // Increased timeout for WebSocket connection

    it("should verify addToolOutput updates message state but does NOT auto-submit (ADK BIDI)", async () => {
      // Given: ADK BIDI mode with initial message containing tool call waiting for output
      const initialMessages: UIMessage[] = [
        {
          id: "msg-1",
          role: "user" as const,
          parts: [
            {
              type: "text" as const,
              text: "Search for AI news",
            },
          ],
        },
        {
          id: "msg-2",
          role: "assistant" as const,
          parts: [
            {
              type: "tool-web_search" as const,
              toolCallId: "call-1",
              toolName: "web_search",
              args: { query: "AI news" },
              state: "call" as const, // Tool called but waiting for output
            },
          ],
        },
      ];

      const options = buildUseChatOptions({
        mode: "adk-bidi",
        initialMessages,
        adkBackendUrl: "http://localhost:8000",
      });

      const transport = options.transport!;
      const sendMessagesSpy = vi.spyOn(transport, "sendMessages");

      // When: Using with useChat and adding tool output
      const { result } = renderHook(() => useChat(options.useChatOptions));

      await act(async () => {
        result.current.addToolOutput({
          toolCallId: "call-1",
          tool: "web_search",
          output: { results: ["AI news 1", "AI news 2"] },
        });
      });

      // Wait a bit to ensure no automatic submission happens
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Then: Message state should be updated
      const messages = result.current.messages;
      const assistantMessage = messages.find((m) => m.role === "assistant");
      const toolPart = assistantMessage?.parts?.find(
        (p: any) => p.toolCallId === "call-1",
      );

      expect(toolPart).toBeDefined();
      expect((toolPart as any)?.state).toBe("output-available");
      expect((toolPart as any)?.output).toEqual({
        results: ["AI news 1", "AI news 2"],
      });

      // But: sendMessages should NOT be called automatically
      // Current sendAutomaticallyWhen (lastAssistantMessageIsCompleteWithApprovalResponses)
      // only triggers on approval-responded, not on output-available
      expect(sendMessagesSpy).not.toHaveBeenCalled();

      // Note: This verifies current behavior:
      // - addToolOutput updates message state to "output-available"
      // - But does NOT trigger automatic resubmission
      // - This is because sendAutomaticallyWhen is configured for approval flow only
      // - For tool output without approval, user must manually call submit() or append()
    }, 10000); // Increased timeout for WebSocket connection

    it("should verify mixed approval + output triggers auto-submit (ADK BIDI)", async () => {
      // Given: ADK BIDI mode with two tools - one needs approval, one needs output
      const initialMessages: UIMessage[] = [
        {
          id: "msg-1",
          role: "user" as const,
          parts: [
            {
              type: "text" as const,
              text: "Search and analyze",
            },
          ],
        },
        {
          id: "msg-2",
          role: "assistant" as const,
          parts: [
            {
              type: "tool-web_search" as const,
              toolCallId: "call-1",
              toolName: "web_search",
              args: { query: "AI news" },
              state: "approval-requested" as const,
              approval: {
                id: "approval-1",
                approved: undefined,
                reason: undefined,
              },
            },
            {
              type: "tool-data_analyzer" as const,
              toolCallId: "call-2",
              toolName: "data_analyzer",
              args: { data: "sample" },
              state: "call" as const, // Waiting for output
            },
          ],
        },
      ];

      const options = buildUseChatOptions({
        mode: "adk-bidi",
        initialMessages,
        adkBackendUrl: "http://localhost:8000",
      });

      const transport = options.transport!;
      const sendMessagesSpy = vi.spyOn(transport, "sendMessages");

      // When: Using with useChat
      const { result } = renderHook(() => useChat(options.useChatOptions));

      // First: Approve tool-1
      await act(async () => {
        result.current.addToolApprovalResponse({
          id: "approval-1",
          approved: true,
          reason: "User approved",
        });
      });

      // Wait a bit - should NOT auto-submit yet (only condition 1 satisfied)
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(sendMessagesSpy).not.toHaveBeenCalled();

      // Second: Provide output for tool-2
      await act(async () => {
        result.current.addToolOutput({
          toolCallId: "call-2",
          tool: "data_analyzer",
          output: { result: "analyzed" },
        });
      });

      // Then: NOW both conditions satisfied → auto-submit should happen
      // Condition 1: Has approval-responded (call-1)
      // Condition 2: All tools complete (call-1: approval-responded, call-2: output-available)
      await vi.waitFor(() => {
        expect(sendMessagesSpy).toHaveBeenCalled();
      });

      // Verify the call includes both completed tools
      const calls = sendMessagesSpy.mock.calls;
      const lastCall = calls[calls.length - 1];
      const lastMessage = lastCall[0].messages[lastCall[0].messages.length - 1];

      expect(lastMessage.parts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "tool-web_search",
            toolCallId: "call-1",
            state: "approval-responded",
          }),
          expect.objectContaining({
            type: "tool-data_analyzer",
            toolCallId: "call-2",
            state: "output-available",
          }),
        ]),
      );

      // Note: This verifies the combined condition:
      // - Condition 1: At least one approval-responded exists (call-1)
      // - Condition 2: All tools are complete (both call-1 and call-2)
      // - Result: Automatic resubmission triggered
    }, 10000); // Increased timeout for WebSocket connection

    it("should verify multiple-tool rejection does NOT auto-submit until all tools complete (ADK BIDI)", async () => {
      // Given: ADK BIDI mode with MULTIPLE tools - one needs approval, one needs output
      // Note: This test uses approved=false to verify rejection in multi-tool scenario
      const initialMessages: UIMessage[] = [
        {
          id: "msg-1",
          role: "user" as const,
          parts: [
            {
              type: "text" as const,
              text: "Search and change BGM",
            },
          ],
        },
        {
          id: "msg-2",
          role: "assistant" as const,
          parts: [
            {
              type: "tool-web_search" as const,
              toolCallId: "call-1",
              toolName: "web_search",
              args: { query: "AI news" },
              state: "approval-requested" as const,
              approval: {
                id: "approval-1",
                approved: undefined,
                reason: undefined,
              },
            },
            {
              type: "tool-change_bgm" as const,
              toolCallId: "call-2",
              toolName: "change_bgm",
              args: { track_name: "lofi" },
              state: "call" as const, // Waiting for output
            },
          ],
        },
      ];

      const options = buildUseChatOptions({
        mode: "adk-bidi",
        initialMessages,
        adkBackendUrl: "http://localhost:8000",
      });

      const transport = options.transport!;
      const sendMessagesSpy = vi.spyOn(transport, "sendMessages");

      // When: Using with useChat
      const { result } = renderHook(() => useChat(options.useChatOptions));

      // Step 1: Reject tool-1
      await act(async () => {
        result.current.addToolApprovalResponse({
          id: "approval-1",
          approved: false,
          reason: "User denied permission",
        });
      });

      // Wait a bit - should NOT auto-submit yet (Tool-2 still incomplete)
      await new Promise((resolve) => setTimeout(resolve, 100));

      // ✅ IMPORTANT: Auto-submit does NOT happen after rejection
      // Reason: This is a MULTIPLE tool scenario
      //   - Condition 1: Has approval-responded ✅ (call-1)
      //   - Condition 2: All tools complete ❌ (call-2 still in "call" state)
      // Note: approved=true would behave the same (see mixed approval test)
      // The key is that Tool-2 is still incomplete
      expect(sendMessagesSpy).not.toHaveBeenCalled();

      // Step 2: Provide output for tool-2
      await act(async () => {
        result.current.addToolOutput({
          toolCallId: "call-2",
          tool: "change_bgm",
          output: { success: true, track: "lofi" },
        });
      });

      // Then: NOW both conditions satisfied → auto-submit should happen
      // Condition 1: Has approval-responded (call-1 with approved=false)
      // Condition 2: All tools complete (call-1: approval-responded, call-2: output-available)
      await vi.waitFor(() => {
        expect(sendMessagesSpy).toHaveBeenCalled();
      });

      // Verify the combined message includes both rejection and output
      const calls = sendMessagesSpy.mock.calls;
      const lastCall = calls[calls.length - 1];
      const lastMessage = lastCall[0].messages[lastCall[0].messages.length - 1];

      expect(lastMessage.parts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "tool-web_search",
            toolCallId: "call-1",
            state: "approval-responded",
            approval: expect.objectContaining({
              id: "approval-1",
              approved: false,
              reason: "User denied permission",
            }),
          }),
          expect.objectContaining({
            type: "tool-change_bgm",
            toolCallId: "call-2",
            state: "output-available",
          }),
        ]),
      );

      // Note: This verifies multi-tool rejection flow:
      // - Step 1: addToolApprovalResponse({ approved: false }) on Tool-1
      //   → Tool-1 state becomes "approval-responded"
      //   → Tool-2 still in "call" state (incomplete)
      //   → Condition 2 fails → NO auto-submit
      //
      // - Step 2: addToolOutput on Tool-2
      //   → Tool-2 state becomes "output-available"
      //   → All tools now complete
      //   → Auto-submit triggered → sends BOTH results
      //
      // IMPORTANT: This proves that approved=false does NOT cause immediate
      // auto-submit in multi-tool scenarios. The behavior is identical to
      // approved=true (see mixed approval test). Only ALL tools being complete
      // triggers auto-submit.
    }, 10000); // Increased timeout for WebSocket connection

    it("should verify single-tool approval-response triggers immediate auto-submit (ADK BIDI)", async () => {
      // Given: ADK BIDI mode with SINGLE tool waiting for approval
      // Note: This test uses approved=false, but approved=true would behave identically
      const initialMessages: UIMessage[] = [
        {
          id: "msg-1",
          role: "user" as const,
          parts: [
            {
              type: "text" as const,
              text: "Change BGM to lofi",
            },
          ],
        },
        {
          id: "msg-2",
          role: "assistant" as const,
          parts: [
            {
              type: "tool-change_bgm" as const,
              toolCallId: "call-1",
              toolName: "change_bgm",
              args: { track_name: "lofi" },
              state: "approval-requested" as const,
              approval: {
                id: "approval-1",
                approved: undefined,
                reason: undefined,
              },
            },
          ],
        },
      ];

      const options = buildUseChatOptions({
        mode: "adk-bidi",
        initialMessages,
        adkBackendUrl: "http://localhost:8000",
      });

      const transport = options.transport!;
      const sendMessagesSpy = vi.spyOn(transport, "sendMessages");

      // When: Using with useChat and rejecting the tool
      const { result } = renderHook(() => useChat(options.useChatOptions));

      // Step 1: User rejects tool
      await act(async () => {
        result.current.addToolApprovalResponse({
          id: "approval-1",
          approved: false,
          reason: "User denied permission",
        });
      });

      // ✅ IMPORTANT: Auto-submit happens IMMEDIATELY after addToolApprovalResponse
      // Reason: This is a SINGLE tool scenario
      //   - Condition 1: Has approval-responded ✅
      //   - Condition 2: All tools complete ✅ (only 1 tool, now in approval-responded state)
      // Note: approved=true would also trigger immediate auto-submit (see first test)
      // The key is NOT the approved value, but that ALL tools are now complete
      await vi.waitFor(() => {
        expect(sendMessagesSpy).toHaveBeenCalledTimes(1);
      });

      // Verify the first call (after rejection, before addToolOutput)
      const firstCall = sendMessagesSpy.mock.calls[0];
      const firstMessage =
        firstCall[0].messages[firstCall[0].messages.length - 1];
      const firstToolPart = firstMessage.parts.find(
        (p: any) => p.toolCallId === "call-1",
      );

      expect(firstToolPart).toBeDefined();
      expect(firstToolPart).toMatchObject({
        type: "tool-change_bgm",
        toolCallId: "call-1",
        state: "approval-responded",
        approval: {
          id: "approval-1",
          approved: false,
          reason: "User denied permission",
        },
      });

      // Step 2: Optionally provide error output (simulating frontend's handleRejectTool behavior)
      // Note: This is optional because auto-submit already happened
      await act(async () => {
        result.current.addToolOutput({
          toolCallId: "call-1",
          tool: "change_bgm",
          state: "output-available",
          output: {
            success: false,
            error: "User denied permission",
            denied: true,
          },
        });
      });

      // Wait a bit to confirm no second auto-submit
      await new Promise((resolve) => setTimeout(resolve, 100));

      // ✅ Verify: addToolOutput does NOT trigger second auto-submit
      // Reason: status guard prevents duplicate submission
      //   - status is now "submitted" (from first auto-submit)
      //   - AI SDK v6 checks: status !== "submitted" → false → no submit
      expect(sendMessagesSpy).toHaveBeenCalledTimes(1);

      // Verify message state was updated (even though no new submit)
      const messages = result.current.messages;
      const assistantMessage = messages.find((m) => m.role === "assistant");
      const toolPart = assistantMessage?.parts?.find(
        (p: any) => p.toolCallId === "call-1",
      );

      expect(toolPart).toBeDefined();
      expect((toolPart as any)?.state).toBe("output-available");
      expect((toolPart as any)?.output).toEqual({
        success: false,
        error: "User denied permission",
        denied: true,
      });

      // Note: This verifies single-tool rejection flow:
      // - Step 1: addToolApprovalResponse({ approved: false })
      //   → state becomes "approval-responded"
      //   → All tools complete (only 1 tool exists)
      //   → Auto-submit triggered → status becomes "submitted"
      //   → Backend receives approval-responded state with approved=false
      //
      // - Step 2: addToolOutput({ output: { success: false } })
      //   → state becomes "output-available" (local update only)
      //   → Status guard prevents auto-submit (status === "submitted")
      //   → Backend does NOT receive this update
      //
      // IMPORTANT: This is SINGLE tool behavior. In MULTIPLE tool scenarios,
      // auto-submit would wait until ALL tools are complete (see mixed test).
      // The approved value (true/false) does NOT affect auto-submit timing.
    }, 10000); // Increased timeout for WebSocket connection

    it("should verify useChat receives and processes tool-approval-request from backend (ADK BIDI)", async () => {
      // Given: ADK BIDI mode
      const options = buildUseChatOptions({
        mode: "adk-bidi",
        initialMessages: [],
        adkBackendUrl: "http://localhost:8000",
      });

      const transport = options.transport!;

      // When: Using with useChat
      const { result } = renderHook(() => useChat(options.useChatOptions));

      // Send initial message to establish connection
      await act(async () => {
        result.current.sendMessage({ text: "Search for AI news" });
      });

      // Wait for WebSocket to be ready
      await vi.waitFor(() => {
        const ws = (transport as any).ws;
        expect(ws?.readyState).toBe(MockWebSocket.OPEN);
      });

      const ws = (transport as any).ws as MockWebSocket;

      // Then: Simulate backend sending tool-approval-request (Step 4)
      await act(async () => {
        // Step 4a: Backend sends tool-input-start
        ws.simulateMessage({
          type: "tool-input-start",
          toolCallId: "call-1",
          toolName: "web_search",
        });

        // Step 4b: Backend sends tool-input-available with args
        ws.simulateMessage({
          type: "tool-input-available",
          toolCallId: "call-1",
          toolName: "web_search",
          args: { query: "AI news" },
        });

        // Step 4c: Backend sends tool-approval-request
        ws.simulateMessage({
          type: "tool-approval-request",
          toolCallId: "call-1",
          approvalId: "approval-1",
        });
      });

      // Step 5: Verify useChat received and processed the events
      await vi.waitFor(
        () => {
          const messages = result.current.messages;
          expect(messages.length).toBeGreaterThan(1); // User message + assistant message

          // Find the assistant message
          const assistantMessage = messages.find((m) => m.role === "assistant");
          expect(assistantMessage).toBeDefined();
          expect(assistantMessage?.parts).toBeDefined();

          // Find the tool-use part with approval-requested state
          // Note: AI SDK v6 creates dynamic type name "tool-{toolName}"
          const toolPart = assistantMessage?.parts?.find(
            (p: any) => p.toolCallId === "call-1",
          );
          expect(toolPart).toBeDefined();
          expect((toolPart as any)?.type).toBe("tool-web_search"); // Dynamic type name
          expect((toolPart as any)?.state).toBe("approval-requested");
          expect((toolPart as any)?.approval?.id).toBe("approval-1");
        },
        { timeout: 5000 },
      );

      // Note: This verifies Step 4-5 integration:
      // Step 4: Backend sends tool-approval-request via WebSocket
      // Step 5: useChat receives event, updates message state with approval-requested
      // (UI rendering is not tested here - that's for E2E tests)
    }, 15000); // Increased timeout for WebSocket connection and event processing
  });

  describe("ADK SSE Mode with useChat", () => {
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      // Save original fetch
      originalFetch = global.fetch;
    });

    afterEach(() => {
      // Restore original fetch
      global.fetch = originalFetch;
    });

    it("should integrate buildUseChatOptions + DefaultChatTransport + useChat", async () => {
      // Given: Build options for ADK SSE mode
      const options = buildUseChatOptions({
        mode: "adk-sse",
        initialMessages: [],
        adkBackendUrl: "http://localhost:8000",
      });

      // When: Using with useChat hook
      const { result } = renderHook(() => useChat(options.useChatOptions));

      // Then: useChat should work with DefaultChatTransport
      expect(result.current).toBeDefined();
      expect(result.current.messages).toEqual([]);
      expect(options.transport).toBeUndefined(); // SSE mode has no transport reference
    });

    // TODO: Add integration test for Step 1-2 (user message → fetch)
    // Blocked by: Same as ADK BIDI - need to understand useChat API

    // TODO: Add integration test for Step 6-8 (tool approval → fetch)
    // Blocked by: Same as ADK BIDI - need approval flow setup
  });

  describe("Gemini Direct Mode with useChat", () => {
    it("should integrate buildUseChatOptions + DefaultChatTransport + useChat", async () => {
      // Given: Build options for Gemini Direct mode
      const options = buildUseChatOptions({
        mode: "gemini",
        initialMessages: [],
      });

      // When: Using with useChat hook
      const { result } = renderHook(() => useChat(options.useChatOptions));

      // Then: useChat should work with DefaultChatTransport
      expect(result.current.messages).toEqual([]);
      expect(options.transport).toBeUndefined(); // Gemini mode has no transport reference
    });
  });

  describe("useChat API Compatibility", () => {
    let originalWebSocket: typeof WebSocket;

    // Setup WebSocket mock for BIDI compatibility tests
    beforeEach(() => {
      originalWebSocket = global.WebSocket as typeof WebSocket;
      global.WebSocket = MockWebSocket as any;
    });

    afterEach(() => {
      global.WebSocket = originalWebSocket;
      vi.clearAllMocks();
    });

    it("should accept configuration without errors for BIDI mode", async () => {
      // Given: Options for ADK BIDI mode
      const options = buildUseChatOptions({
        mode: "adk-bidi",
        initialMessages: [],
        adkBackendUrl: "http://localhost:8000",
      });

      // When: Using with useChat (should not throw)
      const { result } = renderHook(() => useChat(options.useChatOptions));

      // Then: useChat should accept configuration (hook initializes without error)
      expect(result.current).toBeDefined();
      // Note: useChat methods may not be immediately available due to React lifecycle
      // What matters is that our configuration is compatible with useChat API
    });

    it("should preserve initial messages in useChat", async () => {
      // Given: Options with initial messages
      const initialMessages: UIMessage[] = [
        {
          id: "msg-1",
          role: "user" as const,
          parts: [{ type: "text" as const, text: "Hello" }],
        },
        {
          id: "msg-2",
          role: "assistant" as const,
          parts: [{ type: "text" as const, text: "Hi there!" }],
        },
      ];

      const options = buildUseChatOptions({
        mode: "adk-bidi",
        initialMessages,
        adkBackendUrl: "http://localhost:8000",
      });

      // When: Using with useChat
      const { result } = renderHook(() => useChat(options.useChatOptions));

      // Then: Initial messages should be preserved
      expect(result.current.messages).toEqual(initialMessages);
    });

    it("should use correct chatId across modes", async () => {
      // Given: Options for different modes
      const bidiOptions = buildUseChatOptions({
        mode: "adk-bidi",
        initialMessages: [],
        adkBackendUrl: "http://localhost:8000",
      });

      const sseOptions = buildUseChatOptions({
        mode: "adk-sse",
        initialMessages: [],
        adkBackendUrl: "http://localhost:8000",
      });

      const geminiOptions = buildUseChatOptions({
        mode: "gemini",
        initialMessages: [],
      });

      // When: Using with useChat for each mode
      const bidiResult = renderHook(() => useChat(bidiOptions.useChatOptions));
      const sseResult = renderHook(() => useChat(sseOptions.useChatOptions));
      const geminiResult = renderHook(() =>
        useChat(geminiOptions.useChatOptions),
      );

      // Then: Each should have different chatId
      expect(bidiOptions.useChatOptions.id).toContain("adk-bidi");
      expect(sseOptions.useChatOptions.id).toContain("adk-sse");
      expect(geminiOptions.useChatOptions.id).toContain("gemini");

      // All should work without errors
      expect(bidiResult.result.current.messages).toBeDefined();
      expect(sseResult.result.current.messages).toBeDefined();
      expect(geminiResult.result.current.messages).toBeDefined();
    });
  });
});
