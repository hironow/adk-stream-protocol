/**
 * @vitest-environment jsdom
 */

/**
 * Manual Send Tool Approval Tests
 * Tests the manual send workaround for AI SDK v6 beta sendAutomaticallyWhen bug
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom"; // Add jest-dom matchers
import { ToolInvocationComponent } from "@/components/tool-invocation";

describe("Manual Send Tool Approval", () => {
  const mockSendMessage = vi.fn();
  const mockAddToolApprovalResponse = vi.fn();
  const mockExecuteToolCallback = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Approval Flow", () => {
    it("should trigger manual send after tool approval", async () => {
      const toolInvocation = {
        type: "tool-change_bgm",
        state: "approval-requested",
        toolCallId: "test-tool-call-id",
        approval: {
          id: "test-approval-id",
        },
        input: {
          track: 1,
        },
      };

      render(
        <ToolInvocationComponent
          toolInvocation={toolInvocation}
          addToolApprovalResponse={mockAddToolApprovalResponse}
          executeToolCallback={mockExecuteToolCallback}
          sendMessage={mockSendMessage}
        />,
      );

      // Find and click approve button
      const approveButton = screen.getByText("Approve");
      await userEvent.click(approveButton);

      // Verify approval response was sent
      expect(mockAddToolApprovalResponse).toHaveBeenCalledWith({
        id: "test-approval-id",
        approved: true,
        reason: "User approved the tool execution.",
      });

      // Wait for manual send to be triggered (100ms delay)
      await waitFor(
        () => {
          expect(mockSendMessage).toHaveBeenCalled();
        },
        { timeout: 200 },
      );
    });

    it("should trigger manual send after tool rejection", async () => {
      const toolInvocation = {
        type: "tool-get_location",
        state: "approval-requested",
        toolCallId: "test-tool-call-id-2",
        approval: {
          id: "test-approval-id-2",
        },
        input: {},
      };

      render(
        <ToolInvocationComponent
          toolInvocation={toolInvocation}
          addToolApprovalResponse={mockAddToolApprovalResponse}
          sendMessage={mockSendMessage}
        />,
      );

      // Find and click deny button
      const denyButton = screen.getByText("Deny");
      await userEvent.click(denyButton);

      // Verify rejection response was sent
      expect(mockAddToolApprovalResponse).toHaveBeenCalledWith({
        id: "test-approval-id-2",
        approved: false,
        reason: "User denied the tool execution.",
      });

      // Wait for manual send to be triggered
      await waitFor(
        () => {
          expect(mockSendMessage).toHaveBeenCalled();
        },
        { timeout: 200 },
      );
    });

    it("should handle client-side tool execution with manual send", async () => {
      const mockExecute = vi.fn().mockResolvedValue(true); // Returns true for client-handled
      const toolInvocation = {
        type: "tool-change_bgm",
        state: "approval-requested",
        toolCallId: "test-tool-call-id-3",
        approval: {
          id: "test-approval-id-3",
        },
        input: {
          track: 0,
        },
      };

      render(
        <ToolInvocationComponent
          toolInvocation={toolInvocation}
          addToolApprovalResponse={mockAddToolApprovalResponse}
          executeToolCallback={mockExecute}
          sendMessage={mockSendMessage}
        />,
      );

      const approveButton = screen.getByText("Approve");
      await userEvent.click(approveButton);

      // Verify tool was executed on client
      expect(mockExecute).toHaveBeenCalledWith(
        "change_bgm",
        "test-tool-call-id-3",
        { track: 0 },
      );

      // When client handles, approval response should NOT be sent
      expect(mockAddToolApprovalResponse).not.toHaveBeenCalled();

      // But manual send should still be triggered
      await waitFor(
        () => {
          expect(mockSendMessage).toHaveBeenCalled();
        },
        { timeout: 200 },
      );
    });
  });

  describe("Tool Name Extraction", () => {
    it("should extract tool name from type with tool- prefix", () => {
      const toolInvocation = {
        type: "tool-change_bgm",
        state: "approval-requested",
        toolCallId: "test-id",
        approval: { id: "approval-id" },
      };

      const { container: _container } = render(
        <ToolInvocationComponent
          toolInvocation={toolInvocation}
          sendMessage={mockSendMessage}
        />,
      );

      // Check that tool name is displayed correctly (component renders "toolName (type)")
      expect(screen.getByText(/change_bgm/)).toBeInTheDocument();
    });

    it("should use toolName if available", () => {
      const toolInvocation = {
        toolName: "explicit_tool_name",
        type: "tool-change_bgm",
        state: "approval-requested",
        toolCallId: "test-id",
        approval: { id: "approval-id" },
      };

      render(
        <ToolInvocationComponent
          toolInvocation={toolInvocation}
          sendMessage={mockSendMessage}
        />,
      );

      // Should use explicit toolName over type extraction
      expect(screen.getByText(/explicit_tool_name/)).toBeInTheDocument();
    });
  });

  describe("State Display", () => {
    it("should show approval UI when state is approval-requested", () => {
      const toolInvocation = {
        type: "tool-test",
        state: "approval-requested",
        approval: { id: "test-id" },
        input: { param: "value" },
      };

      render(
        <ToolInvocationComponent
          toolInvocation={toolInvocation}
          sendMessage={mockSendMessage}
        />,
      );

      expect(screen.getByText("Approval Required")).toBeInTheDocument();
      expect(screen.getByText("Approve")).toBeInTheDocument();
      expect(screen.getByText("Deny")).toBeInTheDocument();
      expect(
        screen.getByText("This tool requires your approval to execute:"),
      ).toBeInTheDocument();
    });

    it("should show completed state when output is available", () => {
      const toolInvocation = {
        type: "tool-test",
        state: "output-available",
        toolName: "test_tool",
        output: { result: "success" },
      };

      render(
        <ToolInvocationComponent
          toolInvocation={toolInvocation}
          sendMessage={mockSendMessage}
        />,
      );

      expect(screen.getByText("Completed")).toBeInTheDocument();
      expect(screen.getByText("Result")).toBeInTheDocument();
    });

    it("should show error state when output-error", () => {
      const toolInvocation = {
        type: "tool-test",
        state: "output-error",
        toolName: "test_tool",
        errorText: "Tool execution failed",
      };

      render(
        <ToolInvocationComponent
          toolInvocation={toolInvocation}
          sendMessage={mockSendMessage}
        />,
      );

      expect(screen.getByText("Failed")).toBeInTheDocument();
      expect(screen.getByText("Error")).toBeInTheDocument();
      expect(screen.getByText("Tool execution failed")).toBeInTheDocument();
    });
  });
});
