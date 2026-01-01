/**
 * Chunk Logging and Replay Public API
 *
 * ADK-Independent - Works with all backend modes (adk-bidi, adk-sse, gemini)
 *
 * This module provides comprehensive utilities for chunk logging, replay, and
 * deterministic E2E testing. The chunk logging system captures the complete data
 * flow between frontend and backend, enabling powerful debugging and testing workflows.
 *
 * Core Capabilities:
 *
 * 1. Transparent Logging (ChunkLoggingTransport):
 *    - Wraps any ChatTransport to log all chunks without affecting behavior
 *    - Logs both incoming (backend → frontend) and outgoing (frontend → backend) chunks
 *    - Captures metadata: timestamps, session IDs, sequence numbers, locations
 *    - Useful for debugging protocol issues and understanding data flow
 *
 * 2. Deterministic Replay (ChunkPlayerTransport):
 *    - Replays pre-recorded chunk sequences from JSONL fixtures
 *    - Enables deterministic E2E testing without live backend
 *    - Perfect for testing race conditions, error handling, edge cases
 *    - Controlled timing and ordering of events
 *
 * 3. Development Monitoring (chunkLogger):
 *    - Real-time console logging of chunk flow
 *    - localStorage-based session management
 *    - Flexible log filtering and formatting
 *
 * Dependencies:
 * - AI SDK v6 (ChatTransport, UIMessage, UIMessageChunk)
 * - Browser APIs (localStorage, console, fetch)
 *
 * Use Cases:
 * - Development: Monitor real-time chunk streaming with console logs
 * - Debugging: Record and analyze complete request/response flows
 * - Testing: Create deterministic E2E tests with fixture replay
 * - CI/CD: Run E2E tests without backend dependencies
 *
 * @example Basic Logging
 * ```typescript
 * import { chunkLogger, ChunkLoggingTransport } from '@/lib/chunk_logs';
 *
 * // Manual logging
 * chunkLogger.logChunk({
 *   location: 'frontend-sse-chunk',
 *   chunk,
 *   mode: 'adk-sse',
 *   direction: 'in'
 * });
 *
 * // Automatic logging via transport wrapper
 * const transport = new ChunkLoggingTransport(baseTransport, 'adk-bidi');
 * // All chunks will be logged transparently
 * ```
 *
 * @example Deterministic E2E Testing
 * ```typescript
 * import { ChunkPlayerTransport } from '@/lib/chunk_logs';
 *
 * // Replay pre-recorded fixture
 * const transport = ChunkPlayerTransport.fromFixture(
 *   '/fixtures/tool-confirmation-flow.jsonl'
 * );
 *
 * const { useChatOptions } = {
 *   useChatOptions: {
 *     transport,
 *     messages: [],
 *     id: 'test-chat'
 *   }
 * };
 *
 * // useChat will receive exactly the same chunks every time
 * const { messages, sendMessage } = useChat(useChatOptions);
 * ```
 */

// Chunk Logger - Singleton instance for manual chunk logging and session management
export { type ChunkLogEntry, chunkLogger, type Mode } from "./chunk-logger";

// Chunk Logging Transport - Transparent wrapper that logs all chunks passing through
export { ChunkLoggingTransport } from "./chunk-logging-transport";

// Chunk Player - JSONL-based replay engine for deterministic chunk playback
export {
  ChunkPlayer,
  type PlaybackMode,
  type PlayOptions,
} from "./chunk-player";

// Chunk Player Transport - Mock ChatTransport for E2E testing with fixture replay
export { ChunkPlayerTransport } from "./chunk-player-transport";

/**
 * Public API Design Note
 *
 * All exports in this module are part of the public API and designed for external use.
 * There are no internal-only modules in this directory. The chunk logging system is
 * intentionally designed to be flexible and composable for various debugging and
 * testing workflows.
 */
