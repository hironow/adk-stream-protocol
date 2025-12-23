/**
 * WebSocket Message Builders for Integration Tests
 *
 * Helper functions to create WebSocket messages for ADK BIDI protocol testing.
 * Provides consistent message formatting for mock WebSocket responses.
 */

import { TOOL_NAME_ADK_REQUEST_CONFIRMATION } from "../../constants";

/**
 * ADK BIDI message event (user/assistant content)
 */
export interface BidiMessageEvent {
  type: "message";
  content: string | { type: string; [key: string]: unknown };
}

/**
 * ADK BIDI tool use event
 */
export interface BidiToolUseEvent {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}

/**
 * ADK BIDI end of turn event
 */
export interface BidiEndOfTurnEvent {
  type: "end_of_turn";
}

/**
 * ADK BIDI function response event (tool result)
 */
export interface BidiFunctionResponseEvent {
  type: "function_response";
  id: string;
  response: unknown;
}

/**
 * Union type for all BIDI events
 */
export type BidiEvent =
  | BidiMessageEvent
  | BidiToolUseEvent
  | BidiEndOfTurnEvent
  | BidiFunctionResponseEvent;

/**
 * Create BIDI message event
 *
 * @param content - Message content (string or structured object)
 * @returns BIDI message event object
 *
 * @example
 * ```typescript
 * const event = createBidiMessageEvent('Hello');
 * mockWebSocket.simulateMessage(JSON.stringify(event));
 * ```
 */
export function createBidiMessageEvent(
  content: string | { type: string; [key: string]: unknown },
): BidiMessageEvent {
  return {
    type: "message",
    content,
  };
}

/**
 * Create BIDI tool use event
 *
 * @param id - Tool call ID
 * @param name - Tool name
 * @param input - Tool input parameters
 * @returns BIDI tool use event object
 *
 * @example
 * ```typescript
 * const event = createBidiToolUseEvent('call-1', 'search', { query: 'test' });
 * mockWebSocket.simulateMessage(JSON.stringify(event));
 * ```
 */
export function createBidiToolUseEvent(
  id: string,
  name: string,
  input: unknown,
): BidiToolUseEvent {
  return {
    type: "tool_use",
    id,
    name,
    input,
  };
}

/**
 * Create BIDI end of turn event
 *
 * @returns BIDI end of turn event object
 *
 * @example
 * ```typescript
 * const event = createBidiEndOfTurnEvent();
 * mockWebSocket.simulateMessage(JSON.stringify(event));
 * ```
 */
export function createBidiEndOfTurnEvent(): BidiEndOfTurnEvent {
  return {
    type: "end_of_turn",
  };
}

/**
 * Create BIDI confirmation request (adk_request_confirmation tool)
 *
 * @param originalFunctionCall - Original function call to confirm
 * @returns BIDI tool use event for confirmation request
 *
 * @example
 * ```typescript
 * const event = createBidiConfirmationRequest({
 *   id: 'orig-1',
 *   name: 'dangerous_operation',
 *   args: { param: 'value' },
 * });
 * mockWebSocket.simulateMessage(JSON.stringify(event));
 * ```
 */
export function createBidiConfirmationRequest(originalFunctionCall: {
  id: string;
  name: string;
  args: Record<string, unknown>;
}): BidiToolUseEvent {
  return createBidiToolUseEvent("call-1", TOOL_NAME_ADK_REQUEST_CONFIRMATION, {
    originalFunctionCall,
  });
}

/**
 * Create text delta message event
 *
 * @param textDelta - Text content
 * @returns BIDI message event with text delta structure
 *
 * @example
 * ```typescript
 * const event = createTextDeltaEvent('Hello World');
 * mockWebSocket.simulateMessage(JSON.stringify(event));
 * ```
 */
export function createTextDeltaEvent(textDelta: string): BidiMessageEvent {
  return createBidiMessageEvent({ type: "text-delta", textDelta });
}
