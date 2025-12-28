/**
 * Core - sendAutomaticallyWhen
 *
 * Shared auto-send logic for both BIDI and SSE modes.
 * Determines when to automatically trigger sendMessages() after user interactions.
 *
 * Supports two patterns:
 * 1. Server Execute: Backend executes tools after approval
 * 2. Frontend Execute: Frontend executes tools (e.g., camera, location) and sends output
 *
 * See ADR 0005 for detailed execution patterns and [DONE] sending timing.
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

export interface SendAutomaticallyWhenOptions {
  messages: UIMessageFromAISDKv6[];
}

// Infinite loop prevention: Track approval states already sent
// Key format: "messageId:toolCallId1,toolCallId2,..."
const sentApprovalStates = new Set<string>();

/**
 * Core auto-send decision logic for tool confirmation workflow.
 *
 * @param options - Messages to analyze
 * @param log - Logging function for mode-specific prefixes
 * @returns true to trigger sendMessages(), false otherwise
 */
export function sendAutomaticallyWhenCore(
  { messages }: SendAutomaticallyWhenOptions,
  log: (message: string) => void,
): boolean {
  try {
    log("═══ CALLED ═══");
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage) {
      log("No last message, returning false");
      return false;
    }

    if (lastMessage?.role !== "assistant") {
      log(`Last message role is not assistant: ${lastMessage?.role}`);
      return false;
    }

    // biome-ignore lint/suspicious/noExplicitAny: AI SDK v6 internal structure
    const parts = (lastMessage as any).parts || [];
    log(`Checking parts: ${parts.length}`);

    // ========================================================================
    // Check 1: Backend already responded with text? (HIGHEST PRIORITY)
    // ========================================================================
    // If backend sent AI response text, don't auto-send again.
    // This prevents infinite loops where completed tools trigger repeated sends.
    const hasTextPart = parts.some(
      // biome-ignore lint/suspicious/noExplicitAny: AI SDK v6 internal structure
      (part: any) => isTextUIPartFromAISDKv6(part),
    );

    if (hasTextPart) {
      log("Has text part, returning false");

      // Cleanup: Clear approval tracking for this message
      const messageId = (lastMessage as any).id || "unknown";
      const keysToDelete = Array.from(sentApprovalStates).filter((key) =>
        key.startsWith(`${messageId}:`),
      );
      for (const key of keysToDelete) {
        sentApprovalStates.delete(key);
      }
      if (keysToDelete.length > 0) {
        log(`Cleared approval states: ${keysToDelete.join(", ")}`);
      }

      return false;
    }

    // ========================================================================
    // Check 2: User approved any tool? (state = approval-responded)
    // ========================================================================
    // AI SDK v6: addToolApprovalResponse() changes state from
    // "approval-requested" → "approval-responded"
    const hasApprovedTool = parts.some(
      // biome-ignore lint/suspicious/noExplicitAny: AI SDK v6 internal structure
      (part: any) => isApprovalRespondedTool(part),
    );

    if (!hasApprovedTool) {
      log(
        "No approved tool found (no approval-responded state), returning false",
      );
      return false;
    }
    log("Has approved tool (approval-responded state)");

    // ========================================================================
    // Check 3: Any tool still waiting for approval? (state = approval-requested)
    // ========================================================================
    // Multiple tools can be pending approval in same message.
    // Wait for user to approve ALL before sending.
    const hasPendingApproval = parts.some(
      // biome-ignore lint/suspicious/noExplicitAny: AI SDK v6 internal structure
      (part: any) => isApprovalRequestedTool(part),
    );

    if (hasPendingApproval) {
      log(
        "Has pending approval (still in approval-requested state), returning false",
      );
      return false;
    }

    // ========================================================================
    // Check 4: Frontend Execute - Tool output added? (PRIORITY 1)
    // ========================================================================
    // Frontend called addToolOutput() → state="output-available" + output set
    // This is NEW DATA that must be sent to backend.
    // MUST check BEFORE infinite loop prevention to allow tool output sends.
    const hasToolOutputFromAddToolOutput = parts.some(
      // biome-ignore lint/suspicious/noExplicitAny: AI SDK v6 internal structure
      (part: any) => isOutputAvailableTool(part) && part.output !== undefined,
    );

    if (hasToolOutputFromAddToolOutput) {
      log("Tool output from addToolOutput() detected, returning true");
      return true;
    }

    // ========================================================================
    // Check 5: Infinite loop prevention - Already sent for this approval state?
    // ========================================================================
    // Track: messageId + sorted tool IDs to prevent repeated sends for same approval.
    const messageId = (lastMessage as any).id || "unknown";
    const approvedToolIds = parts
      .filter((p: any) => isApprovalRespondedTool(p))
      .map((p: any) => p.toolCallId)
      .sort()
      .join(",");
    const approvalStateKey = `${messageId}:${approvedToolIds}`;

    if (sentApprovalStates.has(approvalStateKey)) {
      log(
        "Already sent for this approval state, returning false to prevent loop",
      );
      return false;
    }

    // ========================================================================
    // Check 6: Tool execution failed? (state = output-error)
    // ========================================================================
    // If backend responded with error, don't auto-send again.
    const toolParts = parts.filter(
      // biome-ignore lint/suspicious/noExplicitAny: AI SDK v6 internal structure
      (part: any) => isToolUIPartFromAISDKv6(part),
    );

    for (const toolPart of toolParts) {
      // biome-ignore lint/suspicious/noExplicitAny: AI SDK v6 internal structure
      if (isOutputErrorTool(toolPart as any)) {
        return false;
      }

      // biome-ignore lint/suspicious/noExplicitAny: AI SDK v6 internal structure
      const hasError = (toolPart as any).error;
      if (hasError) {
        return false;
      }
    }

    // ========================================================================
    // All checks passed: Server Execute pattern - Send approval to backend
    // ========================================================================
    log("All checks passed, returning true to trigger send");
    log(`Recording approval state: ${approvalStateKey}`);

    sentApprovalStates.add(approvalStateKey);

    return true;
  } catch (error) {
    // Error safety: Return false to prevent infinite loops
    console.error("Error in sendAutomaticallyWhen:", error);
    return false;
  }
}
