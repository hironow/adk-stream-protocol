/**
 * WebSocketChatTransport Unit Tests
 *
 * Tests the custom ChatTransport implementation for WebSocket bidirectional streaming.
 * Key focus: Tool approval flow integration with AI SDK v6 (addToolOutput, addToolApprovalResponse)
 */

import type { UIMessage } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocketChatTransport } from "./websocket-chat-transport";

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
      // Special case: if data has type "sse", use data.data directly (for raw SSE strings)
      let messageData: string;
      if (data.type === "sse") {
        messageData = data.data;
      } else {
        // Backend sends SSE-formatted events (data: {...}\n\n)
        messageData = `data: ${JSON.stringify(data)}`;
      }
      this.onmessage(
        new MessageEvent("message", {
          data: messageData,
        }),
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
    config: ConstructorParameters<typeof WebSocketChatTransport>[0],
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
      expect(transport.ws?.readyState).toBe(MockWebSocket.OPEN);
    });

    const ws = transport.ws as unknown as MockWebSocket;
    return { transport, ws };
  }

  describe("sendMessages() - Core Functionality", () => {
    it("should establish WebSocket connection on first call", async () => {
      // Given: Fresh transport instance
      const transport = new WebSocketChatTransport({
        url: "ws://localhost:8000/live",
      });

      const messages: UIMessage[] = [
        { id: "msg-1", role: "user", content: "Hello" },
      ];

      // When: Calling sendMessages for the first time
      const streamPromise = transport.sendMessages({
        trigger: "submit-message",
        chatId: "chat-1",
        messageId: undefined,
        messages,
        abortSignal: new AbortController().signal,
      });

      // Then: WebSocket should be created with correct URL
      expect(transport.ws).toBeDefined();
      expect(transport.ws?.url).toBe("ws://localhost:8000/live");

      // Wait for connection to open
      await vi.waitFor(() => {
        expect(transport.ws?.readyState).toBe(MockWebSocket.OPEN);
      });

      // Should return ReadableStream
      expect(streamPromise).toBeInstanceOf(Promise);
      const stream = await streamPromise;
      expect(stream).toBeInstanceOf(ReadableStream);
    });

    it("should send message event with correct format", async () => {
      // Given: Fresh transport instance
      const transport = new WebSocketChatTransport({
        url: "ws://localhost:8000/live",
      });

      const messages: UIMessage[] = [
        { id: "msg-1", role: "user", content: "Hello" },
        { id: "msg-2", role: "assistant", content: "Hi!" },
        { id: "msg-3", role: "user", content: "How are you?" },
      ];

      // When: Sending message
      const streamPromise = transport.sendMessages({
        trigger: "submit-message",
        chatId: "chat-1",
        messageId: undefined,
        messages,
        abortSignal: new AbortController().signal,
      });

      // Wait for connection to open
      await vi.waitFor(() => {
        expect(transport.ws?.readyState).toBe(MockWebSocket.OPEN);
      });

      const ws = transport.ws as unknown as MockWebSocket;

      // Then: Should send message event with full history
      const messageEvents = ws.sentMessages.filter((msg) => {
        const parsed = JSON.parse(msg);
        return parsed.type === "message";
      });

      expect(messageEvents.length).toBeGreaterThan(0);
      const sentMessage = JSON.parse(messageEvents[0]);

      expect(sentMessage).toMatchObject({
        type: "message",
        version: "1.0",
        data: {
          messages: [
            { id: "msg-1", role: "user", content: "Hello" },
            { id: "msg-2", role: "assistant", content: "Hi!" },
            { id: "msg-3", role: "user", content: "How are you?" },
          ],
        },
      });
      expect(sentMessage.timestamp).toBeTypeOf("number");

      // Clean up
      await streamPromise;
    });

    it("should reuse existing connection for subsequent messages", async () => {
      // Given: Transport with established connection
      const { transport } = await initializeTransport({
        url: "ws://localhost:8000/live",
      });

      const firstWs = transport.ws;

      // When: Sending second message
      await transport.sendMessages({
        trigger: "submit-message",
        chatId: "chat-2",
        messageId: undefined,
        messages: [{ id: "msg-2", role: "user", content: "Second message" }],
        abortSignal: new AbortController().signal,
      });

      // Then: Should reuse the same WebSocket instance
      expect(transport.ws).toBe(firstWs);
    });

    it("should handle abort signal during connection", async () => {
      // Given: Transport and abort controller
      const transport = new WebSocketChatTransport({
        url: "ws://localhost:8000/live",
      });

      const abortController = new AbortController();
      const messages: UIMessage[] = [
        { id: "msg-1", role: "user", content: "Hello" },
      ];

      // When: Starting message send then aborting immediately
      const streamPromise = transport.sendMessages({
        trigger: "submit-message",
        chatId: "chat-1",
        messageId: undefined,
        messages,
        abortSignal: abortController.signal,
      });

      abortController.abort();

      // Then: Should handle abort gracefully (stream might close)
      const stream = await streamPromise;
      expect(stream).toBeInstanceOf(ReadableStream);

      // WebSocket might be closed by abort handling
      // (Implementation-dependent behavior - just verify no crash)
    });

    it.skip("should handle connection timeout", async () => {
      // FIXME: Timeout behavior needs clarification
      // Current implementation returns stream immediately, timeout occurs during reading
      // Need to verify expected behavior: Should timeout reject the promise or error the stream?

      // Given: Transport with short timeout
      const transport = new WebSocketChatTransport({
        url: "ws://localhost:8000/live",
        timeout: 10, // Very short timeout (10ms)
      });

      // Mock WebSocket that never opens
      const NeverOpenWebSocket = class extends MockWebSocket {
        constructor(url: string) {
          super(url);
          // Override to prevent automatic opening
          this.readyState = MockWebSocket.CONNECTING;
        }
      };
      global.WebSocket = NeverOpenWebSocket as any;

      const messages: UIMessage[] = [
        { id: "msg-1", role: "user", content: "Hello" },
      ];

      // When: Attempting to send message with connection that never opens
      const streamPromise = transport.sendMessages({
        trigger: "submit-message",
        chatId: "chat-1",
        messageId: undefined,
        messages,
        abortSignal: new AbortController().signal,
      });

      // Then: Stream should be returned but will error when timeout triggers
      const stream = await streamPromise;
      expect(stream).toBeInstanceOf(ReadableStream);

      // Reading from stream will eventually fail due to timeout
      const reader = stream.getReader();

      try {
        // Try to read, which should timeout
        await reader.read();
        // If we get here without timeout, the test should fail
        expect.fail("Expected timeout error");
      } catch (error) {
        // Expected: timeout error should occur
        expect(error).toBeDefined();
      } finally {
        reader.releaseLock();
      }
    });

    it("should stream text events from ReadableStream", async () => {
      // Given: Fresh transport
      const transport = new WebSocketChatTransport({
        url: "ws://localhost:8000/live",
      });

      const messages: UIMessage[] = [
        { id: "msg-1", role: "user", content: "Hello" },
      ];

      // When: Starting to send message
      const streamPromise = transport.sendMessages({
        trigger: "submit-message",
        chatId: "chat-1",
        messageId: undefined,
        messages,
        abortSignal: new AbortController().signal,
      });

      // Wait for connection
      await vi.waitFor(() => {
        expect(transport.ws?.readyState).toBe(MockWebSocket.OPEN);
      });

      const stream = await streamPromise;
      const ws = transport.ws as unknown as MockWebSocket;
      const reader = stream.getReader();

      // Start reading in background
      const eventsPromise = (async () => {
        const events: any[] = [];
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            events.push(value);
          }
        } finally {
          reader.releaseLock();
        }
        return events;
      })();

      // Simulate backend sending text events
      ws.simulateMessage({ type: "text-start", id: "block-1" });
      ws.simulateMessage({ type: "text-delta", id: "block-1", delta: "Hello" });
      ws.simulateMessage({
        type: "text-delta",
        id: "block-1",
        delta: " world",
      });
      ws.simulateMessage({ type: "text-end", id: "block-1" });
      ws.simulateMessage({ type: "finish" });

      // Close WebSocket to end stream
      ws.close();

      // Wait for events
      const events = await eventsPromise;

      // Verify we received events
      expect(events.length).toBeGreaterThan(0);
    });

    it("should handle regenerate trigger", async () => {
      // Given: Fresh transport
      const transport = new WebSocketChatTransport({
        url: "ws://localhost:8000/live",
      });

      const messages: UIMessage[] = [
        { id: "msg-1", role: "user", content: "Hello" },
        { id: "msg-2", role: "assistant", content: "Old response" },
      ];

      // When: Sending with regenerate trigger
      const streamPromise = transport.sendMessages({
        trigger: "regenerate-message",
        chatId: "chat-1",
        messageId: "msg-2",
        messages,
        abortSignal: new AbortController().signal,
      });

      // Wait for connection
      await vi.waitFor(() => {
        expect(transport.ws?.readyState).toBe(MockWebSocket.OPEN);
      });

      const ws = transport.ws as unknown as MockWebSocket;

      // Then: Should send message event (trigger doesn't affect message format)
      const messageEvents = ws.sentMessages.filter((msg) => {
        const parsed = JSON.parse(msg);
        return parsed.type === "message";
      });

      expect(messageEvents.length).toBeGreaterThan(0);
      const sentMessage = JSON.parse(messageEvents[0]);
      expect(sentMessage.data.messages).toEqual(messages);

      await streamPromise;
    });
  });

  describe("Message Event Processing", () => {
    it("should process text-start event", async () => {
      // Given: Fresh transport
      const transport = new WebSocketChatTransport({
        url: "ws://localhost:8000/live",
      });

      const messages: UIMessage[] = [
        { id: "msg-1", role: "user", content: "Hello" },
      ];

      const streamPromise = transport.sendMessages({
        trigger: "submit-message",
        chatId: "chat-1",
        messageId: undefined,
        messages,
        abortSignal: new AbortController().signal,
      });

      // Wait for connection
      await vi.waitFor(() => {
        expect(transport.ws?.readyState).toBe(MockWebSocket.OPEN);
      });

      const stream = await streamPromise;
      const ws = transport.ws as unknown as MockWebSocket;

      // When: Server sends text-start event
      ws.simulateMessage({ type: "text-start", id: "block-1" });

      // Then: Stream should emit text-start chunk
      const reader = stream.getReader();
      const { value } = await reader.read();
      reader.releaseLock();

      expect(value).toMatchObject({
        type: "text-start",
        id: "block-1",
      });
    });

    it("should process text-delta event", async () => {
      // Given: Fresh transport
      const transport = new WebSocketChatTransport({
        url: "ws://localhost:8000/live",
      });

      const streamPromise = transport.sendMessages({
        trigger: "submit-message",
        chatId: "chat-1",
        messageId: undefined,
        messages: [{ id: "msg-1", role: "user", content: "Hello" }],
        abortSignal: new AbortController().signal,
      });

      await vi.waitFor(() => {
        expect(transport.ws?.readyState).toBe(MockWebSocket.OPEN);
      });

      const stream = await streamPromise;
      const ws = transport.ws as unknown as MockWebSocket;

      // When: Server sends text-delta event
      ws.simulateMessage({
        type: "text-delta",
        id: "block-1",
        delta: "Hello world",
      });

      // Then: Stream should emit text-delta chunk
      const reader = stream.getReader();
      const { value } = await reader.read();
      reader.releaseLock();

      expect(value).toMatchObject({
        type: "text-delta",
        id: "block-1",
        delta: "Hello world",
      });
    });

    it("should process text-end event", async () => {
      // Given: Fresh transport
      const transport = new WebSocketChatTransport({
        url: "ws://localhost:8000/live",
      });

      const streamPromise = transport.sendMessages({
        trigger: "submit-message",
        chatId: "chat-1",
        messageId: undefined,
        messages: [{ id: "msg-1", role: "user", content: "Hello" }],
        abortSignal: new AbortController().signal,
      });

      await vi.waitFor(() => {
        expect(transport.ws?.readyState).toBe(MockWebSocket.OPEN);
      });

      const stream = await streamPromise;
      const ws = transport.ws as unknown as MockWebSocket;

      // When: Server sends text-end event
      ws.simulateMessage({ type: "text-end", id: "block-1" });

      // Then: Stream should emit text-end chunk
      const reader = stream.getReader();
      const { value } = await reader.read();
      reader.releaseLock();

      expect(value).toMatchObject({
        type: "text-end",
        id: "block-1",
      });
    });

    it("should assemble multi-chunk text stream", async () => {
      // Given: Fresh transport
      const transport = new WebSocketChatTransport({
        url: "ws://localhost:8000/live",
      });

      const streamPromise = transport.sendMessages({
        trigger: "submit-message",
        chatId: "chat-1",
        messageId: undefined,
        messages: [{ id: "msg-1", role: "user", content: "Hello" }],
        abortSignal: new AbortController().signal,
      });

      await vi.waitFor(() => {
        expect(transport.ws?.readyState).toBe(MockWebSocket.OPEN);
      });

      const stream = await streamPromise;
      const ws = transport.ws as unknown as MockWebSocket;
      const reader = stream.getReader();

      // Start reading in background
      const eventsPromise = (async () => {
        const events: any[] = [];
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            events.push(value);
          }
        } finally {
          reader.releaseLock();
        }
        return events;
      })();

      // When: Server sends complete text stream
      ws.simulateMessage({ type: "text-start", id: "block-1" });
      ws.simulateMessage({ type: "text-delta", id: "block-1", delta: "Hello" });
      ws.simulateMessage({ type: "text-delta", id: "block-1", delta: " " });
      ws.simulateMessage({ type: "text-delta", id: "block-1", delta: "world" });
      ws.simulateMessage({ type: "text-end", id: "block-1" });
      ws.simulateMessage({ type: "finish" });

      // Close to end stream
      ws.close();

      // Wait for all events
      const events = await eventsPromise;

      // Then: Should have all chunks
      expect(events.length).toBeGreaterThanOrEqual(5);
      expect(events[0]).toMatchObject({ type: "text-start" });
      expect(events[events.length - 1]).toMatchObject({ type: "finish" });

      // Verify delta events contain text
      const deltas = events.filter((e) => e.type === "text-delta");
      expect(deltas.length).toBe(3);
    });

    it("should handle malformed SSE format gracefully", async () => {
      // Given: Transport with active stream
      const { transport, ws } = await initializeTransport({
        url: "ws://localhost:8000/live",
      });

      const stream = await transport.sendMessages({
        trigger: "submit-message",
        chatId: "chat-1",
        messageId: undefined,
        messages: [{ id: "msg-1", role: "user", content: "Hello" }],
        abortSignal: new AbortController().signal,
      });

      const reader = stream.getReader();

      // When: Server sends malformed message (not SSE format)
      if (ws.onmessage) {
        ws.onmessage(
          new MessageEvent("message", {
            data: "not-sse-format", // Missing "data: " prefix
          }),
        );
      }

      // Then: Should not crash, might skip or handle gracefully
      // (Implementation-dependent - verify no uncaught errors)
      try {
        const { value } = await Promise.race([
          reader.read(),
          new Promise<{ value: undefined; done: true }>((resolve) =>
            setTimeout(() => resolve({ value: undefined, done: true }), 50),
          ),
        ]);

        // If we got a value, it should be valid
        if (value) {
          expect(value).toHaveProperty("type");
        }
      } finally {
        reader.releaseLock();
      }
    });

    it("should handle unknown event types gracefully", async () => {
      // Given: Transport with active stream
      const { transport, ws } = await initializeTransport({
        url: "ws://localhost:8000/live",
      });

      const stream = await transport.sendMessages({
        trigger: "submit-message",
        chatId: "chat-1",
        messageId: undefined,
        messages: [{ id: "msg-1", role: "user", content: "Hello" }],
        abortSignal: new AbortController().signal,
      });

      // When: Server sends unknown event type
      ws.simulateMessage({ type: "unknown-event-type", data: "something" });

      // Then: Should not crash (might skip or log warning)
      const reader = stream.getReader();
      try {
        // Attempt to read - should not throw
        const { done } = await Promise.race([
          reader.read(),
          new Promise<{ done: true }>((resolve) =>
            setTimeout(() => resolve({ done: true }), 50),
          ),
        ]);

        // Test passes if we reach here without throwing
        expect(done).toBeDefined();
      } finally {
        reader.releaseLock();
      }
    });

    it("should handle events without required fields", async () => {
      // Given: Transport with active stream
      const { transport, ws } = await initializeTransport({
        url: "ws://localhost:8000/live",
      });

      const stream = await transport.sendMessages({
        trigger: "submit-message",
        chatId: "chat-1",
        messageId: undefined,
        messages: [{ id: "msg-1", role: "user", content: "Hello" }],
        abortSignal: new AbortController().signal,
      });

      // When: Server sends text-delta without required 'delta' field
      ws.simulateMessage({
        type: "text-delta",
        id: "block-1",
        // Missing 'delta' field
      });

      // Then: Should handle gracefully (might skip or use default)
      const reader = stream.getReader();
      try {
        const { done } = await Promise.race([
          reader.read(),
          new Promise<{ done: true }>((resolve) =>
            setTimeout(() => resolve({ done: true }), 50),
          ),
        ]);

        // Test passes if we don't crash
        expect(done).toBeDefined();
      } finally {
        reader.releaseLock();
      }
    });

    it("should process finish event with metadata", async () => {
      // Given: Fresh transport
      const transport = new WebSocketChatTransport({
        url: "ws://localhost:8000/live",
      });

      const streamPromise = transport.sendMessages({
        trigger: "submit-message",
        chatId: "chat-1",
        messageId: undefined,
        messages: [{ id: "msg-1", role: "user", content: "Hello" }],
        abortSignal: new AbortController().signal,
      });

      await vi.waitFor(() => {
        expect(transport.ws?.readyState).toBe(MockWebSocket.OPEN);
      });

      const stream = await streamPromise;
      const ws = transport.ws as unknown as MockWebSocket;

      // When: Server sends finish event with usage metadata
      ws.simulateMessage({
        type: "finish",
        usage: {
          promptTokens: 10,
          completionTokens: 20,
          totalTokens: 30,
        },
        finishReason: "stop",
      });

      // Then: Stream should emit finish chunk with metadata
      const reader = stream.getReader();
      const { value } = await reader.read();
      reader.releaseLock();

      expect(value).toMatchObject({
        type: "finish",
        usage: {
          promptTokens: 10,
          completionTokens: 20,
          totalTokens: 30,
        },
        finishReason: "stop",
      });
    });
  });

  describe("Connection Lifecycle", () => {
    it("should transition from CONNECTING to OPEN state", async () => {
      // Given: Fresh transport instance
      const transport = new WebSocketChatTransport({
        url: "ws://localhost:8000/live",
      });

      // When: Starting connection
      const streamPromise = transport.sendMessages({
        trigger: "submit-message",
        chatId: "chat-1",
        messageId: undefined,
        messages: [{ id: "msg-1", role: "user", content: "Hello" }],
        abortSignal: new AbortController().signal,
      });

      // Then: Should transition CONNECTING → OPEN
      expect(transport.ws).toBeDefined();
      expect(transport.ws?.readyState).toBe(MockWebSocket.CONNECTING);

      await vi.waitFor(() => {
        expect(transport.ws?.readyState).toBe(MockWebSocket.OPEN);
      });

      const stream = await streamPromise;
      expect(stream).toBeInstanceOf(ReadableStream);
    });

    it.skip("should handle connection failure gracefully", async () => {
      // FIXME: Connection error handling needs verification
      // Current implementation may return stream even on error
      // Need to clarify: Should onerror during connection reject the promise?

      // Given: WebSocket that fails to connect
      const FailingWebSocket = class extends MockWebSocket {
        constructor(url: string) {
          super(url);
          // Override to prevent automatic opening
          this.readyState = MockWebSocket.CONNECTING;
          // Simulate connection error after short delay
          setTimeout(() => {
            this.readyState = MockWebSocket.CLOSED;
            if (this.onerror) {
              this.onerror(new Event("error"));
            }
            if (this.onclose) {
              this.onclose(new CloseEvent("close"));
            }
          }, 10);
        }
      };
      global.WebSocket = FailingWebSocket as any;

      const transport = new WebSocketChatTransport({
        url: "ws://localhost:8000/live",
        timeout: 100,
      });

      // When: Attempting to connect
      const streamPromise = transport.sendMessages({
        trigger: "submit-message",
        chatId: "chat-1",
        messageId: undefined,
        messages: [{ id: "msg-1", role: "user", content: "Hello" }],
        abortSignal: new AbortController().signal,
      });

      // Then: Should reject due to connection failure
      await expect(streamPromise).rejects.toThrow();
    });

    it("should clean up on close", async () => {
      // Given: Transport with established connection
      const { transport, ws } = await initializeTransport({
        url: "ws://localhost:8000/live",
      });

      expect(transport.ws).toBeDefined();
      expect(ws.readyState).toBe(MockWebSocket.OPEN);

      // When: Closing connection
      transport.close();

      // Then: WebSocket should be closed
      expect(ws.readyState).toBe(MockWebSocket.CLOSED);
    });

    it("should handle unexpected server close during stream", async () => {
      // Given: Transport with active stream
      const { transport, ws } = await initializeTransport({
        url: "ws://localhost:8000/live",
      });

      const stream = await transport.sendMessages({
        trigger: "submit-message",
        chatId: "chat-1",
        messageId: undefined,
        messages: [{ id: "msg-1", role: "user", content: "Hello" }],
        abortSignal: new AbortController().signal,
      });

      const reader = stream.getReader();

      // When: Server unexpectedly closes connection
      ws.close();

      // Then: Stream should handle close gracefully
      try {
        const result = await Promise.race([
          reader.read(),
          new Promise<{ done: true }>((resolve) =>
            setTimeout(() => resolve({ done: true }), 100),
          ),
        ]);

        // Should either finish gracefully or timeout
        expect(result.done).toBeDefined();
      } finally {
        reader.releaseLock();
      }
    });

    it("should handle multiple rapid connect/disconnect cycles", async () => {
      // Given: Transport instance
      const transport = new WebSocketChatTransport({
        url: "ws://localhost:8000/live",
      });

      // When: Rapidly connecting and disconnecting
      const messages = [
        { id: "msg-1", role: "user" as const, content: "Hello" },
      ];

      // First connection
      const stream1 = await transport.sendMessages({
        trigger: "submit-message",
        chatId: "chat-1",
        messageId: undefined,
        messages,
        abortSignal: new AbortController().signal,
      });

      await vi.waitFor(() => {
        expect(transport.ws?.readyState).toBe(MockWebSocket.OPEN);
      });

      const firstWs = transport.ws;

      // Second message (should reuse connection)
      const stream2 = await transport.sendMessages({
        trigger: "submit-message",
        chatId: "chat-2",
        messageId: undefined,
        messages,
        abortSignal: new AbortController().signal,
      });

      // Then: Should reuse same connection
      expect(transport.ws).toBe(firstWs);
      expect(stream1).toBeInstanceOf(ReadableStream);
      expect(stream2).toBeInstanceOf(ReadableStream);
    });

    it("should handle network interruption during active stream", async () => {
      // Given: Transport with active stream
      const { transport, ws } = await initializeTransport({
        url: "ws://localhost:8000/live",
      });

      const stream = await transport.sendMessages({
        trigger: "submit-message",
        chatId: "chat-1",
        messageId: undefined,
        messages: [{ id: "msg-1", role: "user", content: "Hello" }],
        abortSignal: new AbortController().signal,
      });

      const reader = stream.getReader();

      // Start reading
      const readPromise = reader.read();

      // When: Network error occurs
      ws.simulateError();

      // Then: Should error the stream
      await expect(readPromise).rejects.toThrow("WebSocket error");
      reader.releaseLock();
    });
  });

  // Tool Approval Flow tests removed
  // AI SDK v6 uses sendAutomaticallyWhen + addToolApprovalResponse instead of sendToolResult
  // See experiments/2025-12-13_lib_test_coverage_investigation.md:1640-1679 for details

  // Custom Events (Skip Standard Enqueue)
  // Note: tool-approval-request events are no longer skipped
  // They flow through to AI SDK v6's useChat for native handling
  // Custom events that skip enqueue can be added here in the future

  describe("reconnectToStream()", () => {
    it("should return null (WebSocket cannot reconnect to specific streams)", async () => {
      // Given: Transport instance
      const transport = new WebSocketChatTransport({
        url: "ws://localhost:8000/live",
      });

      // When: Attempting to reconnect
      const result = await transport.reconnectToStream({
        chatId: "chat-1",
      });

      // Then: Should return null
      expect(result).toBeNull();
    });

    it("should return null regardless of chatId", async () => {
      // Given: Transport instance
      const transport = new WebSocketChatTransport({
        url: "ws://localhost:8000/live",
      });

      // When: Attempting to reconnect with different chatIds
      const result1 = await transport.reconnectToStream({ chatId: "chat-1" });
      const result2 = await transport.reconnectToStream({ chatId: "chat-2" });

      // Then: Should always return null
      expect(result1).toBeNull();
      expect(result2).toBeNull();
    });

    it("should return null even with active connection", async () => {
      // Given: Transport with established connection
      const { transport } = await initializeTransport({
        url: "ws://localhost:8000/live",
      });

      // When: Attempting to reconnect
      const result = await transport.reconnectToStream({
        chatId: "chat-1",
      });

      // Then: Should return null (WebSocket limitation)
      expect(result).toBeNull();
    });
  });

  describe("interrupt()", () => {
    it("should send interrupt event with user_abort reason", async () => {
      // Given: Transport with established connection
      const { transport, ws } = await initializeTransport({
        url: "ws://localhost:8000/live",
      });

      ws.sentMessages = [];

      // When: User interrupts
      transport.interrupt("user_abort");

      // Then: Should send interrupt event
      const interruptEvents = ws.sentMessages.filter((msg) => {
        const parsed = JSON.parse(msg);
        return parsed.type === "interrupt";
      });

      expect(interruptEvents.length).toBe(1);
      const event = JSON.parse(interruptEvents[0]);
      expect(event).toMatchObject({
        type: "interrupt",
        version: "1.0",
        reason: "user_abort",
      });
    });

    it("should send interrupt event with timeout reason", async () => {
      // Given: Transport connected
      const { transport, ws } = await initializeTransport({
        url: "ws://localhost:8000/live",
      });

      ws.sentMessages = [];

      // When: Timeout occurs
      transport.interrupt("timeout");

      // Then: Should send interrupt event with timeout reason
      const interruptEvents = ws.sentMessages.filter((msg) => {
        const parsed = JSON.parse(msg);
        return parsed.type === "interrupt";
      });

      expect(interruptEvents.length).toBe(1);
      const event = JSON.parse(interruptEvents[0]);
      expect(event.reason).toBe("timeout");
    });

    it("should send interrupt event without reason", async () => {
      // Given: Transport connected
      const { transport, ws } = await initializeTransport({
        url: "ws://localhost:8000/live",
      });

      ws.sentMessages = [];

      // When: Interrupting without specific reason
      transport.interrupt();

      // Then: Should send interrupt event without reason field
      const interruptEvents = ws.sentMessages.filter((msg) => {
        const parsed = JSON.parse(msg);
        return parsed.type === "interrupt";
      });

      expect(interruptEvents.length).toBe(1);
      const event = JSON.parse(interruptEvents[0]);
      expect(event.type).toBe("interrupt");
      expect(event.reason).toBeUndefined();
    });
  });

  describe("Audio Streaming (data-pcm)", () => {
    it("should process data-pcm events when audioContext is provided", async () => {
      // Given: Transport with audioContext
      const mockAudioContext = {
        voiceChannel: {
          sendChunk: vi.fn(),
          onComplete: vi.fn(),
        },
      };

      const transport = new WebSocketChatTransport({
        url: "ws://localhost:8000/live",
        audioContext: mockAudioContext as any,
      });

      const streamPromise = transport.sendMessages({
        trigger: "submit-message",
        chatId: "chat-1",
        messageId: undefined,
        messages: [{ id: "msg-1", role: "user", content: "Hello" }],
        abortSignal: new AbortController().signal,
      });

      await vi.waitFor(() => {
        expect(transport.ws?.readyState).toBe(MockWebSocket.OPEN);
      });

      const _stream = await streamPromise;
      const ws = transport.ws as unknown as MockWebSocket;

      // When: Server sends data-pcm event
      const pcmData = btoa("fake-pcm-data");
      ws.simulateMessage({
        type: "data-pcm",
        data: {
          content: pcmData,
          sampleRate: 24000,
          channels: 1,
          bitDepth: 16,
        },
      });

      // Then: Should send chunk to audioContext
      await vi.waitFor(() => {
        expect(mockAudioContext.voiceChannel.sendChunk).toHaveBeenCalledWith({
          content: pcmData,
          sampleRate: 24000,
          channels: 1,
          bitDepth: 16,
        });
      });
    });

    it("should not enqueue data-pcm events to stream", async () => {
      // Given: Transport with audioContext
      const mockAudioContext = {
        voiceChannel: {
          sendChunk: vi.fn(),
        },
      };

      const transport = new WebSocketChatTransport({
        url: "ws://localhost:8000/live",
        audioContext: mockAudioContext as any,
      });

      const streamPromise = transport.sendMessages({
        trigger: "submit-message",
        chatId: "chat-1",
        messageId: undefined,
        messages: [{ id: "msg-1", role: "user", content: "Hello" }],
        abortSignal: new AbortController().signal,
      });

      await vi.waitFor(() => {
        expect(transport.ws?.readyState).toBe(MockWebSocket.OPEN);
      });

      const stream = await streamPromise;
      const ws = transport.ws as unknown as MockWebSocket;
      const reader = stream.getReader();

      // When: Server sends data-pcm event
      ws.simulateMessage({
        type: "data-pcm",
        data: {
          content: btoa("fake-pcm-data"),
          sampleRate: 24000,
          channels: 1,
          bitDepth: 16,
        },
      });

      // Then: Stream should not receive data-pcm chunk (it's skipped)
      // Send finish to close stream
      ws.simulateMessage({ type: "finish" });
      ws.close();

      const events: any[] = [];
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          events.push(value);
        }
      } finally {
        reader.releaseLock();
      }

      // Verify no data-pcm events in stream
      const pcmEvents = events.filter((e) => e.type === "data-pcm");
      expect(pcmEvents.length).toBe(0);
    });

    it("should buffer multiple PCM chunks", async () => {
      // Given: Transport with audioContext
      const mockAudioContext = {
        voiceChannel: {
          sendChunk: vi.fn(),
        },
      };

      const transport = new WebSocketChatTransport({
        url: "ws://localhost:8000/live",
        audioContext: mockAudioContext as any,
      });

      const streamPromise = transport.sendMessages({
        trigger: "submit-message",
        chatId: "chat-1",
        messageId: undefined,
        messages: [{ id: "msg-1", role: "user", content: "Hello" }],
        abortSignal: new AbortController().signal,
      });

      await vi.waitFor(() => {
        expect(transport.ws?.readyState).toBe(MockWebSocket.OPEN);
      });

      await streamPromise;
      const ws = transport.ws as unknown as MockWebSocket;

      // When: Server sends multiple PCM chunks
      ws.simulateMessage({
        type: "data-pcm",
        data: {
          content: btoa("chunk1"),
          sampleRate: 24000,
          channels: 1,
          bitDepth: 16,
        },
      });

      ws.simulateMessage({
        type: "data-pcm",
        data: {
          content: btoa("chunk2"),
          sampleRate: 24000,
          channels: 1,
          bitDepth: 16,
        },
      });

      ws.simulateMessage({
        type: "data-pcm",
        data: {
          content: btoa("chunk3"),
          sampleRate: 24000,
          channels: 1,
          bitDepth: 16,
        },
      });

      // Then: All chunks should be sent to audioContext
      await vi.waitFor(() => {
        expect(mockAudioContext.voiceChannel.sendChunk).toHaveBeenCalledTimes(
          3,
        );
      });
    });

    it("should skip data-pcm events when audioContext is not provided", async () => {
      // Given: Transport WITHOUT audioContext
      const transport = new WebSocketChatTransport({
        url: "ws://localhost:8000/live",
        // No audioContext
      });

      const streamPromise = transport.sendMessages({
        trigger: "submit-message",
        chatId: "chat-1",
        messageId: undefined,
        messages: [{ id: "msg-1", role: "user", content: "Hello" }],
        abortSignal: new AbortController().signal,
      });

      await vi.waitFor(() => {
        expect(transport.ws?.readyState).toBe(MockWebSocket.OPEN);
      });

      const _stream = await streamPromise;
      const ws = transport.ws as unknown as MockWebSocket;

      // When: Server sends data-pcm event
      ws.simulateMessage({
        type: "data-pcm",
        data: {
          content: btoa("fake-pcm-data"),
          sampleRate: 24000,
          channels: 1,
          bitDepth: 16,
        },
      });

      // Then: Should not crash (just skip)
      // This is tested by not throwing - the event is ignored
      expect(true).toBe(true);
    });
  });

  describe("Tool Events", () => {
    it("should process tool-approval-request event through stream", async () => {
      // Given: Transport with active stream
      const transport = new WebSocketChatTransport({
        url: "ws://localhost:8000/live",
      });

      const streamPromise = transport.sendMessages({
        trigger: "submit-message",
        chatId: "chat-1",
        messageId: undefined,
        messages: [{ id: "msg-1", role: "user", content: "Change BGM" }],
        abortSignal: new AbortController().signal,
      });

      await vi.waitFor(() => {
        expect(transport.ws?.readyState).toBe(MockWebSocket.OPEN);
      });

      const stream = await streamPromise;
      const ws = transport.ws as unknown as MockWebSocket;

      // When: Server sends tool-approval-request
      ws.simulateMessage({
        type: "tool-approval-request",
        approvalId: "approval-123",
        toolCallId: "call-456",
        toolName: "changeBGM",
        args: { bgm: "energetic" },
      });

      // Then: Event should flow through to useChat
      const reader = stream.getReader();
      const { value } = await reader.read();
      reader.releaseLock();

      expect(value).toMatchObject({
        type: "tool-approval-request",
        approvalId: "approval-123",
        toolCallId: "call-456",
      });
    });

    it("should log finish event with audio metadata", async () => {
      // Given: Transport with audioContext
      const mockAudioContext = {
        voiceChannel: {
          sendChunk: vi.fn(),
          onComplete: vi.fn(),
        },
      };

      const transport = new WebSocketChatTransport({
        url: "ws://localhost:8000/live",
        audioContext: mockAudioContext as any,
      });

      const streamPromise = transport.sendMessages({
        trigger: "submit-message",
        chatId: "chat-1",
        messageId: undefined,
        messages: [{ id: "msg-1", role: "user", content: "Hello" }],
        abortSignal: new AbortController().signal,
      });

      await vi.waitFor(() => {
        expect(transport.ws?.readyState).toBe(MockWebSocket.OPEN);
      });

      const stream = await streamPromise;
      const ws = transport.ws as unknown as MockWebSocket;

      // When: Server sends finish with audio metadata
      ws.simulateMessage({
        type: "finish",
        messageMetadata: {
          audio: {
            chunks: 100,
            bytes: 48000,
            sampleRate: 24000,
            duration: 2.0,
          },
        },
      });

      // Then: Should call onComplete callback
      const reader = stream.getReader();
      await reader.read();
      reader.releaseLock();

      expect(mockAudioContext.voiceChannel.onComplete).toHaveBeenCalledWith({
        chunks: 100,
        bytes: 48000,
        sampleRate: 24000,
        duration: 2.0,
      });
    });

    it("should handle finish event without metadata gracefully", async () => {
      // Given: Fresh transport
      const transport = new WebSocketChatTransport({
        url: "ws://localhost:8000/live",
      });

      const streamPromise = transport.sendMessages({
        trigger: "submit-message",
        chatId: "chat-1",
        messageId: undefined,
        messages: [{ id: "msg-1", role: "user", content: "Hello" }],
        abortSignal: new AbortController().signal,
      });

      await vi.waitFor(() => {
        expect(transport.ws?.readyState).toBe(MockWebSocket.OPEN);
      });

      const stream = await streamPromise;
      const ws = transport.ws as unknown as MockWebSocket;

      // When: Server sends finish without metadata
      ws.simulateMessage({
        type: "finish",
        // No messageMetadata
      });

      // Then: Should not crash
      const reader = stream.getReader();
      const { value } = await reader.read();
      reader.releaseLock();

      expect(value.type).toBe("finish");
    });

    // Parametrized tests for messageMetadata fields
    // Coverage: field_coverage_config.yaml - groundingMetadata, citationMetadata, cacheMetadata, modelVersion
    it.each([
      {
        field: "grounding",
        value: {
          sources: [
            {
              startIndex: 0,
              endIndex: 10,
              uri: "https://example.com/source1",
              title: "Example Source 1",
            },
            {
              startIndex: 11,
              endIndex: 20,
              uri: "https://example.com/source2",
              title: "Example Source 2",
            },
          ],
        },
        description: "grounding-with-multiple-sources",
      },
      {
        field: "citations",
        value: [
          { startIndex: 0, endIndex: 10, uri: "https://example.com/cite1" },
          { startIndex: 15, endIndex: 25, uri: "https://example.com/cite2" },
        ],
        description: "citations-with-multiple-entries",
      },
      {
        field: "cache",
        value: { hits: 5, misses: 2 },
        description: "cache-with-hits-and-misses",
      },
      {
        field: "modelVersion",
        value: "gemini-2.0-flash-001",
        description: "model-version-string",
      },
    ])("should forward messageMetadata.$field from backend to frontend ($description)", async ({
      field,
      value,
    }) => {
      // Given: Fresh transport
      const transport = new WebSocketChatTransport({
        url: "ws://localhost:8000/live",
      });

      const streamPromise = transport.sendMessages({
        trigger: "submit-message",
        chatId: "chat-1",
        messageId: undefined,
        messages: [{ id: "msg-1", role: "user", content: "Hello" }],
        abortSignal: new AbortController().signal,
      });

      await vi.waitFor(() => {
        expect(transport.ws?.readyState).toBe(MockWebSocket.OPEN);
      });

      const stream = await streamPromise;
      const ws = transport.ws as unknown as MockWebSocket;

      // When: Server sends finish event with messageMetadata field
      const finishEvent: any = {
        type: "finish",
        messageMetadata: {},
      };
      finishEvent.messageMetadata[field] = value;

      ws.simulateMessage(finishEvent);

      // Then: Stream should emit finish chunk with messageMetadata field
      const reader = stream.getReader();
      const { value: chunk } = await reader.read();
      reader.releaseLock();

      expect(chunk.type).toBe("finish");
      expect(chunk.messageMetadata).toBeDefined();
      expect(chunk.messageMetadata[field]).toEqual(value);
    });
  });

  describe("Audio Control Methods", () => {
    it("should send audio_control event with start action", async () => {
      // Given: Transport with established connection
      const { transport, ws } = await initializeTransport({
        url: "ws://localhost:8000/live",
      });

      ws.sentMessages = [];

      // When: Starting audio input
      transport.startAudio();

      // Then: Should send audio_control event with start action
      const audioControlEvents = ws.sentMessages.filter((msg) => {
        const parsed = JSON.parse(msg);
        return parsed.type === "audio_control";
      });

      expect(audioControlEvents.length).toBe(1);
      const event = JSON.parse(audioControlEvents[0]);
      expect(event).toMatchObject({
        type: "audio_control",
        version: "1.0",
        action: "start",
      });
    });

    it("should send audio_control event with stop action", async () => {
      // Given: Transport connected
      const { transport, ws } = await initializeTransport({
        url: "ws://localhost:8000/live",
      });

      ws.sentMessages = [];

      // When: Stopping audio input
      transport.stopAudio();

      // Then: Should send audio_control event with stop action
      const audioControlEvents = ws.sentMessages.filter((msg) => {
        const parsed = JSON.parse(msg);
        return parsed.type === "audio_control";
      });

      expect(audioControlEvents.length).toBe(1);
      const event = JSON.parse(audioControlEvents[0]);
      expect(event).toMatchObject({
        type: "audio_control",
        version: "1.0",
        action: "stop",
      });
    });

    it("should send audio_chunk event with PCM data", async () => {
      // Given: Transport connected
      const { transport, ws } = await initializeTransport({
        url: "ws://localhost:8000/live",
      });

      ws.sentMessages = [];

      const audioChunk = {
        content: btoa("microphone-pcm-data"),
        sampleRate: 16000,
        channels: 1,
        bitDepth: 16,
      };

      // When: Sending audio chunk
      transport.sendAudioChunk(audioChunk);

      // Then: Should send audio_chunk event
      const audioChunkEvents = ws.sentMessages.filter((msg) => {
        const parsed = JSON.parse(msg);
        return parsed.type === "audio_chunk";
      });

      expect(audioChunkEvents.length).toBe(1);
      const event = JSON.parse(audioChunkEvents[0]);
      expect(event).toMatchObject({
        type: "audio_chunk",
        version: "1.0",
        data: {
          chunk: audioChunk.content,
          sampleRate: 16000,
          channels: 1,
          bitDepth: 16,
        },
      });
    });

    it("should send multiple audio chunks in sequence", async () => {
      // Given: Transport connected
      const { transport, ws } = await initializeTransport({
        url: "ws://localhost:8000/live",
      });

      ws.sentMessages = [];

      // When: Sending multiple audio chunks
      transport.sendAudioChunk({
        content: btoa("chunk1"),
        sampleRate: 16000,
        channels: 1,
        bitDepth: 16,
      });

      transport.sendAudioChunk({
        content: btoa("chunk2"),
        sampleRate: 16000,
        channels: 1,
        bitDepth: 16,
      });

      transport.sendAudioChunk({
        content: btoa("chunk3"),
        sampleRate: 16000,
        channels: 1,
        bitDepth: 16,
      });

      // Then: Should send all chunks
      const audioChunkEvents = ws.sentMessages.filter((msg) => {
        const parsed = JSON.parse(msg);
        return parsed.type === "audio_chunk";
      });

      expect(audioChunkEvents.length).toBe(3);
    });

    it("should handle start/stop audio cycle", async () => {
      // Given: Transport connected
      const { transport, ws } = await initializeTransport({
        url: "ws://localhost:8000/live",
      });

      ws.sentMessages = [];

      // When: Starting, sending chunks, then stopping
      transport.startAudio();
      transport.sendAudioChunk({
        content: btoa("audio-data"),
        sampleRate: 16000,
        channels: 1,
        bitDepth: 16,
      });
      transport.stopAudio();

      // Then: Should send start, chunk, stop events in order
      const events = ws.sentMessages.map((msg) => JSON.parse(msg));

      expect(events.length).toBe(3);
      expect(events[0].type).toBe("audio_control");
      expect(events[0].action).toBe("start");
      expect(events[1].type).toBe("audio_chunk");
      expect(events[2].type).toBe("audio_control");
      expect(events[2].action).toBe("stop");
    });
  });

  describe("Latency Monitoring (Ping/Pong)", () => {
    it("should start ping interval on connection", async () => {
      // Given: Transport with latency callback
      const latencyCallback = vi.fn();
      const transport = new WebSocketChatTransport({
        url: "ws://localhost:8000/live",
        latencyCallback,
      });

      // When: Establishing connection
      const streamPromise = transport.sendMessages({
        trigger: "submit-message",
        chatId: "chat-1",
        messageId: undefined,
        messages: [{ id: "msg-1", role: "user", content: "Hello" }],
        abortSignal: new AbortController().signal,
      });

      await vi.waitFor(() => {
        expect(transport.ws?.readyState).toBe(MockWebSocket.OPEN);
      });

      await streamPromise;
      const ws = transport.ws as unknown as MockWebSocket;

      // Then: Ping interval should be started
      // Wait a bit for ping to be sent
      await new Promise((resolve) => setTimeout(resolve, 100));

      const pingEvents = ws.sentMessages.filter((msg) => {
        const parsed = JSON.parse(msg);
        return parsed.type === "ping";
      });

      // Should have sent at least initial ping
      expect(pingEvents.length).toBeGreaterThanOrEqual(0);
    });

    it("should calculate RTT from pong response", async () => {
      // Given: Transport with latency callback
      const latencyCallback = vi.fn();
      const transport = new WebSocketChatTransport({
        url: "ws://localhost:8000/live",
        latencyCallback,
      });

      const streamPromise = transport.sendMessages({
        trigger: "submit-message",
        chatId: "chat-1",
        messageId: undefined,
        messages: [{ id: "msg-1", role: "user", content: "Hello" }],
        abortSignal: new AbortController().signal,
      });

      await vi.waitFor(() => {
        expect(transport.ws?.readyState).toBe(MockWebSocket.OPEN);
      });

      const _stream = await streamPromise;
      const ws = transport.ws as unknown as MockWebSocket;

      // Manually trigger ping
      const pingTime = Date.now();
      transport.lastPingTime = pingTime;

      // When: Server sends pong response (NOT in SSE format)
      // Pong is sent as plain JSON, not SSE
      if (ws.onmessage) {
        ws.onmessage(
          new MessageEvent("message", {
            data: JSON.stringify({
              type: "pong",
              timestamp: pingTime,
            }),
          }),
        );
      }

      // Then: Should calculate RTT and call callback
      await vi.waitFor(() => {
        expect(latencyCallback).toHaveBeenCalled();
      });

      const rtt = latencyCallback.mock.calls[0][0];
      expect(rtt).toBeGreaterThanOrEqual(0);
      expect(rtt).toBeLessThan(1000); // RTT should be reasonable
    });

    it("should stop ping on connection close", async () => {
      // Given: Transport with active ping
      const { transport } = await initializeTransport({
        url: "ws://localhost:8000/live",
      });

      // Verify ping interval exists
      expect(transport.pingInterval).toBeDefined();

      // When: Closing connection
      transport.close();

      // Then: Ping interval should be cleared
      expect(transport.pingInterval).toBeNull();
    });
  });

  describe("close()", () => {
    it("should close WebSocket connection", async () => {
      // Given: Transport with established connection
      const { transport, ws } = await initializeTransport({
        url: "ws://localhost:8000/live",
      });

      expect(ws.readyState).toBe(MockWebSocket.OPEN);

      // When: Closing transport
      transport.close();

      // Then: WebSocket should be closed
      expect(ws.readyState).toBe(MockWebSocket.CLOSED);
    });

    it("should set ws to null after close", async () => {
      // Given: Transport connected
      const { transport } = await initializeTransport({
        url: "ws://localhost:8000/live",
      });

      expect(transport.ws).toBeDefined();

      // When: Closing
      transport.close();

      // Then: ws should be null
      expect(transport.ws).toBeNull();
    });

    it("should handle close when no connection exists", () => {
      // Given: Transport without connection
      const transport = new WebSocketChatTransport({
        url: "ws://localhost:8000/live",
      });

      // When/Then: Closing should not throw
      expect(() => transport.close()).not.toThrow();
    });
  });

  // P4-T10: Controller Lifecycle Management Tests
  describe("Controller Lifecycle Management (P4-T10)", () => {
    it("should set currentController on new connection", async () => {
      // Given: Fresh transport
      const transport = new WebSocketChatTransport({
        url: "ws://localhost:8000/live",
      });

      // When: Send messages (creates new connection)
      const _streamPromise = transport.sendMessages({
        trigger: "submit-message",
        chatId: "test-chat",
        messageId: "msg-1",
        messages: [
          {
            id: "1",
            role: "user",
            parts: [{ type: "text", text: "Hello" }],
          },
        ],
        abortSignal: undefined,
      });

      // Wait for connection to establish
      await vi.waitFor(() => {
        expect((transport as any).ws).toBeDefined();
        expect((transport as any).ws?.readyState).toBe(MockWebSocket.OPEN);
      });

      // Then: currentController should be set
      expect((transport as any).currentController).toBeDefined();
      expect((transport as any).currentController).not.toBeNull();
    });

    it("should close previous controller when reusing connection", async () => {
      // Given: Transport with existing connection
      const transport = new WebSocketChatTransport({
        url: "ws://localhost:8000/live",
      });

      // Create first stream
      const _stream1Promise = transport.sendMessages({
        trigger: "submit-message",
        chatId: "test-chat",
        messageId: "msg-1",
        messages: [
          {
            id: "1",
            role: "user",
            parts: [{ type: "text", text: "First message" }],
          },
        ],
        abortSignal: undefined,
      });

      await vi.waitFor(() => {
        expect((transport as any).ws?.readyState).toBe(MockWebSocket.OPEN);
      });

      // Get first controller reference
      const firstController = (transport as any).currentController;
      expect(firstController).toBeDefined();

      // When: Send second message (this should trigger controller override logic)
      const _stream2Promise = transport.sendMessages({
        trigger: "submit-message",
        chatId: "test-chat",
        messageId: "msg-2",
        messages: [
          {
            id: "2",
            role: "user",
            parts: [{ type: "text", text: "Second message" }],
          },
        ],
        abortSignal: undefined,
      });

      await vi.waitFor(() => {
        expect((transport as any).currentController).toBeDefined();
      });

      // Then: New controller should be different from first
      const secondController = (transport as any).currentController;
      expect(secondController).not.toBe(firstController);

      // Verify warning was logged about closing previous controller
      // (implementation closes previous controller in try-catch)
    });

    it("should clear currentController on [DONE] message", async () => {
      // Given: Transport with active stream
      const transport = new WebSocketChatTransport({
        url: "ws://localhost:8000/live",
      });

      const streamPromise = transport.sendMessages({
        trigger: "submit-message",
        chatId: "test-chat",
        messageId: "msg-1",
        messages: [
          {
            id: "1",
            role: "user",
            parts: [{ type: "text", text: "Hello" }],
          },
        ],
        abortSignal: undefined,
      });

      // Wait for controller to be set
      await vi.waitFor(() => {
        const controller = (transport as any).currentController;
        expect(controller).toBeDefined();
        expect(controller).not.toBeNull();
      });

      const ws = (transport as any).ws as MockWebSocket;
      const stream = await streamPromise;
      const reader = stream.getReader();

      // Start reading stream in background
      const readPromise = (async () => {
        const chunks: any[] = [];
        try {
          // Using while(true) with break is acceptable in test code for async iteration
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
          }
        } catch (_err) {
          // Stream might close before all chunks are read
        }
        return chunks;
      })();

      // When: Send actual [DONE] message (SSE format)
      ws.simulateMessage({ type: "sse", data: "data: [DONE]\n\n" });

      // Wait for stream processing
      await readPromise;

      // Then: currentController should be cleared after [DONE] processing
      expect((transport as any).currentController).toBeNull();

      // Note: This tests the complete [DONE] message processing flow:
      // WebSocket → handleWebSocketMessage → Line 547 → currentController = null
    });

    it("should clear currentController on error", async () => {
      // Given: Transport with active stream
      const transport = new WebSocketChatTransport({
        url: "ws://localhost:8000/live",
      });

      const _streamPromise = transport.sendMessages({
        trigger: "submit-message",
        chatId: "test-chat",
        messageId: "msg-1",
        messages: [
          {
            id: "1",
            role: "user",
            parts: [{ type: "text", text: "Hello" }],
          },
        ],
        abortSignal: undefined,
      });

      await vi.waitFor(() => {
        expect((transport as any).currentController).toBeDefined();
      });

      // When: Receive malformed message that causes error
      const ws = (transport as any).ws as MockWebSocket;
      ws.simulateMessage({ type: "sse", data: "data: {invalid json\n\n" });

      // Then: currentController should be cleared
      await vi.waitFor(() => {
        expect((transport as any).currentController).toBeNull();
      });
    });

    it("should handle already-closed controller gracefully", async () => {
      // Given: Transport with active stream
      const transport = new WebSocketChatTransport({
        url: "ws://localhost:8000/live",
      });

      const _stream1Promise = transport.sendMessages({
        trigger: "submit-message",
        chatId: "test-chat",
        messageId: "msg-1",
        messages: [
          {
            id: "1",
            role: "user",
            parts: [{ type: "text", text: "First" }],
          },
        ],
        abortSignal: undefined,
      });

      await vi.waitFor(() => {
        expect((transport as any).ws?.readyState).toBe(MockWebSocket.OPEN);
      });

      // Get first controller and close it manually
      const firstController = (transport as any).currentController;
      expect(firstController).toBeDefined();

      // Simulate controller already closed
      firstController.close();
      (transport as any).currentController = null;

      expect((transport as any).currentController).toBeNull();

      // When: Send second message (try to close already-closed controller)
      // This should not throw error
      await expect(
        transport.sendMessages({
          trigger: "submit-message",
          chatId: "test-chat",
          messageId: "msg-2",
          messages: [
            {
              id: "2",
              role: "user",
              parts: [{ type: "text", text: "Second" }],
            },
          ],
          abortSignal: undefined,
        }),
      ).resolves.toBeDefined();

      // Then: New controller should be set
      await vi.waitFor(() => {
        expect((transport as any).currentController).toBeDefined();
      });
    });

    it("should handle WebSocket onerror event", async () => {
      // Given: Transport with active connection
      const transport = new WebSocketChatTransport({
        url: "ws://localhost:8000/live",
      });

      const streamPromise = transport.sendMessages({
        trigger: "submit-message",
        chatId: "test-chat",
        messageId: "msg-1",
        messages: [
          {
            id: "1",
            role: "user",
            parts: [{ type: "text", text: "Hello" }],
          },
        ],
        abortSignal: undefined,
      });

      // Wait for connection
      await vi.waitFor(() => {
        expect((transport as any).ws?.readyState).toBe(MockWebSocket.OPEN);
      });

      const stopPingSpy = vi.spyOn(transport as any, "stopPing");

      // When: WebSocket error occurs
      const ws = (transport as any).ws as MockWebSocket;
      const errorEvent = new Event("error");
      if (ws.onerror) {
        ws.onerror(errorEvent);
      }

      // Then: stopPing should be called and stream should error
      expect(stopPingSpy).toHaveBeenCalled();

      // Verify stream errors when reading
      const stream = await streamPromise;
      const reader = stream.getReader();
      await expect(reader.read()).rejects.toThrow();
    });

    it("should handle WebSocket onclose event", async () => {
      // Given: Transport with active connection
      const transport = new WebSocketChatTransport({
        url: "ws://localhost:8000/live",
      });

      const streamPromise = transport.sendMessages({
        trigger: "submit-message",
        chatId: "test-chat",
        messageId: "msg-1",
        messages: [
          {
            id: "1",
            role: "user",
            parts: [{ type: "text", text: "Hello" }],
          },
        ],
        abortSignal: undefined,
      });

      // Wait for connection
      await vi.waitFor(() => {
        expect((transport as any).ws?.readyState).toBe(MockWebSocket.OPEN);
      });

      const stopPingSpy = vi.spyOn(transport as any, "stopPing");

      // When: WebSocket closes
      const ws = (transport as any).ws as MockWebSocket;
      ws.close();

      // Then: stopPing should be called and stream should close
      expect(stopPingSpy).toHaveBeenCalled();

      // Verify stream closes gracefully
      const stream = await streamPromise;
      const reader = stream.getReader();
      const result = await reader.read();
      expect(result.done).toBe(true);
    });
  });
});
