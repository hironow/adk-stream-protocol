/**
 * BIDI Mode - sendAutomaticallyWhen
 *
 * Determines when to automatically send messages in BIDI mode.
 * Specifically handles ADK Tool Confirmation Flow.
 *
 * BIDI-specific behavior:
 * - WebSocket connection is persistent
 * - EventSender.sendMessages() converts confirmation to function_response
 * - No HTTP request overhead
 */

import type { UIMessage } from "@ai-sdk/react";
import { TOOL_TYPE_ADK_REQUEST_CONFIRMATION } from "@/lib/constants";

/**
 * Options for sendAutomaticallyWhen function
 */
export interface SendAutomaticallyWhenOptions {
  messages: UIMessage[];
}

/**
 * BIDI Mode: Automatically send when adk_request_confirmation completes
 *
 * ADK Tool Confirmation Flow (BIDI):
 * 1. User clicks Approve/Deny → addToolOutput adds confirmation to messages
 * 2. This function detects confirmation completion → returns true
 * 3. useChat automatically calls transport.sendMessages()
 * 4. EventSender.sendMessages() converts to function_response
 * 5. WebSocket sends to backend immediately
 *
 * @param options - Object containing messages array
 * @returns true if automatic send should be triggered, false otherwise
 */
export function sendAutomaticallyWhen({
  messages,
}: SendAutomaticallyWhenOptions): boolean {
  try {
    const lastMessage = messages[messages.length - 1];
    console.log(
      `[BIDI sendAutomaticallyWhen] Checking lastMessage role: ${lastMessage?.role}`,
    );
    if (lastMessage?.role !== "assistant") return false;

    // AI SDK v6 stores tool invocations in the `parts` array
    // biome-ignore lint/suspicious/noExplicitAny: AI SDK v6 internal structure
    const parts = (lastMessage as any).parts || [];
    console.log(
      `[BIDI sendAutomaticallyWhen] Found ${parts.length} parts in lastMessage`,
    );

    // Check if adk_request_confirmation has output
    const confirmationPart = parts.find(
      // biome-ignore lint/suspicious/noExplicitAny: AI SDK v6 internal structure
      (part: any) =>
        part.type === TOOL_TYPE_ADK_REQUEST_CONFIRMATION &&
        part.state === "output-available",
    );

    if (!confirmationPart) {
      console.log(
        "[BIDI sendAutomaticallyWhen] No confirmation completion, not sending",
      );
      return false;
    }

    console.log(
      "[BIDI sendAutomaticallyWhen] Found confirmation part:",
      JSON.stringify(confirmationPart, null, 2),
    );

    // Check if this is the FIRST time confirmation completed (user just clicked)
    // vs. backend has responded with additional content
    //
    // When user clicks Approve/Deny:
    // - Confirmation tool in output-available state
    // - Original tool (if exists) is still waiting (input-available or executing)
    //
    // After backend responds:
    // - Confirmation still in output-available
    // - Original tool (if exists) has completed (output-available or Failed)
    // - Message may have new AI response text

    // Find ANY other tool in the same message (not confirmation)
    const otherTools = parts.filter(
      // biome-ignore lint/suspicious/noExplicitAny: AI SDK v6 internal structure
      (part: any) =>
        part.type?.startsWith("tool-") &&
        part.type !== TOOL_TYPE_ADK_REQUEST_CONFIRMATION,
    );

    console.log(
      `[BIDI sendAutomaticallyWhen] Found ${otherTools.length} other tool(s) besides confirmation`,
    );

    // Check if any other tool has completed (backend responded)
    for (const toolPart of otherTools) {
      // biome-ignore lint/suspicious/noExplicitAny: AI SDK v6 internal structure
      const toolState = (toolPart as any).state;
      // biome-ignore lint/suspicious/noExplicitAny: AI SDK v6 internal structure
      const toolType = (toolPart as any).type;

      console.log(
        `[BIDI sendAutomaticallyWhen] Tool ${toolType} state: ${toolState}`,
      );

      // Check for both completed states AND error state
      // This detects when backend has ALREADY responded (prevents infinite loop)
      if (toolState === "output-available" || toolState === "output-error") {
        console.log(
          `[BIDI sendAutomaticallyWhen] Tool ${toolType} completed (state: ${toolState}), backend has responded, not sending`,
        );
        return false;
      }

      // Check if tool has error (additional safety)
      // biome-ignore lint/suspicious/noExplicitAny: AI SDK v6 internal structure
      const hasError = (toolPart as any).error;
      if (hasError) {
        console.log(
          `[BIDI sendAutomaticallyWhen] Tool ${toolType} has error, not sending`,
        );
        return false;
      }
    }

    // First time confirmation completed - send to backend via WebSocket
    console.log(
      "[BIDI sendAutomaticallyWhen] First confirmation completion detected, triggering send",
    );
    return true;
  } catch (error) {
    // Prevent infinite request loops by returning false on error
    console.error(
      "[BIDI sendAutomaticallyWhen] Error in sendAutomaticallyWhen:",
      error,
    );
    return false;
  }
}
