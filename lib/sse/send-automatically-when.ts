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
 * │ Decision Logic: When to return true (CRITICAL ORDER)                       │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 *   Check 1: Has text part in assistant message?
 *       YES → return false (backend already sent AI response)
 *       NO → Continue
 *       WHY: Text indicates backend completed full response cycle
 *
 *   Check 2: Has approval-responded confirmation?
 *       NO → return false (user hasn't approved yet or wrong state)
 *       YES → Continue
 *       WHY: Must validate approval before checking execution patterns
 *
 *   Check 3: Has pending approval-requested confirmations?
 *       YES → return false (wait for user to approve all tools)
 *       NO → Continue
 *       WHY: Don't send until all confirmations are resolved
 *
 *   Check 4: Any other tool in ERROR state?
 *       YES → return false (backend already responded with error)
 *       NO → Continue
 *       WHY: Error state means backend finished processing
 *       NOTE: output-available NOT checked here (handled in Check 5)
 *
 *   Check 5: Has tool output from addToolOutput()? (Frontend Execute)
 *       YES → return true (frontend executed tool, send result to backend)
 *       NO → Continue
 *       WHY: Tool in output-available + no error = frontend just called addToolOutput()
 *       CRITICAL: Must check AFTER error check to distinguish:
 *         - Frontend Execute: tool output-available, no errors
 *         - Backend responded: text part present (caught in Check 1)
 *
 *   Default: return true (Server Execute: send approval to backend)
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

    // CRITICAL: Check if any tool has been approved (ADR 0002)
    // With ADR 0002, tool-approval-request updates the original tool part's state
    // to "approval-requested", and addToolApprovalResponse() updates it to "approval-responded"
    const hasApprovedTool = parts.some(
      // biome-ignore lint/suspicious/noExplicitAny: AI SDK v6 internal structure
      (part: any) =>
        isToolUIPart(part) && part.state === TOOL_STATE_APPROVAL_RESPONDED,
    );

    if (!hasApprovedTool) {
      // No approved tool found - user hasn't responded to approval request yet
      return false;
    }

    // SSE-specific: Check for pending approval requests (approval-requested)
    // In SSE mode, multiple tools can be waiting for approval in the same message
    // If there's a pending approval request, wait for user response before sending
    const hasPendingApproval = parts.some(
      // biome-ignore lint/suspicious/noExplicitAny: AI SDK v6 internal structure
      (part: any) =>
        isToolUIPart(part) && part.state === TOOL_STATE_APPROVAL_REQUESTED,
    );

    if (hasPendingApproval) {
      return false;
    }

    // CRITICAL: Check if tools have completed execution BEFORE Frontend Execute check
    // This distinguishes:
    // - Backend already responded: Tools in output-available/error → return false
    // - Frontend Execute: Tool in approval-responded, user called addToolOutput() → return true
    //
    // When user approves:
    // - Tool in approval-responded state
    // - Tool is still waiting (input-available or needs frontend execution)
    //
    // After backend responds:
    // - Tool still in approval-responded (if server execute)
    // - Tool has completed (output-available or output-error)
    // - Message may have new AI response text
    //
    // Note: Text part check is done earlier

    // Find all tool parts in the message
    const toolParts = parts.filter(
      // biome-ignore lint/suspicious/noExplicitAny: AI SDK v6 internal structure
      (part: any) => isToolUIPart(part),
    );

    // Check if any tool has ERRORED (backend responded with error)
    // Note: output-available state is handled by Frontend Execute check below
    for (const toolPart of toolParts) {
      // biome-ignore lint/suspicious/noExplicitAny: AI SDK v6 internal structure
      const toolState = (toolPart as any).state;

      // Only check for error states - output-available could be from addToolOutput
      if (toolState === TOOL_STATE_OUTPUT_ERROR) {
        return false;
      }

      // Check if tool has error field (additional safety)
      // biome-ignore lint/suspicious/noExplicitAny: AI SDK v6 internal structure
      const hasError = (toolPart as any).error;
      if (hasError) {
        return false;
      }
    }

    // Check for Frontend Execute pattern: tool output added via addToolOutput()
    // addToolOutput() updates existing tool part to state="output-available"
    // This check is AFTER "tools completed" check to prevent false positives
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
