/**
 * UI Message Chunk Types
 *
 * Re-exports AI SDK v6 UIMessageChunk types and defines specific chunk types
 * for SSE and BIDI streaming responses.
 */

// Re-export AI SDK v6 types
export type { UIMessageChunk } from "ai";

// Import constants for type definitions
import type {
  TEXT_CHUNK_TYPE_DELTA,
  TEXT_CHUNK_TYPE_END,
  TEXT_CHUNK_TYPE_START,
  TOOL_CHUNK_TYPE_APPROVAL_REQUEST,
  TOOL_CHUNK_TYPE_INPUT_AVAILABLE,
  TOOL_CHUNK_TYPE_INPUT_START,
} from "../constants";

// SSE/BIDI specific chunk types (based on AI SDK v6 UIMessageChunk)

/**
 * Text start chunk - AI SDK v6 format
 */
export interface TextStartChunk {
  type: typeof TEXT_CHUNK_TYPE_START;
  id: string;
}

/**
 * Text delta chunk - AI SDK v6 format
 */
export interface TextDeltaChunk {
  type: typeof TEXT_CHUNK_TYPE_DELTA;
  delta: string;
  id: string;
}

/**
 * Text end chunk - AI SDK v6 format
 */
export interface TextEndChunk {
  type: typeof TEXT_CHUNK_TYPE_END;
  id: string;
}

/**
 * Tool input start chunk - AI SDK v6 format
 */
export interface ToolInputStartChunk {
  type: typeof TOOL_CHUNK_TYPE_INPUT_START;
  toolCallId: string;
  toolName: string;
}

/**
 * Tool input available chunk - AI SDK v6 format
 */
export interface ToolInputAvailableChunk {
  type: typeof TOOL_CHUNK_TYPE_INPUT_AVAILABLE;
  toolCallId: string;
  toolName: string;
  input: unknown;
}

/**
 * Tool approval request chunk - AI SDK v6 format
 */
export interface ToolApprovalRequestChunk {
  type: typeof TOOL_CHUNK_TYPE_APPROVAL_REQUEST;
  approvalId: string;
  toolCallId: string;
}

/**
 * Union type for SSE stream chunks
 * Covers the most common chunk types used in SSE responses
 */
export type SseChunk =
  | TextStartChunk
  | TextDeltaChunk
  | TextEndChunk
  | ToolInputStartChunk
  | ToolInputAvailableChunk
  | ToolApprovalRequestChunk;
