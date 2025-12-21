/**
 * Unit tests for confirmation-handler.ts
 *
 * RED-GREEN-REFACTOR cycle:
 * - RED: These tests define the correct behavior and should FAIL initially
 * - GREEN: Implementation is fixed to make all tests PASS
 * - REFACTOR: Code is cleaned up while keeping tests green
 */

import { describe, expect, it, vi } from "vitest";
import {
  type ConfirmationToolInvocation,
  type ConfirmationTransport,
  handleConfirmation,
} from "../../confirmation-handler";

describe("handleConfirmation", () => {
  describe("BIDI mode (WebSocket transport)", () => {
    it("should send user message with tool-result for ORIGINAL tool (approval)", () => {
      // given
      const toolInvocation: ConfirmationToolInvocation = {
        toolCallId: "confirmation-function-call-123",
        toolName: "adk_request_confirmation",
        input: {
          originalFunctionCall: {
            id: "function-call-123",
            name: "process_payment",
            args: { amount: 50 },
          },
          toolConfirmation: {
            confirmed: false,
          },
        },
      };

      const mockSendFunctionResponse = vi.fn();
      const transport: ConfirmationTransport = {
        websocket: {
          sendFunctionResponse: mockSendFunctionResponse,
        },
      };

      // when
      const result = handleConfirmation(toolInvocation, true, transport);

      // then
      expect(result.success).toBe(true);
      expect(result.mode).toBe("websocket");
      expect(mockSendFunctionResponse).toHaveBeenCalledOnce();
      expect(mockSendFunctionResponse).toHaveBeenCalledWith(
        "function-call-123", // Original tool ID, not confirmation tool ID
        "process_payment", // Original tool name, not confirmation tool name
        {
          approved: true,
          user_message: "User approved process_payment execution",
        },
      );
    });

    it("should send user message with tool-result for ORIGINAL tool (denial)", () => {
      // given
      const toolInvocation: ConfirmationToolInvocation = {
        toolCallId: "confirmation-adk-456",
        toolName: "adk_request_confirmation",
        input: {
          originalFunctionCall: {
            id: "function-call-789",
            name: "get_location",
            args: {},
          },
        },
      };

      const mockSendFunctionResponse = vi.fn();
      const transport: ConfirmationTransport = {
        websocket: {
          sendFunctionResponse: mockSendFunctionResponse,
        },
      };

      // when
      const result = handleConfirmation(toolInvocation, false, transport);

      // then
      expect(result.success).toBe(true);
      expect(result.mode).toBe("websocket");
      expect(mockSendFunctionResponse).toHaveBeenCalledWith(
        "function-call-789", // Original tool ID
        "get_location", // Original tool name
        {
          approved: false,
          user_message: "User denied get_location execution",
        },
      );
    });

    it("should return error when originalFunctionCall is missing (BIDI mode)", () => {
      // given
      const toolInvocation: ConfirmationToolInvocation = {
        toolCallId: "confirmation-adk-456",
        toolName: "adk_request_confirmation",
        // Missing input.originalFunctionCall
      };

      const mockSendFunctionResponse = vi.fn();
      const transport: ConfirmationTransport = {
        websocket: {
          sendFunctionResponse: mockSendFunctionResponse,
        },
      };

      // when
      const result = handleConfirmation(toolInvocation, true, transport);

      // then
      expect(result.success).toBe(false);
      expect(result.error).toContain("Missing originalFunctionCall");
      expect(mockSendFunctionResponse).not.toHaveBeenCalled();
    });
  });

  describe("SSE mode (addToolOutput transport)", () => {
    it("should send confirmation via addToolOutput when WebSocket not available", () => {
      // given
      const toolInvocation: ConfirmationToolInvocation = {
        toolCallId: "confirmation-adk-789",
        toolName: "adk_request_confirmation",
        input: {
          originalFunctionCall: {
            id: "adk-789",
            name: "get_location",
            args: {},
          },
        },
      };

      const mockAddToolOutput = vi.fn();
      const transport: ConfirmationTransport = {
        sse: {
          addToolOutput: mockAddToolOutput,
        },
      };

      // when
      const result = handleConfirmation(toolInvocation, true, transport);

      // then
      expect(result.success).toBe(true);
      expect(result.mode).toBe("sse");
      expect(mockAddToolOutput).toHaveBeenCalledOnce();

      // Verify output structure matches createAdkConfirmationOutput
      const call = mockAddToolOutput.mock.calls[0][0];
      expect(call).toEqual({
        tool: "adk_request_confirmation",
        toolCallId: "confirmation-adk-789",
        output: {
          confirmed: true,
        },
      });
    });

    it("should handle denial (confirmed=false) via addToolOutput", () => {
      // given
      const toolInvocation: ConfirmationToolInvocation = {
        toolCallId: "confirmation-adk-999",
        toolName: "adk_request_confirmation",
      };

      const mockAddToolOutput = vi.fn();
      const transport: ConfirmationTransport = {
        sse: {
          addToolOutput: mockAddToolOutput,
        },
      };

      // when
      const result = handleConfirmation(toolInvocation, false, transport);

      // then
      expect(result.success).toBe(true);
      expect(result.mode).toBe("sse");

      const call = mockAddToolOutput.mock.calls[0][0];
      expect(call.output).toEqual({
        confirmed: false,
      });
    });

    it("RED TEST: should preserve exact toolCallId from backend", () => {
      // This is the ROOT CAUSE test case
      // Backend sends: "confirmation-adk-6038360e-0572-46c2-b868-9ae035efe8d6"
      // Frontend MUST send back the EXACT SAME ID

      // given
      const backendToolCallId =
        "confirmation-adk-6038360e-0572-46c2-b868-9ae035efe8d6";
      const toolInvocation: ConfirmationToolInvocation = {
        toolCallId: backendToolCallId, // Exact ID from backend
        toolName: "adk_request_confirmation",
      };

      const mockAddToolOutput = vi.fn();
      const transport: ConfirmationTransport = {
        sse: {
          addToolOutput: mockAddToolOutput,
        },
      };

      // when
      handleConfirmation(toolInvocation, true, transport);

      // then
      const call = mockAddToolOutput.mock.calls[0][0];

      // CRITICAL: toolCallId must be preserved exactly as received
      expect(call.toolCallId).toBe(backendToolCallId);
      expect(call.toolCallId).toBe(
        "confirmation-adk-6038360e-0572-46c2-b868-9ae035efe8d6",
      );
    });
  });

  describe("Priority and fallback", () => {
    it("should prefer WebSocket over SSE when both available", () => {
      // given
      const toolInvocation: ConfirmationToolInvocation = {
        toolCallId: "test-id",
        toolName: "adk_request_confirmation",
        input: {
          originalFunctionCall: {
            id: "original-id",
            name: "test_tool",
            args: {},
          },
        },
      };

      const mockSendFunctionResponse = vi.fn();
      const mockAddToolOutput = vi.fn();
      const transport: ConfirmationTransport = {
        websocket: {
          sendFunctionResponse: mockSendFunctionResponse,
        },
        sse: {
          addToolOutput: mockAddToolOutput,
        },
      };

      // when
      const result = handleConfirmation(toolInvocation, true, transport);

      // then
      expect(result.mode).toBe("websocket");
      expect(mockSendFunctionResponse).toHaveBeenCalled();
      expect(mockAddToolOutput).not.toHaveBeenCalled();
    });
  });

  describe("This binding for WebSocket transport", () => {
    it("RED TEST: should preserve 'this' context when calling sendFunctionResponse", () => {
      // This test reproduces the production bug where `this` is lost
      // when passing websocketTransport.sendFunctionResponse as a function reference

      // given - Create a mock WebSocketChatTransport that uses 'this'
      class MockWebSocketTransport {
        private sentEvents: Array<{
          toolCallId: string;
          toolName: string;
          response: unknown;
        }> = [];

        // This method uses 'this' internally (like the real WebSocketChatTransport)
        public sendFunctionResponse(
          toolCallId: string,
          toolName: string,
          response: Record<string, unknown>,
        ): void {
          // If 'this' is not the MockWebSocketTransport instance, this will throw
          if (!this.sentEvents) {
            throw new TypeError(
              "Cannot read properties of undefined (reading 'sentEvents') - 'this' context lost!",
            );
          }
          this.sentEvents.push({ toolCallId, toolName, response });
        }

        public getSentEvents() {
          return this.sentEvents;
        }
      }

      const mockTransport = new MockWebSocketTransport();

      // Simulate the BUGGY pattern from components/tool-invocation.tsx
      // where method reference is extracted WITHOUT binding
      const transport: ConfirmationTransport = {
        websocket: {
          // BUG: Direct method reference loses 'this' context
          sendFunctionResponse: mockTransport.sendFunctionResponse, // ← 'this' is lost here!
        },
      };

      const toolInvocation: ConfirmationToolInvocation = {
        toolCallId: "confirmation-test-id-123",
        toolName: "adk_request_confirmation",
        input: {
          originalFunctionCall: {
            id: "original-test-id-456",
            name: "test_tool",
            args: {},
          },
        },
      };

      // when/then - This should throw because 'this' is not mockTransport
      // RED: Currently this test will FAIL because handleConfirmation
      // doesn't preserve 'this' binding
      expect(() => {
        handleConfirmation(toolInvocation, true, transport);
      }).toThrow(/this.*context lost/);

      // After fix (GREEN), we should verify the event was sent:
      // expect(mockTransport.getSentEvents()).toHaveLength(1);
      // expect(mockTransport.getSentEvents()[0]).toEqual({
      //   toolCallId: "original-test-id-456",
      //   toolName: "test_tool",
      //   response: {
      //     approved: true,
      //     user_message: "User approved test_tool execution",
      //   },
      // });
    });
  });

  describe("Error handling", () => {
    it("should return error when no transport available", () => {
      // given
      const toolInvocation: ConfirmationToolInvocation = {
        toolCallId: "test-id",
        toolName: "adk_request_confirmation",
      };

      const transport: ConfirmationTransport = {}; // No transport

      // when
      const result = handleConfirmation(toolInvocation, true, transport);

      // then
      expect(result.success).toBe(false);
      expect(result.mode).toBe("none");
      expect(result.error).toContain("No transport");
    });

    it("should return error when tool name is invalid", () => {
      // given
      const toolInvocation: ConfirmationToolInvocation = {
        toolCallId: "test-id",
        toolName: "wrong_tool", // Invalid tool name
      };

      const mockSendFunctionResponse = vi.fn();
      const transport: ConfirmationTransport = {
        websocket: {
          sendFunctionResponse: mockSendFunctionResponse,
        },
      };

      // when
      const result = handleConfirmation(toolInvocation, true, transport);

      // then
      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid tool name");
      expect(mockSendFunctionResponse).not.toHaveBeenCalled();
    });
  });
});
