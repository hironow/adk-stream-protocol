/**
 * WebSocket Mock Helpers
 * Provides reusable WebSocket mock setup for tests
 */

import { vi } from "vitest";

export interface MockWebSocketInstance {
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  readyState: number;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
}

/**
 * Creates a mock WebSocket instance with common properties
 */
export function createMockWebSocket(): MockWebSocketInstance {
  return {
    send: vi.fn(),
    close: vi.fn(),
    readyState: 1, // WebSocket.OPEN
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null,
  };
}

/**
 * Sets up global WebSocket mock with the provided instance
 * Returns the mock instance for test assertions
 */
export function setupWebSocketMock(
  mockInstance?: MockWebSocketInstance,
): MockWebSocketInstance {
  const mock = mockInstance || createMockWebSocket();

  global.WebSocket = class MockWebSocket {
    send = mock.send;
    close = mock.close;
    readyState = mock.readyState;
    onopen = null;
    onmessage = null;
    onerror = null;
    onclose = null;
  } as any;

  return mock;
}

/**
 * Simulates receiving a WebSocket message
 */
export function simulateWebSocketMessage(
  mock: MockWebSocketInstance,
  data: string | object,
): void {
  if (mock.onmessage) {
    const messageData = typeof data === "string" ? data : JSON.stringify(data);
    mock.onmessage({ data: messageData } as MessageEvent);
  }
}

/**
 * Simulates WebSocket connection open
 */
export function simulateWebSocketOpen(mock: MockWebSocketInstance): void {
  if (mock.onopen) {
    mock.onopen(new Event("open"));
  }
}

/**
 * Simulates WebSocket connection close
 */
export function simulateWebSocketClose(
  mock: MockWebSocketInstance,
  code = 1000,
  reason = "",
): void {
  if (mock.onclose) {
    mock.onclose({ code, reason } as CloseEvent);
  }
}

/**
 * Simulates WebSocket error
 */
export function simulateWebSocketError(
  mock: MockWebSocketInstance,
  error?: Error,
): void {
  if (mock.onerror) {
    mock.onerror(error ? (error as any) : new Event("error"));
  }
}
