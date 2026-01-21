/**
 * AI SDK v6 Data Stream Protocol Event Types for Testing
 *
 * TypeScript interfaces matching the actual SSE event formats sent by the backend.
 * These types provide better type safety in integration tests compared to using `any`.
 *
 * Reference: AI SDK v6 UIMessageChunk types
 * Reference: ADR 0002 - Tool Approval Architecture
 * Reference: ADR 0011 - finish-step Injection Pattern
 */

// ============================================================================
// Base Types
// ============================================================================

/**
 * Common fields for all SSE events
 */
interface BaseSSEEvent {
  type: string;
}

// ============================================================================
// Message Lifecycle Events
// ============================================================================

/**
 * Start of a new message stream
 */
export interface StartEvent extends BaseSSEEvent {
  type: "start";
  messageId: string;
}

/**
 * End of message stream with usage statistics
 */
export interface FinishEvent extends BaseSSEEvent {
  type: "finish";
  finishReason: "stop" | "tool-calls" | "length" | "content-filter" | "error";
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/**
 * Start of a step within a message
 */
export interface StartStepEvent extends BaseSSEEvent {
  type: "start-step";
}

/**
 * End of a step within a message
 * ADR 0011: Used to close stream after tool-approval-request in BIDI mode
 */
export interface FinishStepEvent extends BaseSSEEvent {
  type: "finish-step";
}

// ============================================================================
// Text Events
// ============================================================================

/**
 * Start of text content
 */
export interface TextStartEvent extends BaseSSEEvent {
  type: "text-start";
}

/**
 * Incremental text content
 */
export interface TextDeltaEvent extends BaseSSEEvent {
  type: "text-delta";
  text: string;
}

/**
 * End of text content
 */
export interface TextEndEvent extends BaseSSEEvent {
  type: "text-end";
}

// ============================================================================
// Tool Events
// ============================================================================

/**
 * Start of tool input streaming
 */
export interface ToolInputStartEvent extends BaseSSEEvent {
  type: "tool-input-start";
  toolCallId: string;
  toolName: string;
}

/**
 * Tool input fully available
 */
export interface ToolInputAvailableEvent extends BaseSSEEvent {
  type: "tool-input-available";
  toolCallId: string;
  toolName: string;
  input: unknown;
}

/**
 * Tool approval request (ADR 0002)
 *
 * IMPORTANT: Use `approvalId` when calling `addToolApprovalResponse()`,
 * NOT `toolCallId`. The `toolCallId` refers to the original tool being approved.
 */
export interface ToolApprovalRequestEvent extends BaseSSEEvent {
  type: "tool-approval-request";
  toolCallId: string; // Original tool's call ID
  approvalId: string; // ID to use with addToolApprovalResponse()
}

/**
 * Tool execution result available
 */
export interface ToolOutputAvailableEvent extends BaseSSEEvent {
  type: "tool-output-available";
  toolCallId: string;
  toolName: string;
  output: unknown;
}

/**
 * Tool execution error
 */
export interface ToolOutputErrorEvent extends BaseSSEEvent {
  type: "tool-output-error";
  toolCallId: string;
  toolName: string;
  error: string;
}

/**
 * Tool execution denied by user
 */
export interface ToolOutputDeniedEvent extends BaseSSEEvent {
  type: "tool-output-denied";
  toolCallId: string;
  toolName: string;
}

// ============================================================================
// Error Events
// ============================================================================

/**
 * Stream error
 */
export interface ErrorEvent extends BaseSSEEvent {
  type: "error";
  error: string;
}

// ============================================================================
// Union Types
// ============================================================================

/**
 * All possible SSE event types
 */
export type SSEEvent =
  | StartEvent
  | FinishEvent
  | StartStepEvent
  | FinishStepEvent
  | TextStartEvent
  | TextDeltaEvent
  | TextEndEvent
  | ToolInputStartEvent
  | ToolInputAvailableEvent
  | ToolApprovalRequestEvent
  | ToolOutputAvailableEvent
  | ToolOutputErrorEvent
  | ToolOutputDeniedEvent
  | ErrorEvent;

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if event is a tool approval request
 */
export function isToolApprovalRequestEvent(
  event: SSEEvent,
): event is ToolApprovalRequestEvent {
  return event.type === "tool-approval-request";
}

/**
 * Check if event is a tool output available
 */
export function isToolOutputAvailableEvent(
  event: SSEEvent,
): event is ToolOutputAvailableEvent {
  return event.type === "tool-output-available";
}

/**
 * Check if event is a finish step event (ADR 0011)
 */
export function isFinishStepEvent(event: SSEEvent): event is FinishStepEvent {
  return event.type === "finish-step";
}

/**
 * Check if event is a text delta event
 */
export function isTextDeltaEvent(event: SSEEvent): event is TextDeltaEvent {
  return event.type === "text-delta";
}

// ============================================================================
// SSE Parsing Helpers
// ============================================================================

/**
 * Parse SSE data line to typed event
 *
 * @param dataLine - SSE data line (e.g., 'data: {"type":"text-delta","text":"Hello"}')
 * @returns Parsed event or null if parsing fails
 *
 * @example
 * ```typescript
 * const event = parseSSEDataLine('data: {"type":"text-delta","text":"Hi"}');
 * if (event && isTextDeltaEvent(event)) {
 *   console.log(event.text); // "Hi"
 * }
 * ```
 */
export function parseSSEDataLine(dataLine: string): SSEEvent | null {
  if (!dataLine.startsWith("data: ")) {
    return null;
  }

  const jsonStr = dataLine.slice(6).trim();
  if (jsonStr === "[DONE]") {
    return null;
  }

  try {
    return JSON.parse(jsonStr) as SSEEvent;
  } catch {
    return null;
  }
}
