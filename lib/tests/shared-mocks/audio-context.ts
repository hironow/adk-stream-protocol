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
 * Use this helper in beforeEach/beforeAll hooks
 */
export function setupAudioContextMock() {
  vi.mock('@/lib/audio-context', () => ({
    useAudio: () => createMockAudioContext(),
  }));
}
