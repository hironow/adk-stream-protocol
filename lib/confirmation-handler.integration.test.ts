/**
 * Integration tests for confirmation-handler.ts
 *
 * RED-GREEN-REFACTOR cycle:
 * - RED: These tests reproduce E2E failures and define correct behavior
 * - GREEN: Integration with tool-invocation.tsx makes these pass
 * - REFACTOR: Clean up while keeping tests green
 *
 * Context: E2E tests are failing with timeout errors because
 * tool-invocation.tsx doesn't properly send confirmation results
 * back to the backend.
 */

import { describe, expect, it, vi } from "vitest";
import {
  type ConfirmationToolInvocation,
  type ConfirmationTransport,
  handleConfirmation,
} from "./confirmation-handler";
import { createAdkConfirmationOutput } from "./adk_compat";

describe("Confirmation Handler Integration", () => {
  describe("SSE Mode - process_payment scenario", () => {
    it("RED: should send exact toolCallId received from backend (SSE mode)", () => {
      // Reproduces E2E failure: scenarios/tools/process-payment-sse.spec.ts
      // Backend sends: confirmation-adk-384471c4-9d3e-43ca-bd3f-f203a12673dd
      // Frontend MUST send back EXACT same ID via addToolOutput
      //
      // Chunk log evidence:
      // {"type":"tool-input-available","toolCallId":"confirmation-adk-384471c4-9d3e-43ca-bd3f-f203a12673dd"}
      //
      // Backend timeout log:
      // [FrontendDelegate] Awaiting result for tool=adk_request_confirmation,
      // function_call.id=confirmation-adk-384471c4-9d3e-43ca-bd3f-f203a12673dd
      // [FrontendDelegate] ========== TIMEOUT DETECTED ==========

      // given - Backend sends this exact toolCallId
      const backendToolCallId =
        "confirmation-adk-384471c4-9d3e-43ca-bd3f-f203a12673dd";
      const toolInvocation: ConfirmationToolInvocation = {
        toolCallId: backendToolCallId,
        toolName: "adk_request_confirmation",
        input: {
          originalFunctionCall: {
            id: "adk-384471c4-9d3e-43ca-bd3f-f203a12673dd",
            name: "process_payment",
            args: {
              recipient: "花子",
              amount: 50,
              currency: "USD",
            },
          },
          toolConfirmation: {
            confirmed: false,
          },
        },
      };

      const mockAddToolOutput = vi.fn();
      const transport: ConfirmationTransport = {
        sse: {
          addToolOutput: mockAddToolOutput,
        },
      };

      // when - User clicks Approve button
      const result = handleConfirmation(toolInvocation, true, transport);

      // then - Frontend MUST send back exact toolCallId
      expect(result.success).toBe(true);
      expect(result.mode).toBe("sse");

      const call = mockAddToolOutput.mock.calls[0][0];

      // CRITICAL: toolCallId preservation
      expect(call.toolCallId).toBe(backendToolCallId);
      expect(call.toolCallId).toBe(
        "confirmation-adk-384471c4-9d3e-43ca-bd3f-f203a12673dd",
      );

      // Verify output structure matches backend expectations
      expect(call.tool).toBe("adk_request_confirmation");
      expect(call.output).toEqual({ confirmed: true });
    });

    it("RED: should create valid output via createAdkConfirmationOutput", () => {
      // Verify that createAdkConfirmationOutput produces correct format
      // This is what tool-invocation.tsx should be calling

      // given
      const toolInvocation: ConfirmationToolInvocation = {
        toolCallId: "confirmation-adk-test-id",
        toolName: "adk_request_confirmation",
        input: {
          originalFunctionCall: {
            id: "adk-test-id",
            name: "process_payment",
            args: { amount: 100 },
          },
        },
      };

      // when
      const output = createAdkConfirmationOutput(toolInvocation, true);

      // then - Verify output structure
      expect(output).toEqual({
        tool: "adk_request_confirmation",
        toolCallId: "confirmation-adk-test-id",
        output: {
          confirmed: true,
        },
      });
    });

    it("RED: should handle denial (confirmed=false) in SSE mode", () => {
      // Reproduces E2E scenario where user clicks Deny

      // given
      const toolInvocation: ConfirmationToolInvocation = {
        toolCallId: "confirmation-adk-denial-test",
        toolName: "adk_request_confirmation",
      };

      const mockAddToolOutput = vi.fn();
      const transport: ConfirmationTransport = {
        sse: { addToolOutput: mockAddToolOutput },
      };

      // when - User clicks Deny
      const result = handleConfirmation(toolInvocation, false, transport);

      // then
      expect(result.success).toBe(true);
      expect(result.mode).toBe("sse");

      const call = mockAddToolOutput.mock.calls[0][0];
      expect(call.output).toEqual({ confirmed: false });
      expect(call.toolCallId).toBe("confirmation-adk-denial-test");
    });
  });

  describe("BIDI Mode - process_payment scenario", () => {
    it("RED: should send exact toolCallId via WebSocket (BIDI mode)", () => {
      // Reproduces E2E failure: scenarios/tools/process-payment-bidi.spec.ts
      // BIDI mode uses different ID format: confirmation-function-call-XXXX

      // given
      const backendToolCallId = "confirmation-function-call-456";
      const toolInvocation: ConfirmationToolInvocation = {
        toolCallId: backendToolCallId,
        toolName: "adk_request_confirmation",
        input: {
          originalFunctionCall: {
            id: "function-call-456",
            name: "process_payment",
            args: { amount: 50 },
          },
        },
      };

      const mockSendToolResult = vi.fn();
      const transport: ConfirmationTransport = {
        websocket: {
          sendToolResult: mockSendToolResult,
        },
      };

      // when - User approves via WebSocket transport
      const result = handleConfirmation(toolInvocation, true, transport);

      // then
      expect(result.success).toBe(true);
      expect(result.mode).toBe("websocket");

      // Verify WebSocket sends correct ID and result
      expect(mockSendToolResult).toHaveBeenCalledWith(
        "confirmation-function-call-456",
        { confirmed: true },
      );
    });

    it("RED: should handle denial via WebSocket", () => {
      // given
      const toolInvocation: ConfirmationToolInvocation = {
        toolCallId: "confirmation-function-call-deny",
        toolName: "adk_request_confirmation",
      };

      const mockSendToolResult = vi.fn();
      const transport: ConfirmationTransport = {
        websocket: { sendToolResult: mockSendToolResult },
      };

      // when
      const result = handleConfirmation(toolInvocation, false, transport);

      // then
      expect(result.success).toBe(true);
      expect(mockSendToolResult).toHaveBeenCalledWith(
        "confirmation-function-call-deny",
        { confirmed: false },
      );
    });
  });

  describe("Cross-mode behavior", () => {
    it("RED: should use WebSocket even when SSE available (priority)", () => {
      // When both transports available, WebSocket takes priority
      // This matches get_location behavior which works in BIDI

      // given
      const toolInvocation: ConfirmationToolInvocation = {
        toolCallId: "test-priority",
        toolName: "adk_request_confirmation",
      };

      const mockSendToolResult = vi.fn();
      const mockAddToolOutput = vi.fn();
      const transport: ConfirmationTransport = {
        websocket: { sendToolResult: mockSendToolResult },
        sse: { addToolOutput: mockAddToolOutput },
      };

      // when
      const result = handleConfirmation(toolInvocation, true, transport);

      // then - WebSocket used, SSE ignored
      expect(result.mode).toBe("websocket");
      expect(mockSendToolResult).toHaveBeenCalled();
      expect(mockAddToolOutput).not.toHaveBeenCalled();
    });
  });

  describe("Error cases from E2E logs", () => {
    it("RED: should fail gracefully when no transport available", () => {
      // This shouldn't happen in production, but defines safe failure

      // given
      const toolInvocation: ConfirmationToolInvocation = {
        toolCallId: "test-no-transport",
        toolName: "adk_request_confirmation",
      };

      const transport: ConfirmationTransport = {}; // No transport

      // when
      const result = handleConfirmation(toolInvocation, true, transport);

      // then - Clear error, no crash
      expect(result.success).toBe(false);
      expect(result.mode).toBe("none");
      expect(result.error).toContain("No transport");
    });

    it("RED: should reject invalid tool names", () => {
      // Defense against malformed invocations

      // given
      const toolInvocation: ConfirmationToolInvocation = {
        toolCallId: "test-invalid",
        toolName: "process_payment", // Wrong tool name
      };

      const mockSendToolResult = vi.fn();
      const transport: ConfirmationTransport = {
        websocket: { sendToolResult: mockSendToolResult },
      };

      // when
      const result = handleConfirmation(toolInvocation, true, transport);

      // then - Reject, don't send
      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid tool name");
      expect(mockSendToolResult).not.toHaveBeenCalled();
    });
  });

  describe("Real-world scenario reproduction", () => {
    it("RED: should match exact sequence from chunk logs (SSE)", () => {
      // Exact reproduction from:
      // chunk_logs/scenario-9/frontend/process-payment-sse-1-normal-flow-approve-once.jsonl
      //
      // Line 4 shows:
      // {"type":"tool-input-available",
      //  "toolCallId":"confirmation-adk-384471c4-9d3e-43ca-bd3f-f203a12673dd",
      //  "toolName":"adk_request_confirmation",
      //  "input":{"originalFunctionCall":{...}}}

      // given - Exact data from chunk log
      const toolInvocation: ConfirmationToolInvocation = {
        toolCallId: "confirmation-adk-384471c4-9d3e-43ca-bd3f-f203a12673dd",
        toolName: "adk_request_confirmation",
        input: {
          originalFunctionCall: {
            id: "adk-384471c4-9d3e-43ca-bd3f-f203a12673dd",
            name: "process_payment",
            args: {
              recipient: "花子",
              amount: 50,
              currency: "USD",
            },
          },
          toolConfirmation: {
            confirmed: false,
          },
        },
      };

      const mockAddToolOutput = vi.fn();
      const transport: ConfirmationTransport = {
        sse: { addToolOutput: mockAddToolOutput },
      };

      // when - Simulate user clicking Approve
      handleConfirmation(toolInvocation, true, transport);

      // then - Verify exact output that backend expects
      const call = mockAddToolOutput.mock.calls[0][0];

      // Backend is waiting for this EXACT toolCallId
      expect(call.toolCallId).toBe(
        "confirmation-adk-384471c4-9d3e-43ca-bd3f-f203a12673dd",
      );

      // Backend expects this exact structure
      expect(call).toEqual({
        tool: "adk_request_confirmation",
        toolCallId: "confirmation-adk-384471c4-9d3e-43ca-bd3f-f203a12673dd",
        output: {
          confirmed: true,
        },
      });
    });
  });
});
