/**
 * Shared Constants for ADK AI Data Protocol
 *
 * This file consolidates constant values used across multiple modules
 * to ensure consistency and provide a single source of truth.
 *
 * Constants include:
 * - Tool names (ADK protocol)
 * - Backend mode values
 * - Protocol-specific identifiers
 */

/**
 * ADK Request Confirmation is Internal (ADR 0002)
 *
 * As of ADR 0002, the adk_request_confirmation tool is an internal backend tool
 * and is hidden from the frontend. Frontend receives tool-approval-request events
 * instead and uses addToolApprovalResponse() to respond.
 *
 * The adk_request_confirmation tool and tool-adk_request_confirmation message parts
 * no longer exist in the frontend protocol.
 */

/**
 * Backend Mode Values
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

/**
 * AI SDK v6 Tool-Related Type Constants
 *
 * These constants represent type strings used in UIMessagePart and UIMessageChunk
 * for tool-related operations. Imported from AI SDK v6 for use in tests and type guards.
 *
 * Reference: https://sdk.vercel.ai/docs/ai-sdk-core/tools-and-tool-calling
 */

/**
 * UIMessagePart Tool Types
 *
 * Used in the `parts` array of UIMessage objects.
 *
 * Note: For type guards, use AI SDK v6's isTextUIPart, isToolUIPart, etc. from "ai" package.
 * These constants are for specific part type values that AI SDK v6 doesn't export as constants.
 */
export const TOOL_PART_TYPE_CALL = "tool-call" as const;
export const TOOL_PART_TYPE_APPROVAL_REQUEST = "tool-approval-request" as const;
export const TOOL_PART_TYPE_ERROR = "tool-error" as const;
export const TOOL_PART_TYPE_RESULT = "tool-result" as const;
export const TOOL_PART_TYPE_OUTPUT_DENIED = "tool-output-denied" as const;

/**
 * UIMessageChunk Text Types
 *
 * Used in text streaming chunks.
 */
export const TEXT_CHUNK_TYPE_START = "text-start" as const;
export const TEXT_CHUNK_TYPE_DELTA = "text-delta" as const;
export const TEXT_CHUNK_TYPE_END = "text-end" as const;

/**
 * UIMessageChunk Tool Types
 *
 * Used in streaming chunks during tool execution.
 */
export const TOOL_CHUNK_TYPE_INPUT_START = "tool-input-start" as const;
export const TOOL_CHUNK_TYPE_INPUT_DELTA = "tool-input-delta" as const;
export const TOOL_CHUNK_TYPE_INPUT_END = "tool-input-end" as const;
export const TOOL_CHUNK_TYPE_INPUT_AVAILABLE = "tool-input-available" as const;
export const TOOL_CHUNK_TYPE_INPUT_ERROR = "tool-input-error" as const;
export const TOOL_CHUNK_TYPE_APPROVAL_REQUEST =
  "tool-approval-request" as const;
export const TOOL_CHUNK_TYPE_OUTPUT_AVAILABLE =
  "tool-output-available" as const;
export const TOOL_CHUNK_TYPE_OUTPUT_DENIED = "tool-output-denied" as const;
export const TOOL_CHUNK_TYPE_OUTPUT_ERROR = "tool-output-error" as const;

/**
 * All Tool Part Types (for type guards and validation)
 */
export const ALL_TOOL_PART_TYPES = [
  TOOL_PART_TYPE_CALL,
  TOOL_PART_TYPE_APPROVAL_REQUEST,
  TOOL_PART_TYPE_ERROR,
  TOOL_PART_TYPE_RESULT,
  TOOL_PART_TYPE_OUTPUT_DENIED,
] as const;

/**
 * All Tool Chunk Types (for type guards and validation)
 */
export const ALL_TOOL_CHUNK_TYPES = [
  TOOL_CHUNK_TYPE_INPUT_START,
  TOOL_CHUNK_TYPE_INPUT_DELTA,
  TOOL_CHUNK_TYPE_INPUT_END,
  TOOL_CHUNK_TYPE_INPUT_AVAILABLE,
  TOOL_CHUNK_TYPE_INPUT_ERROR,
  TOOL_CHUNK_TYPE_APPROVAL_REQUEST,
  TOOL_CHUNK_TYPE_OUTPUT_AVAILABLE,
  TOOL_CHUNK_TYPE_OUTPUT_DENIED,
  TOOL_CHUNK_TYPE_OUTPUT_ERROR,
] as const;

/**
 * ToolChoice Type Constants
 *
 * Used for configuring which tool the model should call.
 * Part of the ToolChoice configuration object.
 */
export const TOOL_CHOICE_AUTO = "auto" as const;
export const TOOL_CHOICE_NONE = "none" as const;
export const TOOL_CHOICE_REQUIRED = "required" as const;
export const TOOL_CHOICE_TYPE_TOOL = "tool" as const;

/**
 * All ToolChoice String Values (for type guards and validation)
 */
export const ALL_TOOL_CHOICE_VALUES = [
  TOOL_CHOICE_AUTO,
  TOOL_CHOICE_NONE,
  TOOL_CHOICE_REQUIRED,
] as const;

/**
 * Tool State Constants
 *
 * Used for tool invocation state in UIMessage parts.
 */
export const TOOL_STATE_INPUT_STREAMING = "input-streaming" as const;
export const TOOL_STATE_INPUT_AVAILABLE = "input-available" as const;
export const TOOL_STATE_APPROVAL_REQUESTED = "approval-requested" as const;
export const TOOL_STATE_APPROVAL_RESPONDED = "approval-responded" as const;
export const TOOL_STATE_OUTPUT_AVAILABLE = "output-available" as const;
export const TOOL_STATE_OUTPUT_ERROR = "output-error" as const;
export const TOOL_STATE_OUTPUT_DENIED = "output-denied" as const;

/**
 * All Tool State Values (for type guards and validation)
 */
export const ALL_TOOL_STATE_VALUES = [
  TOOL_STATE_INPUT_STREAMING,
  TOOL_STATE_INPUT_AVAILABLE,
  TOOL_STATE_APPROVAL_REQUESTED,
  TOOL_STATE_APPROVAL_RESPONDED,
  TOOL_STATE_OUTPUT_AVAILABLE,
  TOOL_STATE_OUTPUT_ERROR,
  TOOL_STATE_OUTPUT_DENIED,
] as const;
