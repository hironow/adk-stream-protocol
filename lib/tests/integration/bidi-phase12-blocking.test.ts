/**
 * Integration Tests: BIDI Phase 12 BLOCKING Controller Lifecycle (ADR 0009, ADR 0011)
 *
 * Tests the WebSocketChatTransport controller lifecycle behavior in Phase 12 BLOCKING mode.
 *
 * Key Behaviors:
 * - Controller reuse: When no [DONE] received, reuse existing controller
 * - Controller creation: After [DONE], create new controller for next stream
 * - State preservation: Message state preserved across approval cycle
 * - Timeout: Backend response timeout after approval-request (ADR 0011 gap fix)
 *
 * Phase 12 BLOCKING Pattern:
 * 1. Backend sends tool-approval-request + finish-step
 * 2. Frontend closes stream (doneReceived = true)
 * 3. User approves → sendMessages() called
 * 4. Transport checks doneReceived → creates NEW controller
 * 5. Backend processes approval, sends tool-output-available + [DONE]
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventReceiver } from "../../bidi/event_receiver";
import { WebSocketChatTransport } from "../../bidi/transport";
import type { UIMessageChunkFromAISDKv6 } from "../../utils";

// Mock WebSocket for controlled testing
class MockWebSocket {
  public onopen: (() => void) | null = null;
  public onmessage: ((event: { data: string }) => void) | null = null;
  public onerror: ((error: Event) => void) | null = null;
  public onclose: (() => void) | null = null;
  public readyState: number = WebSocket.CONNECTING;

  public sentMessages: string[] = [];

  constructor(_url: string) {
    // Auto-connect after construction using microtask for more reliable timing
    Promise.resolve().then(() => {
      this.readyState = WebSocket.OPEN;
      this.onopen?.();
    });
  }

  send(data: string): void {
    this.sentMessages.push(data);
  }

  close(): void {
    this.readyState = WebSocket.CLOSED;
    this.onclose?.();
  }

  // Test helper: Simulate server message
  simulateMessage(data: string): void {
    this.onmessage?.({ data });
  }
}

// Store reference to created WebSocket
let mockWs: MockWebSocket | null = null;

describe("BIDI Phase 12 BLOCKING: Controller Lifecycle", () => {
  beforeEach(() => {
    // Mock global WebSocket
    vi.stubGlobal(
      "WebSocket",
      class extends MockWebSocket {
        constructor(url: string) {
          super(url);
          mockWs = this;
        }
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    mockWs = null;
  });

  it("should mark doneReceived=true when finish-step received after approval-request", async () => {
    // Given: EventReceiver with default config
    const eventReceiver = new EventReceiver({});

    // Create mock controller
    const chunks: UIMessageChunkFromAISDKv6[] = [];
    const controller = {
      enqueue: (chunk: UIMessageChunkFromAISDKv6) => chunks.push(chunk),
      close: vi.fn(),
      error: vi.fn(),
    } as unknown as ReadableStreamDefaultController<UIMessageChunkFromAISDKv6>;

    // When: Receive approval-request then finish-step
    eventReceiver.handleMessage(
      'data: {"type": "tool-approval-request", "toolCallId": "tool-1", "approvalId": "approval-1"}\n\n',
      controller,
    );
    eventReceiver.handleMessage(
      'data: {"type": "finish-step"}\n\n',
      controller,
    );

    // Then: doneReceived should be true
    expect(eventReceiver.isDoneReceived()).toBe(true);
    expect(controller.close).toHaveBeenCalled();
    expect(chunks).toHaveLength(2); // approval-request + finish-step
  });

  it("should call onApprovalRequestReceived callback when approval-request received", async () => {
    // Given: EventReceiver with callback
    const onApprovalRequestReceived = vi.fn();
    const eventReceiver = new EventReceiver({ onApprovalRequestReceived });

    const controller = {
      enqueue: vi.fn(),
      close: vi.fn(),
      error: vi.fn(),
    } as unknown as ReadableStreamDefaultController<UIMessageChunkFromAISDKv6>;

    // When: Receive approval-request
    eventReceiver.handleMessage(
      'data: {"type": "tool-approval-request", "toolCallId": "tool-1", "approvalId": "approval-1"}\n\n',
      controller,
    );

    // Then: Callback should be called
    expect(onApprovalRequestReceived).toHaveBeenCalledTimes(1);
  });

  it("should call onApprovalStreamClosed callback when finish-step received after approval-request", async () => {
    // Given: EventReceiver with callback
    const onApprovalStreamClosed = vi.fn();
    const eventReceiver = new EventReceiver({ onApprovalStreamClosed });

    const controller = {
      enqueue: vi.fn(),
      close: vi.fn(),
      error: vi.fn(),
    } as unknown as ReadableStreamDefaultController<UIMessageChunkFromAISDKv6>;

    // When: Receive approval-request then finish-step
    eventReceiver.handleMessage(
      'data: {"type": "tool-approval-request", "toolCallId": "tool-1", "approvalId": "approval-1"}\n\n',
      controller,
    );
    eventReceiver.handleMessage(
      'data: {"type": "finish-step"}\n\n',
      controller,
    );

    // Then: onApprovalStreamClosed should be called
    expect(onApprovalStreamClosed).toHaveBeenCalledTimes(1);
  });

  it("should NOT call onApprovalStreamClosed when finish-step received without prior approval-request", async () => {
    // Given: EventReceiver with callback
    const onApprovalStreamClosed = vi.fn();
    const eventReceiver = new EventReceiver({ onApprovalStreamClosed });

    const controller = {
      enqueue: vi.fn(),
      close: vi.fn(),
      error: vi.fn(),
    } as unknown as ReadableStreamDefaultController<UIMessageChunkFromAISDKv6>;

    // When: Receive finish-step WITHOUT prior approval-request
    eventReceiver.handleMessage(
      'data: {"type": "finish-step"}\n\n',
      controller,
    );

    // Then: onApprovalStreamClosed should NOT be called
    expect(onApprovalStreamClosed).not.toHaveBeenCalled();
  });

  it("should reset state correctly after reset() is called", async () => {
    // Given: EventReceiver in done state
    const eventReceiver = new EventReceiver({});

    const controller = {
      enqueue: vi.fn(),
      close: vi.fn(),
      error: vi.fn(),
    } as unknown as ReadableStreamDefaultController<UIMessageChunkFromAISDKv6>;

    // Set up done state
    eventReceiver.handleMessage(
      'data: {"type": "tool-approval-request", "toolCallId": "tool-1", "approvalId": "approval-1"}\n\n',
      controller,
    );
    eventReceiver.handleMessage(
      'data: {"type": "finish-step"}\n\n',
      controller,
    );
    expect(eventReceiver.isDoneReceived()).toBe(true);

    // When: Reset
    eventReceiver.reset();

    // Then: State should be cleared
    expect(eventReceiver.isDoneReceived()).toBe(false);
  });

  it("should create new controller after [DONE] received", async () => {
    // Given: Transport with established connection
    const transport = new WebSocketChatTransport({
      url: "ws://localhost:8000/live",
      timeout: 1000,
    });

    // First sendMessages call
    const stream1 = await transport.sendMessages({
      trigger: "submit-message",
      chatId: "chat-1",
      messageId: "msg-1",
      messages: [{ id: "1", role: "user", content: "Hello", parts: [] }],
      abortSignal: undefined,
    });

    // Wait for connection
    await vi.waitFor(() => mockWs?.readyState === WebSocket.OPEN);

    // Simulate server response with [DONE]
    mockWs?.simulateMessage(
      'data: {"type": "start", "messageId": "msg-1"}\n\n',
    );
    mockWs?.simulateMessage('data: {"type": "text-delta", "text": "Hi"}\n\n');
    mockWs?.simulateMessage("data: [DONE]\n\n");

    // Read from stream to ensure it completes
    const reader1 = stream1.getReader();
    const chunks1: UIMessageChunkFromAISDKv6[] = [];
    try {
      while (true) {
        const { done, value } = await reader1.read();
        if (done) break;
        chunks1.push(value);
      }
    } catch {
      // Stream may error on close, which is expected
    }

    // When: Second sendMessages call after [DONE]
    const stream2 = await transport.sendMessages({
      trigger: "submit-message",
      chatId: "chat-1",
      messageId: "msg-2",
      messages: [{ id: "2", role: "user", content: "How are you?", parts: [] }],
      abortSignal: undefined,
    });

    // Then: Should be a new stream (not the same object)
    expect(stream2).not.toBe(stream1);

    // Cleanup
    transport._close();
  });

  it("should handle multiple [DONE] markers correctly (only first counts)", async () => {
    // Given: EventReceiver
    const eventReceiver = new EventReceiver({});

    const closeMock = vi.fn();
    const controller = {
      enqueue: vi.fn(),
      close: closeMock,
      error: vi.fn(),
    } as unknown as ReadableStreamDefaultController<UIMessageChunkFromAISDKv6>;

    // When: Receive multiple [DONE] markers
    eventReceiver.handleMessage("data: [DONE]\n\n", controller);
    eventReceiver.handleMessage("data: [DONE]\n\n", controller); // Protocol violation
    eventReceiver.handleMessage("data: [DONE]\n\n", controller); // Protocol violation

    // Then: close() should only be called once
    expect(closeMock).toHaveBeenCalledTimes(1);
    expect(eventReceiver.isDoneReceived()).toBe(true);
  });
});

describe("BIDI Phase 12 BLOCKING: Backend Response Timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();

    // Mock global WebSocket
    vi.stubGlobal(
      "WebSocket",
      class extends MockWebSocket {
        constructor(url: string) {
          super(url);
          mockWs = this;
        }
      },
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    mockWs = null;
  });

  it("should start timeout when approval-request received", async () => {
    // Given: EventReceiver with timeout callbacks
    const onApprovalRequestReceived = vi.fn();
    const eventReceiver = new EventReceiver({ onApprovalRequestReceived });

    const controller = {
      enqueue: vi.fn(),
      close: vi.fn(),
      error: vi.fn(),
    } as unknown as ReadableStreamDefaultController<UIMessageChunkFromAISDKv6>;

    // When: Receive approval-request
    eventReceiver.handleMessage(
      'data: {"type": "tool-approval-request", "toolCallId": "tool-1", "approvalId": "approval-1"}\n\n',
      controller,
    );

    // Then: onApprovalRequestReceived callback should be called (transport uses this to start timeout)
    expect(onApprovalRequestReceived).toHaveBeenCalledTimes(1);
  });

  it("should clear timeout when finish-step received", async () => {
    // Given: EventReceiver with timeout callbacks
    const onApprovalStreamClosed = vi.fn();
    const eventReceiver = new EventReceiver({ onApprovalStreamClosed });

    const controller = {
      enqueue: vi.fn(),
      close: vi.fn(),
      error: vi.fn(),
    } as unknown as ReadableStreamDefaultController<UIMessageChunkFromAISDKv6>;

    // When: Receive approval-request then finish-step
    eventReceiver.handleMessage(
      'data: {"type": "tool-approval-request", "toolCallId": "tool-1", "approvalId": "approval-1"}\n\n',
      controller,
    );
    eventReceiver.handleMessage(
      'data: {"type": "finish-step"}\n\n',
      controller,
    );

    // Then: onApprovalStreamClosed callback should be called (transport uses this to clear timeout)
    expect(onApprovalStreamClosed).toHaveBeenCalledTimes(1);
  });
});
