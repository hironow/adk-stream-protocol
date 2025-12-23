/**
 * Shared Type Definitions for ADK AI Data Protocol
 *
 * This file consolidates type definitions used across multiple modules
 * to maintain consistency and provide a single source of truth.
 *
 * Types include:
 * - Backend mode configurations
 * - Chunk logging types
 * - Audio context interfaces
 */

/**
 * Backend communication mode
 *
 * - gemini: Gemini Direct mode (HTTP SSE, no ADK dependencies)
 * - adk-sse: ADK Server-Sent Events mode (HTTP SSE with ADK protocol)
 * - adk-bidi: ADK Bidirectional mode (WebSocket with ADK protocol)
 */
export type Mode = "gemini" | "adk-sse" | "adk-bidi";

/**
 * SSE-specific backend modes (subset of Mode)
 *
 * Used for SSE transport configuration
 */
export type SseMode = "gemini" | "adk-sse";

/**
 * Data flow direction for chunk logging
 *
 * - in: Incoming data (from backend/server)
 * - out: Outgoing data (to backend/server)
 */
export type Direction = "in" | "out";

/**
 * Recording location in the data flow for chunk logging
 *
 * Identifies where in the system a chunk was captured:
 * - Backend locations: Raw ADK events and SSE formatted events
 * - Frontend locations: API responses, SSE chunks, WebSocket chunks, useChat chunks
 */
export type LogLocation =
  | "backend-adk-event" // ADK raw event (input)
  | "backend-sse-event" // SSE formatted event (output)
  | "frontend-api-response" // Next.js API response (Gemini Direct)
  | "frontend-sse-chunk" // SSE chunk (ADK SSE)
  | "frontend-ws-chunk" // WebSocket chunk (ADK BIDI)
  | "frontend-useChat-chunk"; // useChat chunk (all modes)

/**
 * Chunk log entry structure
 *
 * Records metadata and chunk data at various points in the data flow.
 * Used for debugging, testing, and replay functionality.
 */
export interface ChunkLogEntry {
  // Metadata
  timestamp: number; // Unix timestamp (ms)
  session_id: string; // Session identifier
  mode: Mode; // Backend mode
  location: LogLocation; // Recording point
  direction: Direction; // Input/output
  sequence_number: number; // Chunk order

  // Chunk data
  chunk: unknown; // Actual chunk data (type depends on location)

  // Optional metadata
  metadata?: Record<string, unknown>;
}

/**
 * Audio context interface for PCM streaming (BIDI mode)
 *
 * Provides audio playback and recording capabilities for real-time
 * voice communication in WebSocket BIDI mode.
 */
export interface AudioContextValue {
  /** Voice playback channel */
  voiceChannel: {
    /** Whether audio is currently playing */
    isPlaying: boolean;
    /** Number of chunks buffered */
    chunkCount: number;
    /** Send PCM audio chunk for playback */
    sendChunk: (chunk: {
      content: string;
      sampleRate: number;
      channels: number;
      bitDepth: number;
    }) => void;
    /** Reset playback state */
    reset: () => void;
  };
  /** Whether audio context is initialized */
  isReady: boolean;
  /** Error message if initialization failed */
  error: string | null;
  /** Whether user activation is required (browser autoplay policy) */
  needsUserActivation: boolean;
  /** Activate audio context (after user gesture) */
  activate: () => Promise<void>;
}
