/**
 * Tests for WebSocket message preservation (no truncation)
 */

import type { UIMessage } from "@ai-sdk/react-v6";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocketChatTransport } from "./websocket-chat-transport";

describe("WebSocketChatTransport - Message Preservation", () => {
  let mockWebSocket: any;
  let transport: WebSocketChatTransport;
  let consoleWarnSpy: any;

  beforeEach(() => {
    // Mock WebSocket with vi.fn() for tracking calls
    mockWebSocket = {
      send: vi.fn(),
      close: vi.fn(),
      readyState: 1, // WebSocket.OPEN
      onopen: null,
      onmessage: null,
      onerror: null,
      onclose: null,
    };

    // Mock WebSocket constructor that returns our tracked instance
    class MockWebSocket {
      static OPEN = 1;
      static CLOSED = 3;

      send: any;
      close: any;
      readyState: number;
      onopen: any;
      onmessage: any;
      onerror: any;
      onclose: any;

      constructor() {
        // Return the same mockWebSocket object for tracking
        this.send = mockWebSocket.send;
        this.close = mockWebSocket.close;
        this.readyState = mockWebSocket.readyState;
        this.onopen = mockWebSocket.onopen;
        this.onmessage = mockWebSocket.onmessage;
        this.onerror = mockWebSocket.onerror;
        this.onclose = mockWebSocket.onclose;

        // Store reference to this instance for tests
        mockWebSocket = this;
      }
    }
    global.WebSocket = MockWebSocket as any;

    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    transport = new WebSocketChatTransport({
      url: "ws://localhost:8000/live",
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("should send ALL messages without truncation", async () => {
    // Create a large number of messages (more than old limit of 50)
    const messages: UIMessage[] = Array.from(
      { length: 100 },
      (_, i) =>
        ({
          id: `msg-${i}`,
          role: i % 2 === 0 ? "user" : "assistant",
          parts: [{ type: "text", text: `Message ${i}` }],
        }) as UIMessage,
    );

    // Send messages using the transport
    transport.sendMessages({
      trigger: "submit-message",
      chatId: "test-chat",
      messages,
      messageId: "new-msg",
      abortSignal: new AbortController().signal,
    });

    // Wait for WebSocket to be ready
    if (mockWebSocket.onopen) {
      mockWebSocket.onopen();
    }

    await new Promise((resolve) => setTimeout(resolve, 10));

    // Verify that ALL messages were sent
    expect(mockWebSocket.send).toHaveBeenCalled();
    const sentData = JSON.parse(mockWebSocket.send.mock.calls[0][0]);

    // Should send all 100 messages, not truncate to 50
    expect(sentData.data.messages).toHaveLength(100);
    expect(sentData.data.messages[0].id).toBe("msg-0");
    expect(sentData.data.messages[99].id).toBe("msg-99");
  });

  it("should warn for large payloads but still send them", async () => {
    // Create messages that will exceed warning threshold (> 1MB)
    const largeText = "x".repeat(20000); // 20KB per message
    const messages: UIMessage[] = Array.from(
      { length: 60 },
      (_, i) =>
        ({
          id: `msg-${i}`,
          role: "user",
          parts: [{ type: "text", text: largeText }],
        }) as UIMessage,
    );

    // Start the transport
    transport.sendMessages({
      trigger: "submit-message",
      chatId: "test-chat",
      messages,
      messageId: "new-msg",
      abortSignal: new AbortController().signal,
    });

    // Wait for WebSocket to be ready
    if (mockWebSocket.onopen) {
      mockWebSocket.onopen();
    }

    await new Promise((resolve) => setTimeout(resolve, 10));

    // Should have warned about size
    expect(consoleWarnSpy).toHaveBeenCalled();
    const warnMessage = consoleWarnSpy.mock.calls[0][0];
    expect(warnMessage).toContain("Large message");

    // But should still have sent all messages
    const sentData = JSON.parse(mockWebSocket.send.mock.calls[0][0]);
    expect(sentData.data.messages).toHaveLength(60);
  });

  it("should preserve full conversation context for ADK BIDI", async () => {
    // Simulate a long conversation with context
    const conversation: UIMessage[] = [
      {
        id: "1",
        role: "user",
        parts: [{ type: "text", text: "Start context" }],
      },
      {
        id: "2",
        role: "assistant",
        parts: [{ type: "text", text: "Context response" }],
      },
      // ... many more messages
      ...Array.from({ length: 70 }, (_, i) => ({
        id: `${i + 3}`,
        role: i % 2 === 0 ? "user" : "assistant",
        parts: [{ type: "text", text: `Context message ${i}` }],
      })),
      {
        id: "73",
        role: "user",
        parts: [{ type: "text", text: "Recent message needing full context" }],
      },
    ] as UIMessage[];

    transport.sendMessages({
      trigger: "submit-message",
      chatId: "bidi-chat",
      messages: conversation,
      messageId: "new-msg",
      abortSignal: new AbortController().signal,
    });

    if (mockWebSocket.onopen) {
      mockWebSocket.onopen();
    }

    await new Promise((resolve) => setTimeout(resolve, 10));

    const sentData = JSON.parse(mockWebSocket.send.mock.calls[0][0]);

    // Should preserve entire conversation history
    expect(sentData.data.messages).toHaveLength(73);
    expect(sentData.data.messages[0].parts[0].text).toBe("Start context");
    expect(sentData.data.messages[72].parts[0].text).toBe(
      "Recent message needing full context",
    );
  });

  it("should handle messages with complex parts (images, tools)", async () => {
    const complexMessages: UIMessage[] = [
      {
        id: "1",
        role: "user",
        parts: [
          { type: "text", text: "Analyze this image" },
          {
            type: "image",
            mimeType: "image/png",
            data: "base64data...",
          },
        ],
      },
      {
        id: "2",
        role: "assistant",
        parts: [
          { type: "text", text: "I'll analyze it" },
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "image-analyzer",
            state: "input-available",
            input: { image: "data" },
          },
        ],
      },
      // Add more messages to exceed old 50 limit
      ...Array.from({ length: 60 }, (_, i) => ({
        id: `${i + 3}`,
        role: "user",
        parts: [{ type: "text", text: `Message ${i}` }],
      })),
    ] as UIMessage[];

    transport.sendMessages({
      trigger: "submit-message",
      chatId: "test-chat",
      messages: complexMessages,
      messageId: "new-msg",
      abortSignal: new AbortController().signal,
    });

    if (mockWebSocket.onopen) {
      mockWebSocket.onopen();
    }

    await new Promise((resolve) => setTimeout(resolve, 10));

    const sentData = JSON.parse(mockWebSocket.send.mock.calls[0][0]);

    // Should send all messages including complex ones
    expect(sentData.data.messages).toHaveLength(62);
    expect(sentData.data.messages[0].parts[1].type).toBe("image");
    expect(sentData.data.messages[1].parts[1].type).toBe("tool-call");
  });

  it("should only warn at appropriate size thresholds", async () => {
    // Test the new thresholds (500KB warning, 10MB error)

    // Small payload - no warning
    const smallMessages: UIMessage[] = [
      {
        id: "1",
        role: "user",
        parts: [{ type: "text", text: "Small message" }],
      },
    ] as UIMessage[];

    transport.sendMessages({
      trigger: "submit-message",
      chatId: "test-chat",
      messages: smallMessages,
      messageId: "msg-1",
      abortSignal: new AbortController().signal,
    });

    if (mockWebSocket.onopen) {
      mockWebSocket.onopen();
    }

    await new Promise((resolve) => setTimeout(resolve, 10));

    // Should not warn for small messages
    expect(consoleWarnSpy).not.toHaveBeenCalled();

    // Reset
    consoleWarnSpy.mockClear();
    mockWebSocket.send.mockClear();

    // Medium payload (>500KB) - should warn
    const mediumText = "x".repeat(100000); // 100KB per message
    const mediumMessages: UIMessage[] = Array.from(
      { length: 6 }, // 600KB total
      (_, i) =>
        ({
          id: `msg-${i}`,
          role: "user",
          parts: [{ type: "text", text: mediumText }],
        }) as UIMessage,
    );

    transport.sendMessages({
      trigger: "submit-message",
      chatId: "test-chat",
      messages: mediumMessages,
      messageId: "msg-2",
      abortSignal: new AbortController().signal,
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    // Should warn for messages > 500KB
    expect(consoleWarnSpy).toHaveBeenCalled();

    // But should still send them
    const sentData = JSON.parse(mockWebSocket.send.mock.calls[0][0]);
    expect(sentData.data.messages).toHaveLength(6);
  });
});
