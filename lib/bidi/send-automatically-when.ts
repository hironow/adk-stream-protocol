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
 * BIDI Mode: Automatically send when adk_request_confirmation completes OR tool output added
 *
 * See: ADR 0005 (Frontend Execute Pattern and [DONE] Sending Timing)
 *
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │ PATTERN 1: Server Execute (Backend executes tools)                         │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 *   User Message              Approval Response           Backend Response
 *   ─────────────              ─────────────────           ────────────────
 *        │                            │                           │
 *        │ (1) sendMessages()         │                           │
 *        ├───────────────────────────>│                           │
 *        │                            │                           │
 *        │                            │ (2) Approval request      │
 *        │<───────────────────────────┤    + [DONE]               │
 *        │                            │    (stream closes)        │
 *        │                            │                           │
 *        │ (3) addToolApprovalResponse│                           │
 *        │    (this function → true)  │                           │
 *        ├───────────────────────────>│                           │
 *        │                            │                           │
 *        │                            │ (4) Backend executes      │
 *        │                            │     + Result + [DONE]     │
 *        │<───────────────────────────┴───────────────────────────┤
 *        │                                 (stream closes)        │
 *
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │ PATTERN 2: Frontend Execute (Frontend executes tools)                      │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 *   User Message              Approval Response           Tool Output Response
 *   ─────────────              ─────────────────           ────────────────────
 *        │                            │                           │
 *        │ (1) sendMessages()         │                           │
 *        ├───────────────────────────>│                           │
 *        │                            │                           │
 *        │                            │ (2) Approval request      │
 *        │<───────────────────────────┤    + [DONE]               │
 *        │                            │    (stream closes)        │
 *        │                            │                           │
 *        │ (3) addToolApprovalResponse│                           │
 *        │    (this function → true)  │                           │
 *        ├───────────────────────────>│                           │
 *        │                            │                           │
 *        │                            │ (4) NO [DONE]             │
 *        │<───────────────────────────┤    (stream STAYS OPEN)    │
 *        │                            │         ★ CRITICAL        │
 *        │                            │                           │
 *        │ (5) Frontend executes      │                           │
 *        │     addToolOutput()        │                           │
 *        │     (this function → true) │                           │
 *        ├───────────────────────────────────────────────────────>│
 *        │                            │                           │
 *        │                            │                           │ (6) Result
 *        │<───────────────────────────────────────────────────────┤    + [DONE]
 *        │                                                        │
 *
 * Legend / 凡例:
 * - User Message: ユーザーメッセージ
 * - Approval Response: 承認レスポンス
 * - Backend Response: バックエンドレスポンス
 * - Tool Output Response: ツール出力レスポンス
 * - [DONE]: ストリーム終了シグナル
 * - stream closes: ストリームが閉じる
 * - stream STAYS OPEN: ストリームが開いたまま
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
    // Note: Text part check is done earlier (line 66-75)

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

    // First time confirmation completed - send to backend via WebSocket
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
