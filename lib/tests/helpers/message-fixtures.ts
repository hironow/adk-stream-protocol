/**
 * Message Fixtures
 * Provides reusable message objects for tests
 */

import type { UIMessage } from "ai";

/**
 * Creates a basic text message
 */
export function createTextMessage(
  text: string,
  id = "msg-1",
  role: "user" | "assistant" = "user",
): UIMessage {
  return {
    id,
    role,
    parts: [{ type: "text", text }],
  };
}

/**
 * Creates a function call message
 */
export function createFunctionCallMessage(
  toolName: string,
  args: Record<string, unknown>,
  id = "msg-1",
): UIMessage {
  return {
    id,
    role: "assistant",
    parts: [
      {
        type: "tool-call",
        toolName,
        args,
        // biome-ignore lint/suspicious/noExplicitAny: Test fixture - partial UIMessage construction
      } as any,
    ],
  };
}

/**
 * Creates a tool result message
 */
export function createToolResultMessage(
  toolCallId: string,
  result: unknown,
  id = "msg-1",
): UIMessage {
  return {
    id,
    role: "tool",
    parts: [
      {
        type: "tool-result",
        toolCallId,
        result,
        // biome-ignore lint/suspicious/noExplicitAny: Test fixture - partial UIMessage construction
      } as any,
    ],
  };
}

/**
 * Creates a conversation with multiple messages
 */
export function createConversation(
  messages: Array<{ role: "user" | "assistant"; text: string }>,
): UIMessage[] {
  return messages.map((msg, index) => ({
    id: `msg-${index + 1}`,
    role: msg.role,
    parts: [{ type: "text", text: msg.text }],
  }));
}
