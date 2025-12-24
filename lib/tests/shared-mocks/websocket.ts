/**
 * Shared MockWebSocket for all tests
 *
 * Provides a consistent WebSocket mock across unit, integration, and e2e tests.
 * This eliminates duplication and ensures uniform behavior.
 *
 * Usage:
 * ```typescript
 * import { MockWebSocket } from '@/lib/tests/shared-mocks';
 *
 * // In beforeEach:
 * global.WebSocket = MockWebSocket as any;
 * ```
 */

/**
 * Mock WebSocket class for BIDI mode tests
 */
export class MockWebSocket {
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

  /**
   * Simulate receiving a message from the server
   * Formats data as SSE message format
   */
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
