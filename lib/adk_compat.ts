/**
 * ADK (Agent Development Kit) Compatibility Utilities
 *
 * This module provides utilities for integrating ADK-specific features
 * with AI SDK v6, particularly for handling ADK Tool Confirmation Flow.
 */

import type { UIMessage } from "@ai-sdk/react";
import { lastAssistantMessageIsCompleteWithApprovalResponses } from "ai";

/**
 * Options for sendAutomaticallyWhen function
 */
export interface SendAutomaticallyWhenOptions {
  messages: UIMessage[];
}

/**
 * Checks if the last message is an assistant message with adk_request_confirmation completed.
 *
 * Phase 5: ADK Tool Confirmation Flow Integration
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
    // Phase 5: Custom logic for ADK Tool Confirmation Flow
    // Trigger send when adk_request_confirmation has output (confirmed/denied)
    // Don't wait for process_payment to complete (it can't until confirmation is sent)
    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.role !== "assistant") return false;

    // AI SDK v6 stores tool invocations in the `parts` array, not `toolInvocations`
    // biome-ignore lint/suspicious/noExplicitAny: AI SDK v6 internal structure
    const parts = (lastMessage as any).parts || [];

    // Check if adk_request_confirmation has output
    // biome-ignore lint/suspicious/noExplicitAny: AI SDK v6 internal structure
    const confirmationPart = parts.find(
      (part: any) =>
        part.type === "tool-adk_request_confirmation" &&
        part.state === "output-available"
    );

    if (confirmationPart) {
      console.log(
        "[sendAutomaticallyWhen] adk_request_confirmation completed, triggering send"
      );
      return true;
    }

    // Fall back to standard approval logic for Phase 4 tools
    return lastAssistantMessageIsCompleteWithApprovalResponses({ messages });
  } catch (error) {
    // Prevent infinite request loops by returning false on error
    console.error("[sendAutomaticallyWhen] Error in sendAutomaticallyWhen:", error);
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
  state?: string
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
 * Phase 5: ADK Tool Confirmation Flow
 * - Encapsulates the protocol details of ADK RequestConfirmation
 * - Components don't need to know about originalFunctionCall structure
 * - Backend expects originalFunctionCall in output for proper conversion
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
  confirmed: boolean
): { tool: string; toolCallId: string; output: unknown } {
  const originalToolCall = toolInvocation.input?.originalFunctionCall;

  return {
    tool: "adk_request_confirmation",
    toolCallId: toolInvocation.toolCallId,
    output: {
      originalFunctionCall: originalToolCall,
      toolConfirmation: { confirmed },
    },
  };
}
