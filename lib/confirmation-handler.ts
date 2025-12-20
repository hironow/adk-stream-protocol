/**
 * Confirmation Handler
 *
 * Handles adk_request_confirmation tool approval/denial logic.
 * Decouples confirmation handling from UI component for testability.
 */

import { createAdkConfirmationOutput } from "./adk_compat";

/**
 * Transport interface for sending confirmation results.
 * Abstracts SSE and WebSocket transport layers.
 */
export interface ConfirmationTransport {
  /**
   * WebSocket transport for BIDI mode.
   * Used for confirmation flow via user message.
   */
  websocket?: {
    sendFunctionResponse: (
      toolCallId: string,
      toolName: string,
      response: Record<string, unknown>,
    ) => void;
  };

  /**
   * SSE transport for SSE mode.
   * Uses AI SDK's addToolOutput mechanism.
   */
  sse?: {
    addToolOutput: (response: {
      tool: string;
      toolCallId: string;
      output: unknown;
    }) => void;
  };
}

/**
 * Tool invocation data required for confirmation handling.
 */
export interface ConfirmationToolInvocation {
  /**
   * Tool call ID from backend.
   * Format varies by mode:
   * - BIDI: "confirmation-function-call-XXXX"
   * - SSE: "confirmation-adk-XXXX"
   */
  toolCallId: string;

  /**
   * Tool name (should be "adk_request_confirmation")
   */
  toolName: string;

  /**
   * Input data containing original tool call information.
   */
  input?: {
    originalFunctionCall?: {
      id: string;
      name: string;
      args: Record<string, unknown>;
    };
    toolConfirmation?: {
      confirmed: boolean;
    };
  };
}

/**
 * Result of confirmation handling.
 */
export interface ConfirmationResult {
  /**
   * Whether the confirmation was successfully sent.
   */
  success: boolean;

  /**
   * Error message if sending failed.
   */
  error?: string;

  /**
   * Transport mode used (for debugging).
   */
  mode: "websocket" | "sse" | "none";
}

/**
 * Create ConfirmationTransport with properly bound methods.
 *
 * This function solves the "this" binding issue when passing WebSocket transport methods.
 * Without this, extracting websocketTransport.sendToolResult loses the "this" context,
 * causing "Cannot read properties of undefined" errors.
 *
 * @param websocketTransport - WebSocket transport instance (BIDI mode)
 * @param addToolOutput - AI SDK's addToolOutput function (SSE mode)
 * @returns ConfirmationTransport with correctly bound methods
 *
 * @example
 * ```typescript
 * // BIDI mode - arrow function preserves "this"
 * const transport = createConfirmationTransport(websocketTransport, undefined);
 *
 * // SSE mode
 * const transport = createConfirmationTransport(undefined, addToolOutput);
 * ```
 */
export function createConfirmationTransport(
  websocketTransport:
    | {
        sendToolResult: (
          toolCallId: string,
          result: Record<string, unknown>,
        ) => void;
        sendFunctionResponse: (
          toolCallId: string,
          toolName: string,
          response: Record<string, unknown>,
        ) => void;
      }
    | undefined,
  addToolOutput:
    | ((response: {
        tool: string;
        toolCallId: string;
        output: unknown;
      }) => void)
    | undefined,
): ConfirmationTransport {
  return {
    websocket: websocketTransport
      ? {
          // Arrow function preserves "this" binding
          sendFunctionResponse: (
            toolCallId: string,
            toolName: string,
            response: Record<string, unknown>,
          ) =>
            websocketTransport.sendFunctionResponse(
              toolCallId,
              toolName,
              response,
            ),
        }
      : undefined,
    sse: addToolOutput
      ? {
          addToolOutput,
        }
      : undefined,
  };
}

/**
 * Handle confirmation click from component (high-level API).
 *
 * This function is the main entry point for components.
 * It creates the transport and delegates to handleConfirmation.
 *
 * @param toolInvocation - The confirmation tool invocation
 * @param confirmed - Whether the user approved (true) or denied (false)
 * @param websocketTransport - WebSocket transport (BIDI mode)
 * @param addToolOutput - SSE addToolOutput function (SSE mode)
 * @returns Result indicating success/failure and mode used
 *
 * @example
 * ```typescript
 * // From component onClick handler
 * const result = handleConfirmationClick(
 *   toolInvocation,
 *   true,
 *   websocketTransport,
 *   addToolOutput
 * );
 * ```
 */
export function handleConfirmationClick(
  toolInvocation: ConfirmationToolInvocation,
  confirmed: boolean,
  websocketTransport:
    | {
        sendToolResult: (
          toolCallId: string,
          result: Record<string, unknown>,
        ) => void;
        sendFunctionResponse: (
          toolCallId: string,
          toolName: string,
          response: Record<string, unknown>,
        ) => void;
      }
    | undefined,
  addToolOutput:
    | ((response: {
        tool: string;
        toolCallId: string;
        output: unknown;
      }) => void)
    | undefined,
): ConfirmationResult {
  // Create transport with proper "this" binding
  const transport = createConfirmationTransport(
    websocketTransport,
    addToolOutput,
  );

  // Delegate to core handler
  return handleConfirmation(toolInvocation, confirmed, transport);
}

/**
 * Handle confirmation approval/denial (low-level API).
 *
 * This function encapsulates the logic for sending confirmation results
 * to the backend, choosing the appropriate transport based on availability.
 *
 * @param toolInvocation - The confirmation tool invocation
 * @param confirmed - Whether the user approved (true) or denied (false)
 * @param transport - Available transport methods
 * @returns Result indicating success/failure and mode used
 *
 * @example
 * ```typescript
 * // BIDI mode
 * const result = handleConfirmation(
 *   toolInvocation,
 *   true,
 *   { websocket: { sendFunctionResponse: ws.sendFunctionResponse } }
 * );
 *
 * // SSE mode
 * const result = handleConfirmation(
 *   toolInvocation,
 *   false,
 *   { sse: { addToolOutput: addOutput } }
 * );
 * ```
 */
export function handleConfirmation(
  toolInvocation: ConfirmationToolInvocation,
  confirmed: boolean,
  transport: ConfirmationTransport,
): ConfirmationResult {
  const { toolCallId, toolName } = toolInvocation;

  // Validate tool name
  if (toolName !== "adk_request_confirmation") {
    return {
      success: false,
      error: `Invalid tool name: ${toolName}, expected adk_request_confirmation`,
      mode: "none",
    };
  }

  // Priority 1: WebSocket (BIDI mode)
  // BIDI Mode Protocol: Send user message with tool-result for ORIGINAL tool
  // This matches AI SDK v6's expected format and allows the AI to see the approval
  // in its conversation context.
  if (transport.websocket) {
    // Extract original tool information
    const originalToolCall = toolInvocation.input?.originalFunctionCall;
    if (!originalToolCall) {
      return {
        success: false,
        error: "Missing originalFunctionCall in confirmation tool input",
        mode: "none",
      };
    }

    console.info(
      `[ConfirmationHandler] BIDI mode: Sending user message with tool-result for original tool`,
      {
        confirmationToolCallId: toolCallId,
        originalToolCallId: originalToolCall.id,
        originalToolName: originalToolCall.name,
        confirmed,
      },
    );

    // Send user message with tool-result for the ORIGINAL tool (not confirmation tool)
    // Format matches baseline: ai_sdk_v6_compat.py's FunctionResponse pattern
    transport.websocket.sendFunctionResponse(
      originalToolCall.id, // Original tool ID (e.g., "function-call-123")
      originalToolCall.name, // Original tool name (e.g., "process_payment")
      {
        approved: confirmed,
        user_message: confirmed
          ? `User approved ${originalToolCall.name} execution`
          : `User denied ${originalToolCall.name} execution`,
      },
    );

    return {
      success: true,
      mode: "websocket",
    };
  }

  // Priority 2: SSE (SSE mode)
  if (transport.sse) {
    console.info(
      `[ConfirmationHandler] SSE mode: Sending confirmation via addToolOutput`,
      { toolCallId, confirmed },
    );

    const output = createAdkConfirmationOutput(toolInvocation, confirmed);
    transport.sse.addToolOutput(output);

    return {
      success: true,
      mode: "sse",
    };
  }

  // No transport available
  console.error(
    `[ConfirmationHandler] No transport available for confirmation`,
    { toolCallId, confirmed },
  );

  return {
    success: false,
    error: "No transport (websocket or sse) available",
    mode: "none",
  };
}
