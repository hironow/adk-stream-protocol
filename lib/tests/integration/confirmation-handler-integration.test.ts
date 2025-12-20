/**
 * Integration test for confirmation handler with component integration
 *
 * RED-GREEN-REFACTOR:
 * - RED: This test FAILS because the current implementation doesn't work in E2E
 * - Reproduces the E2E failure where no outgoing messages are sent
 */

import { describe, expect, it, vi } from "vitest";
import {
  type ConfirmationToolInvocation,
  handleConfirmationClick,
} from "../../confirmation-handler";

describe("handleConfirmationClick (Component Integration)", () => {
  it("RED: should send user message for BIDI confirmation (approval)", () => {
    // This test reproduces the E2E failure
    // Given: Tool invocation from backend with originalFunctionCall
    const toolInvocation: ConfirmationToolInvocation = {
      toolCallId: "confirmation-function-call-123",
      toolName: "adk_request_confirmation",
      input: {
        originalFunctionCall: {
          id: "function-call-456",
          name: "process_payment",
          args: { amount: 50, recipient: "Hanako", currency: "USD" },
        },
      },
    };

    // Mock WebSocket transport with sendFunctionResponse
    const mockSendFunctionResponse = vi.fn();
    const websocketTransport = {
      sendFunctionResponse: mockSendFunctionResponse,
      sendToolResult: vi.fn(), // Should NOT be called
    };

    // When: User clicks Approve button
    const result = handleConfirmationClick(
      toolInvocation,
      true, // confirmed = true
      websocketTransport,
      undefined, // no SSE transport in BIDI mode
    );

    // Then: Should send user message with tool-result for ORIGINAL tool
    expect(result.success).toBe(true);
    expect(result.mode).toBe("websocket");

    // CRITICAL: Must call sendFunctionResponse with ORIGINAL tool info
    expect(mockSendFunctionResponse).toHaveBeenCalledOnce();
    expect(mockSendFunctionResponse).toHaveBeenCalledWith(
      "function-call-456", // Original tool ID (NOT confirmation-function-call-123)
      "process_payment", // Original tool name
      {
        approved: true,
        user_message: "User approved process_payment execution",
      },
    );
  });

  it("RED: should send user message for BIDI confirmation (denial)", () => {
    // Given
    const toolInvocation: ConfirmationToolInvocation = {
      toolCallId: "confirmation-function-call-789",
      toolName: "adk_request_confirmation",
      input: {
        originalFunctionCall: {
          id: "function-call-999",
          name: "get_location",
          args: {},
        },
      },
    };

    const mockSendFunctionResponse = vi.fn();
    const websocketTransport = {
      sendFunctionResponse: mockSendFunctionResponse,
      sendToolResult: vi.fn(),
    };

    // When: User clicks Deny
    const result = handleConfirmationClick(
      toolInvocation,
      false, // confirmed = false
      websocketTransport,
      undefined,
    );

    // Then
    expect(result.success).toBe(true);
    expect(mockSendFunctionResponse).toHaveBeenCalledWith(
      "function-call-999",
      "get_location",
      {
        approved: false,
        user_message: "User denied get_location execution",
      },
    );
  });

  it("RED: should handle SSE mode with addToolOutput", () => {
    // Given: SSE mode (no WebSocket transport)
    const toolInvocation: ConfirmationToolInvocation = {
      toolCallId: "confirmation-adk-123",
      toolName: "adk_request_confirmation",
      input: {
        originalFunctionCall: {
          id: "adk-456",
          name: "process_payment",
          args: { amount: 100 },
        },
      },
    };

    const mockAddToolOutput = vi.fn();

    // When: User clicks Approve in SSE mode
    const result = handleConfirmationClick(
      toolInvocation,
      true,
      undefined, // no WebSocket
      mockAddToolOutput,
    );

    // Then: Should use addToolOutput
    expect(result.success).toBe(true);
    expect(result.mode).toBe("sse");
    expect(mockAddToolOutput).toHaveBeenCalledOnce();

    const call = mockAddToolOutput.mock.calls[0][0];
    expect(call).toEqual({
      tool: "adk_request_confirmation",
      toolCallId: "confirmation-adk-123",
      output: {
        confirmed: true,
      },
    });
  });
});
