/**
 * Chunk Logger for ADK AI Data Protocol (Browser)
 *
 * ⚪ ADK-Independent - Works with all modes (adk-bidi, adk-sse, gemini)
 *
 * Records chunks at various points in the data flow for debugging and testing.
 * Outputs JSONL format (1 line = 1 chunk) for easy parsing and replay.
 *
 * Dependencies:
 * - AI SDK v6 (UIMessageChunk types)
 * - Browser APIs (localStorage, console)
 *
 * Supported Modes:
 * - adk-bidi: WebSocket chunk logging
 * - adk-sse: HTTP SSE chunk logging
 * - gemini: Gemini Direct chunk logging
 *
 * Usage:
 *     import { chunkLogger } from './chunk-logger';
 *
 *     // Log a chunk
 *     chunkLogger.logChunk({
 *         location: "frontend-sse-chunk",
 *         direction: "in",
 *         chunk: chunkData,
 *         mode: "adk-sse"
 *     });
 *
 * Configuration (Priority: env var > localStorage > default):
 *     NEXT_PUBLIC_CHUNK_LOGGER_ENABLED: Enable/disable logging (default: false)
 *     NEXT_PUBLIC_CHUNK_LOGGER_SESSION_ID: Session identifier (default: auto-generated)
 *
 *     Fallback: localStorage.setItem('CHUNK_LOGGER_ENABLED', 'true')
 *
 * Output:
 *     Downloads as {session_id}.jsonl when export() is called
 */

"use client";

import type { ChunkLogEntry, Direction, LogLocation, Mode } from "@/lib/types";

// Re-export types for backward compatibility
export type { ChunkLogEntry, Direction, LogLocation, Mode };

export interface LogChunkOptions {
  location: LogLocation;
  direction: Direction;
  chunk: unknown;
  mode?: Mode;
  metadata?: Record<string, unknown>;
}

/**
 * Chunk logger for recording data flow in the browser.
 *
 * Stores chunks in memory and provides export functionality.
 */
export class ChunkLogger {
  private _enabled: boolean;
  private _sessionId: string;
  private _sequenceCounters: Map<LogLocation, number> = new Map();
  private _entries: ChunkLogEntry[] = [];

  constructor(enabled?: boolean, sessionId?: string) {
    // Priority: constructor arg > env var > localStorage > default
    this._enabled =
      enabled ??
      this._getEnvBoolean("NEXT_PUBLIC_CHUNK_LOGGER_ENABLED") ??
      true;
    this._sessionId =
      sessionId ??
      this._getEnvString("NEXT_PUBLIC_CHUNK_LOGGER_SESSION_ID") ??
      this._generateSessionId();
  }

  private _getEnvBoolean(key: string): boolean | null {
    // Read from Next.js environment variable (NEXT_PUBLIC_* are available client-side)
    const value = process.env[key];
    if (value === undefined) return null;
    return value.toLowerCase() === "true";
  }

  private _getEnvString(key: string): string | null {
    // Read from Next.js environment variable
    return process.env[key] ?? null;
  }

  private _generateSessionId(): string {
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
    return `session-${timestamp}`;
  }

  isEnabled(): boolean {
    return this._enabled;
  }

  logChunk(options: LogChunkOptions): void {
    if (!this._enabled) {
      return;
    }

    const { location, direction, chunk, mode = "adk-sse", metadata } = options;

    // Increment sequence counter
    const currentSeq = this._sequenceCounters.get(location) ?? 0;
    const nextSeq = currentSeq + 1;
    this._sequenceCounters.set(location, nextSeq);

    // Create log entry
    const entry: ChunkLogEntry = {
      timestamp: Date.now(),
      session_id: this._sessionId,
      mode,
      location,
      direction,
      sequence_number: nextSeq,
      chunk,
      metadata,
    };

    this._entries.push(entry);
  }

  /**
   * Export all logged chunks as JSONL file download.
   */
  export(): void {
    if (this._entries.length === 0) {
      console.warn("ChunkLogger: No chunks to export");
      return;
    }

    // Convert to JSONL format
    const jsonl = this._entries
      .map((entry) => JSON.stringify(entry))
      .join("\n");

    // Create Blob and trigger download
    const blob = new Blob([jsonl], { type: "application/jsonl" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = `${this._sessionId}.jsonl`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(url);
  }

  /**
   * Get all logged entries (for testing).
   */
  getEntries(): ChunkLogEntry[] {
    return [...this._entries];
  }

  /**
   * Clear all logged entries.
   */
  clear(): void {
    this._entries = [];
    this._sequenceCounters.clear();
  }
}

// Global singleton instance
export const chunkLogger = new ChunkLogger();

// Expose to window for debugging (browser only)
if (typeof window !== "undefined") {
  // biome-ignore lint/suspicious/noExplicitAny: Debug access to chunkLogger
  (window as any).__chunkLogger__ = chunkLogger;
}
