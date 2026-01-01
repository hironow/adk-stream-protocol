/**
 * Shared test mocks
 *
 * Centralized location for all test mocks to eliminate duplication
 * and ensure consistent behavior across all test layers.
 *
 * Usage:
 * ```typescript
 * import { MockWebSocket, createMockAudioContext } from '@/lib/tests/shared-mocks';
 * ```
 */

export { createMockAudioContext, setupAudioContextMock } from "./audio-context";
export { MockWebSocket } from "./websocket";
