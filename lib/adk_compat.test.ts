/**
 * Unit tests for ADK compatibility utilities
 */

import { describe, it, expect, vi } from "vitest";
import type { UIMessage } from "@ai-sdk/react";
import {
  sendAutomaticallyWhenAdkConfirmation,
  isAssistantMessage,
  extractParts,
  findPart,
  createAdkConfirmationOutput,
} from "./adk_compat";

// Mock the lastAssistantMessageIsCompleteWithApprovalResponses function
vi.mock("ai", () => ({
  lastAssistantMessageIsCompleteWithApprovalResponses: vi.fn(() => false),
}));

describe("sendAutomaticallyWhenAdkConfirmation", () => {
  it("should return false when messages array is empty", () => {
    const result = sendAutomaticallyWhenAdkConfirmation({ messages: [] });
    expect(result).toBe(false);
  });

  it("should return false when last message is not assistant", () => {
    const messages: UIMessage[] = [
      {
        id: "1",
        role: "user",
        content: "Hello",
      },
    ];
    const result = sendAutomaticallyWhenAdkConfirmation({ messages });
    expect(result).toBe(false);
  });

  it("should return false when assistant message has no parts", () => {
    const messages: UIMessage[] = [
      {
        id: "2",
        role: "assistant",
        content: "Response",
      },
    ];
    const result = sendAutomaticallyWhenAdkConfirmation({ messages });
    expect(result).toBe(false);
  });

  it("should return false when assistant message has empty parts array", () => {
    const messages = [
      {
        id: "3",
        role: "assistant",
        content: "Response",
        parts: [],
      },
    ] as UIMessage[];
    const result = sendAutomaticallyWhenAdkConfirmation({ messages });
    expect(result).toBe(false);
  });

  it("should return false when adk_request_confirmation part does not exist", () => {
    const messages = [
      {
        id: "4",
        role: "assistant",
        content: "Response",
        parts: [
          {
            type: "tool-some_other_tool",
            state: "output-available",
          },
        ],
      },
    ] as UIMessage[];
    const result = sendAutomaticallyWhenAdkConfirmation({ messages });
    expect(result).toBe(false);
  });

  it("should return false when adk_request_confirmation part exists but state is not output-available", () => {
    const messages = [
      {
        id: "5",
        role: "assistant",
        content: "Response",
        parts: [
          {
            type: "tool-adk_request_confirmation",
            state: "input-streaming",
          },
        ],
      },
    ] as UIMessage[];
    const result = sendAutomaticallyWhenAdkConfirmation({ messages });
    expect(result).toBe(false);
  });

  it("should return false when adk_request_confirmation part exists but state is input-available", () => {
    const messages = [
      {
        id: "6",
        role: "assistant",
        content: "Response",
        parts: [
          {
            type: "tool-adk_request_confirmation",
            state: "input-available",
          },
        ],
      },
    ] as UIMessage[];
    const result = sendAutomaticallyWhenAdkConfirmation({ messages });
    expect(result).toBe(false);
  });

  it("should return true when adk_request_confirmation part has output-available state", () => {
    const messages = [
      {
        id: "7",
        role: "assistant",
        content: "Response",
        parts: [
          {
            type: "tool-adk_request_confirmation",
            state: "output-available",
            output: { toolConfirmation: { confirmed: true } },
          },
        ],
      },
    ] as UIMessage[];
    const result = sendAutomaticallyWhenAdkConfirmation({ messages });
    expect(result).toBe(true);
  });

  it("should return true when adk_request_confirmation is output-available (denied)", () => {
    const messages = [
      {
        id: "8",
        role: "assistant",
        content: "Response",
        parts: [
          {
            type: "tool-adk_request_confirmation",
            state: "output-available",
            output: { toolConfirmation: { confirmed: false } },
          },
        ],
      },
    ] as UIMessage[];
    const result = sendAutomaticallyWhenAdkConfirmation({ messages });
    expect(result).toBe(true);
  });

  it("should return true when adk_request_confirmation is the second part in parts array", () => {
    const messages = [
      {
        id: "9",
        role: "assistant",
        content: "Response",
        parts: [
          {
            type: "tool-process_payment",
            state: "input-available",
          },
          {
            type: "tool-adk_request_confirmation",
            state: "output-available",
            output: { toolConfirmation: { confirmed: true } },
          },
        ],
      },
    ] as UIMessage[];
    const result = sendAutomaticallyWhenAdkConfirmation({ messages });
    expect(result).toBe(true);
  });

  it("should check only the last message (ignore earlier messages)", () => {
    const messages = [
      {
        id: "10",
        role: "assistant",
        content: "Earlier response",
        parts: [
          {
            type: "tool-adk_request_confirmation",
            state: "output-available",
          },
        ],
      },
      {
        id: "11",
        role: "user",
        content: "User message",
      },
    ] as UIMessage[];
    const result = sendAutomaticallyWhenAdkConfirmation({ messages });
    expect(result).toBe(false);
  });

  // ========== Complex Real-World Scenarios ==========

  it("should handle Phase 5 approval flow: process_payment waiting, confirmation completed", () => {
    // This is the exact scenario that was causing infinite loops
    // process_payment is waiting (input-available), but adk_request_confirmation has completed
    // The function should return true to trigger automatic send
    const messages = [
      {
        id: "phase5-1",
        role: "assistant",
        content: "",
        parts: [
          {
            type: "tool-process_payment",
            toolCallId: "call-payment-123",
            toolName: "process_payment",
            state: "input-available", // Still waiting for confirmation
            input: { amount: 50, recipient: "Hanako", currency: "USD" },
          },
          {
            type: "tool-adk_request_confirmation",
            toolCallId: "call-confirm-456",
            toolName: "adk_request_confirmation",
            state: "output-available", // User approved!
            input: {
              originalFunctionCall: {
                id: "call-payment-123",
                name: "process_payment",
                args: { amount: 50, recipient: "Hanako", currency: "USD" },
              },
            },
            output: { toolConfirmation: { confirmed: true } },
          },
        ],
      },
    ] as UIMessage[];
    const result = sendAutomaticallyWhenAdkConfirmation({ messages });
    expect(result).toBe(true);
  });

  it("should handle case where both process_payment and confirmation are completed", () => {
    // After automatic send, process_payment completes
    // This should also return true (confirmation is still output-available)
    const messages = [
      {
        id: "phase5-2",
        role: "assistant",
        content: "Payment processed successfully",
        parts: [
          {
            type: "tool-process_payment",
            toolCallId: "call-payment-123",
            toolName: "process_payment",
            state: "output-available", // Now completed
            input: { amount: 50, recipient: "Hanako", currency: "USD" },
            output: { success: true, transaction_id: "txn_abc123" },
          },
          {
            type: "tool-adk_request_confirmation",
            toolCallId: "call-confirm-456",
            toolName: "adk_request_confirmation",
            state: "output-available",
            input: {
              originalFunctionCall: {
                id: "call-payment-123",
                name: "process_payment",
                args: { amount: 50, recipient: "Hanako", currency: "USD" },
              },
            },
            output: { toolConfirmation: { confirmed: true } },
          },
        ],
      },
    ] as UIMessage[];
    const result = sendAutomaticallyWhenAdkConfirmation({ messages });
    expect(result).toBe(true);
  });

  it("should return true when user denies confirmation (rejected scenario)", () => {
    // User denied the confirmation - should still trigger automatic send
    const messages = [
      {
        id: "phase5-3",
        role: "assistant",
        content: "",
        parts: [
          {
            type: "tool-process_payment",
            toolCallId: "call-payment-789",
            toolName: "process_payment",
            state: "input-available",
            input: { amount: 1000, recipient: "Bob", currency: "USD" },
          },
          {
            type: "tool-adk_request_confirmation",
            toolCallId: "call-confirm-999",
            toolName: "adk_request_confirmation",
            state: "output-available",
            input: {
              originalFunctionCall: {
                id: "call-payment-789",
                name: "process_payment",
                args: { amount: 1000, recipient: "Bob", currency: "USD" },
              },
            },
            output: { toolConfirmation: { confirmed: false } }, // DENIED
          },
        ],
      },
    ] as UIMessage[];
    const result = sendAutomaticallyWhenAdkConfirmation({ messages });
    expect(result).toBe(true);
  });

  it("should handle multiple tool calls with confirmation in the middle", () => {
    // Complex scenario with multiple tools
    const messages = [
      {
        id: "complex-1",
        role: "assistant",
        content: "",
        parts: [
          {
            type: "tool-get_weather",
            toolCallId: "call-weather-1",
            toolName: "get_weather",
            state: "output-available",
            output: { temperature: 20, condition: "Sunny" },
          },
          {
            type: "tool-process_payment",
            toolCallId: "call-payment-2",
            toolName: "process_payment",
            state: "input-available",
            input: { amount: 100, recipient: "Alice" },
          },
          {
            type: "tool-adk_request_confirmation",
            toolCallId: "call-confirm-3",
            toolName: "adk_request_confirmation",
            state: "output-available", // Confirmation completed
            output: { toolConfirmation: { confirmed: true } },
          },
          {
            type: "tool-change_bgm",
            toolCallId: "call-bgm-4",
            toolName: "change_bgm",
            state: "output-available",
            output: { success: true, track: 1 },
          },
        ],
      },
    ] as UIMessage[];
    const result = sendAutomaticallyWhenAdkConfirmation({ messages });
    expect(result).toBe(true);
  });

  it("should return false when confirmation is error state", () => {
    // If confirmation itself errors, should not trigger automatic send
    const messages = [
      {
        id: "error-1",
        role: "assistant",
        content: "",
        parts: [
          {
            type: "tool-process_payment",
            toolCallId: "call-payment-1",
            state: "input-available",
          },
          {
            type: "tool-adk_request_confirmation",
            toolCallId: "call-confirm-2",
            state: "output-error", // ERROR state
            errorText: "Confirmation failed",
          },
        ],
      },
    ] as UIMessage[];
    const result = sendAutomaticallyWhenAdkConfirmation({ messages });
    expect(result).toBe(false);
  });

  it("should handle conversation with multiple assistant messages", () => {
    // Realistic conversation flow
    const messages = [
      {
        id: "conv-1",
        role: "user",
        content: "Send 50 dollars to Hanako",
      },
      {
        id: "conv-2",
        role: "assistant",
        content: "",
        parts: [
          {
            type: "tool-process_payment",
            state: "input-available",
          },
          {
            type: "tool-adk_request_confirmation",
            state: "input-available", // Still waiting for user
          },
        ],
      },
      {
        id: "conv-3",
        role: "user",
        content: "[approval response]",
      },
      {
        id: "conv-4",
        role: "assistant",
        content: "",
        parts: [
          {
            type: "tool-process_payment",
            state: "input-available",
          },
          {
            type: "tool-adk_request_confirmation",
            state: "output-available", // NOW completed
            output: { toolConfirmation: { confirmed: true } },
          },
        ],
      },
    ] as UIMessage[];
    const result = sendAutomaticallyWhenAdkConfirmation({ messages });
    expect(result).toBe(true);
  });

  it("should return false when process_payment completes but no confirmation exists", () => {
    // Edge case: tool completed without confirmation (shouldn't happen in Phase 5, but test it)
    const messages = [
      {
        id: "edge-1",
        role: "assistant",
        content: "",
        parts: [
          {
            type: "tool-process_payment",
            toolCallId: "call-payment-1",
            state: "output-available",
            output: { success: true },
          },
        ],
      },
    ] as UIMessage[];
    const result = sendAutomaticallyWhenAdkConfirmation({ messages });
    expect(result).toBe(false); // No confirmation, falls back to standard approval logic
  });

  it("should handle empty parts in middle of conversation", () => {
    const messages = [
      {
        id: "empty-1",
        role: "assistant",
        content: "Thinking...",
        parts: [],
      },
      {
        id: "empty-2",
        role: "user",
        content: "Continue",
      },
      {
        id: "empty-3",
        role: "assistant",
        content: "",
        parts: [
          {
            type: "tool-adk_request_confirmation",
            state: "output-available",
            output: { toolConfirmation: { confirmed: true } },
          },
        ],
      },
    ] as UIMessage[];
    const result = sendAutomaticallyWhenAdkConfirmation({ messages });
    expect(result).toBe(true);
  });
});

describe("isAssistantMessage", () => {
  it("should return true for assistant messages", () => {
    const message: UIMessage = {
      id: "1",
      role: "assistant",
      content: "Response",
    };
    expect(isAssistantMessage(message)).toBe(true);
  });

  it("should return false for user messages", () => {
    const message: UIMessage = {
      id: "2",
      role: "user",
      content: "Question",
    };
    expect(isAssistantMessage(message)).toBe(false);
  });
});

describe("extractParts", () => {
  it("should return empty array when parts do not exist", () => {
    const message: UIMessage = {
      id: "1",
      role: "assistant",
      content: "Response",
    };
    expect(extractParts(message)).toEqual([]);
  });

  it("should return parts array when it exists", () => {
    const parts = [
      { type: "tool-test", state: "input-available" },
      { type: "tool-test2", state: "output-available" },
    ];
    const message = {
      id: "2",
      role: "assistant",
      content: "Response",
      parts,
    } as UIMessage;
    expect(extractParts(message)).toEqual(parts);
  });
});

describe("findPart", () => {
  const parts = [
    { type: "tool-adk_request_confirmation", state: "input-streaming" },
    { type: "tool-adk_request_confirmation", state: "output-available" },
    { type: "tool-process_payment", state: "input-available" },
  ];

  it("should find part by type only", () => {
    const result = findPart(parts, "tool-process_payment");
    expect(result).toEqual({
      type: "tool-process_payment",
      state: "input-available",
    });
  });

  it("should find part by type and state", () => {
    const result = findPart(
      parts,
      "tool-adk_request_confirmation",
      "output-available"
    );
    expect(result).toEqual({
      type: "tool-adk_request_confirmation",
      state: "output-available",
    });
  });

  it("should return undefined when part not found", () => {
    const result = findPart(parts, "tool-nonexistent");
    expect(result).toBeUndefined();
  });

  it("should return undefined when type matches but state does not", () => {
    const result = findPart(
      parts,
      "tool-adk_request_confirmation",
      "nonexistent-state"
    );
    expect(result).toBeUndefined();
  });

  it("should return first matching part when multiple match", () => {
    const result = findPart(parts, "tool-adk_request_confirmation");
    expect(result).toEqual({
      type: "tool-adk_request_confirmation",
      state: "input-streaming",
    });
  });
});

describe("createAdkConfirmationOutput", () => {
  it("should create confirmation output with approved=true", () => {
    const toolInvocation = {
      toolCallId: "adk-confirm-123",
      input: {
        originalFunctionCall: {
          id: "adk-payment-456",
          name: "process_payment",
          args: { amount: 50, recipient: "Hanako", currency: "USD" },
        },
      },
    };

    const result = createAdkConfirmationOutput(toolInvocation, true);

    expect(result).toEqual({
      tool: "adk_request_confirmation",
      toolCallId: "adk-confirm-123",
      output: {
        originalFunctionCall: {
          id: "adk-payment-456",
          name: "process_payment",
          args: { amount: 50, recipient: "Hanako", currency: "USD" },
        },
        toolConfirmation: { confirmed: true },
      },
    });
  });

  it("should create confirmation output with approved=false", () => {
    const toolInvocation = {
      toolCallId: "adk-confirm-789",
      input: {
        originalFunctionCall: {
          id: "adk-location-999",
          name: "get_location",
          args: {},
        },
      },
    };

    const result = createAdkConfirmationOutput(toolInvocation, false);

    expect(result).toEqual({
      tool: "adk_request_confirmation",
      toolCallId: "adk-confirm-789",
      output: {
        originalFunctionCall: {
          id: "adk-location-999",
          name: "get_location",
          args: {},
        },
        toolConfirmation: { confirmed: false },
      },
    });
  });

  it("should handle missing originalFunctionCall gracefully", () => {
    const toolInvocation = {
      toolCallId: "adk-confirm-error",
      input: {},
    };

    const result = createAdkConfirmationOutput(toolInvocation, true);

    expect(result).toEqual({
      tool: "adk_request_confirmation",
      toolCallId: "adk-confirm-error",
      output: {
        originalFunctionCall: undefined,
        toolConfirmation: { confirmed: true },
      },
    });
  });

  it("should handle missing input gracefully", () => {
    const toolInvocation = {
      toolCallId: "adk-confirm-no-input",
    };

    const result = createAdkConfirmationOutput(toolInvocation, false);

    expect(result).toEqual({
      tool: "adk_request_confirmation",
      toolCallId: "adk-confirm-no-input",
      output: {
        originalFunctionCall: undefined,
        toolConfirmation: { confirmed: false },
      },
    });
  });
});
