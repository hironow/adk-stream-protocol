/**
 * BIDI Mode - sendAutomaticallyWhen (WebSocket Auto-Send Logic)
 *
 * Determines when to automatically send messages in BIDI mode (WebSocket) after
 * user interactions like tool approval or tool execution. This function is passed
 * to AI SDK v6's useChat hook as the `sendAutomaticallyWhen` option.
 *
 * Key Responsibilities:
 * - Detect when user approves tool confirmation (Server Execute pattern)
 * - Detect when frontend executes tool and provides output (Frontend Execute pattern)
 * - Prevent duplicate sends after backend has already responded
 * - Prevent infinite loops by validating message state carefully
 *
 * BIDI-Specific Optimizations:
 * - WebSocket connection is persistent (no connection overhead)
 * - EventSender.sendMessages() efficiently converts confirmation to function_response
 * - Lower latency compared to SSE (no HTTP request/response cycle)
 * - Can handle multiple pending confirmations in single message
 *
 * Integration with AI SDK v6:
 * This function is called by useChat after each message state update to determine
 * if a new sendMessages() call should be triggered automatically. Return true to
 * trigger automatic send, false to wait for explicit user action.
 *
 * See Also:
 * - ADR 0005: Frontend Execute Pattern and [DONE] Sending Timing
 * - lib/sse/send-automatically-when.ts: SSE version (simpler logic due to HTTP)
 */

import {
  isApprovalRequestedTool,
  isApprovalRespondedTool,
  isOutputAvailableTool,
  isOutputErrorTool,
  isTextUIPartFromAISDKv6,
  isToolUIPartFromAISDKv6,
  type UIMessageFromAISDKv6,
} from "@/lib/utils";

/**
 * Options for sendAutomaticallyWhen Function
 *
 * @property messages - Current messages array from useChat hook
 *                      Used to analyze last assistant message for auto-send triggers
 */
export interface SendAutomaticallyWhenOptions {
  messages: UIMessageFromAISDKv6[];
}

// Track which approval states we've already triggered sends for
// Key: messageId + sorted list of approved tool call IDs
// This prevents infinite loops where sendAutomaticallyWhen returns true repeatedly
const sentApprovalStates = new Set<string>();

/**
 * BIDI Mode: Automatically Send When Tool Confirmation Completes OR Tool Output Added
 *
 * This function implements the core auto-send logic for BIDI mode's tool confirmation
 * workflow. It analyzes the last assistant message to determine if AI SDK should
 * automatically trigger a new sendMessages() call.
 *
 * Two Main Patterns Supported:
 * 1. Server Execute: Backend executes tools, frontend only provides approval
 * 2. Frontend Execute: Frontend executes tools (browser APIs), sends results to backend
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
 * Critical Implementation Notes:
 * - Check order is CRITICAL to prevent false positives and infinite loops
 * - Text part check must come FIRST to detect backend responses
 * - Approval-responded validation must come BEFORE Frontend Execute check
 * - Error state check must come BEFORE output-available check
 *
 * @param options - Configuration object
 * @param options.messages - Current messages array from useChat hook
 * @returns {boolean} Auto-send trigger decision
 *          - true: Trigger sendMessages() automatically (tool confirmation approved OR tool output added)
 *          - false: Wait for explicit user action (no auto-send)
 *
 * @throws Never throws - catches all errors and returns false to prevent infinite loops
 *
 * @example Server Execute Pattern
 * ```typescript
 * // User approves tool confirmation
 * addToolApprovalResponse({ id: 'call-1', approved: true });
 * // → sendAutomaticallyWhen returns true
 * // → AI SDK automatically calls sendMessages()
 * // → Backend executes tool and returns result
 * ```
 *
 * @example Frontend Execute Pattern
 * ```typescript
 * // User approves tool confirmation
 * addToolApprovalResponse({ id: 'call-1', approved: true });
 * // → sendAutomaticallyWhen returns true
 * // → AI SDK automatically calls sendMessages()
 * // → Backend acknowledges approval (no [DONE] signal)
 *
 * // Frontend executes tool
 * const result = await navigator.geolocation.getCurrentPosition();
 * addToolOutput({ toolCallId: 'orig-1', output: JSON.stringify(result) });
 * // → sendAutomaticallyWhen returns true
 * // → AI SDK automatically calls sendMessages()
 * // → Backend receives tool output and returns AI response
 * ```
 */
export function sendAutomaticallyWhen({
  messages,
}: SendAutomaticallyWhenOptions): boolean {
  try {
    console.log("[sendAutomaticallyWhen] ═══ CALLED ═══");
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage) {
      console.log("[sendAutomaticallyWhen] No last message, returning false");
      return false;
    }

    if (lastMessage?.role !== "assistant") {
      console.log(
        "[sendAutomaticallyWhen] Last message role is not assistant:",
        lastMessage?.role,
      );
      return false;
    }

    // AI SDK v6 stores tool invocations in the `parts` array
    // biome-ignore lint/suspicious/noExplicitAny: AI SDK v6 internal structure
    const parts = (lastMessage as any).parts || [];
    console.log("[sendAutomaticallyWhen] Checking parts:", parts.length);
    console.log(
      "[sendAutomaticallyWhen] Parts detail:",
      JSON.stringify(
        parts.map((p: any) => ({
          type: p.type,
          toolCallId: p.toolCallId,
          state: p.state,
          hasApproval: !!p.approval,
          approvalApproved: p.approval?.approved,
        })),
        null,
        2,
      ),
    );

    // Early check: If backend has responded with text, don't send again
    // This prevents infinite loops where tool output triggers sends after backend responds
    const hasTextPart = parts.some(
      // biome-ignore lint/suspicious/noExplicitAny: AI SDK v6 internal structure
      (part: any) => isTextUIPartFromAISDKv6(part),
    );

    if (hasTextPart) {
      console.log("[sendAutomaticallyWhen] Has text part, returning false");

      // Clear approval state tracking for this message since backend has responded
      // This allows future approvals in new messages to work correctly
      const messageId = (lastMessage as any).id || "unknown";
      const keysToDelete = Array.from(sentApprovalStates).filter((key) =>
        key.startsWith(`${messageId}:`),
      );
      for (const key of keysToDelete) {
        sentApprovalStates.delete(key);
      }
      if (keysToDelete.length > 0) {
        console.log(
          "[sendAutomaticallyWhen] Cleared approval states:",
          keysToDelete,
        );
      }

      return false;
    }

    // CRITICAL: Check if any tool has been approved (AI SDK v6 behavior)
    // AI SDK v6: When user calls addToolApprovalResponse() with correct approval.id,
    // the state immediately changes from "approval-requested" to "approval-responded"
    // No two-phase tracking needed - just check for approval-responded state
    const hasApprovedTool = parts.some(
      // biome-ignore lint/suspicious/noExplicitAny: AI SDK v6 internal structure
      (part: any) => isApprovalRespondedTool(part),
    );

    if (!hasApprovedTool) {
      console.log(
        "[sendAutomaticallyWhen] No approved tool found (no approval-responded state), returning false",
      );
      // No approved tool found - user hasn't responded to approval request yet
      return false;
    }
    console.log("[sendAutomaticallyWhen] Has approved tool (approval-responded state)");

    // BIDI-specific: Check for pending approval requests
    // In BIDI mode, multiple tools can be waiting for approval in the same message
    // If there's still a tool in approval-requested state, wait for user response before sending
    const hasPendingApproval = parts.some(
      // biome-ignore lint/suspicious/noExplicitAny: AI SDK v6 internal structure
      (part: any) => isApprovalRequestedTool(part),
    );

    if (hasPendingApproval) {
      console.log(
        "[sendAutomaticallyWhen] Has pending approval (still in approval-requested state), returning false",
      );
      return false;
    }

    // Generate unique key for this approval state (prevent infinite loops)
    // Key = messageId + sorted approved tool IDs
    const messageId = (lastMessage as any).id || "unknown";
    const approvedToolIds = parts
      .filter((p: any) => isApprovalRespondedTool(p))
      .map((p: any) => p.toolCallId)
      .sort()
      .join(",");
    const approvalStateKey = `${messageId}:${approvedToolIds}`;

    // Check if we've already triggered a send for this exact approval state
    if (sentApprovalStates.has(approvalStateKey)) {
      console.log(
        "[sendAutomaticallyWhen] Already sent for this approval state, returning false to prevent loop",
      );
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
      (part: any) => isToolUIPartFromAISDKv6(part),
    );

    // Check if any tool has ERRORED (backend responded with error)
    // Note: output-available state is handled by Frontend Execute check below
    for (const toolPart of toolParts) {
      // Only check for error states - output-available could be from addToolOutput
      // biome-ignore lint/suspicious/noExplicitAny: AI SDK v6 internal structure
      if (isOutputErrorTool(toolPart as any)) {
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
      (part: any) => isOutputAvailableTool(part) && part.output !== undefined,
    );

    if (hasToolOutputFromAddToolOutput) {
      return true;
    }

    // First time confirmation completed - send to backend via WebSocket
    console.log(
      "[sendAutomaticallyWhen] All checks passed, returning true to trigger send",
    );
    console.log(
      "[sendAutomaticallyWhen] Recording approval state:",
      approvalStateKey,
    );

    // Record this approval state so we don't send again for the same state
    sentApprovalStates.add(approvalStateKey);

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
