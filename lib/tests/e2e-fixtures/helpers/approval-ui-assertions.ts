/**
 * Approval UI Assertions
 *
 * Assertions for verifying approval UI behavior per ADR 0012.
 * Tests that approval UI is displayed at the correct timing
 * and responds correctly to user actions.
 *
 * Reference: ADR 0012 - Frontend Approval UI Display Timing
 */

import { expect } from "vitest";
import { extractToolNameFromType } from "../../../tool-utils";
import type { UIMessageFromAISDKv6 } from "../../../utils";
import {
  isTextUIPartFromAISDKv6,
  isToolUIPartFromAISDKv6,
} from "../../../utils";

// ============================================================================
// Types
// ============================================================================

/**
 * Tool invocation part from AI SDK v6 message
 *
 * In AI SDK v6 with ADK, tool parts have dynamic types like:
 * - type: "tool-process_payment"
 * - type: "tool-get_location"
 *
 * The toolName is extracted from the type prefix.
 */
export interface ToolInvocationPart {
  type: string; // Dynamic: "tool-{toolName}"
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  input?: Record<string, unknown>; // ADK uses "input" instead of "args"
  state:
    | "partial-call"
    | "call"
    | "approval-requested"
    | "approval-responded"
    | "result"
    | "output-available"
    | "output-error";
  approval?: {
    id: string;
    approved?: boolean;
  };
  result?: unknown;
  output?: unknown; // ADK uses "output" instead of "result"
}

/**
 * Get all tool invocation parts from message
 *
 * Uses AI SDK v6's isToolUIPartFromAISDKv6 to correctly identify
 * tool parts regardless of their dynamic type name.
 * Enriches parts with toolName and args for compatibility.
 */
export function getToolInvocationParts(
  message: UIMessageFromAISDKv6 | undefined,
): ToolInvocationPart[] {
  if (!message) return [];
  const rawParts =
    // biome-ignore lint/suspicious/noExplicitAny: AI SDK v6 internal structure
    (message as any).parts?.filter(
      // biome-ignore lint/suspicious/noExplicitAny: AI SDK v6 internal structure
      (p: any) => isToolUIPartFromAISDKv6(p),
    ) || [];

  // Enrich parts with toolName and args for compatibility
  // biome-ignore lint/suspicious/noExplicitAny: AI SDK v6 internal structure
  return rawParts.map((p: any) => ({
    ...p,
    toolName: p.toolName || extractToolNameFromType(p.type),
    args: p.args || p.input || {},
    result: p.result ?? p.output,
  }));
}

/**
 * Get tool invocation part by toolCallId
 */
export function getToolInvocationById(
  message: UIMessageFromAISDKv6 | undefined,
  toolCallId: string,
): ToolInvocationPart | undefined {
  const parts = getToolInvocationParts(message);
  return parts.find((p) => p.toolCallId === toolCallId);
}

/**
 * Get tool invocation parts with approval-requested state
 *
 * Uses getToolInvocationParts for consistency (enriched with toolName, args, result)
 * then filters for approval-requested state.
 */
export function getApprovalRequestedParts(
  message: UIMessageFromAISDKv6 | undefined,
): ToolInvocationPart[] {
  return getToolInvocationParts(message).filter(
    (p) => p.state === "approval-requested",
  );
}

/**
 * Get message text content
 */
export function getMessageText(
  message: UIMessageFromAISDKv6 | undefined,
): string {
  if (!message) return "";
  return message.parts
    .filter((part): part is { type: "text"; text: string } =>
      isTextUIPartFromAISDKv6(part),
    )
    .map((part) => part.text)
    .join("");
}

// ============================================================================
// ADR 0012 Assertions
// ============================================================================

/**
 * Assert that approval UI should be displayed (state: approval-requested)
 *
 * Per ADR 0012, approval UI is displayed when:
 * - `tool-approval-request` event is received
 * - Tool invocation state becomes "approval-requested"
 */
export function assertApprovalUIDisplayed(
  message: UIMessageFromAISDKv6 | undefined,
  toolCallId: string,
  toolName?: string,
): void {
  expect(message, "Message should exist").toBeDefined();

  const part = getToolInvocationById(message, toolCallId);
  expect(
    part,
    `Tool invocation with id "${toolCallId}" should exist`,
  ).toBeDefined();
  expect(part?.state, "Tool state should be approval-requested").toBe(
    "approval-requested",
  );

  if (toolName) {
    expect(part?.toolName, `Tool name should be "${toolName}"`).toBe(toolName);
  }

  expect(part?.approval, "Approval object should exist").toBeDefined();
  expect(part?.approval?.id, "Approval ID should exist").toBeDefined();
}

/**
 * Assert that approval UI is NOT displayed yet (state: call or partial-call)
 *
 * Per ADR 0012, before tool-approval-request:
 * - tool-input-available sets state to "call"
 * - No approval UI should be shown yet
 */
export function assertApprovalUINotDisplayed(
  message: UIMessageFromAISDKv6 | undefined,
  toolCallId: string,
): void {
  const part = getToolInvocationById(message, toolCallId);

  if (part) {
    expect(part.state).not.toBe("approval-requested");
  }
  // If part doesn't exist, that's also fine (tool not yet streamed)
}

/**
 * Assert approval was responded (state: approval-responded or result)
 *
 * After user calls addToolApprovalResponse():
 * - State changes to "approval-responded"
 * - approval.approved reflects user decision
 */
export function assertApprovalResponded(
  message: UIMessageFromAISDKv6 | undefined,
  toolCallId: string,
  expectedApproved: boolean,
): void {
  expect(message, "Message should exist").toBeDefined();

  const part = getToolInvocationById(message, toolCallId);
  expect(
    part,
    `Tool invocation with id "${toolCallId}" should exist`,
  ).toBeDefined();

  // State should be approval-responded or result (if backend already responded)
  expect(
    part?.state === "approval-responded" || part?.state === "result",
    `State should be "approval-responded" or "result", got "${part?.state}"`,
  ).toBe(true);

  // Check approval decision
  expect(
    part?.approval?.approved,
    `Approval should be ${expectedApproved}`,
  ).toBe(expectedApproved);
}

/**
 * Assert tool execution completed with result
 *
 * Per ADR 0012, after approval:
 * - OK: tool-output-available → state: "result" with result data
 * - NG: tool-output-error → state: "result" with error
 */
export function assertToolResultReceived(
  message: UIMessageFromAISDKv6 | undefined,
  toolCallId: string,
): void {
  expect(message, "Message should exist").toBeDefined();

  const part = getToolInvocationById(message, toolCallId);
  expect(
    part,
    `Tool invocation with id "${toolCallId}" should exist`,
  ).toBeDefined();
  expect(part?.state, "Tool state should be result").toBe("result");
  expect(part?.result, "Tool result should exist").toBeDefined();
}

/**
 * Assert multiple tools have approval-requested state (parallel approvals in SSE)
 *
 * Per ADR 0003/0012, SSE mode can have multiple parallel approval requests
 */
export function assertMultipleApprovalsDisplayed(
  message: UIMessageFromAISDKv6 | undefined,
  expectedCount: number,
): void {
  expect(message, "Message should exist").toBeDefined();

  const approvalParts = getApprovalRequestedParts(message);
  expect(
    approvalParts.length,
    `Expected ${expectedCount} approval-requested tools`,
  ).toBe(expectedCount);
}

/**
 * Assert tool arguments match expected values
 *
 * Useful for verifying tool input is correctly displayed in approval UI
 */
export function assertToolArguments(
  message: UIMessageFromAISDKv6 | undefined,
  toolCallId: string,
  expectedArgs: Record<string, unknown>,
): void {
  expect(message, "Message should exist").toBeDefined();

  const part = getToolInvocationById(message, toolCallId);
  expect(
    part,
    `Tool invocation with id "${toolCallId}" should exist`,
  ).toBeDefined();

  for (const [key, value] of Object.entries(expectedArgs)) {
    expect(part?.args[key], `Tool arg "${key}" should be ${value}`).toEqual(
      value,
    );
  }
}

/**
 * Assert final text response received after approval flow
 */
export function assertFinalTextResponse(
  message: UIMessageFromAISDKv6 | undefined,
  containsText?: string,
): void {
  expect(message, "Message should exist").toBeDefined();

  const text = getMessageText(message);
  expect(
    text.length,
    "Final text response should not be empty",
  ).toBeGreaterThan(0);

  if (containsText) {
    expect(text, `Text should contain "${containsText}"`).toContain(
      containsText,
    );
  }
}

// ============================================================================
// Re-export commonly used helpers
// ============================================================================

export {
  isApprovalRequestedTool,
  isTextUIPartFromAISDKv6,
} from "../../../utils";
