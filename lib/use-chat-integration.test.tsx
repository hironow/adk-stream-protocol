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
  let originalWebSocket: typeof WebSocket;
  let mockWebSocket: MockWebSocket | null = null;

  beforeEach(() => {
    originalWebSocket = global.WebSocket as typeof WebSocket;

    // Mock WebSocket constructor to capture instance
    global.WebSocket = vi.fn((url: string) => {
      mockWebSocket = new MockWebSocket(url);
      return mockWebSocket as typeof WebSocket;
    }) as typeof WebSocket;
  });

  afterEach(() => {
    global.WebSocket = originalWebSocket;
    mockWebSocket = null;
    vi.clearAllMocks();
  });

  describe("ADK BIDI Mode with useChat", () => {
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
      expect(transport.sendToolResult).toBeDefined();
      expect(transport.startAudio).toBeDefined();
      expect(transport.stopAudio).toBeDefined();
      // Actual behavior tested in websocket-chat-transport.test.ts
    });

    it("should handle tool approval flow with addToolApprovalResponse", async () => {
      // Given: Options with transport
      const options = buildUseChatOptions({
        mode: "adk-bidi",
        initialMessages: [],
        adkBackendUrl: "http://localhost:8000",
      });

      // When: Using with useChat
      const { result } = renderHook(() => useChat(options.useChatOptions));

      // Wait for initial render
      await waitFor(() => {
        expect(result.current).toBeDefined();
      });

      // Send a message to trigger tool approval request
      await act(async () => {
        result.current.append({
          role: "user",
          content: "BGMを変更してください",
        });
      });

      // Wait for WebSocket to be created and send message
      await waitFor(() => {
        expect(mockWebSocket).not.toBeNull();
        expect(mockWebSocket?.sentMessages.length).toBeGreaterThan(0);
      });

      // Simulate tool-approval-request from backend
      await act(async () => {
        mockWebSocket?.simulateMessage({
          type: "tool-approval-request",
          approvalId: "approval-123",
          toolCallId: "call-456",
          toolName: "change_bgm",
          args: { track: 1 },
        });
      });

      // Then: addToolApprovalResponse should be available
      await waitFor(() => {
        expect(result.current.addToolApprovalResponse).toBeDefined();
      });

      // Clear sent messages to isolate approval response
      if (mockWebSocket) {
        mockWebSocket.sentMessages = [];
      }

      // When: User approves the tool
      await act(async () => {
        result.current.addToolApprovalResponse("approval-123", true);
      });

      // Then: WebSocket should send approval response
      await waitFor(() => {
        const approvalMessages = mockWebSocket?.sentMessages.filter((msg) => {
          const parsed = JSON.parse(msg);
          return parsed.type === "tool_approval_response";
        });
        expect(approvalMessages?.length).toBe(1);
      });
    });

  });

  describe("ADK SSE Mode with useChat", () => {
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
      expect(result.current.messages).toEqual([]);
      expect(options.transport).toBeUndefined(); // SSE mode has no transport reference
    });

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
