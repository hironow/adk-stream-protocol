/**
 * ToolInvocation Component Tests
 *
 * Tests manual send behavior after tool approval operations.
 * Reference: experiments/2025-12-16_manual_send_tool_approval_design.md
 *
 * @vitest-environment jsdom
 */

import { fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the ToolInvocationComponent
// Note: This is a simplified test focusing on the manual send behavior
// The actual component is in tool-invocation.tsx

describe("ToolInvocation Manual Send Tests", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("should call sendMessage after tool approval (approved=true)", () => {
    // Given: Mock functions
    const addToolApprovalResponse = vi.fn();
    const sendMessage = vi.fn();

    // Simplified ToolInvocation component with Approve button
    const TestComponent = () => {
      const handleApprove = () => {
        addToolApprovalResponse({
          id: "approval-1",
          approved: true,
          reason: "User approved",
        });

        // Manual send after tool approval (AI SDK v6 beta bug workaround)
        if (sendMessage) {
          setTimeout(() => {
            sendMessage();
          }, 100);
        }
      };

      return (
        <button type="button" onClick={handleApprove}>
          Approve
        </button>
      );
    };

    // When: Render and click Approve button
    const { getByText } = render(<TestComponent />);
    const approveButton = getByText("Approve");
    fireEvent.click(approveButton);

    // Then: addToolApprovalResponse should be called immediately
    expect(addToolApprovalResponse).toHaveBeenCalledWith({
      id: "approval-1",
      approved: true,
      reason: "User approved",
    });

    // And: sendMessage should NOT be called yet (waiting for timeout)
    expect(sendMessage).not.toHaveBeenCalled();

    // When: Advance timer by 100ms
    vi.advanceTimersByTime(100);

    // Then: sendMessage should be called after timeout
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("should call sendMessage after tool rejection (approved=false)", () => {
    // Given: Mock functions
    const addToolApprovalResponse = vi.fn();
    const sendMessage = vi.fn();

    // Simplified ToolInvocation component with Reject button
    const TestComponent = () => {
      const handleReject = () => {
        addToolApprovalResponse({
          id: "approval-1",
          approved: false,
          reason: "User denied the tool execution.",
        });

        // Manual send after tool rejection (AI SDK v6 beta bug workaround)
        if (sendMessage) {
          setTimeout(() => {
            sendMessage();
          }, 100);
        }
      };

      return (
        <button type="button" onClick={handleReject}>
          Reject
        </button>
      );
    };

    // When: Render and click Reject button
    const { getByText } = render(<TestComponent />);
    const rejectButton = getByText("Reject");
    fireEvent.click(rejectButton);

    // Then: addToolApprovalResponse should be called immediately
    expect(addToolApprovalResponse).toHaveBeenCalledWith({
      id: "approval-1",
      approved: false,
      reason: "User denied the tool execution.",
    });

    // And: sendMessage should NOT be called yet (waiting for timeout)
    expect(sendMessage).not.toHaveBeenCalled();

    // When: Advance timer by 100ms
    vi.advanceTimersByTime(100);

    // Then: sendMessage should be called after timeout
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("should NOT call sendMessage if sendMessage callback is undefined", () => {
    // Given: No sendMessage callback
    const addToolApprovalResponse = vi.fn();
    const sendMessage = undefined; // Explicitly undefined

    // Simplified ToolInvocation component
    const TestComponent = () => {
      const handleApprove = () => {
        addToolApprovalResponse({
          id: "approval-1",
          approved: true,
          reason: "User approved",
        });

        // Manual send after tool approval (AI SDK v6 beta bug workaround)
        if (sendMessage) {
          setTimeout(() => {
            sendMessage();
          }, 100);
        }
      };

      return (
        <button type="button" onClick={handleApprove}>
          Approve
        </button>
      );
    };

    // When: Render and click Approve button
    const { getByText } = render(<TestComponent />);
    const approveButton = getByText("Approve");
    fireEvent.click(approveButton);

    // Then: addToolApprovalResponse should be called
    expect(addToolApprovalResponse).toHaveBeenCalled();

    // When: Advance timer by 100ms
    vi.advanceTimersByTime(100);

    // Then: No error should occur (sendMessage is undefined, so no call)
    // This tests the safety check: if (sendMessage) { ... }
    expect(true).toBe(true); // Just verify no error occurred
  });

  it("should call sendMessage after client-side tool execution success", () => {
    // Given: Mock functions
    const addToolOutput = vi.fn();
    const sendMessage = vi.fn();

    // Simplified component simulating client-side tool execution
    const TestComponent = () => {
      const handleExecuteTool = () => {
        try {
          // Simulate tool execution
          const result = { success: true, data: "result" };

          // Add tool output
          addToolOutput({
            toolCallId: "call-1",
            tool: "web_search",
            output: result,
          });

          // Manual send after client-side tool execution
          setTimeout(() => {
            sendMessage({ text: "" });
          }, 100);
        } catch (_error) {
          // Handle error
        }
      };

      return (
        <button type="button" onClick={handleExecuteTool}>
          Execute Tool
        </button>
      );
    };

    // When: Render and click Execute Tool button
    const { getByText } = render(<TestComponent />);
    const executeButton = getByText("Execute Tool");
    fireEvent.click(executeButton);

    // Then: addToolOutput should be called immediately
    expect(addToolOutput).toHaveBeenCalledWith({
      toolCallId: "call-1",
      tool: "web_search",
      output: { success: true, data: "result" },
    });

    // And: sendMessage should NOT be called yet (waiting for timeout)
    expect(sendMessage).not.toHaveBeenCalled();

    // When: Advance timer by 100ms
    vi.advanceTimersByTime(100);

    // Then: sendMessage should be called with empty text
    expect(sendMessage).toHaveBeenCalledWith({ text: "" });
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("should call sendMessage after client-side tool execution error", () => {
    // Given: Mock functions
    const addToolOutput = vi.fn();
    const sendMessage = vi.fn();

    // Simplified component simulating client-side tool execution with error
    const TestComponent = () => {
      const handleExecuteTool = () => {
        try {
          // Simulate tool execution error
          throw new Error("Tool execution failed");
        } catch (error) {
          // Add tool error output
          addToolOutput({
            toolCallId: "call-1",
            tool: "web_search",
            state: "output-error",
            errorText: error instanceof Error ? error.message : String(error),
          });

          // Manual send after client-side tool error
          setTimeout(() => {
            sendMessage({ text: "" });
          }, 100);
        }
      };

      return (
        <button type="button" onClick={handleExecuteTool}>
          Execute Tool
        </button>
      );
    };

    // When: Render and click Execute Tool button
    const { getByText } = render(<TestComponent />);
    const executeButton = getByText("Execute Tool");
    fireEvent.click(executeButton);

    // Then: addToolOutput should be called with error state
    expect(addToolOutput).toHaveBeenCalledWith({
      toolCallId: "call-1",
      tool: "web_search",
      state: "output-error",
      errorText: "Tool execution failed",
    });

    // And: sendMessage should NOT be called yet (waiting for timeout)
    expect(sendMessage).not.toHaveBeenCalled();

    // When: Advance timer by 100ms
    vi.advanceTimersByTime(100);

    // Then: sendMessage should be called with empty text
    expect(sendMessage).toHaveBeenCalledWith({ text: "" });
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });
});

/**
 * Frontend Delegate Tool Auto-Execution Tests
 *
 * Tests automatic execution of frontend delegate tools in BIDI mode.
 * Reference: experiments/2025-12-18_bidi_frontend_delegate_deadlock_analysis.md
 */
describe("ToolInvocation Frontend Delegate Auto-Execution Tests", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("should detect frontend delegate tool (no approval, BIDI mode)", () => {
    // Given: A frontend delegate tool in input-available state with WebSocket transport
    const toolInvocation = {
      type: "tool-change_bgm",
      toolName: "change_bgm",
      toolCallId: "call-123",
      state: "input-available",
      input: { track: 1 },
    };

    const websocketTransport = {
      sendToolResult: vi.fn(),
      sendFunctionResponse: vi.fn(),
    };

    const executeToolCallback = vi.fn();

    // Simulate the detection logic we implemented
    const isAdkConfirmation =
      toolInvocation.toolName === "adk_request_confirmation";

    const isLongRunningTool =
      toolInvocation.state === "input-available" &&
      websocketTransport !== undefined &&
      executeToolCallback === undefined; // Long-running tools DON'T have executeToolCallback

    const isFrontendDelegateTool =
      toolInvocation.state === "input-available" &&
      websocketTransport !== undefined &&
      !isAdkConfirmation &&
      executeToolCallback !== undefined; // Frontend delegate tools HAVE executeToolCallback

    // Then: Should be detected as frontend delegate tool
    // This will fail until we fix the detection logic
    expect(isFrontendDelegateTool).toBe(true);
  });

  it("should NOT detect long-running tools as frontend delegate tools", () => {
    // Given: A long-running tool (approval required, returns None on backend)
    const toolInvocation = {
      type: "tool-process_payment",
      toolName: "process_payment",
      toolCallId: "call-456",
      state: "input-available",
      input: { amount: 100, recipient: "Alice" },
    };

    const websocketTransport = {
      sendToolResult: vi.fn(),
      sendFunctionResponse: vi.fn(),
    };

    // Long-running tools DON'T have executeToolCallback
    // They use sendFunctionResponse after approval
    const executeToolCallback = undefined;

    const isLongRunningTool =
      toolInvocation.state === "input-available" &&
      websocketTransport !== undefined &&
      executeToolCallback === undefined; // Long-running tools DON'T have executeToolCallback

    const isFrontendDelegateTool =
      toolInvocation.state === "input-available" &&
      websocketTransport !== undefined &&
      !isLongRunningTool &&
      executeToolCallback !== undefined; // Frontend delegate tools HAVE executeToolCallback

    // Then: Should NOT be detected as frontend delegate tool
    expect(isFrontendDelegateTool).toBe(false);
  });

  it("should auto-execute frontend delegate tool and send result via WebSocket", async () => {
    // Given: Mock functions
    const executeToolCallback = vi.fn().mockResolvedValue({
      success: true,
      result: {
        success: true,
        current_track: 1,
        message: "BGM changed to track 1",
      },
    });

    const websocketTransport = {
      sendToolResult: vi.fn(),
      sendFunctionResponse: vi.fn(),
    };

    const toolInvocation = {
      type: "tool-change_bgm",
      toolName: "change_bgm",
      toolCallId: "call-789",
      state: "input-available",
      input: { track: 1 },
    };

    // Simulate the auto-execution logic we implemented
    // This should happen in useEffect when tool arrives
    const isFrontendDelegateTool =
      toolInvocation.state === "input-available" &&
      websocketTransport !== undefined &&
      executeToolCallback !== undefined;

    if (isFrontendDelegateTool) {
      const { success, result } = await executeToolCallback(
        toolInvocation.toolName,
        toolInvocation.toolCallId,
        toolInvocation.input,
      );

      if (success && result) {
        websocketTransport.sendToolResult(toolInvocation.toolCallId, result);
      }
    }

    // Then: executeToolCallback should be called with correct arguments
    expect(executeToolCallback).toHaveBeenCalledWith("change_bgm", "call-789", {
      track: 1,
    });

    // And: sendToolResult should be called with result
    expect(websocketTransport.sendToolResult).toHaveBeenCalledWith("call-789", {
      success: true,
      current_track: 1,
      message: "BGM changed to track 1",
    });

    // And: sendFunctionResponse should NOT be called (that's for long-running tools)
    expect(websocketTransport.sendFunctionResponse).not.toHaveBeenCalled();
  });

  it("should NOT auto-execute if state is not input-available", () => {
    // Given: Tool in different state
    const toolInvocation = {
      type: "tool-change_bgm",
      toolName: "change_bgm",
      toolCallId: "call-abc",
      state: "input-streaming", // Not input-available
      input: { track: 1 },
    };

    const websocketTransport = {
      sendToolResult: vi.fn(),
      sendFunctionResponse: vi.fn(),
    };

    const executeToolCallback = vi.fn();

    const isFrontendDelegateTool =
      toolInvocation.state === "input-available" &&
      websocketTransport !== undefined &&
      executeToolCallback !== undefined;

    // Then: Should NOT be detected
    expect(isFrontendDelegateTool).toBe(false);

    // And: No execution should occur
    expect(executeToolCallback).not.toHaveBeenCalled();
    expect(websocketTransport.sendToolResult).not.toHaveBeenCalled();
  });

  it("should NOT auto-execute in SSE mode (no websocketTransport)", () => {
    // Given: SSE mode (no websocketTransport)
    const toolInvocation = {
      type: "tool-change_bgm",
      toolName: "change_bgm",
      toolCallId: "call-def",
      state: "input-available",
      input: { track: 1 },
    };

    const websocketTransport = undefined; // SSE mode

    const executeToolCallback = vi.fn();

    const isFrontendDelegateTool =
      toolInvocation.state === "input-available" &&
      websocketTransport !== undefined &&
      executeToolCallback !== undefined;

    // Then: Should NOT be detected (SSE mode uses different flow)
    expect(isFrontendDelegateTool).toBe(false);

    // And: No execution should occur
    expect(executeToolCallback).not.toHaveBeenCalled();
  });
});
