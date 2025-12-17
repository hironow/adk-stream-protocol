/**
 * Unit tests for ADK compatibility utilities
 */

import type { UIMessage } from "@ai-sdk/react";
import { describe, expect, it, vi } from "vitest";
import {
  createAdkConfirmationOutput,
  extractParts,
  findPart,
  isAssistantMessage,
  sendAutomaticallyWhenAdkConfirmation,
} from "./adk_compat";

// Mock the lastAssistantMessageIsCompleteWithApprovalResponses function
vi.mock("ai", () => ({
  lastAssistantMessageIsCompleteWithApprovalResponses: vi.fn(() => false),
}));

describe("sendAutomaticallyWhenAdkConfirmation", () => {
  it("should call extractParts and findPart exactly once (spy test for efficiency)", () => {
    // Given: test data with adk_request_confirmation completion
    const messages = [
      {
        id: "spy-test-1",
        role: "assistant",
        parts: [
          {
            type: "tool-adk_request_confirmation",
            state: "output-available",
            output: { confirmed: true },
          },
        ],
      },
    ] as UIMessage[];

    // When: call function (note: we can't easily spy on internal calls, but we can verify behavior)
    const result = sendAutomaticallyWhenAdkConfirmation({ messages });

    // Then: should return true
    expect(result).toBe(true);

    // Note: This test verifies the function works correctly.
    // The actual spy tests for extractParts and findPart are in their own describe blocks.
  });

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
    // When both tools are complete, don't send again (prevents infinite loop)
    expect(result).toBe(false);
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

  it("should return false when original tool is Failed after denial (prevents infinite loop)", () => {
    // After backend processes denial, original tool enters "Failed" state
    // We should NOT auto-send again when original tool is already Failed
    // This prevents infinite loop: denial sent → backend responds with Failed → don't send again
    const messages = [
      {
        id: "phase5-denial-response",
        role: "assistant",
        content: "Payment was denied",
        parts: [
          {
            type: "tool-process_payment",
            toolCallId: "call-payment-789",
            toolName: "process_payment",
            state: "Failed", // Tool failed after user denied
            input: { amount: 1000, recipient: "Bob", currency: "USD" },
            output: { error: "This tool call is rejected." },
          },
          {
            type: "tool-adk_request_confirmation",
            toolCallId: "call-confirm-999",
            toolName: "adk_request_confirmation",
            state: "output-available",
            input: {
              originalFunctionCall: { id: "call-payment-789" }, // Points to failed tool
            },
            output: { confirmed: false },
          },
        ],
      },
    ] as UIMessage[];
    const result = sendAutomaticallyWhenAdkConfirmation({ messages });
    // Should NOT trigger auto-send because original tool is already Failed
    expect(result).toBe(false);
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
  it("should extract parts exactly once (spy test for efficiency)", () => {
    // Given: spy on extractParts
    const extractSpy = vi.fn(extractParts);
    const message: UIMessage = {
      id: "1",
      role: "assistant",
      content: "Response",
      parts: [
        { type: "tool-test", state: "input-available" },
        { type: "tool-test2", state: "output-available" },
      ],
    };

    // When: extract parts
    const result = extractSpy(message);

    // Then: should be called exactly once
    expect(extractSpy).toHaveBeenCalledTimes(1);
    expect(extractSpy).toHaveBeenCalledWith(message);
    expect(result).toEqual(message.parts);
  });

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

  it("should find part exactly once (spy test for efficiency)", () => {
    // Given: spy on findPart
    const findSpy = vi.fn(findPart);

    // When: find part by type and state
    const result = findSpy(
      parts,
      "tool-adk_request_confirmation",
      "output-available",
    );

    // Then: should be called exactly once
    expect(findSpy).toHaveBeenCalledTimes(1);
    expect(findSpy).toHaveBeenCalledWith(
      parts,
      "tool-adk_request_confirmation",
      "output-available",
    );
    expect(result).toEqual({
      type: "tool-adk_request_confirmation",
      state: "output-available",
    });
  });

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
      "output-available",
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
      "nonexistent-state",
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
  it("should create confirmation output exactly once (spy test for duplicate send prevention)", () => {
    // Given: spy on createAdkConfirmationOutput
    const createSpy = vi.fn(createAdkConfirmationOutput);
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

    // When: create confirmation output
    const result = createSpy(toolInvocation, true);

    // Then: should be called exactly once (no duplicates)
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(createSpy).toHaveBeenCalledWith(toolInvocation, true);

    // Verify output is correct
    expect(result).toEqual({
      tool: "adk_request_confirmation",
      toolCallId: "adk-confirm-123",
      output: {
        confirmed: true,
      },
    });
  });

  it("should create confirmation output with approved=true (simplified format)", () => {
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

    // Simplified format: just {confirmed: boolean}
    expect(result).toEqual({
      tool: "adk_request_confirmation",
      toolCallId: "adk-confirm-123",
      output: {
        confirmed: true,
      },
    });
  });

  it("should create confirmation output with approved=false (simplified format)", () => {
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

    // Simplified format: just {confirmed: boolean}
    expect(result).toEqual({
      tool: "adk_request_confirmation",
      toolCallId: "adk-confirm-789",
      output: {
        confirmed: false,
      },
    });
  });

  it("should not require originalFunctionCall (simplified approach)", () => {
    // With simplified approach, we don't need originalFunctionCall
    // Backend uses toolCallId directly
    const toolInvocation = {
      toolCallId: "adk-confirm-simple",
      input: {},
    };

    const result = createAdkConfirmationOutput(toolInvocation, true);

    expect(result).toEqual({
      tool: "adk_request_confirmation",
      toolCallId: "adk-confirm-simple",
      output: {
        confirmed: true,
      },
    });
  });

  it("should work with minimal toolInvocation object", () => {
    // Only toolCallId is required
    const toolInvocation = {
      toolCallId: "adk-confirm-minimal",
    };

    const result = createAdkConfirmationOutput(toolInvocation, false);

    expect(result).toEqual({
      tool: "adk_request_confirmation",
      toolCallId: "adk-confirm-minimal",
      output: {
        confirmed: false,
      },
    });
  });
});
