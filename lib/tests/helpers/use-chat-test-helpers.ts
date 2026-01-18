/**
 * Common test helper functions for useChat E2E tests
 *
 * Provides utilities for:
 * - Message text extraction from UIMessageFromAISDKv6
 * - sendAutomaticallyWhen spy setup
 * - Confirmation part finding
 * - Tool approval response helpers
 */

import { vi } from "vitest";
import type { UIMessageFromAISDKv6 } from "../../utils";
import { isApprovalRequestedTool, isTextUIPartFromAISDKv6 } from "../../utils";

/**
 * Extract text content from UIMessageFromAISDKv6 parts
 *
 * @param message - UIMessageFromAISDKv6 to extract text from
 * @returns Concatenated text from all text parts
 *
 * @example
 * ```typescript
 * const lastMessage = result.current.messages.at(-1);
 * const text = getMessageText(lastMessage);
 * expect(text).toBe("Hello World");
 * ```
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

/**
 * Find confirmation part in UIMessageFromAISDKv6
 *
 * @param message - UIMessageFromAISDKv6 to search in
 * @returns Confirmation part if found, undefined otherwise
 *
 * @example
 * ```typescript
 * const lastMessage = result.current.messages.at(-1);
 * const confirmationPart = findConfirmationPart(lastMessage);
 * expect(confirmationPart).toBeDefined();
 * expect(confirmationPart?.toolCallId).toBe("call-123");
 * ```
 */
export function findConfirmationPart(
  message: UIMessageFromAISDKv6 | undefined,
  // biome-ignore lint/suspicious/noExplicitAny: Test helper - return type varies
): any {
  if (!message) return undefined;
  // biome-ignore lint/suspicious/noExplicitAny: Test helper - AI SDK v6 internal structure
  return (message as any).parts?.find((p: any) => isApprovalRequestedTool(p));
}

/**
 * Find all confirmation parts in UIMessageFromAISDKv6
 *
 * @param message - UIMessageFromAISDKv6 to search in
 * @returns Array of confirmation parts
 *
 * @example
 * ```typescript
 * const lastMessage = result.current.messages.at(-1);
 * const confirmations = findAllConfirmationParts(lastMessage);
 * expect(confirmations).toHaveLength(2);
 * ```
 */
export function findAllConfirmationParts(
  message: UIMessageFromAISDKv6 | undefined,
  // biome-ignore lint/suspicious/noExplicitAny: Test helper - return type varies
): any[] {
  if (!message) return [];
  return (
    // biome-ignore lint/suspicious/noExplicitAny: Test helper - AI SDK v6 internal structure
    (message as any).parts?.filter((p: any) => isApprovalRequestedTool(p)) || []
  );
}

/**
 * Setup spy wrapper for sendAutomaticallyWhen
 *
 * Creates a spy that wraps the original sendAutomaticallyWhen function,
 * allowing test assertions while preserving the original behavior.
 *
 * @param originalSendAuto - Original sendAutomaticallyWhen function
 * @returns Vitest spy function
 *
 * @example
 * ```typescript
 * const { useChatOptions } = buildUseChatOptions({ mode: "adk-sse", ... });
 * const spy = createSendAutoSpy(useChatOptions.sendAutomaticallyWhen!);
 * const options = { ...useChatOptions, sendAutomaticallyWhen: spy };
 *
 * // Later in test...
 * expect(spy).toHaveBeenCalled();
 * ```
 */
export function createSendAutoSpy(
  originalSendAuto: (options: { messages: UIMessageFromAISDKv6[] }) => boolean,
) {
  return vi.fn((options: { messages: UIMessageFromAISDKv6[] }) =>
    originalSendAuto(options),
  );
}

/**
 * Check if confirmation part has specific state
 *
 * @param part - Confirmation part to check
 * @param expectedState - Expected state string
 * @returns True if part has the expected state
 *
 * @example
 * ```typescript
 * const part = findConfirmationPart(message);
 * expect(hasConfirmationState(part, "approval-requested")).toBe(true);
 * ```
 */
export function hasConfirmationState(
  // biome-ignore lint/suspicious/noExplicitAny: Test helper - part type varies
  part: any,
  expectedState: string,
): boolean {
  return part?.state === expectedState;
}
