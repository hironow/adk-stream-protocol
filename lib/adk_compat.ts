/**
 * ADK (Agent Development Kit) Compatibility Utilities
 *
 * This module provides utilities for integrating ADK-specific features
 * with AI SDK v6, particularly for handling ADK Tool Confirmation Flow.
 */

import type { UIMessage } from "@ai-sdk/react";

/**
 * Options for sendAutomaticallyWhen function
 */
export interface SendAutomaticallyWhenOptions {
  messages: UIMessage[];
}

/**
 * Checks if the last message is an assistant message with adk_request_confirmation completed.
 *
 * ADK Tool Confirmation Flow Integration
 * - Detects when adk_request_confirmation tool has completed (state=output-available)
 * - This indicates user has approved/denied the confirmation via the approval UI
 * - Triggers automatic message sending to continue the agent workflow
 *
 * @param options - Object containing messages array
 * @returns true if automatic send should be triggered, false otherwise
 *
 * @example
 * ```typescript
 * const shouldSend = sendAutomaticallyWhenAdkConfirmation({ messages });
 * if (shouldSend) {
 *   // Trigger automatic send to continue workflow
 * }
 * ```
 */
export function sendAutomaticallyWhenAdkConfirmation({
  messages,
}: SendAutomaticallyWhenOptions): boolean {
  try {
    // Custom logic for ADK Tool Confirmation Flow
    const lastMessage = messages[messages.length - 1];
    console.log(
      `[sendAutomaticallyWhen] Checking lastMessage role: ${lastMessage?.role}`,
    );
    if (lastMessage?.role !== "assistant") return false;

    // AI SDK v6 stores tool invocations in the `parts` array, not `toolInvocations`
    // biome-ignore lint/suspicious/noExplicitAny: AI SDK v6 internal structure
    const parts = (lastMessage as any).parts || [];
    console.log(
      `[sendAutomaticallyWhen] Found ${parts.length} parts in lastMessage`,
    );
    console.log(
      // biome-ignore lint/suspicious/noExplicitAny: AI SDK v6 internal structure
      `[sendAutomaticallyWhen] Part types: ${parts.map((p: any) => p.type).join(", ")}`,
    );
    console.log(
      // biome-ignore lint/suspicious/noExplicitAny: AI SDK v6 internal structure
      `[sendAutomaticallyWhen] Part states: ${parts.map((p: any) => `${p.type}:${p.state}`).join(", ")}`,
    );

    // Check if adk_request_confirmation has output
    const confirmationPart = parts.find(
      // biome-ignore lint/suspicious/noExplicitAny: AI SDK v6 internal structure
      (part: any) =>
        part.type === "tool-adk_request_confirmation" &&
        part.state === "output-available",
    );

    if (confirmationPart) {
      console.log(
        "[sendAutomaticallyWhen] Found confirmation part:",
        JSON.stringify(confirmationPart, null, 2),
      );

      // Check if this is the FIRST time confirmation completed (user just clicked)
      // vs. backend has responded with additional content
      //
      // When user clicks Approve/Deny:
      // - Confirmation tool in output-available state
      // - Message has NO text content yet
      //
      // After backend responds:
      // - Confirmation still in output-available
      // - BUT: Message now HAS text content (AI's response)
      //
      // By checking for text content, we detect when backend has responded

      // Check if message has text content (indicates backend response)
      const hasTextContent = parts.some(
        // biome-ignore lint/suspicious/noExplicitAny: AI SDK v6 internal structure
        (part: any) => part.type === "text" && part.text && part.text.trim().length > 0,
      );

      console.log(
        `[sendAutomaticallyWhen] Message has text content: ${hasTextContent}`,
      );

      if (hasTextContent) {
        // Backend has responded with text - don't send again
        console.log(
          "[sendAutomaticallyWhen] Backend has responded (message has text), not sending",
        );
        return false;
      }

      // First time confirmation completed (no text yet) - send to backend
      console.log(
        "[sendAutomaticallyWhen] First confirmation completion detected (no text yet), triggering send",
      );
      return true;
    }

    // DON'T fall back to standard approval logic - it may cause infinite loops
    console.log(
      "[sendAutomaticallyWhen] No adk_request_confirmation completion, not sending",
    );
    return false;
  } catch (error) {
    // Prevent infinite request loops by returning false on error
    console.error(
      "[sendAutomaticallyWhen] Error in sendAutomaticallyWhen:",
      error,
    );
    return false;
  }
}

/**
 * Type guard to check if a message is an assistant message
 */
export function isAssistantMessage(message: UIMessage): boolean {
  return message.role === "assistant";
}

/**
 * Extracts parts array from AI SDK v6 message
 *
 * @param message - AI SDK v6 message
 * @returns Array of parts, or empty array if not found
 */
// biome-ignore lint/suspicious/noExplicitAny: AI SDK v6 internal structure
export function extractParts(message: UIMessage): any[] {
  // biome-ignore lint/suspicious/noExplicitAny: AI SDK v6 internal structure
  return (message as any).parts || [];
}

/**
 * Finds a part by type and optional state
 *
 * @param parts - Array of parts from AI SDK v6 message
 * @param type - Part type to search for (e.g., "tool-adk_request_confirmation")
 * @param state - Optional state to match (e.g., "output-available")
 * @returns The matching part, or undefined if not found
 */
export function findPart(
  // biome-ignore lint/suspicious/noExplicitAny: AI SDK v6 internal structure
  parts: any[],
  type: string,
  state?: string,
  // biome-ignore lint/suspicious/noExplicitAny: AI SDK v6 internal structure
): any | undefined {
  return parts.find((part) => {
    const typeMatches = part.type === type;
    const stateMatches = state === undefined || part.state === state;
    return typeMatches && stateMatches;
  });
}

/**
 * Creates an ADK confirmation output for addToolOutput.
 *
 * ADK Tool Confirmation Flow (Simplified)
 * - Simple format: just {confirmed: boolean}
 * - Backend uses toolCallId directly (no originalFunctionCall needed)
 * - Matches ADK specification in assets/adk/action-confirmation.txt
 *
 * @param toolInvocation - The adk_request_confirmation tool invocation
 * @param confirmed - true if user approved, false if denied
 * @returns Object to pass to addToolOutput
 *
 * @example
 * ```typescript
 * // In component:
 * addToolOutput?.(createAdkConfirmationOutput(toolInvocation, true));
 * ```
 */
export function createAdkConfirmationOutput(
  // biome-ignore lint/suspicious/noExplicitAny: Tool invocation type varies
  toolInvocation: any,
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
