/**
 * Mock WebSocket for Integration Tests
 *
 * Provides a mock WebSocket implementation for testing WebSocket-based
 * communication (ADK BIDI mode) without actual network connections.
 */

/**
 * Mock WebSocket class for testing
 *
 * Simulates WebSocket behavior including connection lifecycle,
 * message sending/receiving, and connection state management.
 *
 * @example
 * ```typescript
 * import { MockWebSocket } from '@/lib/tests/mocks/mock-websocket';
 *
 * beforeEach(() => {
 *   global.WebSocket = MockWebSocket as any;
 * });
 *
 * // In test:
 * const ws = new WebSocket('ws://localhost:8000/live');
 * ws.onopen = () => console.log('Connected');
 * ws.send(JSON.stringify({ type: 'message', content: 'Hello' }));
 *
 * // Simulate server message
 * if (ws instanceof MockWebSocket) {
 *   ws.simulateMessage(JSON.stringify({ type: 'response', data: '...' }));
 * }
 * ```
 */
export class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  // Track all created instances for testing
  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.CONNECTING;
  url: string;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  sentMessages: string[] = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
    // Simulate connection opening after a tick
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      if (this.onopen) {
        this.onopen(new Event("open"));
      }
    }, 0);
  }

  send(data: string): void {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error("WebSocket is not open");
    }
    this.sentMessages.push(data);
  }

  close(code?: number, reason?: string): void {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose(
        new CloseEvent("close", { code: code ?? 1000, reason: reason ?? "" }),
      );
    }
  }

  /**
   * Simulate receiving a message from the server
   *
   * @param data - Message data (usually JSON string)
   */
  simulateMessage(data: string): void {
    if (this.onmessage) {
      this.onmessage(new MessageEvent("message", { data }));
    }
  }

  /**
   * Simulate a WebSocket error
   *
   * @param error - Error message
   */
  simulateError(error: string): void {
    if (this.onerror) {
      this.onerror(new Event("error"));
    }
  }

  /**
   * Get all sent messages
   *
   * @returns Array of sent message strings
   */
  getSentMessages(): string[] {
    return [...this.sentMessages];
  }

  /**
   * Get parsed sent messages (assumes JSON)
   *
   * @returns Array of parsed message objects
   */
  getParsedSentMessages<T = unknown>(): T[] {
    return this.sentMessages
      .map((msg) => {
        try {
          return JSON.parse(msg) as T;
        } catch {
          return null;
        }
      })
      .filter((msg): msg is T => msg !== null);
  }

  /**
   * Clear sent messages history
   */
  clearSentMessages(): void {
    this.sentMessages = [];
  }
}

/**
 * Install MockWebSocket as global WebSocket
 *
 * @returns Original WebSocket constructor (for restoration)
 *
 * @example
 * ```typescript
 * beforeEach(() => {
 *   originalWebSocket = installMockWebSocket();
 * });
 *
 * afterEach(() => {
 *   restoreMockWebSocket(originalWebSocket);
 * });
 * ```
 */
export function installMockWebSocket(): typeof WebSocket {
  const original = global.WebSocket;
  MockWebSocket.instances = []; // Clear instances on install
  global.WebSocket = MockWebSocket as any;
  return original as any;
}

/**
 * Restore original WebSocket constructor
 *
 * @param original - Original WebSocket constructor
 */
export function restoreMockWebSocket(original: typeof WebSocket): void {
  global.WebSocket = original;
}
