/**
 * Chunk Player for ADK AI Data Protocol (Browser)
 *
 * ⚪ ADK-Independent - Works with all modes (adk-bidi, adk-sse, gemini)
 *
 * Replays recorded chunks from JSONL files for testing and debugging.
 *
 * Dependencies:
 * - AI SDK v6 (UIMessageChunk types)
 * - chunk-logger.ts (JSONL format)
 *
 * Supported Modes:
 * - All modes: Replays any recorded chunk sequence
 *
 * Usage:
 *     import { ChunkPlayer } from './chunk-player';
 *
 *     // Create player from JSONL content
 *     const player = new ChunkPlayer(jsonlContent);
 *
 *     // Replay chunks
 *     for await (const entry of player.play({ mode: 'fast-forward' })) {
 *         // Process entry.chunk
 *         console.log(entry);
 *     }
 *
 * Playback Modes:
 *     real-time: Replay with original timing (based on timestamps)
 *     fast-forward: Replay as fast as possible (no delays)
 *     step: Manual step-by-step (requires next() call)
 */

import type { ChunkLogEntry } from "./chunk-logger";

export type PlaybackMode = "real-time" | "fast-forward" | "step";

export interface PlayOptions {
  mode?: PlaybackMode;
}

export interface PlayerStats {
  count: number;
  duration_ms: number;
  first_timestamp: number | null;
  last_timestamp: number | null;
}

/**
 * Chunk player for replaying recorded data flow.
 *
 * Reads chunks from JSONL content and yields them with timing control.
 */
export class ChunkPlayer {
  private entries: ChunkLogEntry[];

  /**
   * Initialize chunk player.
   *
   * @param jsonlContent - JSONL file content as string
   */
  constructor(jsonlContent: string) {
    this.entries = this.parseJsonl(jsonlContent);
  }

  /**
   * Create player from File object (uploaded JSONL file).
   *
   * @param file - JSONL file
   * @returns Promise<ChunkPlayer>
   */
  static async fromFile(file: File): Promise<ChunkPlayer> {
    const content = await file.text();
    return new ChunkPlayer(content);
  }

  /**
   * Create player from URL (fetch JSONL from server).
   *
   * @param url - URL to JSONL file
   * @returns Promise<ChunkPlayer>
   */
  static async fromUrl(url: string): Promise<ChunkPlayer> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch JSONL: ${response.statusText}`);
    }
    const content = await response.text();
    return new ChunkPlayer(content);
  }

  /**
   * Parse JSONL content into chunk entries.
   *
   * @param jsonlContent - JSONL file content
   * @returns Array of ChunkLogEntry
   */
  private parseJsonl(jsonlContent: string): ChunkLogEntry[] {
    const lines = jsonlContent.split("\n");
    const entries: ChunkLogEntry[] = [];

    for (let lineNo = 0; lineNo < lines.length; lineNo++) {
      const line = lines[lineNo].trim();
      if (!line) continue; // Skip empty lines

      try {
        const entry = JSON.parse(line) as ChunkLogEntry;
        entries.push(entry);
      } catch (error) {
        throw new Error(
          `Invalid JSONL at line ${lineNo + 1}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    // Sort by sequence_number to ensure correct order
    entries.sort((a, b) => a.sequence_number - b.sequence_number);

    return entries;
  }

  /**
   * Replay chunks as async generator.
   *
   * @param options - Playback options
   * @yields ChunkLogEntry entries in sequence
   */
  async *play(options: PlayOptions = {}): AsyncGenerator<ChunkLogEntry> {
    const { mode = "fast-forward" } = options;

    if (mode === "fast-forward") {
      // Yield as fast as possible
      for (const entry of this.entries) {
        yield entry;
      }
    } else if (mode === "real-time") {
      // Yield with original timing
      if (this.entries.length === 0) return;

      const startTime = Date.now();
      const firstTimestamp = this.entries[0].timestamp;

      for (const entry of this.entries) {
        // Calculate delay based on original timestamp
        const elapsedMs = Date.now() - startTime;
        const targetMs = entry.timestamp - firstTimestamp;
        const delayMs = targetMs - elapsedMs;

        if (delayMs > 0) {
          await this.sleep(delayMs);
        }

        yield entry;
      }
    } else if (mode === "step") {
      // Manual step-by-step
      // For now, just yield with small delay
      for (const entry of this.entries) {
        yield entry;
        await this.sleep(100); // Small delay for step mode
      }
    }
  }

  /**
   * Get statistics about the recorded session.
   *
   * @returns PlayerStats
   */
  getStats(): PlayerStats {
    if (this.entries.length === 0) {
      return {
        count: 0,
        duration_ms: 0,
        first_timestamp: null,
        last_timestamp: null,
      };
    }

    const firstTimestamp = this.entries[0].timestamp;
    const lastTimestamp = this.entries[this.entries.length - 1].timestamp;
    const durationMs = lastTimestamp - firstTimestamp;

    return {
      count: this.entries.length,
      duration_ms: durationMs,
      first_timestamp: firstTimestamp,
      last_timestamp: lastTimestamp,
    };
  }

  /**
   * Get all entries (for inspection/debugging).
   *
   * @returns Array of ChunkLogEntry
   */
  getEntries(): ChunkLogEntry[] {
    return [...this.entries];
  }

  /**
   * Helper to sleep for specified milliseconds.
   *
   * @param ms - Milliseconds to sleep
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
