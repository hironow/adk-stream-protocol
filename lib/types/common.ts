/**
 * Common Type Definitions
 *
 * Shared type definitions used across multiple modules in the library.
 * This file serves as a single source of truth for core types to ensure
 * consistency throughout the codebase.
 *
 * Type Categories:
 * - Backend Communication Modes: Mode, SseMode
 * - Chunk Logging System: Direction, LogLocation, ChunkLogEntry
 * - Audio Streaming: AudioContextValue (BIDI mode PCM streaming)
 */

/**
 * Backend Communication Mode
 *
 * Defines the communication protocol used between frontend and backend.
 * Each mode uses different transport mechanisms and protocols.
 *
 * @property gemini - Direct Gemini API via Server-Sent Events (no ADK backend required)
 * @property adk-sse - ADK protocol over Server-Sent Events (supports tool confirmation)
 * @property adk-bidi - ADK protocol over WebSocket (supports PCM audio streaming and real-time communication)
 */
export type Mode = "gemini" | "adk-sse" | "adk-bidi";

/**
 * SSE-Specific Backend Modes
 *
 * Subset of Mode that only includes Server-Sent Events based transports.
 * Used for type safety in SSE transport configuration.
 *
 * @property gemini - Direct Gemini API via SSE
 * @property adk-sse - ADK protocol via SSE
 */
export type SseMode = "gemini" | "adk-sse";

/**
 * Data Flow Direction
 *
 * Indicates whether chunk data is incoming (from backend) or outgoing (to backend).
 * Used for chunk logging to distinguish request vs response data.
 *
 * @property in - Incoming data from backend/server (responses)
 * @property out - Outgoing data to backend/server (requests)
 */
export type Direction = "in" | "out";

/**
 * Recording Location in Data Flow
 *
 * Identifies where in the system architecture a chunk was captured for logging.
 * This allows precise tracking of data transformations across the stack.
 *
 * Backend Locations (Python ADK server):
 * @property backend-adk-event - Raw ADK event before SSE formatting
 * @property backend-sse-event - SSE-formatted event ready for transmission
 *
 * Frontend Locations (Browser/React):
 * @property frontend-api-response - Next.js API route response (Gemini Direct mode)
 * @property frontend-sse-chunk - SSE chunk received by frontend (ADK SSE mode)
 * @property frontend-ws-chunk - WebSocket message received by frontend (ADK BIDI mode)
 * @property frontend-useChat-chunk - Chunk processed by AI SDK v6 useChat hook (all modes)
 */
export type LogLocation =
  | "backend-adk-event"
  | "backend-sse-event"
  | "frontend-api-response"
  | "frontend-sse-chunk"
  | "frontend-ws-chunk"
  | "frontend-useChat-chunk";

/**
 * Chunk Log Entry
 *
 * Complete record of a single chunk captured at a specific point in the data flow.
 * Used for debugging, testing, and deterministic replay via ChunkPlayerTransport.
 *
 * @property timestamp - Unix timestamp in milliseconds when chunk was captured
 * @property session_id - Unique session identifier for grouping related chunks
 * @property mode - Backend communication mode when chunk was captured
 * @property location - Where in the system this chunk was recorded
 * @property direction - Whether this is incoming (in) or outgoing (out) data
 * @property sequence_number - Sequential chunk number within the session
 * @property chunk - Actual chunk data (structure varies by location)
 * @property metadata - Optional additional context (e.g., HTTP headers, timing info)
 */
export interface ChunkLogEntry {
  timestamp: number;
  session_id: string;
  mode: Mode;
  location: LogLocation;
  direction: Direction;
  sequence_number: number;
  chunk: unknown;
  metadata?: Record<string, unknown>;
}

/**
 * Audio Context Value
 *
 * Interface for managing real-time PCM audio streaming in BIDI mode.
 * Provides audio playback capabilities using Web Audio API with AudioWorklet
 * for low-latency voice communication.
 *
 * Note: Only used in adk-bidi mode. SSE modes do not support audio streaming.
 *
 * @property voiceChannel - Audio playback channel for PCM data
 * @property voiceChannel.isPlaying - Whether audio is currently playing
 * @property voiceChannel.chunkCount - Number of PCM chunks currently buffered
 * @property voiceChannel.sendChunk - Queue PCM audio chunk for playback
 * @property voiceChannel.reset - Clear buffer and reset playback state
 * @property isReady - Whether AudioContext and AudioWorklet are initialized
 * @property error - Error message if initialization failed, null otherwise
 * @property needsUserActivation - Whether user gesture is required (browser autoplay policy)
 * @property activate - Activate AudioContext after user gesture (required by some browsers)
 */
export interface AudioContextValue {
  voiceChannel: {
    isPlaying: boolean;
    chunkCount: number;
    sendChunk: (chunk: {
      content: string; // Base64-encoded PCM data
      sampleRate: number; // Sample rate in Hz (e.g., 24000)
      channels: number; // Number of audio channels (1 = mono, 2 = stereo)
      bitDepth: number; // Bits per sample (e.g., 16)
    }) => void;
    reset: () => void;
  };
  isReady: boolean;
  error: string | null;
  needsUserActivation: boolean;
  activate: () => Promise<void>;
}
