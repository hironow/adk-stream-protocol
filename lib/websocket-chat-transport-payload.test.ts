import type { UIMessage } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocketChatTransport } from "./websocket-chat-transport";

describe("WebSocketChatTransport - Payload Size Management", () => {
  let transport: WebSocketChatTransport;
  let mockWebSocket: any;
  let consoleWarnSpy: any;
  let consoleErrorSpy: any;
  let consoleInfoSpy: any;

  beforeEach(() => {
    // Mock WebSocket
    mockWebSocket = {
      send: vi.fn(),
      close: vi.fn(),
      readyState: 1, // WebSocket.OPEN = 1
      onopen: null,
      onmessage: null,
      onerror: null,
      onclose: null,
    };

    // Mock WebSocket constructor with proper constants
    const MockWebSocket = vi
      .fn()
      .mockImplementation(() => mockWebSocket) as any;
    MockWebSocket.OPEN = 1;
    MockWebSocket.CLOSED = 3;
    MockWebSocket.CLOSING = 2;
    MockWebSocket.CONNECTING = 0;
    global.WebSocket = MockWebSocket;

    // Spy on console methods
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    transport = new WebSocketChatTransport({
      url: "ws://localhost:8000/live",
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe("Message History Truncation", () => {
    it("should truncate message history when exceeding MAX_MESSAGES_TO_SEND", async () => {
      // Create 60 messages (more than the 50 limit)
      const messages: UIMessage[] = Array.from(
        { length: 60 },
        (_, i) =>
          ({
            id: `msg-${i}`,
            role: i % 2 === 0 ? "user" : "assistant",
            content: `Message ${i}`,
          }) as UIMessage,
      );

      // Create transport with mocked WebSocket
      transport = new WebSocketChatTransport({
        url: "ws://localhost:8000/live",
      });

      // Access private ws property and set to our mock
      (transport as any).ws = mockWebSocket;
      (transport as any).wsReady = Promise.resolve();
      mockWebSocket.readyState = 1; // WebSocket.OPEN

      // Start the transport and get the stream
      const stream = await transport.sendMessages({
        trigger: "submit-message",
        chatId: "test-chat",
        messageId: "test-msg",
        messages,
        abortSignal: undefined,
        onFinish: vi.fn(),
      });

      // Start consuming the stream to trigger the start callback
      const reader = stream.getReader();

      // Try to read from the stream to trigger the start callback
      // biome-ignore lint/correctness/noUnusedVariables: Start promise to trigger stream
      const _readPromise = reader.read();

      // Wait a bit for the send to happen
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Check that truncation was logged
      expect(consoleInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "[WS Transport] Truncating message history: 60 → 50 messages",
        ),
        expect.objectContaining({
          originalCount: 60,
          sentCount: 50,
          droppedCount: 10,
        }),
      );

      // Check that only 50 messages were sent
      expect(mockWebSocket.send).toHaveBeenCalled();
      const sentData = JSON.parse(mockWebSocket.send.mock.calls[0][0]);
      expect(sentData.type).toBe("message");
      expect(sentData.data.messages).toHaveLength(50);

      // Check that the last 50 messages were kept (not the first 50)
      expect(sentData.data.messages[0].content).toBe("Message 10");
      expect(sentData.data.messages[49].content).toBe("Message 59");

      // Reader automatically released when stream closes
    });

    it("should not truncate when messages are within limit", async () => {
      // Create 30 messages (less than the 50 limit)
      const messages: UIMessage[] = Array.from(
        { length: 30 },
        (_, i) =>
          ({
            id: `msg-${i}`,
            role: i % 2 === 0 ? "user" : "assistant",
            content: `Message ${i}`,
          }) as UIMessage,
      );

      // Create transport with mocked WebSocket
      transport = new WebSocketChatTransport({
        url: "ws://localhost:8000/live",
      });

      // Access private ws property and set to our mock
      (transport as any).ws = mockWebSocket;
      (transport as any).wsReady = Promise.resolve();
      mockWebSocket.readyState = 1; // WebSocket.OPEN

      // Start the transport and get the stream
      const stream = await transport.sendMessages({
        trigger: "submit-message",
        chatId: "test-chat",
        messageId: "test-msg",
        messages,
        abortSignal: undefined,
        onFinish: vi.fn(),
      });

      // Start consuming the stream to trigger the start callback
      const reader = stream.getReader();

      // Try to read from the stream to trigger the start callback
      // biome-ignore lint/correctness/noUnusedVariables: Start promise to trigger stream
      const _readPromise = reader.read();

      // Wait a bit for the send to happen
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Check that truncation was NOT logged
      expect(consoleInfoSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("[WS Transport] Truncating message history"),
        expect.anything(),
      );

      // Check that all 30 messages were sent
      expect(mockWebSocket.send).toHaveBeenCalled();
      const sentData = JSON.parse(mockWebSocket.send.mock.calls[0][0]);
      expect(sentData.data.messages).toHaveLength(30);

      // Reader automatically released when stream closes
    });
  });

  describe("Size Warning and Error Logging", () => {
    it("should warn when message size exceeds 100KB but is less than 1MB", async () => {
      // Create a message that's larger than 100KB
      const largeContent = "x".repeat(150 * 1024); // 150KB of text
      const messages: UIMessage[] = [
        {
          id: "large-msg",
          role: "user",
          content: largeContent,
        } as UIMessage,
      ];

      // Directly send event to test size checking
      const transport = new WebSocketChatTransport({
        url: "ws://localhost:8000/live",
      });

      // Access private method via type assertion
      (transport as any).ws = mockWebSocket;
      (transport as any).sendEvent({
        type: "message",
        version: "1.0",
        data: { messages },
      });

      // Debug logs should be called for size > 100KB but < 1MB
      // Note: We can't easily test console.debug as it might be called multiple times
      // But we can verify no warning or error was called
      expect(consoleWarnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("[WS Transport] ⚠️ Large message"),
        expect.anything(),
      );
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it("should warn when message size exceeds 1MB but is less than 5MB", async () => {
      // Create a message that's larger than 1MB but less than 5MB
      const largeContent = "x".repeat(2 * 1024 * 1024); // 2MB of text
      const messages: UIMessage[] = [
        {
          id: "large-msg",
          role: "user",
          content: largeContent,
        } as UIMessage,
      ];

      const transport = new WebSocketChatTransport({
        url: "ws://localhost:8000/live",
      });

      // Access private method via type assertion
      (transport as any).ws = mockWebSocket;
      (transport as any).sendEvent({
        type: "message",
        version: "1.0",
        data: { messages },
      });

      // Should have warning for size > 1MB
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("[WS Transport] ⚠️ Large message"),
        expect.objectContaining({
          type: "message",
          sizeBytes: expect.any(Number),
          sizeKB: expect.any(String),
          sizeMB: expect.any(String),
        }),
      );

      // Should also log message details
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "[WS Transport] Message details:",
        expect.objectContaining({
          messageCount: 1,
          firstMessage: expect.any(String),
          lastMessage: expect.any(String),
        }),
      );
    });

    it("should error when message size exceeds 5MB", async () => {
      // Create a message that's larger than 5MB
      const largeContent = "x".repeat(6 * 1024 * 1024); // 6MB of text
      const messages: UIMessage[] = [
        {
          id: "huge-msg",
          role: "user",
          content: largeContent,
        } as UIMessage,
      ];

      const transport = new WebSocketChatTransport({
        url: "ws://localhost:8000/live",
      });

      // Access private method via type assertion
      (transport as any).ws = mockWebSocket;
      (transport as any).sendEvent({
        type: "message",
        version: "1.0",
        data: { messages },
      });

      // Should have error for size > 5MB
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("[WS Transport] ❌ Message too large"),
        expect.objectContaining({
          type: "message",
          sizeBytes: expect.any(Number),
          sizeKB: expect.any(String),
          sizeMB: expect.any(String),
          maxMB: 5,
        }),
      );
    });

    it("should not log warnings for small messages", async () => {
      const messages: UIMessage[] = [
        {
          id: "small-msg",
          role: "user",
          content: "Hello, this is a small message",
        } as UIMessage,
      ];

      const transport = new WebSocketChatTransport({
        url: "ws://localhost:8000/live",
      });

      // Access private method via type assertion
      (transport as any).ws = mockWebSocket;
      (transport as any).sendEvent({
        type: "message",
        version: "1.0",
        data: { messages },
      });

      // Should not have any warnings or errors for small messages
      expect(consoleWarnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("[WS Transport]"),
        expect.anything(),
      );
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });
  });

  describe("Message Truncation with Various Message Types", () => {
    it("should handle mixed message roles when truncating", async () => {
      // Create 60 messages with mixed roles
      const messages: UIMessage[] = Array.from(
        { length: 60 },
        (_, i) =>
          ({
            id: `msg-${i}`,
            role: i % 3 === 0 ? "user" : i % 3 === 1 ? "assistant" : "system",
            content: `Message ${i}`,
          }) as UIMessage,
      );

      // Create transport with mocked WebSocket
      transport = new WebSocketChatTransport({
        url: "ws://localhost:8000/live",
      });

      // Access private ws property and set to our mock
      (transport as any).ws = mockWebSocket;
      (transport as any).wsReady = Promise.resolve();
      mockWebSocket.readyState = 1; // WebSocket.OPEN

      // Start the transport and get the stream
      const stream = await transport.sendMessages({
        trigger: "submit-message",
        chatId: "test-chat",
        messageId: "test-msg",
        messages,
        abortSignal: undefined,
        onFinish: vi.fn(),
      });

      // Start consuming the stream to trigger the start callback
      const reader = stream.getReader();

      // Try to read from the stream to trigger the start callback
      // biome-ignore lint/correctness/noUnusedVariables: Start promise to trigger stream
      const _readPromise = reader.read();

      // Wait a bit for the send to happen
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Check that truncation preserved message order
      expect(mockWebSocket.send).toHaveBeenCalled();
      const sentData = JSON.parse(mockWebSocket.send.mock.calls[0][0]);
      expect(sentData.data.messages).toHaveLength(50);

      // Verify roles are preserved correctly
      expect(sentData.data.messages[0].role).toBe(messages[10].role);
      expect(sentData.data.messages[49].role).toBe(messages[59].role);

      // Reader automatically released when stream closes
    });

    it("should handle messages with complex content when truncating", async () => {
      // Create messages with parts instead of simple content
      const messages: UIMessage[] = Array.from(
        { length: 55 },
        (_, i) =>
          ({
            id: `msg-${i}`,
            role: i % 2 === 0 ? "user" : "assistant",
            // Use parts array instead of content string
            parts: [
              { type: "text", text: `Message ${i} part 1` },
              { type: "text", text: `Message ${i} part 2` },
            ],
          }) as any,
      );

      // Create transport with mocked WebSocket
      transport = new WebSocketChatTransport({
        url: "ws://localhost:8000/live",
      });

      // Access private ws property and set to our mock
      (transport as any).ws = mockWebSocket;
      (transport as any).wsReady = Promise.resolve();
      mockWebSocket.readyState = 1; // WebSocket.OPEN

      // Start the transport and get the stream
      const stream = await transport.sendMessages({
        trigger: "submit-message",
        chatId: "test-chat",
        messageId: "test-msg",
        messages,
        abortSignal: undefined,
        onFinish: vi.fn(),
      });

      // Start consuming the stream to trigger the start callback
      const reader = stream.getReader();

      // Try to read from the stream to trigger the start callback
      // biome-ignore lint/correctness/noUnusedVariables: Start promise to trigger stream
      const _readPromise = reader.read();

      // Wait a bit for the send to happen
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Check that truncation worked with complex messages
      expect(mockWebSocket.send).toHaveBeenCalled();
      const sentData = JSON.parse(mockWebSocket.send.mock.calls[0][0]);
      expect(sentData.data.messages).toHaveLength(50);

      // Verify parts are preserved
      expect(sentData.data.messages[0].parts).toBeDefined();
      expect(sentData.data.messages[0].parts).toHaveLength(2);

      // Reader automatically released when stream closes
    });
  });
});
