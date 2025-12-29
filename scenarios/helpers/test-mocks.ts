/**
 * Common test mocks for integration tests
 *
 * @deprecated This file now re-exports from @/lib/tests/shared-mocks.
 * Please import directly from @/lib/tests/shared-mocks instead.
 *
 * This file will be removed in a future update after all imports are migrated.
 */

// Re-export from shared-mocks to maintain backward compatibility
export {
  createMockAudioContext,
  MockWebSocket,
  setupAudioContextMock,
} from "@/lib/tests/shared-mocks";
