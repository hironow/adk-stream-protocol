/**
 * Shared AudioContext mock for all tests
 *
 * Provides a consistent AudioContext mock across unit, integration, and e2e tests.
 * This eliminates duplication and ensures uniform behavior.
 *
 * Usage:
 * ```typescript
 * import { createMockAudioContext } from '@/lib/tests/shared-mocks';
 *
 * // In test setup:
 * vi.mock('@/lib/audio-context', () => ({
 *   useAudio: () => createMockAudioContext(),
 * }));
 * ```
 */

import { vi } from "vitest";

/**
 * Mock AudioContext with all required properties
 */
export function createMockAudioContext() {
  return {
    inputDeviceId: "default",
    outputDeviceId: "default",
    bgmChannel: {
      currentTrack: 0, // 0: bgm.wav, 1: bgm2.wav
      switchTrack: vi.fn(),
    },
    voiceChannel: {
      isPlaying: false,
      chunkCount: 0,
      sendChunk: vi.fn(),
      reset: vi.fn(),
      onComplete: vi.fn(),
      lastCompletion: null,
    },
    isReady: true,
    error: null,
    needsUserActivation: false,
    activate: vi.fn(),
    setInputDeviceId: vi.fn(),
    setOutputDeviceId: vi.fn(),
    playBGM: vi.fn(),
    stopBGM: vi.fn(),
    setVolume: vi.fn(),
  };
}

/**
 * Setup AudioContext mock for tests
 * Use this helper in beforeEach/beforeAll hooks
 */
export function setupAudioContextMock() {
  vi.mock("@/lib/audio-context", () => ({
    useAudio: () => createMockAudioContext(),
  }));
}
