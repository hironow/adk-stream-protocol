/**
 * Chunk Logging and Replay Public API
 *
 * ⚪ ADK-Independent - Works with all modes (adk-bidi, adk-sse, gemini)
 *
 * This module provides utilities for chunk logging, replay, and testing.
 * All utilities work with any ChatTransport implementation.
 *
 * Dependencies:
 * - AI SDK v6 (ChatTransport, UIMessage, UIMessageChunk)
 * - Browser APIs (localStorage, console)
 *
 * Use Cases:
 * - Debugging: Record chunk flow for analysis
 * - Testing: Replay recorded chunks deterministically
 * - Development: Monitor real-time chunk streaming
 *
 * @example
 * ```typescript
 * // Logging
 * import { chunkLogger } from '@/lib/chunk_logs';
 * chunkLogger.logChunk({ location: 'frontend', chunk, mode: 'adk-bidi' });
 *
 * // Transport wrapper
 * import { ChunkLoggingTransport } from '@/lib/chunk_logs';
 * const transport = new ChunkLoggingTransport(baseTransport, 'adk-sse');
 *
 * // Replay
 * import { ChunkPlayerTransport } from '@/lib/chunk_logs';
 * const transport = ChunkPlayerTransport.fromFixture('/fixtures/test.jsonl');
 * ```
 */

// Chunk Logger (singleton instance for logging)
export { type ChunkLogEntry, chunkLogger, type Mode } from "./chunk-logger";

// Chunk Logging Transport (wrapper for any ChatTransport)
export { ChunkLoggingTransport } from "./chunk-logging-transport";

// Chunk Player (JSONL replay engine)
export {
  ChunkPlayer,
  type PlaybackMode,
  type PlayOptions,
} from "./chunk-player";

// Chunk Player Transport (mock transport for testing)
export { ChunkPlayerTransport } from "./chunk-player-transport";

/**
 * Internal modules (implementation details):
 * - All exports above are public API
 * - No internal-only modules in this directory
 * - All chunk utilities are designed for external use
 */
