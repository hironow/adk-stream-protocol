/**
 * ADK AI Data Protocol - Utility Types and Constants
 *
 * This module serves as the single source of truth for:
 * - AI SDK v6 compatibility aliases
 * - Protocol constants (modes, chunk types, tool states)
 * - Type definitions (chunks, logging, audio)
 *
 * Import everything from this module to ensure consistency across the codebase.
 */

import type {
  ChatRequestOptions,
  ChatTransport,
  DefaultChatTransport,
  DynamicToolUIPart,
  UIMessage,
  UIMessageChunk,
  UIMessagePart,
  UIToolInvocation,
} from "ai";
import {
  getToolName,
  getToolOrDynamicToolName,
  isDataUIPart,
  isFileUIPart,
  isReasoningUIPart,
  isTextUIPart,
  isToolOrDynamicToolUIPart,
  isToolUIPart,
  uiMessageChunkSchema,
} from "ai";

// ============================================================================
// AI SDK v6 Compatibility Aliases
// ============================================================================

// Re-exporting from provider-utils for AISDKv6 compatibility
// via node_modules/@ai-sdk/provider-utils/dist/index.d.ts

// String unions as literal types
export type UIToolsRoleFromAISDKv6 = "system" | "user" | "assistant";
export type UIToolInvocationStateFromAISDKv6 =
  | "input-streaming"
  | "input-available"
  | "approval-requested"
  | "approval-responded"
  | "output-available"
  | "output-error"
  | "output-denied";
export type DynamicToolUIPartTypeFromAISDKv6 = "dynamic-tool";
export type DynamicToolUIPartStateFromAISDKv6 =
  | "input-streaming"
  | "input-available"
  | "approval-requested"
  | "approval-responded"
  | "output-available"
  | "output-error"
  | "output-denied";
export type UIMessageChunkTypeFromAISDKv6 =
  | "text-start"
  | "text-delta"
  | "text-end"
  | "reasoning-start"
  | "reasoning-delta"
  | "reasoning-end"
  | "error"
  | "tool-input-available"
  | "tool-input-error"
  | "tool-approval-request"
  | "tool-output-available"
  | "tool-output-error"
  | "tool-output-denied"
  | "tool-input-start"
  | "tool-input-delta"
  | "source-url"
  | "source-document"
  | "file"
  | "start-step"
  | "finish-step"
  | "start"
  | "finish"
  | "abort"
  | "message-metadata";

// Function aliases
export const isDataUIPartFromAISDKv6 = isDataUIPart;
export const isTextUIPartFromAISDKv6 = isTextUIPart;
export const isFileUIPartFromAISDKv6 = isFileUIPart;
export const isReasoningUIPartFromAISDKv6 = isReasoningUIPart;
export const isToolUIPartFromAISDKv6 = isToolUIPart;
export const isToolOrDynamicToolUIPartFromAISDKv6 = isToolOrDynamicToolUIPart;
export const getToolNameFromAISDKv6 = getToolName;
export const getToolOrDynamicToolNameFromAISDKv6 = getToolOrDynamicToolName;
export const uiMessageChunkSchemaFromAISDKv6 = uiMessageChunkSchema;

// Type aliases
export type UIMessageFromAISDKv6 = UIMessage;
export type UIMessageChunkFromAISDKv6 = UIMessageChunk;
export type UIMessagePartFromAISDKv6 = UIMessagePart<any, any>;
export type UIToolInvocationFromAISDKv6 = UIToolInvocation<any>;
export type DynamicToolUIPartFromAISDKv6 = DynamicToolUIPart;
export type ChatTransportFromAISDKv6 = ChatTransport<any>;
export type DefaultChatTransportFromAISDKv6 = DefaultChatTransport<any>;
export type ChatRequestOptionsFromAISDKv6 = ChatRequestOptions;

// ============================================================================
// Backend Mode Constants
// ============================================================================

/**
 * Backend Communication Modes
 *
 * Available backend communication modes.
 * These values are used for mode selection and routing.
 */
export const MODE_GEMINI = "gemini" as const;
export const MODE_ADK_SSE = "adk-sse" as const;
export const MODE_ADK_BIDI = "adk-bidi" as const;

/**
 * All supported modes as a const array
 */
export const ALL_MODES = [MODE_GEMINI, MODE_ADK_SSE, MODE_ADK_BIDI] as const;

/**
 * SSE-specific modes
 */
export const SSE_MODES = [MODE_GEMINI, MODE_ADK_SSE] as const;

// ============================================================================
// Tool State Type Guards
// ============================================================================

/**
 * Type guard for tool in "approval-requested" state
 *
 * @example
 * const approvalTools = message.parts.filter(isApprovalRequestedTool);
 */
export function isApprovalRequestedTool(
  part: UIMessagePartFromAISDKv6,
): part is Extract<UIMessagePartFromAISDKv6, { state: "approval-requested" }> {
  return isToolUIPartFromAISDKv6(part) && part.state === "approval-requested";
}

/**
 * Type guard for tool in "approval-responded" state
 *
 * Indicates the user has responded (approved/denied) to a tool approval request.
 */
export function isApprovalRespondedTool(
  part: UIMessagePartFromAISDKv6,
): part is Extract<UIMessagePartFromAISDKv6, { state: "approval-responded" }> {
  return isToolUIPartFromAISDKv6(part) && part.state === "approval-responded";
}

/**
 * Type guard for tool with output available
 */
export function isOutputAvailableTool(
  part: UIMessagePartFromAISDKv6,
): part is Extract<UIMessagePartFromAISDKv6, { state: "output-available" }> {
  return isToolUIPartFromAISDKv6(part) && part.state === "output-available";
}

/**
 * Type guard for tool with output error
 */
export function isOutputErrorTool(
  part: UIMessagePartFromAISDKv6,
): part is Extract<UIMessagePartFromAISDKv6, { state: "output-error" }> {
  return isToolUIPartFromAISDKv6(part) && part.state === "output-error";
}

/**
 * Type guard for tool with input available
 */
export function isInputAvailableTool(
  part: UIMessagePartFromAISDKv6,
): part is Extract<UIMessagePartFromAISDKv6, { state: "input-available" }> {
  return isToolUIPartFromAISDKv6(part) && part.state === "input-available";
}

/**
 * Type guard for tool approval request part
 *
 * Checks if a message part is a tool-approval-request type.
 * This is an ADK-specific extension to AI SDK v6.
 */
export function isApprovalRequestPart(
  part: UIMessagePartFromAISDKv6,
): part is UIMessagePartFromAISDKv6 & { type: "tool-approval-request" } {
  return "type" in part && part.type === "tool-approval-request";
}

// ============================================================================
// Common Type Definitions
// ============================================================================

/**
 * Backend Communication Mode
 *
 * Defines the communication protocol used between frontend and backend.
 * Each mode uses different transport mechanisms and protocols.
 */
export type Mode = "gemini" | "adk-sse" | "adk-bidi";

/**
 * SSE-Specific Backend Modes
 *
 * Subset of Mode that only includes Server-Sent Events based transports.
 * Used for type safety in SSE transport configuration.
 */
export type SseMode = "gemini" | "adk-sse";

/**
 * Data Flow Direction
 *
 * Indicates whether chunk data is incoming (from backend) or outgoing (to backend).
 * Used for chunk logging to distinguish request vs response data.
 */
export type Direction = "in" | "out";

/**
 * Recording Location in Data Flow
 *
 * Identifies where in the system architecture a chunk was captured for logging.
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
