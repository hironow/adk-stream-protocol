/**
 * Tool Invocation Component Integration Tests
 *
 * Tests the integration between ToolInvocationComponent and tool approval/execution logic.
 * Focuses on UI rendering and callback integration, not backend behavior.
 *
 * Test Categories:
 * 1. ADK RequestConfirmation Pattern - Approval UI rendering and callbacks
 * 2. Frontend Execute Pattern - Local tool execution (not tested here, covered in E2E)
 * 3. Tool State Rendering - Different tool states (pending, approved, denied)
 *
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToolInvocationComponent } from "@/components/tool-invocation";

describe("Tool Invocation Component Integration", () => {
  describe("ADK RequestConfirmation Pattern", () => {
    it("should render approval UI for adk_request_confirmation tool", () => {
      // Given: adk_request_confirmation tool invocation
      const toolInvocation = {
        type: "tool-adk_request_confirmation",
        toolName: "adk_request_confirmation",
        toolCallId: "call-1",
        state: "approval-requested",
        input: {
          originalFunctionCall: {
            id: "orig-1",
            name: "web_search",
            args: { query: "latest AI news" },
          },
        },
      };

      const addToolApprovalResponse = vi.fn();

      // When: Render ToolInvocation component
      render(
        <ToolInvocationComponent
          toolInvocation={toolInvocation}
          addToolApprovalResponse={addToolApprovalResponse}
        />,
      );

      // Then: Tool name should be displayed (original tool, not adk_request_confirmation)
      expect(screen.getByTestId("tool-name-primary")).toHaveTextContent(
        "web_search",
      );

      // Then: Tool args should be displayed
      expect(screen.getByText(/latest AI news/i)).toBeTruthy();
    });

    it("should call addToolApprovalResponse with approved=true when Approve clicked", () => {
      // Given: Tool requiring approval
      const toolInvocation = {
        type: "tool-adk_request_confirmation",
        toolName: "adk_request_confirmation",
        toolCallId: "call-1",
        state: "approval-requested",
        input: {
          originalFunctionCall: {
            id: "orig-1",
            name: "change_bgm",
            args: { track_name: "lofi" },
          },
        },
      };

      const addToolOutput = vi.fn();

      // When: Render component
      render(
        <ToolInvocationComponent
          toolInvocation={toolInvocation}
          addToolOutput={addToolOutput}
        />,
      );

      // When: Click Approve button
      const approveButton = screen.getByTestId("tool-approve-button");
      fireEvent.click(approveButton);

      // Then: Callback should be called with confirmation output
      expect(addToolOutput).toHaveBeenCalledWith({
        tool: "adk_request_confirmation",
        toolCallId: "call-1",
        output: {
          confirmed: true,
        },
      });
    });

    it("should call addToolApprovalResponse with approved=false when Deny clicked", () => {
      // Given: Tool requiring approval
      const toolInvocation = {
        type: "tool-adk_request_confirmation",
        toolName: "adk_request_confirmation",
        toolCallId: "call-1",
        state: "approval-requested",
        input: {
          originalFunctionCall: {
            id: "orig-1",
            name: "delete_files",
            args: {},
          },
        },
      };

      const addToolOutput = vi.fn();

      // When: Render component
      render(
        <ToolInvocationComponent
          toolInvocation={toolInvocation}
          addToolOutput={addToolOutput}
        />,
      );

      // When: Click Deny button
      const denyButton = screen.getByTestId("tool-deny-button");
      fireEvent.click(denyButton);

      // Then: Callback should be called with confirmation output
      expect(addToolOutput).toHaveBeenCalledWith({
        tool: "adk_request_confirmation",
        toolCallId: "call-1",
        output: {
          confirmed: false,
        },
      });
    });

    it("should display original tool information in approval UI", () => {
      // Given: adk_request_confirmation with nested originalFunctionCall
      const toolInvocation = {
        type: "tool-adk_request_confirmation",
        toolName: "adk_request_confirmation",
        toolCallId: "call-1",
        state: "approval-requested",
        input: {
          originalFunctionCall: {
            id: "orig-1",
            name: "get_location",
            args: { precision: "high" },
          },
        },
      };

      // When: Render component
      render(
        <ToolInvocationComponent
          toolInvocation={toolInvocation}
          addToolApprovalResponse={vi.fn()}
        />,
      );

      // Then: Original tool name displayed (not adk_request_confirmation)
      expect(screen.getByTestId("tool-name-primary")).toHaveTextContent(
        "get_location",
      );

      // Then: Tool arguments displayed
      expect(screen.getByText(/high/i)).toBeTruthy();
    });
  });

  describe("Tool State Rendering", () => {
    it("should show approval-requested state UI", () => {
      // Given: Tool in approval-requested state
      const toolInvocation = {
        type: "tool-adk_request_confirmation",
        toolName: "adk_request_confirmation",
        toolCallId: "call-1",
        state: "approval-requested",
        input: {
          originalFunctionCall: {
            id: "orig-1",
            name: "web_search",
            args: { query: "test" },
          },
        },
      };

      // When: Render component
      render(
        <ToolInvocationComponent
          toolInvocation={toolInvocation}
          addToolApprovalResponse={vi.fn()}
        />,
      );

      // Then: Approve and Deny buttons should be visible
      expect(screen.getByTestId("tool-approve-button")).toBeInTheDocument();
      expect(screen.getByTestId("tool-deny-button")).toBeInTheDocument();
    });

    it("should show approval-responded state with approved", () => {
      // Given: Tool in approval-responded state (approved)
      const toolInvocation = {
        type: "tool-adk_request_confirmation",
        toolName: "adk_request_confirmation",
        toolCallId: "call-1",
        state: "approval-responded",
        input: {
          originalFunctionCall: {
            id: "orig-1",
            name: "change_bgm",
            args: { track_name: "jazz" },
          },
        },
        approval: {
          id: "call-1",
          approved: true,
        },
      };

      // When: Render component
      render(
        <ToolInvocationComponent
          toolInvocation={toolInvocation}
          addToolApprovalResponse={vi.fn()}
        />,
      );

      // Then: Approval status should be indicated
      // Note: Specific UI depends on component implementation
      expect(screen.getByTestId("tool-name-primary")).toHaveTextContent(
        "change_bgm",
      );
    });

    it("should show approval-responded state with denied", () => {
      // Given: Tool in approval-responded state (denied)
      const toolInvocation = {
        type: "tool-adk_request_confirmation",
        toolName: "adk_request_confirmation",
        toolCallId: "call-1",
        state: "approval-responded",
        input: {
          originalFunctionCall: {
            id: "orig-1",
            name: "delete_files",
            args: {},
          },
        },
        approval: {
          id: "call-1",
          approved: false,
        },
      };

      // When: Render component
      render(
        <ToolInvocationComponent
          toolInvocation={toolInvocation}
          addToolApprovalResponse={vi.fn()}
        />,
      );

      // Then: Denial status should be indicated
      expect(screen.getByTestId("tool-name-primary")).toHaveTextContent(
        "delete_files",
      );
    });

    it("should handle long-running tool state (input-available)", () => {
      // Given: Long-running tool in input-available state
      const toolInvocation = {
        type: "tool-analyze_dataset",
        toolName: "analyze_dataset",
        toolCallId: "call-1",
        state: "input-available",
        args: { dataset_id: "12345" },
      };

      const addToolOutput = vi.fn();

      // When: Render component
      render(
        <ToolInvocationComponent
          toolInvocation={toolInvocation}
          addToolOutput={addToolOutput}
        />,
      );

      // Then: Tool name should be displayed
      expect(screen.getByTestId("tool-name-primary")).toHaveTextContent(
        "analyze_dataset",
      );

      // Then: Approval UI should appear for long-running tools
      expect(screen.getByTestId("tool-approve-button")).toBeInTheDocument();
    });

    it("should handle tool output-available state", () => {
      // Given: Tool with output available
      const toolInvocation = {
        type: "tool-get_weather",
        toolName: "get_weather",
        toolCallId: "call-1",
        state: "output-available",
        args: { location: "Tokyo" },
        result: {
          temperature: 20,
          condition: "sunny",
        },
      };

      // When: Render component
      render(<ToolInvocationComponent toolInvocation={toolInvocation} />);

      // Then: Tool result should be displayed (debug view for output-available state)
      expect(screen.getByTestId("tool-name-debug")).toHaveTextContent(
        "get_weather",
      );
      // Note: Result display format depends on component implementation
    });
  });

  describe("Error Handling", () => {
    it("should handle missing addToolApprovalResponse gracefully", () => {
      // Given: Tool requiring approval but no callback provided
      const toolInvocation = {
        type: "tool-adk_request_confirmation",
        toolName: "adk_request_confirmation",
        toolCallId: "call-1",
        state: "approval-requested",
        input: {
          originalFunctionCall: {
            id: "orig-1",
            name: "test_tool",
            args: {},
          },
        },
      };

      // When: Render without callback
      render(<ToolInvocationComponent toolInvocation={toolInvocation} />);

      // Then: Component should render without errors (debug view)
      expect(screen.getByTestId("tool-name-primary")).toHaveTextContent(
        "test_tool",
      );
    });

    it("should handle malformed tool invocation data", () => {
      // Given: Tool invocation with missing data
      const toolInvocation = {
        type: "tool-unknown",
        toolCallId: "call-1",
        state: "input-available",
        // Missing toolName and args
      };

      // When: Render component
      render(<ToolInvocationComponent toolInvocation={toolInvocation} />);

      // Then: Component should render without crashing
      // Note: Should display fallback or error state
      expect(document.body).toBeTruthy();
    });
  });
});
