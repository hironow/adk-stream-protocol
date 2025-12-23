/**
 * SSE Event Sender
 *
 * Handles outgoing messages to backend in SSE mode (HTTP fetch).
 *
 * SSE Mode Characteristics:
 * - Uses AI SDK's DefaultChatTransport (HTTP fetch)
 * - Confirmation handled via addToolOutput mechanism
 * - Two separate HTTP requests (user input ’ confirmation ’ approval ’ execution)
 * - ADK natively handles confirmation flow
 *
 * Responsibilities:
 * - Send confirmation responses via addToolOutput
 * - Create ADK-compatible confirmation output format
 */

/**
 * Tool invocation data for confirmation handling (SSE mode)
 */
export interface SseConfirmationToolInvocation {
  /**
   * Tool call ID from backend.
   * Format in SSE mode: "confirmation-adk-XXXX"
   */
  toolCallId: string;

  /**
   * Tool name (should be "adk_request_confirmation")
   */
  toolName: string;

  /**
   * Input data (optional, contains originalFunctionCall for context)
   */
  input?: {
    originalFunctionCall?: {
      id: string;
      name: string;
      args: Record<string, unknown>;
    };
  };
}

/**
 * Create ADK-compatible confirmation output for addToolOutput.
 *
 * This format matches what ADK expects when handling adk_request_confirmation tool.
 *
 * @param toolInvocation - The confirmation tool invocation
 * @param confirmed - Whether the user approved (true) or denied (false)
 * @returns Output object for addToolOutput
 *
 * @example
 * ```typescript
 * const output = createAdkConfirmationOutput(toolInvocation, true);
 * addToolOutput(output);
 * ```
 */
export function createAdkConfirmationOutput(
  toolInvocation: SseConfirmationToolInvocation,
  confirmed: boolean,
): { tool: string; toolCallId: string; output: unknown } {
  return {
    tool: "adk_request_confirmation",
    toolCallId: toolInvocation.toolCallId,
    output: {
      confirmed,
    },
  };
}

/**
 * Send confirmation response in SSE mode.
 *
 * SSE mode uses AI SDK's addToolOutput mechanism to send confirmation.
 * This triggers a new HTTP request to the backend with the user's decision.
 *
 * @param toolInvocation - The confirmation tool invocation
 * @param confirmed - Whether the user approved (true) or denied (false)
 * @param addToolOutput - AI SDK's addToolOutput function
 *
 * @example
 * ```typescript
 * sendConfirmation(
 *   toolInvocation,
 *   true,
 *   (output) => addToolOutput(output)
 * );
 * ```
 */
export function sendConfirmation(
  toolInvocation: SseConfirmationToolInvocation,
  confirmed: boolean,
  addToolOutput: (response: {
    tool: string;
    toolCallId: string;
    output: unknown;
  }) => void,
): void {
  console.info(
    `[SSE EventSender] Sending confirmation via addToolOutput`,
    { toolCallId: toolInvocation.toolCallId, confirmed },
  );

  const output = createAdkConfirmationOutput(toolInvocation, confirmed);
  addToolOutput(output);
}
