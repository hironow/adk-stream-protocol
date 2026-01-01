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
  mode?: "bidi" | "sse" | "unknown"; // Optional mode for state separation
}

// Infinite loop prevention: Track approval states already sent
// Key format: "mode:messageId:toolCallId1,toolCallId2,..." (mode prefix for BIDI/SSE separation)
const sentApprovalStates = new Set<string>();

/**
 * Core auto-send decision logic for tool confirmation workflow.
 *
 * @param options - Messages to analyze
 * @param log - Logging function for mode-specific prefixes
 * @returns true to trigger sendMessages(), false otherwise
 */
export function sendAutomaticallyWhenCore(
  { messages, mode = "unknown" }: SendAutomaticallyWhenOptions,
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

    // Debug: Log each part's type
    parts.forEach((part: any, index: number) => {
      const partType = part.type || "unknown";
      const partState = part.state || "n/a";
      const isToolPart = isToolUIPartFromAISDKv6(part);
      const partKeys = Object.keys(part).join(",");
      log(
        `  Part ${index}: type=${partType}, state=${partState}, isToolPart=${isToolPart}, keys=${partKeys}`,
      );
    });

    // ========================================================================
    // Check 1: Backend already responded with text? (HIGHEST PRIORITY)
    // ========================================================================
    // EXCEPTION: If approval workflow is in progress, allow sending regardless of text parts
    // This handles BLOCKING pattern where backend sends reasoning/text before approval

    // First, check if approval workflow is active
    const hasApprovedTool = parts.some(
      // biome-ignore lint/suspicious/noExplicitAny: AI SDK v6 internal structure
      (part: any) => isApprovalRespondedTool(part),
    );
    const hasPendingApproval = parts.some(
      // biome-ignore lint/suspicious/noExplicitAny: AI SDK v6 internal structure
      (part: any) => isApprovalRequestedTool(part),
    );

    // Only check text part if NO approval workflow is active
    if (!hasApprovedTool && !hasPendingApproval) {
      const hasTextPart = parts.some(
        // biome-ignore lint/suspicious/noExplicitAny: AI SDK v6 internal structure
        (part: any) => isTextUIPartFromAISDKv6(part),
      );

      if (hasTextPart) {
        log("Has text part (no approval workflow), returning false");

        // Cleanup: Clear approval tracking for this message (mode-specific)
        const messageId = (lastMessage as any).id || "unknown";
        const keysToDelete = Array.from(sentApprovalStates).filter((key) =>
          key.startsWith(`${mode}:${messageId}:`),
        );
        for (const key of keysToDelete) {
          sentApprovalStates.delete(key);
        }
        if (keysToDelete.length > 0) {
          log(`Cleared approval states: ${keysToDelete.join(", ")}`);
        }

        return false;
      }
    } else {
      log(
        `Approval workflow active (approved=${hasApprovedTool}, pending=${hasPendingApproval}), allowing send despite text parts`,
      );
    }

    // ========================================================================
    // Check 2: Frontend Execute - Tool output added? (PRIORITY 1)
    // ========================================================================
    // Frontend called addToolOutput() → state="output-available" + output set
    // This is NEW DATA that must be sent to backend.
    // MUST check BEFORE approval checks to handle Frontend Execute pattern.
    // IMPORTANT: Only exclusion case where we should NOT auto-send:
    // - Backend already responded with text part (conversation complete)
    const hasToolOutputFromAddToolOutput = parts.some(
      // biome-ignore lint/suspicious/noExplicitAny: AI SDK v6 internal structure
      (part: any) => isOutputAvailableTool(part) && part.output !== undefined,
    );

    if (hasToolOutputFromAddToolOutput) {
      // Check if backend already responded with text (conversation complete)
      // biome-ignore lint/suspicious/noExplicitAny: AI SDK v6 internal structure
      const hasTextPartInMessage = parts.some((part: any) =>
        isTextUIPartFromAISDKv6(part),
      );

      if (hasTextPartInMessage) {
        log(
          "Tool output exists but backend already responded with text, returning false",
        );
        return false;
      }

      // If approval workflow is active, check if this is Frontend Execute pattern
      if (hasApprovedTool || hasPendingApproval) {
        // Check if output and approval are for the SAME tool (Frontend Execute pattern)
        // biome-ignore lint/suspicious/noExplicitAny: AI SDK v6 internal structure
        const outputToolIds = new Set(
          parts
            .filter(
              (p: any) => isOutputAvailableTool(p) && p.output !== undefined,
            )
            .map((p: any) => p.toolCallId),
        );

        if (hasApprovedTool) {
          // biome-ignore lint/suspicious/noExplicitAny: AI SDK v6 internal structure
          const approvalToolIds = new Set(
            parts
              .filter((p: any) => isApprovalRespondedTool(p))
              .map((p: any) => p.toolCallId),
          );

          log(`Output tool IDs: ${Array.from(outputToolIds).join(", ")}`);
          log(`Approval tool IDs: ${Array.from(approvalToolIds).join(", ")}`);

          // Check if any output toolId matches any approval toolId
          const hasSameToolId = [...outputToolIds].some((id) =>
            approvalToolIds.has(id),
          );

          if (hasSameToolId) {
            // Same tool: Frontend Execute (single tool) → auto-send
            log(
              "Tool output and approval for SAME tool detected (Frontend Execute), returning true",
            );
            return true;
          }

          log(
            `Tool IDs don't match (output: ${Array.from(outputToolIds).join(",")}, approval: ${Array.from(approvalToolIds).join(",")}), checking for confirmation pattern`,
          );
        }

        // Different cases: defer to approval checks
        // - If pending approval exists: output is old data (backend returned), approval is new
        // - If approved tool exists but different ID: Multiple Sequential pattern
        log(
          `Tool output exists but approval workflow active (approved=${hasApprovedTool}, pending=${hasPendingApproval}), deferring to approval checks`,
        );
        // Fall through to Check 3/4
      } else {
        // No approval workflow: Pure Frontend Execute (e.g., camera, location without confirmation)
        log(
          "Tool output from addToolOutput() detected (no approval workflow), returning true to send to backend",
        );
        return true;
      }
    }

    // ========================================================================
    // Check 3: User approved any tool? (state = approval-responded)
    // ========================================================================
    // AI SDK v6: addToolApprovalResponse() changes state from
    // "approval-requested" → "approval-responded"
    // NOTE: hasApprovedTool already computed above

    if (!hasApprovedTool) {
      log(
        "No approved tool found (no approval-responded state), returning false",
      );
      return false;
    }
    log("Has approved tool (approval-responded state)");

    // ========================================================================
    // Check 4: Any tool still waiting for approval? (state = approval-requested)
    // ========================================================================
    // Multiple tools can be pending approval in same message.
    // Wait for user to approve ALL before sending.
    // NOTE: hasPendingApproval already computed in Check 1

    if (hasPendingApproval) {
      log(
        "Has pending approval (still in approval-requested state), returning false",
      );
      return false;
    }

    // ========================================================================
    // Check 5: Infinite loop prevention - Already sent for this approval state?
    // ========================================================================
    // Track: mode + messageId + sorted tool IDs to prevent repeated sends for same approval.
    // Mode prefix ensures BIDI and SSE have separate state spaces.
    // EXCEPTION: Skip this check if tool output was just added by frontend (Frontend Execute pattern)
    // In Frontend Execute, output is added AFTER approval, creating a new state that needs sending.
    const messageId = (lastMessage as any).id || "unknown";
    const approvedToolIds = parts
      .filter((p: any) => isApprovalRespondedTool(p))
      .map((p: any) => p.toolCallId)
      .sort()
      .join(",");
    const approvalStateKey = `${mode}:${messageId}:${approvedToolIds}`;

    // Only check for duplicate sends if this is NOT a Frontend Execute pattern with new output
    if (
      !hasToolOutputFromAddToolOutput &&
      sentApprovalStates.has(approvalStateKey)
    ) {
      log(
        "Already sent for this approval state, returning false to prevent loop",
      );
      return false;
    }

    if (hasToolOutputFromAddToolOutput) {
      log(
        "Frontend Execute: Output added after approval, skipping infinite loop prevention",
      );
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
