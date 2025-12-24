/**
 * Common test mocks for integration tests
 *
 * Provides reusable mocks for AudioContext, WebSocket, and other dependencies.
 */

import { vi } from 'vitest';

/**
 * Mock AudioContext with all required properties
 */
export function createMockAudioContext() {
  return {
    inputDeviceId: 'default',
    outputDeviceId: 'default',
    bgmChannel: {
      currentTrack: null,
      isPlaying: false,
      volume: 0.5,
    },
    voiceChannel: {
      chunkCount: 0,
      lastCompletion: null,
    },
    setInputDeviceId: vi.fn(),
    setOutputDeviceId: vi.fn(),
    playBGM: vi.fn(),
    stopBGM: vi.fn(),
    setVolume: vi.fn(),
  };
}

/**
 * Setup AudioContext mock for tests
 */
export function setupAudioContextMock() {
  vi.mock('@/lib/audio-context', () => ({
    useAudio: () => createMockAudioContext(),
  }));
}

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
        this.onopen(new Event('open'));
      }
    }, 0);
  }

  send(data: string): void {
    this.sentMessages.push(data);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose(new CloseEvent('close'));
    }
  }

  simulateMessage(data: Record<string, unknown>): void {
    if (this.onmessage) {
      const sseMessage = `data: ${JSON.stringify(data)}`;
      this.onmessage(
        new MessageEvent('message', {
          data: sseMessage,
        })
      );
    }
  }
}
