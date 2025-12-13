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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useChat } from "@ai-sdk/react";
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
        })
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
      const sendMessagesSpy = vi.spyOn(transport, 'sendMessages');

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
        ])
      );

      // Note: WebSocket functionality is tested in websocket-chat-transport.test.ts
      // This test verifies the integration: useChat → transport.sendMessages() → protocol conversion
    }, 10000); // Increased timeout for WebSocket connection

    it("should verify AI SDK v6 calls transport.sendMessages() on tool approval (ADK BIDI)", async () => {
      // Given: ADK BIDI mode with initial message containing tool approval request
      const initialMessages = [
        {
          id: "msg-1",
          role: "user" as const,
          content: "Search for latest AI news",
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
      const sendMessagesSpy = vi.spyOn(transport, 'sendMessages');

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

      // Then: AI SDK v6 should have called transport.sendMessages() (Step 7-8)
      // sendAutomaticallyWhen triggers automatic resubmission after approval
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
        ])
      );

      // Note: This verifies Step 6-8 integration:
      // Step 6: User approves in UI (addToolApprovalResponse)
      // Step 7: AI SDK v6 checks sendAutomaticallyWhen → triggers makeRequest
      // Step 8: AI SDK v6 calls transport.sendMessages() with approved message
    }, 10000); // Increased timeout for WebSocket connection

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
      const initialMessages = [
        {
          id: "msg-1",
          role: "user" as const,
          content: "Hello",
        },
        {
          id: "msg-2",
          role: "assistant" as const,
          content: "Hi there!",
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
      const geminiResult = renderHook(() => useChat(geminiOptions.useChatOptions));

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
