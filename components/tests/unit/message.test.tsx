/**
 * Message Component Unit Tests
 *
 * Tests the MessageComponent rendering logic for various message types and content.
 * Focuses on component-level behavior without external integration.
 *
 * Test Categories:
 * 1. Basic Message Rendering - User vs Assistant messages
 * 2. Text Content - Simple and multi-line text
 * 3. Tool Invocations - Rendering tool calls and results
 * 4. Metadata Display - Usage stats, grounding, citations
 * 5. Edge Cases - Empty messages, audio detection
 *
 * @vitest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MessageComponent } from "@/components/message";
import type { UIMessageFromAISDKv6 } from "@/lib/utils";

// Mock dependencies
vi.mock("@/lib/audio-context", () => ({
  useAudio: () => ({
    voiceChannel: {
      chunkCount: 0,
    },
    bgmChannel: {
      currentTrack: 0,
      switchTrack: vi.fn(),
    },
    needsUserActivation: false,
    activate: vi.fn(),
  }),
}));

vi.mock("@/components/image-display", () => ({
  ImageDisplay: ({ url, alt }: { url: string; alt: string }) => (
    <div data-testid="image-display">
      <img src={url} alt={alt} />
    </div>
  ),
}));

vi.mock("@/components/tool-invocation", () => ({
  ToolInvocationComponent: ({ toolInvocation }: any) => (
    <div data-testid="tool-invocation">Tool: {toolInvocation.toolName}</div>
  ),
}));

describe("MessageComponent", () => {
  describe("Basic Message Rendering", () => {
    it("should render user message with correct styling", () => {
      const message: UIMessageFromAISDKv6 = {
        id: "msg-1",
        role: "user",
        content: "Hello, AI!",
        parts: [{ type: "text", text: "Hello, AI!" }],
      };

      render(<MessageComponent message={message} />);

      expect(screen.getByText("Hello, AI!")).toBeInTheDocument();
      expect(screen.getByText("You")).toBeInTheDocument();
    });

    it("should render assistant message with correct styling", () => {
      const message: UIMessageFromAISDKv6 = {
        id: "msg-2",
        role: "assistant",
        content: "Hello, human!",
        parts: [{ type: "text", text: "Hello, human!" }],
      };

      render(<MessageComponent message={message} />);

      expect(screen.getByText("Hello, human!")).toBeInTheDocument();
      expect(screen.getByText("Assistant")).toBeInTheDocument();
    });
  });

  describe("Text Content Rendering", () => {
    it("should render simple text content", () => {
      const message: UIMessageFromAISDKv6 = {
        id: "msg-3",
        role: "assistant",
        content: "This is a simple message.",
        parts: [{ type: "text", text: "This is a simple message." }],
      };

      render(<MessageComponent message={message} />);

      expect(screen.getByText("This is a simple message.")).toBeInTheDocument();
    });

    it("should render multi-line text content", () => {
      const message: UIMessageFromAISDKv6 = {
        id: "msg-4",
        role: "assistant",
        content: "Line 1\nLine 2\nLine 3",
        parts: [{ type: "text", text: "Line 1\nLine 2\nLine 3" }],
      };

      render(<MessageComponent message={message} />);

      const textElement = screen.getByText(/Line 1/);
      expect(textElement).toBeInTheDocument();
      expect(textElement.textContent).toContain("Line 1");
      expect(textElement.textContent).toContain("Line 2");
      expect(textElement.textContent).toContain("Line 3");
    });

    it("should render empty string as valid content", () => {
      const message: UIMessageFromAISDKv6 = {
        id: "msg-5",
        role: "assistant",
        content: "",
        parts: [{ type: "text", text: "" }],
      };

      render(<MessageComponent message={message} />);

      // Message should still be rendered (not hidden)
      expect(screen.getByTestId("message-assistant")).toBeInTheDocument();
    });
  });

  describe("Tool Invocations", () => {
    it("should render tool call request", () => {
      const message: UIMessageFromAISDKv6 = {
        id: "msg-6",
        role: "assistant",
        content: "",
        parts: [],
        toolInvocations: [
          {
            type: "adk_request_confirmation",
            state: "approval-requested",
            toolCallId: "call-1",
            toolName: "get_weather",
            input: { location: "Tokyo" },
            approval: {
              description: "Get weather for Tokyo",
            },
          },
        ],
      };

      render(
        <MessageComponent
          message={message}
          addToolApprovalResponse={vi.fn()}
        />,
      );

      expect(screen.getByTestId("tool-invocation")).toBeInTheDocument();
      expect(screen.getByText(/Tool: get_weather/)).toBeInTheDocument();
    });

    it("should render multiple tool invocations", () => {
      const message: UIMessageFromAISDKv6 = {
        id: "msg-7",
        role: "assistant",
        content: "",
        parts: [],
        toolInvocations: [
          {
            type: "adk_request_confirmation",
            state: "approval-requested",
            toolCallId: "call-1",
            toolName: "tool_a",
            input: {},
            approval: { description: "Tool A" },
          },
          {
            type: "adk_request_confirmation",
            state: "approval-requested",
            toolCallId: "call-2",
            toolName: "tool_b",
            input: {},
            approval: { description: "Tool B" },
          },
        ],
      };

      render(
        <MessageComponent
          message={message}
          addToolApprovalResponse={vi.fn()}
        />,
      );

      const toolInvocations = screen.getAllByTestId("tool-invocation");
      expect(toolInvocations).toHaveLength(2);
      expect(screen.getByText(/Tool: tool_a/)).toBeInTheDocument();
      expect(screen.getByText(/Tool: tool_b/)).toBeInTheDocument();
    });
  });

  describe("Image Content", () => {
    it("should render image part", () => {
      const message: UIMessageFromAISDKv6 = {
        id: "msg-8",
        role: "user",
        content: "Check this image",
        parts: [
          { type: "text", text: "Check this image" },
          {
            type: "file",
            filename: "test.png",
            mediaType: "image/png",
            url: "data:image/png;base64,iVBORw0KGgo=",
          },
        ],
      };

      render(<MessageComponent message={message} />);

      const img = screen.getByAltText("test.png");
      expect(img).toBeInTheDocument();
      expect(img).toHaveAttribute("src", "data:image/png;base64,iVBORw0KGgo=");
    });

    it("should render multiple images", () => {
      const message: UIMessageFromAISDKv6 = {
        id: "msg-9",
        role: "user",
        content: "Two images",
        parts: [
          {
            type: "file",
            filename: "image1.png",
            mediaType: "image/png",
            url: "data:image/png;base64,img1",
          },
          {
            type: "file",
            filename: "image2.jpg",
            mediaType: "image/jpeg",
            url: "data:image/jpeg;base64,img2",
          },
        ],
      };

      render(<MessageComponent message={message} />);

      expect(screen.getByAltText("image1.png")).toBeInTheDocument();
      expect(screen.getByAltText("image2.jpg")).toBeInTheDocument();
    });
  });

  describe("Edge Cases", () => {
    it("should hide empty user message (delegate continuation)", () => {
      const message: UIMessageFromAISDKv6 = {
        id: "msg-10",
        role: "user",
        content: "",
        parts: [{ type: "text", text: "" }],
      };

      const { container } = render(<MessageComponent message={message} />);

      // Empty user message should be hidden
      expect(container.firstChild).toBeNull();
    });

    it("should not hide empty assistant message", () => {
      const message: UIMessageFromAISDKv6 = {
        id: "msg-11",
        role: "assistant",
        content: "",
        parts: [{ type: "text", text: "" }],
      };

      const { container } = render(<MessageComponent message={message} />);

      // Assistant message should still be rendered
      expect(container.firstChild).not.toBeNull();
    });

    it("should handle message with no parts", () => {
      const message: UIMessageFromAISDKv6 = {
        id: "msg-12",
        role: "assistant",
        content: "Content from content field",
        parts: [],
      };

      render(<MessageComponent message={message} />);

      // Message container should be rendered even without parts
      expect(screen.getByTestId("message-assistant")).toBeInTheDocument();
      expect(screen.getByText("Assistant")).toBeInTheDocument();
    });

    it("should handle message with mixed content types", () => {
      const message: UIMessageFromAISDKv6 = {
        id: "msg-13",
        role: "assistant",
        content: "Mixed content",
        parts: [
          { type: "text", text: "Text part" },
          {
            type: "file",
            filename: "image.png",
            mediaType: "image/png",
            url: "data:image/png;base64,test",
          },
        ],
        toolInvocations: [
          {
            type: "adk_request_confirmation",
            state: "approval-requested",
            toolCallId: "call-1",
            toolName: "test_tool",
            input: {},
            approval: { description: "Test" },
          },
        ],
      };

      render(
        <MessageComponent
          message={message}
          addToolApprovalResponse={vi.fn()}
        />,
      );

      expect(screen.getByText("Text part")).toBeInTheDocument();
      expect(screen.getByAltText("image.png")).toBeInTheDocument();
      expect(screen.getByTestId("tool-invocation")).toBeInTheDocument();
    });
  });

  describe("Metadata Display", () => {
    it("should display usage metadata when present", () => {
      const message: UIMessageFromAISDKv6 = {
        id: "msg-14",
        role: "assistant",
        content: "Response with metadata",
        parts: [{ type: "text", text: "Response with metadata" }],
        metadata: {
          usage: {
            promptTokens: 100,
            completionTokens: 50,
            totalTokens: 150,
          },
        },
      };

      const { container } = render(<MessageComponent message={message} />);

      // Check for usage metadata display - look for the combined display
      expect(container.textContent).toContain("100 in");
      expect(container.textContent).toContain("50 out");
    });

    it("should not display metadata section when no metadata", () => {
      const message: UIMessageFromAISDKv6 = {
        id: "msg-15",
        role: "assistant",
        content: "Response without metadata",
        parts: [{ type: "text", text: "Response without metadata" }],
      };

      const { container } = render(<MessageComponent message={message} />);

      // Should not have metadata section
      expect(container.textContent).not.toContain("Metadata");
      expect(container.textContent).not.toContain("tokens");
    });
  });
});
