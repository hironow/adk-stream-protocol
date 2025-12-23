/**
 * SSE Mode - sendAutomaticallyWhen
 *
 * Determines when to automatically send messages in SSE mode.
 * Specifically handles ADK Tool Confirmation Flow.
 *
 * SSE-specific behavior:
 * - HTTP request/response cycle per interaction
 * - Each sendMessages() creates a new HTTP request
 * - Same detection logic as BIDI but different transport mechanism
 */

import type { UIMessage } from "@ai-sdk/react";
import { isTextUIPart, isToolUIPart } from "ai";
import {
  TOOL_STATE_APPROVAL_REQUESTED,
  TOOL_STATE_APPROVAL_RESPONDED,
  TOOL_STATE_OUTPUT_AVAILABLE,
  TOOL_STATE_OUTPUT_ERROR,
  TOOL_TYPE_ADK_REQUEST_CONFIRMATION,
} from "@/lib/constants";

/**
 * Options for sendAutomaticallyWhen function
 */
export interface SendAutomaticallyWhenOptions {
  messages: UIMessage[];
}

/**
 * SSE Mode: Automatically send when adk_request_confirmation completes OR tool output added
 *
 * See: ADR 0005 (Frontend Execute Pattern and [DONE] Sending Timing)
 *
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │ PATTERN 1: Server Execute (Backend executes tools)                         │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 *   Request 1                  Request 2                   Request 3
 *   ─────────                  ─────────                   ─────────
 *        │                            │                           │
 *        │ (1) Initial message        │                           │
 *        ├───────────────────────────>│                           │
 *        │                            │                           │
 *        │                            │ Approval request          │
 *        │<───────────────────────────┤ + [DONE]                  │
 *        │                            │                           │
 *        │ (2) addToolApprovalResponse│                           │
 *        │    (this function → true)  │                           │
 *        │    triggers sendMessages() │                           │
 *        ├───────────────────────────────────────────────────────>│
 *        │                            │                           │
 *        │                            │                           │ Backend
 *        │                            │                           │ executes
 *        │                            │                           │ + Result
 *        │<───────────────────────────────────────────────────────┤ + [DONE]
 *        │                            │                           │
 *
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │ PATTERN 2: Frontend Execute (Frontend executes tools)                      │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 *   Request 1                  Request 2                   Request 3
 *   ─────────                  ─────────                   ─────────
 *        │                            │                           │
 *        │ (1) Initial message        │                           │
 *        ├───────────────────────────>│                           │
 *        │                            │                           │
 *        │                            │ Approval request          │
 *        │<───────────────────────────┤ + [DONE]                  │
 *        │                            │                           │
 *        │ (2) addToolApprovalResponse│                           │
 *        │    (this function → true)  │                           │
 *        │    triggers sendMessages() │                           │
 *        ├───────────────────────────────────────────────────────>│
 *        │                            │                           │
 *        │                            │                           │ (3) 204
 *        │<───────────────────────────────────────────────────────┤ No Content
 *        │                            │         ★ CRITICAL        │ (no [DONE])
 *        │                            │                           │
 *        │ (4) Frontend executes      │                           │
 *        │     addToolOutput()        │                           │
 *        │     (this function → true) │                           │
 *        │     triggers sendMessages()│                           │
 *        ├───────────────────────────>│                           │
 *        │                            │                           │
 *        │                            │ Result + [DONE]           │
 *        │<───────────────────────────┤                           │
 *        │                            │                           │
 *
 * Legend / 凡例:
 * - Request: HTTPリクエスト
 * - [DONE]: SSEストリーム終了シグナル
 * - 204 No Content: レスポンスなし（次のリクエストを待つ）
 *
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │ Decision Logic: When to return true                                        │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 *   Check 1: Has text part?
 *       YES → return false (backend already responded)
 *       NO → Continue
 *
 *   Check 2: Has tool output from addToolOutput()?
 *       YES → return true (Frontend Execute: send tool result)
 *       NO → Continue
 *
 *   Check 3: Has approval-responded confirmation?
 *       NO → return false (no approval yet)
 *       YES → Continue
 *
 *   Check 4: Has pending approval-requested?
 *       YES → return false (wait for user to approve all)
 *       NO → Continue
 *
 *   Check 5: Any other tool completed (output-available/output-error)?
 *       YES → return false (backend already responded)
 *       NO → return true (Server Execute: send approval)
 *
 * @param options - Object containing messages array
 * @returns true if automatic send should be triggered, false otherwise
 */
export function sendAutomaticallyWhen({
  messages,
}: SendAutomaticallyWhenOptions): boolean {
  try {
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage) return false;

    if (lastMessage?.role !== "assistant") return false;

    // AI SDK v6 stores tool invocations in the `parts` array
    // biome-ignore lint/suspicious/noExplicitAny: AI SDK v6 internal structure
    const parts = (lastMessage as any).parts || [];

    // Early check: If backend has responded with text, don't send again
    // This prevents infinite loops where tool output triggers sends after backend responds
    const hasTextPart = parts.some(
      // biome-ignore lint/suspicious/noExplicitAny: AI SDK v6 internal structure
      (part: any) => isTextUIPart(part),
    );

    if (hasTextPart) {
      return false;
    }

    // Check for Frontend Execute pattern: tool output added via addToolOutput()
    // addToolOutput() updates existing tool part to state="output-available"
    const hasToolOutputFromAddToolOutput = parts.some(
      // biome-ignore lint/suspicious/noExplicitAny: AI SDK v6 internal structure
      (part: any) =>
        isToolUIPart(part) &&
        part.state === TOOL_STATE_OUTPUT_AVAILABLE &&
        part.output !== undefined,
    );

    if (hasToolOutputFromAddToolOutput) {
      return true;
    }

    // Check if adk_request_confirmation has been approved OR denied (Server Execute pattern)
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
      return false;
    }

    // SSE-specific: Check for pending confirmations (approval-requested)
    // In SSE mode, multiple confirmations can accumulate in the same message
    // If there's a pending confirmation, wait for user response before sending
    const hasPendingConfirmation = parts.some(
      // biome-ignore lint/suspicious/noExplicitAny: AI SDK v6 internal structure
      (part: any) =>
        part.type === TOOL_TYPE_ADK_REQUEST_CONFIRMATION &&
        part.state === TOOL_STATE_APPROVAL_REQUESTED,
    );

    if (hasPendingConfirmation) {
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
    //
    // Note: Text part check is done earlier (line 65-72)

    // Find ANY other tool in the same message (not confirmation)
    const otherTools = parts.filter(
      // biome-ignore lint/suspicious/noExplicitAny: AI SDK v6 internal structure
      (part: any) =>
        isToolUIPart(part) && part.type !== TOOL_TYPE_ADK_REQUEST_CONFIRMATION,
    );

    // Check if any other tool has completed (backend responded)
    for (const toolPart of otherTools) {
      // biome-ignore lint/suspicious/noExplicitAny: AI SDK v6 internal structure
      const toolState = (toolPart as any).state;

      // Check for both completed states AND error state
      // This detects when backend has ALREADY responded (prevents infinite loop)
      if (
        toolState === TOOL_STATE_OUTPUT_AVAILABLE ||
        toolState === TOOL_STATE_OUTPUT_ERROR
      ) {
        return false;
      }

      // Check if tool has error (additional safety)
      // biome-ignore lint/suspicious/noExplicitAny: AI SDK v6 internal structure
      const hasError = (toolPart as any).error;
      if (hasError) {
        return false;
      }
    }

    // First time confirmation completed - send to backend via HTTP
    return true;
  } catch (error) {
    // Prevent infinite request loops by returning false on error
    console.error(
      "[SSE sendAutomaticallyWhen] Error in sendAutomaticallyWhen:",
      error,
    );
    return false;
  }
}
