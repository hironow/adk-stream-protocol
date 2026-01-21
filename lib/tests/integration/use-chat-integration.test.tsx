/**
 * useChat Integration Tests
 *
 * Tests that buildUseChatOptions creates valid configuration compatible with AI SDK v6's useChat.
 * This is a compatibility test - we verify our options work with useChat without errors.
 *
 * Components under test (3-way integration):
 * 1. buildUseChatOptions (our code)
 * 2. WebSocketChatTransport / DefaultChatTransportFromAISDKv6 (our code)
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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocketChatTransport } from "../../bidi/transport";
import { buildUseChatOptions } from "../../build-use-chat-options";
import type { UIMessageFromAISDKv6 } from "../../utils";

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
      const sseMessage = `data: ${JSON.stringify(data)}`;
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
      expect(transport.__startAudio).toBeDefined();
      expect(transport.__stopAudio).toBeDefined();
      // Note: sendToolResult() removed - use addToolApprovalResponse() instead
      // Actual behavior tested in websocket-chat-transport.test.ts
    });

    // Note: Tool approval is handled natively by AI SDK v6's addToolApprovalResponse
    // The tool-approval-request events flow through UIMessageChunkFromAISDKv6 stream to useChat
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

    // Integration Test: Verify sendAutomaticallyWhen logic for Server Execute pattern
    // Tests our code (sendAutomaticallyWhen function), not AI SDK v6 internal behavior
    // E2E tests verify the complete flow with real useChat hook
    it("should configure sendAutomaticallyWhen to return true when tool approval completed (Server Execute)", () => {
      // Given: buildUseChatOptions configured for ADK BIDI mode
      const options = buildUseChatOptions({
        mode: "adk-bidi",
        initialMessages: [],
        adkBackendUrl: "http://localhost:8000",
      });

      // AI SDK v6: State changes from "approval-requested" to "approval-responded"
      // when user calls addToolApprovalResponse() with correct approval.id

      // when: Tool waiting for approval
      const messagesWaiting: UIMessageFromAISDKv6[] = [
        {
          id: "msg-1",
          role: "user" as const,
          parts: [{ type: "text" as const, text: "Search for latest AI news" }],
        },
        {
          id: "msg-2",
          role: "assistant" as const,
          parts: [
            {
              type: "tool-web_search" as any,
              state: "approval-requested" as any, // User hasn't responded yet
              toolCallId: "orig-1",
              toolName: "web_search",
              input: { query: "latest AI news" },
              approval: {
                id: "approval-1",
              },
            },
          ],
        },
      ];

      const sendAutomaticallyWhen =
        options.useChatOptions.sendAutomaticallyWhen!;

      const firstCall = sendAutomaticallyWhen({
        messages: messagesWaiting,
      });
      expect(firstCall).toBe(false);

      // when: User approved (state changed to approval-responded)
      const messagesApproved: UIMessageFromAISDKv6[] = [
        {
          id: "msg-1",
          role: "user" as const,
          parts: [{ type: "text" as const, text: "Search for latest AI news" }],
        },
        {
          id: "msg-2",
          role: "assistant" as const,
          parts: [
            {
              type: "tool-web_search" as any,
              state: "approval-responded" as any, // ← State changed
              toolCallId: "orig-1",
              toolName: "web_search",
              input: { query: "latest AI news" },
              approval: {
                id: "approval-1",
                approved: true,
                reason: undefined,
              },
            },
          ],
        },
      ];

      const secondCall = sendAutomaticallyWhen({
        messages: messagesApproved,
      });
      expect(secondCall).toBe(true);

      // Verify the integration: buildUseChatOptions correctly configured sendAutomaticallyWhen
      // This tests our code (buildUseChatOptions + sendAutomaticallyWhen logic)
      // E2E tests verify the complete flow with real AI SDK useChat hook
    });

    it("should verify addToolOutput updates message state and auto-submits (Frontend Execute pattern)", async () => {
      // Given: ADK BIDI mode with initial message containing tool call waiting for output
      const initialMessages: UIMessageFromAISDKv6[] = [
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

      // Wait for async state updates and auto-submission
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

      // And: sendMessages SHOULD be called automatically (Frontend Execute pattern)
      // sendAutomaticallyWhen detects output-available with output → auto-sends to backend
      expect(sendMessagesSpy).toHaveBeenCalled();

      // Note: This verifies Frontend Execute pattern behavior:
      // - addToolOutput updates message state to "output-available"
      // - sendAutomaticallyWhen detects this and returns true
      // - AI SDK automatically calls sendMessages to send output to backend
    }, 10000); // Increased timeout for WebSocket connection

    // Integration Test: Verify sendAutomaticallyWhen logic for Frontend Execute pattern
    // Tests our code (sendAutomaticallyWhen function), not AI SDK v6 internal behavior
    // E2E tests verify the complete flow with real useChat hook
    it("should configure sendAutomaticallyWhen to return true for Frontend Execute pattern (tool output added)", () => {
      // Given: buildUseChatOptions configured for ADK BIDI mode
      const options = buildUseChatOptions({
        mode: "adk-bidi",
        initialMessages: [],
        adkBackendUrl: "http://localhost:8000",
      });

      const sendAutomaticallyWhen =
        options.useChatOptions.sendAutomaticallyWhen!;

      // Scenario 1: Approval completed - state changes from approval-requested to approval-responded
      // AI SDK v6: State changes when user calls addToolApprovalResponse() with correct approval.id

      const messagesWaiting: UIMessageFromAISDKv6[] = [
        {
          id: "msg-3",
          role: "user" as const,
          parts: [{ type: "text" as const, text: "Get my location" }],
        },
        {
          id: "msg-4",
          role: "assistant" as const,
          parts: [
            {
              type: "tool-get_location" as any,
              state: "approval-requested" as any, // User hasn't responded yet
              toolCallId: "orig-3",
              toolName: "get_location",
              input: {},
              approval: { id: "approval-3" },
            },
          ],
        },
      ];

      const firstCall = sendAutomaticallyWhen({
        messages: messagesWaiting,
      });
      expect(firstCall).toBe(false);

      const messagesApproved: UIMessageFromAISDKv6[] = [
        {
          id: "msg-3",
          role: "user" as const,
          parts: [{ type: "text" as const, text: "Get my location" }],
        },
        {
          id: "msg-4",
          role: "assistant" as const,
          parts: [
            {
              type: "tool-get_location" as any,
              state: "approval-responded" as any, // ← State changed
              toolCallId: "orig-3",
              toolName: "get_location",
              input: {},
              approval: {
                id: "approval-3",
                approved: true,
                reason: undefined,
              },
            },
          ],
        },
      ];

      const secondCall = sendAutomaticallyWhen({
        messages: messagesApproved,
      });
      // Frontend Execute tool (get_location) approved but no output yet
      // sendAutomaticallyWhen waits for addToolOutput() before sending
      // This is the correct behavior - don't send approval without output
      expect(secondCall).toBe(false);

      // Scenario 2: Frontend has added tool output, ready to send to backend
      // Note: When output is added via addToolOutput, the tool transitions to output-available
      // The approval tracking has completed (tool was approved via two-phase above)
      const messagesAfterOutputAdded: UIMessageFromAISDKv6[] = [
        {
          id: "msg-5",
          role: "user" as const,
          parts: [{ type: "text" as const, text: "Get my location" }],
        },
        {
          id: "msg-6",
          role: "assistant" as const,
          parts: [
            {
              type: "tool-get_location" as any,
              state: "output-available" as any, // Frontend executed and added output
              toolCallId: "orig-4",
              toolName: "get_location",
              output: { lat: 35.6762, lng: 139.6503 },
              // No approval object - approval cycle completed, now in output phase
            },
          ],
        },
      ];

      // When: Call sendAutomaticallyWhen after frontend added output
      // With output-available state, should detect it needs to send output to backend
      // This is Frontend Execute pattern - output must be sent to backend
      const shouldAutoSendAfterOutput = sendAutomaticallyWhen({
        messages: messagesAfterOutputAdded,
      });

      // Then: Frontend Execute pattern - returns true to auto-send output to backend
      // - Tool is in output-available state with output (frontend called addToolOutput)
      // - No text part yet (backend hasn't responded)
      // - No approval workflow (approval cycle completed earlier)
      // → Auto-send to backend so it can process the tool output
      expect(shouldAutoSendAfterOutput).toBe(true);

      // Verify the integration: buildUseChatOptions correctly configured sendAutomaticallyWhen
      // This tests our code (buildUseChatOptions + sendAutomaticallyWhen logic)
      // E2E tests verify the complete flow with real AI SDK useChat hook
    });

    // Integration Test: Verify sendAutomaticallyWhen logic for pending confirmations
    // Tests our code (sendAutomaticallyWhen function), not AI SDK v6 internal behavior
    // E2E tests verify the complete flow with real useChat hook
    it("should configure sendAutomaticallyWhen to return false when pending confirmations exist", () => {
      // Given: buildUseChatOptions configured for ADK BIDI mode
      const options = buildUseChatOptions({
        mode: "adk-bidi",
        initialMessages: [],
        adkBackendUrl: "http://localhost:8000",
      });

      const sendAutomaticallyWhen =
        options.useChatOptions.sendAutomaticallyWhen!;

      // Scenario: Pending confirmation exists (approval-requested)
      // Pattern: User needs to respond to confirmation before auto-submit
      const messagesWithPendingConfirmation: UIMessageFromAISDKv6[] = [
        {
          id: "msg-1",
          role: "user" as const,
          parts: [{ type: "text" as const, text: "Search and change BGM" }],
        },
        {
          id: "msg-2",
          role: "assistant" as const,
          parts: [
            {
              type: "tool-adk_request_confirmation" as any,
              state: "approval-requested" as any,
              toolCallId: "call-1",
              input: {
                originalFunctionCall: {
                  id: "orig-1",
                  name: "web_search",
                  args: { query: "AI news" },
                },
              },
            },
            {
              type: "tool-adk_request_confirmation" as any,
              state: "approval-requested" as any,
              toolCallId: "call-2",
              input: {
                originalFunctionCall: {
                  id: "orig-2",
                  name: "change_bgm",
                  args: { track_name: "lofi" },
                },
              },
            },
          ],
        },
      ];

      // When: Call sendAutomaticallyWhen with pending confirmations
      const shouldAutoSend = sendAutomaticallyWhen({
        messages: messagesWithPendingConfirmation,
      });

      // Then: Should return false (wait for user to approve/deny all confirmations)
      expect(shouldAutoSend).toBe(false);

      // Verify the integration: buildUseChatOptions correctly configured sendAutomaticallyWhen
      // This tests our code (buildUseChatOptions + sendAutomaticallyWhen logic)
      // E2E tests verify the complete flow with real AI SDK useChat hook
    });

    // Integration Test: Verify sendAutomaticallyWhen logic for tool denial
    // Tests our code (sendAutomaticallyWhen function), not AI SDK v6 internal behavior
    // E2E tests verify the complete flow with real useChat hook
    it("should configure sendAutomaticallyWhen to return true when tool denied (single tool)", () => {
      // Given: buildUseChatOptions configured for ADK BIDI mode
      const options = buildUseChatOptions({
        mode: "adk-bidi",
        initialMessages: [],
        adkBackendUrl: "http://localhost:8000",
      });

      const sendAutomaticallyWhen =
        options.useChatOptions.sendAutomaticallyWhen!;

      // AI SDK v6: Denial works same as approval - state changes from approval-requested to approval-responded
      // The actual approval/denial decision (approved: false) is included in the approval object

      // when: Tool waiting for approval
      const messagesWaiting: UIMessageFromAISDKv6[] = [
        {
          id: "msg-7",
          role: "user" as const,
          parts: [{ type: "text" as const, text: "Change BGM" }],
        },
        {
          id: "msg-8",
          role: "assistant" as const,
          parts: [
            {
              type: "tool-change_bgm" as any,
              state: "approval-requested" as any, // User hasn't responded yet
              toolCallId: "orig-5",
              toolName: "change_bgm",
              input: { track_name: "lofi" },
              approval: {
                id: "approval-5",
              },
            },
          ],
        },
      ];

      const firstCall = sendAutomaticallyWhen({
        messages: messagesWaiting,
      });
      expect(firstCall).toBe(false);

      // when: User denied (state changed to approval-responded with approved: false)
      const messagesDenied: UIMessageFromAISDKv6[] = [
        {
          id: "msg-7",
          role: "user" as const,
          parts: [{ type: "text" as const, text: "Change BGM" }],
        },
        {
          id: "msg-8",
          role: "assistant" as const,
          parts: [
            {
              type: "tool-change_bgm" as any,
              state: "approval-responded" as any, // ← State changed
              toolCallId: "orig-5",
              toolName: "change_bgm",
              input: { track_name: "lofi" },
              approval: {
                id: "approval-5",
                approved: false, // ← User denied
                reason: undefined,
              },
            },
          ],
        },
      ];

      const secondCall = sendAutomaticallyWhen({
        messages: messagesDenied,
      });
      expect(secondCall).toBe(true);

      // Verify the integration: buildUseChatOptions correctly configured sendAutomaticallyWhen
      // This tests our code (buildUseChatOptions + sendAutomaticallyWhen logic)
      // E2E tests verify the complete flow with real AI SDK useChat hook
    });

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

    it("should integrate buildUseChatOptions + DefaultChatTransportFromAISDKv6 + useChat", async () => {
      // Given: Build options for ADK SSE mode
      const options = buildUseChatOptions({
        mode: "adk-sse",
        initialMessages: [],
        adkBackendUrl: "http://localhost:8000",
      });

      // When: Using with useChat hook
      const { result } = renderHook(() => useChat(options.useChatOptions));

      // Then: useChat should work with DefaultChatTransportFromAISDKv6
      expect(result.current).toBeDefined();
      expect(result.current.messages).toEqual([]);
      expect(options.transport).toBeUndefined(); // SSE mode has no transport reference
    });
  });

  describe("Gemini Direct Mode with useChat", () => {
    it("should integrate buildUseChatOptions + DefaultChatTransportFromAISDKv6 + useChat", async () => {
      // Given: Build options for Gemini Direct mode
      const options = buildUseChatOptions({
        mode: "gemini",
        initialMessages: [],
      });

      // When: Using with useChat hook
      const { result } = renderHook(() => useChat(options.useChatOptions));

      // Then: useChat should work with DefaultChatTransportFromAISDKv6
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
      const initialMessages: UIMessageFromAISDKv6[] = [
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
