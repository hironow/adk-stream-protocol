/**
 * Custom WebSocket Mock for BIDI Tests (MSW Alternative)
 *
 * This module provides WebSocket mocking WITHOUT MSW's ws.link(),
 * avoiding libuv handle cleanup issues that cause "Worker exited unexpectedly"
 * errors in Vitest parallel execution.
 *
 * Key Difference from MSW WebSocket:
 * - MSW: Uses @mswjs/interceptors → creates libuv socket handles → cleanup issues
 * - This: Uses vi.stubGlobal → no real sockets → clean parallel execution
 *
 * Usage:
 * ```typescript
 * import { useMockWebSocket, createMockBidiHandler } from '@/lib/tests/helpers/mock-websocket';
 *
 * describe('my bidi tests', () => {
 *   const { getConnections } = useMockWebSocket();
 *
 *   it('should handle message', async () => {
 *     // Setup mock handler
 *     const handler = createMockBidiHandler((ws, message) => {
 *       ws.simulateServerMessage({ type: 'text-delta', delta: 'Hello' });
 *     });
 *
 *     // Connect (will trigger handler)
 *     const transport = new WebSocketChatTransport({ url: 'ws://localhost:8000/live' });
 *
 *     // Get the mock connection
 *     const [mockWs] = getConnections();
 *     mockWs.simulateOpen();
 *     // ...
 *   });
 * });
 * ```
 */

import { afterEach, beforeEach, vi } from "vitest";

/**
 * Enhanced MockWebSocket for BIDI protocol testing
 *
 * Extends the basic WebSocket interface with test helpers for simulating
 * server-side messages, errors, and connection states.
 */
export class BidiMockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = BidiMockWebSocket.CONNECTING;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;

  /** Messages sent by the client (for assertions) */
  sentMessages: string[] = [];

  /** Connection URL */
  url: string;

  /** Custom message handler set by test */
  private messageHandler: ((data: string) => void) | null = null;

  /** Auto-open flag (set to false for manual open control) */
  private autoOpen: boolean;

  constructor(url: string, autoOpen = true) {
    this.url = url;
    this.autoOpen = autoOpen;

    if (this.autoOpen) {
      // Auto-open via microtask (consistent with real WebSocket behavior)
      Promise.resolve().then(() => {
        this.simulateOpen();
      });
    }
  }

  /**
   * Send data to the server (client → server)
   * This is called by the WebSocket client code being tested
   */
  send(data: string): void {
    this.sentMessages.push(data);
    // Trigger registered message handler
    if (this.messageHandler) {
      // Use microtask to simulate async server processing
      Promise.resolve().then(() => {
        this.messageHandler?.(data);
      });
    }
  }

  /**
   * Close the connection (client-initiated)
   */
  close(code?: number, reason?: string): void {
    this.readyState = BidiMockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose(new CloseEvent("close", { code, reason }));
    }
  }

  // ========== Test Helper Methods ==========

  /**
   * Simulate connection open (server → client)
   * Call this to trigger the onopen event
   */
  simulateOpen(): void {
    if (this.readyState !== BidiMockWebSocket.OPEN) {
      this.readyState = BidiMockWebSocket.OPEN;
      if (this.onopen) {
        this.onopen(new Event("open"));
      }
    }
  }

  /**
   * Simulate receiving a raw message from server (server → client)
   * @param data - Raw string data (e.g., SSE format: "data: {...}\n\n")
   */
  simulateRawMessage(data: string): void {
    if (this.onmessage) {
      this.onmessage(new MessageEvent("message", { data }));
    }
  }

  /**
   * Simulate receiving a structured message from server (server → client)
   * Automatically formats as SSE message
   * @param data - Object to send as JSON
   */
  simulateServerMessage(data: Record<string, unknown>): void {
    const sseMessage = `data: ${JSON.stringify(data)}\n\n`;
    this.simulateRawMessage(sseMessage);
  }

  /**
   * Simulate [DONE] marker (end of stream)
   */
  simulateDone(): void {
    this.simulateRawMessage("data: [DONE]\n\n");
  }

  /**
   * Simulate connection error
   */
  simulateError(message?: string): void {
    if (this.onerror) {
      const errorEvent = new Event("error");
      if (message) {
        Object.defineProperty(errorEvent, "message", { value: message });
      }
      this.onerror(errorEvent);
    }
  }

  /**
   * Simulate server-initiated close
   */
  simulateClose(code = 1000, reason = ""): void {
    this.readyState = BidiMockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose(new CloseEvent("close", { code, reason }));
    }
  }

  /**
   * Register a handler for client messages
   * This is used by test helpers to define mock server behavior
   */
  onClientMessage(handler: (data: string) => void): void {
    this.messageHandler = handler;
  }

  // ========== BIDI Protocol Helpers ==========

  /**
   * Send text-start event
   */
  sendTextStart(textId: string): void {
    this.simulateServerMessage({ type: "text-start", id: textId });
  }

  /**
   * Send text-delta event
   */
  sendTextDelta(textId: string, delta: string): void {
    this.simulateServerMessage({ type: "text-delta", id: textId, delta });
  }

  /**
   * Send text-end event
   */
  sendTextEnd(textId: string): void {
    this.simulateServerMessage({ type: "text-end", id: textId });
  }

  /**
   * Send complete text response (start → deltas → end → done)
   */
  sendTextResponse(textId: string, ...textParts: string[]): void {
    this.sendTextStart(textId);
    for (const part of textParts) {
      this.sendTextDelta(textId, part);
    }
    this.sendTextEnd(textId);
    this.simulateDone();
  }

  /**
   * Send tool-input-start event
   */
  sendToolInputStart(toolCallId: string, toolName: string): void {
    this.simulateServerMessage({
      type: "tool-input-start",
      toolCallId,
      toolName,
    });
  }

  /**
   * Send tool-input-available event
   */
  sendToolInputAvailable(
    toolCallId: string,
    toolName: string,
    input: Record<string, unknown>,
  ): void {
    this.simulateServerMessage({
      type: "tool-input-available",
      toolCallId,
      toolName,
      input,
    });
  }

  /**
   * Send tool-approval-request event (ADR 0002)
   */
  sendToolApprovalRequest(approvalId: string, toolCallId: string): void {
    this.simulateServerMessage({
      type: "tool-approval-request",
      approvalId,
      toolCallId,
    });
  }

  /**
   * Send tool-output-available event
   */
  sendToolOutputAvailable(
    toolCallId: string,
    toolName: string,
    output: Record<string, unknown>,
  ): void {
    this.simulateServerMessage({
      type: "tool-output-available",
      toolCallId,
      toolName,
      output,
    });
  }

  /**
   * Send complete tool with approval flow
   *
   * @param toolCallId - The tool call ID
   * @param toolName - The tool name
   * @param input - The tool input
   * @param approvalId - The approval ID
   * @param options.done - Whether to call simulateDone() after (default: true)
   *                       Set to false when sending multiple tools in sequence
   */
  sendToolWithApproval(
    toolCallId: string,
    toolName: string,
    input: Record<string, unknown>,
    approvalId: string,
    options?: { done?: boolean },
  ): void {
    this.sendToolInputStart(toolCallId, toolName);
    this.sendToolInputAvailable(toolCallId, toolName, input);
    this.sendToolApprovalRequest(approvalId, toolCallId);
    if (options?.done !== false) {
      this.simulateDone();
    }
  }
}

/**
 * Registry for tracking all mock WebSocket connections in a test
 */
const mockConnections: BidiMockWebSocket[] = [];

/**
 * Default handler to apply to new connections
 */
let defaultHandler: ((ws: BidiMockWebSocket) => void) | null = null;

/**
 * Clear all mock connections
 */
function clearMockConnections(): void {
  mockConnections.length = 0;
}

/**
 * Clear default handler
 */
function clearDefaultHandler(): void {
  defaultHandler = null;
}

/**
 * Vitest helper for using mock WebSocket in tests
 *
 * Automatically:
 * - beforeEach: Stubs global WebSocket with BidiMockWebSocket
 * - afterEach: Unstubs and clears connections
 *
 * @param options - Configuration options
 * @param options.autoOpen - Whether to auto-open connections (default: true)
 * @returns Object with helper functions
 *
 * @example
 * ```typescript
 * describe('my tests', () => {
 *   const { getConnections, getLastConnection } = useMockWebSocket();
 *
 *   it('should connect', async () => {
 *     const transport = new WebSocketChatTransport({ url: 'ws://localhost:8000/live' });
 *
 *     await vi.waitFor(() => {
 *       expect(getConnections()).toHaveLength(1);
 *     });
 *
 *     const ws = getLastConnection();
 *     ws.sendTextResponse('text-1', 'Hello', ' World');
 *   });
 * });
 * ```
 */
export function useMockWebSocket(options?: { autoOpen?: boolean }): {
  getConnections: () => BidiMockWebSocket[];
  getLastConnection: () => BidiMockWebSocket | undefined;
  clearConnections: () => void;
  setDefaultHandler: (handler: (ws: BidiMockWebSocket) => void) => void;
} {
  const autoOpen = options?.autoOpen ?? true;

  beforeEach(() => {
    clearMockConnections();
    clearDefaultHandler();

    // Create a factory class that tracks instances and applies default handler
    const MockWebSocketClass = class extends BidiMockWebSocket {
      constructor(url: string) {
        super(url, autoOpen);
        mockConnections.push(this);

        // Apply default handler if set (allows pre-registering handlers before WebSocket creation)
        if (defaultHandler) {
          defaultHandler(this);
        }
      }
    };

    // Add static constants
    Object.defineProperty(MockWebSocketClass, "CONNECTING", { value: 0 });
    Object.defineProperty(MockWebSocketClass, "OPEN", { value: 1 });
    Object.defineProperty(MockWebSocketClass, "CLOSING", { value: 2 });
    Object.defineProperty(MockWebSocketClass, "CLOSED", { value: 3 });

    vi.stubGlobal("WebSocket", MockWebSocketClass);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearMockConnections();
    clearDefaultHandler();
  });

  return {
    /**
     * Get all WebSocket connections created during the test
     */
    getConnections: () => [...mockConnections],

    /**
     * Get the most recent WebSocket connection
     */
    getLastConnection: () => mockConnections[mockConnections.length - 1],

    /**
     * Manually clear all connections
     */
    clearConnections: clearMockConnections,

    /**
     * Set a default handler to be applied to all new WebSocket connections
     *
     * IMPORTANT: Call this BEFORE any code that creates WebSocket connections.
     * The handler will be applied in the WebSocket constructor, so it's ready
     * when the client sends its first message.
     *
     * @param handler - Handler function to apply to new connections
     *
     * @example
     * ```typescript
     * it('should handle message', async () => {
     *   // Set up handler BEFORE creating transport
     *   setDefaultHandler((ws) => {
     *     ws.onClientMessage((data) => {
     *       const msg = JSON.parse(data);
     *       if (msg.type !== 'ping') {
     *         ws.sendTextResponse('text-1', 'Hello World');
     *       }
     *     });
     *   });
     *
     *   // Now create transport (WebSocket will have handler attached)
     *   const { useChatOptions } = buildUseChatOptions({ ... });
     *   const { result } = renderHook(() => useChat(useChatOptions));
     *
     *   await act(async () => {
     *     result.current.sendMessage({ text: 'Hi' });
     *   });
     * });
     * ```
     */
    setDefaultHandler: (handler: (ws: BidiMockWebSocket) => void) => {
      defaultHandler = handler;
    },
  };
}

/**
 * Message handler type for mock BIDI server behavior
 */
export type BidiMessageHandler = (
  ws: BidiMockWebSocket,
  message: string,
  parsedMessage: unknown,
) => void | Promise<void>;

/**
 * Create a message handler for mock BIDI server
 *
 * This is the Custom Mock equivalent of MSW's createCustomHandler.
 * Register it on a BidiMockWebSocket to define server behavior.
 *
 * @param handler - Function to handle incoming messages
 * @returns Function to register on a mock WebSocket
 *
 * @example
 * ```typescript
 * const { getLastConnection } = useMockWebSocket();
 *
 * it('should handle confirmation', async () => {
 *   // Create transport (will create mock WebSocket)
 *   const transport = new WebSocketChatTransport({ url: 'ws://localhost:8000/live' });
 *
 *   // Get the mock and set up handler
 *   const ws = getLastConnection();
 *   ws.onClientMessage((data) => {
 *     const msg = JSON.parse(data);
 *     if (msg.type !== 'ping') {
 *       ws.sendToolWithApproval('tool-1', 'process_payment', { amount: 100 }, 'approval-1');
 *     }
 *   });
 *
 *   // Trigger the flow
 *   await transport.send({ ... });
 * });
 * ```
 */
export function createMockBidiHandler(
  handler: BidiMessageHandler,
): (ws: BidiMockWebSocket) => void {
  return (ws: BidiMockWebSocket) => {
    ws.onClientMessage((data) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        parsed = data;
      }

      // Skip ping messages by default (common pattern)
      if (typeof parsed === "object" && parsed !== null && "type" in parsed) {
        if ((parsed as { type: string }).type === "ping") {
          return;
        }
      }

      handler(ws, data, parsed);
    });
  };
}

/**
 * Pre-built handler: Text response
 *
 * Sends a simple text response when receiving any message.
 */
export function createTextResponseMockHandler(
  ...textParts: string[]
): (ws: BidiMockWebSocket) => void {
  let messageCount = 0;
  const textId = `text-${Date.now()}`;

  return createMockBidiHandler((ws) => {
    messageCount++;
    if (messageCount === 1) {
      ws.sendTextResponse(textId, ...textParts);
    }
  });
}

/**
 * Pre-built handler: Confirmation request (ADR 0002)
 *
 * Sends a tool with approval request, then responds based on approval.
 */
export function createConfirmationMockHandler(config: {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  approvalId?: string;
}): (ws: BidiMockWebSocket) => void {
  const approvalId = config.approvalId ?? "approval-1";
  let messageCount = 0;

  return createMockBidiHandler((ws, _data, parsed) => {
    messageCount++;

    if (messageCount === 1) {
      // First message: Send approval request
      ws.sendToolWithApproval(
        config.toolCallId,
        config.toolName,
        config.args,
        approvalId,
      );
      return;
    }

    if (messageCount === 2) {
      // Second message: Check approval and send result
      // biome-ignore lint/suspicious/noExplicitAny: Test helper - message structure varies
      const messages = (parsed as any)?.messages;
      const approvalPart = messages
        // biome-ignore lint/suspicious/noExplicitAny: Test helper
        ?.flatMap((msg: any) => msg.parts || [])
        .find(
          // biome-ignore lint/suspicious/noExplicitAny: Test helper
          (part: any) => part.toolCallId === config.toolCallId && part.approval,
        );

      if (approvalPart?.approval) {
        // Approved
        ws.sendToolOutputAvailable(config.toolCallId, config.toolName, {
          result: "Operation completed successfully",
        });
      } else {
        // Denied
        ws.simulateServerMessage({
          type: "tool-output-denied",
          toolCallId: config.toolCallId,
          toolName: config.toolName,
          reason: "User denied",
        });
      }
      ws.simulateDone();
    }
  });
}
