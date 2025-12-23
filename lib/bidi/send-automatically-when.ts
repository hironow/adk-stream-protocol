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
import { isTextUIPart, isToolUIPart } from "ai";
import {
  TOOL_TYPE_ADK_REQUEST_CONFIRMATION,
  TOOL_STATE_OUTPUT_AVAILABLE,
  TOOL_STATE_OUTPUT_ERROR,
  TOOL_STATE_APPROVAL_RESPONDED,
  TOOL_STATE_APPROVAL_REQUESTED,
} from "@/lib/constants";

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
 * 1. User clicks Approve/Deny → addToolApprovalResponse updates confirmation state
 * 2. This function detects confirmation completion → returns true
 *    - Approval: state changes to "approval-responded", approval.approved = true
 *    - Denial: state changes to "approval-responded", approval.approved = false
 * 3. useChat automatically calls transport.sendMessages()
 * 4. WebSocketChatTransport sends WebSocket message to backend
 * 5. Backend receives approval/denial and responds
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

    // Check if adk_request_confirmation has been approved OR denied
    // AI SDK v6 approval flow:
    // - State: "approval-responded" (for both approval and denial)
    // - Approval: part.approval.approved = true
    // - Denial: part.approval.approved = false
    // Both cases should trigger automatic send to backend
    const confirmationPart = parts.find(
      // biome-ignore lint/suspicious/noExplicitAny: AI SDK v6 internal structure
      (part: any) =>
        part.type === TOOL_TYPE_ADK_REQUEST_CONFIRMATION &&
        part.state === TOOL_STATE_APPROVAL_RESPONDED,
    );

    if (!confirmationPart) {
      console.log(
        "[BIDI sendAutomaticallyWhen] No confirmation approval/denial, not sending",
      );
      return false;
    }

    console.log(
      "[BIDI sendAutomaticallyWhen] Found confirmation part:",
      JSON.stringify(confirmationPart, null, 2),
    );

    // BIDI-specific: Check for pending confirmations (approval-requested)
    // In BIDI mode, multiple confirmations can accumulate in the same message
    // If there's a pending confirmation, wait for user response before sending
    const hasPendingConfirmation = parts.some(
      // biome-ignore lint/suspicious/noExplicitAny: AI SDK v6 internal structure
      (part: any) =>
        part.type === TOOL_TYPE_ADK_REQUEST_CONFIRMATION &&
        part.state === TOOL_STATE_APPROVAL_REQUESTED,
    );

    if (hasPendingConfirmation) {
      console.log(
        "[BIDI sendAutomaticallyWhen] Pending confirmation found (approval-requested), waiting for user response",
      );
      return false;
    }

    // Check if this is the FIRST time confirmation completed (user just clicked)
    // vs. backend has responded with additional content
    //
    // When user clicks Approve/Deny:
    // - Confirmation tool in approval-responded state
    // - Original tool (if exists) is still waiting (input-available or executing)
    //
    // After backend responds:
    // - Confirmation still in approval-responded
    // - Original tool (if exists) has completed (output-available or output-error)
    // - Message may have new AI response text

    // Check if backend has ALREADY responded by looking for:
    // 1. Text parts (AI response)
    // 2. Other tools that have completed
    const hasTextPart = parts.some(
      // biome-ignore lint/suspicious/noExplicitAny: AI SDK v6 internal structure
      (part: any) => isTextUIPart(part),
    );

    if (hasTextPart) {
      console.log(
        "[BIDI sendAutomaticallyWhen] Text part found, backend has responded, not sending",
      );
      return false;
    }

    // Find ANY other tool in the same message (not confirmation)
    const otherTools = parts.filter(
      // biome-ignore lint/suspicious/noExplicitAny: AI SDK v6 internal structure
      (part: any) =>
        isToolUIPart(part) &&
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
      if (
        toolState === TOOL_STATE_OUTPUT_AVAILABLE ||
        toolState === TOOL_STATE_OUTPUT_ERROR
      ) {
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
