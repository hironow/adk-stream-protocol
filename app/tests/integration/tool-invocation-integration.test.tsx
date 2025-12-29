/**
 * Tool Invocation Component Integration Tests
 *
 * Tests the integration between ToolInvocationComponent and tool approval/execution logic.
 * Focuses on UI rendering and callback integration using ADR 0002 approval pattern.
 *
 * Test Categories:
 * 1. Tool Approval Pattern (ADR 0002) - Direct tool approval with state="approval-requested"
 * 2. Tool State Rendering - Different tool states (approval-requested, approval-responded, input-available, etc.)
 * 3. Error Handling - Graceful handling of missing callbacks and malformed data
 *
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToolInvocationComponent } from "@/components/tool-invocation";

describe("Tool Invocation Component Integration", () => {
  describe("Tool Approval Pattern (ADR 0002)", () => {
    it("should render approval UI for tool requiring approval", () => {
      // Given: Tool with approval-requested state (ADR 0002 pattern)
      const toolInvocation = {
        type: "tool-process_payment",
        toolName: "process_payment",
        toolCallId: "call-1",
        state: "approval-requested",
        input: {
          amount: 100,
          recipient: "Alice",
        },
        approval: {
          id: "approval-1",
          approved: undefined, // Pending approval
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

      // Then: Tool name should be displayed in header
      expect(screen.getByTestId("tool-name")).toHaveTextContent(
        "process_payment",
      );

      // Then: Approval UI should be visible
      expect(screen.getByText(/This tool requires your approval to execute/i)).toBeTruthy();
      expect(screen.getByTestId("tool-approve-button")).toBeInTheDocument();
      expect(screen.getByTestId("tool-deny-button")).toBeInTheDocument();
    });

    it("should call addToolApprovalResponse with approved=true when Approve clicked", () => {
      // Given: Tool requiring approval
      const toolInvocation = {
        type: "tool-get_location",
        toolName: "get_location",
        toolCallId: "call-1",
        state: "approval-requested",
        input: {
          precision: "high",
        },
        approval: {
          id: "approval-1",
          approved: undefined,
        },
      };

      const addToolApprovalResponse = vi.fn();

      // When: Render component
      render(
        <ToolInvocationComponent
          toolInvocation={toolInvocation}
          addToolApprovalResponse={addToolApprovalResponse}
        />,
      );

      // When: Click Approve button
      const approveButton = screen.getByTestId("tool-approve-button");
      fireEvent.click(approveButton);

      // Then: Callback should be called with approval response
      expect(addToolApprovalResponse).toHaveBeenCalledWith({
        id: "approval-1",
        approved: true,
        reason: "User approved the tool execution.",
      });
    });

    it("should call addToolApprovalResponse with approved=false when Deny clicked", () => {
      // Given: Tool requiring approval
      const toolInvocation = {
        type: "tool-delete_files",
        toolName: "delete_files",
        toolCallId: "call-1",
        state: "approval-requested",
        input: {
          paths: ["/tmp/file.txt"],
        },
        approval: {
          id: "approval-1",
          approved: undefined,
        },
      };

      const addToolApprovalResponse = vi.fn();

      // When: Render component
      render(
        <ToolInvocationComponent
          toolInvocation={toolInvocation}
          addToolApprovalResponse={addToolApprovalResponse}
        />,
      );

      // When: Click Deny button
      const denyButton = screen.getByTestId("tool-deny-button");
      fireEvent.click(denyButton);

      // Then: Callback should be called with denial response
      expect(addToolApprovalResponse).toHaveBeenCalledWith({
        id: "approval-1",
        approved: false,
        reason: "User denied the tool execution.",
      });
    });
  });

  describe("Tool State Rendering", () => {
    it("should show approval-requested state UI", () => {
      // Given: Tool in approval-requested state
      const toolInvocation = {
        type: "tool-web_search",
        toolName: "web_search",
        toolCallId: "call-1",
        state: "approval-requested",
        input: {
          query: "test",
        },
        approval: {
          id: "approval-1",
          approved: undefined,
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
      expect(screen.getByTestId("tool-state")).toHaveTextContent("Approval Required");
    });

    it("should show approval-responded state with approved", () => {
      // Given: Tool in approval-responded state (approved)
      const toolInvocation = {
        type: "tool-change_bgm",
        toolName: "change_bgm",
        toolCallId: "call-1",
        state: "approval-responded",
        input: {
          track_name: "jazz",
        },
        approval: {
          id: "approval-1",
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

      // Then: Tool name and state should be displayed
      expect(screen.getByTestId("tool-name")).toHaveTextContent("change_bgm");
      expect(screen.getByTestId("tool-state")).toHaveTextContent("Processing Approval...");
    });

    it("should show approval-responded state with denied", () => {
      // Given: Tool in approval-responded state (denied)
      const toolInvocation = {
        type: "tool-delete_files",
        toolName: "delete_files",
        toolCallId: "call-1",
        state: "approval-responded",
        input: {
          paths: ["/tmp/file.txt"],
        },
        approval: {
          id: "approval-1",
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

      // Then: Tool name and state should be displayed
      expect(screen.getByTestId("tool-name")).toHaveTextContent("delete_files");
      expect(screen.getByTestId("tool-state")).toHaveTextContent("Processing Approval...");
    });

    it("should handle long-running tool state (input-available)", () => {
      // Given: Long-running tool in input-available state
      const toolInvocation = {
        type: "tool-analyze_dataset",
        toolName: "analyze_dataset",
        toolCallId: "call-1",
        state: "input-available",
        input: {
          dataset_id: "12345",
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

      // Then: Tool name should be displayed prominently
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
        input: {
          location: "Tokyo",
        },
        result: {
          temperature: 20,
          condition: "sunny",
        },
      };

      // When: Render component
      render(<ToolInvocationComponent toolInvocation={toolInvocation} />);

      // Then: Tool name should be displayed
      expect(screen.getByTestId("tool-name")).toHaveTextContent("get_weather");
      expect(screen.getByTestId("tool-state")).toHaveTextContent("Completed");
    });
  });

  describe("Error Handling", () => {
    it("should handle missing addToolApprovalResponse gracefully", () => {
      // Given: Tool requiring approval but no callback provided
      const toolInvocation = {
        type: "tool-test_tool",
        toolName: "test_tool",
        toolCallId: "call-1",
        state: "approval-requested",
        input: {
          param: "value",
        },
        approval: {
          id: "approval-1",
          approved: undefined,
        },
      };

      // When: Render without callback
      // Component should still render approval UI but clicking won't do anything
      render(<ToolInvocationComponent toolInvocation={toolInvocation} />);

      // Then: Component should render without errors
      expect(screen.getByTestId("tool-name")).toHaveTextContent("test_tool");
      expect(screen.getByTestId("tool-approve-button")).toBeInTheDocument();
    });

    it("should handle malformed tool invocation data", () => {
      // Given: Tool invocation with missing data
      const toolInvocation = {
        type: "tool-unknown",
        toolCallId: "call-1",
        state: "input-available",
        // Missing toolName and input
      };

      // When: Render component
      render(<ToolInvocationComponent toolInvocation={toolInvocation} />);

      // Then: Component should render without crashing
      // Note: Should display fallback or error state
      expect(document.body).toBeTruthy();
    });
  });
});
