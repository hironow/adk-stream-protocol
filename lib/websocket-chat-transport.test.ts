/**
 * WebSocketChatTransport Unit Tests
 *
 * Tests the custom ChatTransport implementation for WebSocket bidirectional streaming.
 * Key focus: Tool approval flow integration with AI SDK v6 (addToolOutput, addToolApprovalResponse)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WebSocketChatTransport } from "./websocket-chat-transport";
import type { UIMessage } from "ai";

// Mock WebSocket
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

  constructor(public url: string) {
    // Simulate connection opening after creation
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

  // Test helper: Simulate receiving a message from server (SSE format)
  simulateMessage(data: any): void {
    if (this.onmessage) {
      // Backend sends SSE-formatted events (data: {...}\n\n)
      const sseMessage = `data: ${JSON.stringify(data)}`;
      this.onmessage(
        new MessageEvent("message", {
          data: sseMessage,
        })
      );
    }
  }

  // Test helper: Simulate connection error
  simulateError(): void {
    if (this.onerror) {
      this.onerror(new Event("error"));
    }
  }
}

describe("WebSocketChatTransport", () => {
  let originalWebSocket: typeof WebSocket;

  beforeEach(() => {
    // Store original WebSocket
    originalWebSocket = global.WebSocket as any;

    // Replace with mock
    global.WebSocket = MockWebSocket as any;
  });

  afterEach(() => {
    // Restore original WebSocket
    global.WebSocket = originalWebSocket;
    vi.clearAllMocks();
  });

  // Helper: Initialize transport and wait for WebSocket connection
  async function initializeTransport(
    config: ConstructorParameters<typeof WebSocketChatTransport>[0]
  ): Promise<{ transport: WebSocketChatTransport; ws: MockWebSocket }> {
    const transport = new WebSocketChatTransport(config);

    const messages: UIMessage[] = [
      {
        id: "msg-1",
        role: "user",
        content: "Hello",
      },
    ];

    // Start sending messages to initialize WebSocket
    transport.sendMessages({
      trigger: "submit-message",
      chatId: "chat-1",
      messageId: undefined,
      messages,
      abortSignal: new AbortController().signal,
    });

    // Wait for WebSocket to be created and opened
    await vi.waitFor(() => {
      expect(transport["ws"]?.readyState).toBe(MockWebSocket.OPEN);
    });

    const ws = transport["ws"] as unknown as MockWebSocket;
    return { transport, ws };
  }

  describe("Tool Approval Flow", () => {
    // Note: AI SDK v6 handles tool-approval-request natively via UIMessageChunk stream
    // The framework calls addToolApprovalResponse() when user approves/denies
    // No custom callback needed - events flow through to useChat

    it("should send tool_result event with correct format", async () => {
      // Given: Transport connected
      const { transport, ws } = await initializeTransport({
        url: "ws://localhost:8000/live",
      });

      // When: Frontend calls sendToolResult (simulating addToolOutput behavior)
      transport.sendToolResult("call-456", {
        success: true,
        message: "BGM changed",
      });

      // Then: WebSocket should send tool_result event
      const sentMessages = ws.sentMessages.filter((msg) => {
        const parsed = JSON.parse(msg);
        return parsed.type === "tool_result";
      });

      expect(sentMessages.length).toBe(1);
      const sentMessage = JSON.parse(sentMessages[0]);
      expect(sentMessage).toMatchObject({
        type: "tool_result",
        version: "1.0",
        data: {
          toolCallId: "call-456",
          result: {
            success: true,
            message: "BGM changed",
          },
        },
      });
      // Verify timestamp exists
      expect(sentMessage.timestamp).toBeTypeOf("number");
    });

    it("should send tool_result event with error status", async () => {
      // Given: Transport connected
      const { transport, ws } = await initializeTransport({
        url: "ws://localhost:8000/live",
      });

      // When: Frontend sends error result
      transport.sendToolResult(
        "call-456",
        { error: "User denied permission" },
        "error"
      );

      // Then: WebSocket should send tool_result event with error status
      const sentMessages = ws.sentMessages.filter((msg) => {
        const parsed = JSON.parse(msg);
        return parsed.type === "tool_result";
      });

      expect(sentMessages.length).toBe(1);
      const sentMessage = JSON.parse(sentMessages[0]);
      expect(sentMessage).toMatchObject({
        type: "tool_result",
        version: "1.0",
        data: {
          toolCallId: "call-456",
          result: {
            error: "User denied permission",
          },
          status: "error",
        },
      });
      // Verify timestamp exists
      expect(sentMessage.timestamp).toBeTypeOf("number");
    });
  });

  describe("Custom Events (Skip Standard Enqueue)", () => {
    // Note: tool-approval-request events are no longer skipped
    // They flow through to AI SDK v6's useChat for native handling
    // Custom events that skip enqueue can be added here in the future
  });
});
