/**
 * Shared test mocks
 *
 * Centralized location for all test mocks to eliminate duplication
 * and ensure consistent behavior across all test layers.
 *
 * Usage:
 * ```typescript
 * import { setupWebAudioMocks } from '@/lib/tests/shared-mocks';
 * ```
 */

export {
  createMockAudioBuffer,
  createMockPCMData,
  MockAudioContext,
  MockAudioWorkletNode,
  MockHTMLAudioElement,
  MockMediaStream,
  MockMediaStreamTrack,
  setupWebAudioMocks,
} from "./web-audio-api";
