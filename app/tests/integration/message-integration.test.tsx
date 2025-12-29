/**
 * Message Component Integration Tests
 *
 * Tests the integration between MessageComponent and various message part types.
 * Focuses on rendering different message types correctly.
 *
 * Test Categories:
 * 1. Message Type Rendering - text, image, tool invocations
 * 2. Audio Transcription - input/output transcription display
 * 3. Mixed Message Parts - Multiple parts in correct order
 *
 * @vitest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MessageComponent } from "@/components/message";
// Mock AudioContext
import { createMockAudioContext } from "@/lib/tests/shared-mocks";
import type { UIMessageFromAISDKv6 } from "@/lib/utils";

vi.mock("@/lib/audio-context", () => ({
  useAudio: () => createMockAudioContext(),
}));

describe("Message Component Integration", () => {
  describe("Message Type Rendering", () => {
    it("should render text message parts", () => {
      // Given: Message with text part
      const message: UIMessageFromAISDKv6 = {
        id: "msg-1",
        role: "user",
        parts: [
          {
            type: "text",
            text: "Hello, world!",
          },
        ],
      };

      // When: Render Message component
      render(<MessageComponent message={message} />);

      // Then: Text content should be displayed
      expect(screen.getByText(/Hello, world!/i)).toBeTruthy();
    });

    it("should render assistant text message", () => {
      // Given: Assistant message with text
      const message: UIMessageFromAISDKv6 = {
        id: "msg-1",
        role: "assistant",
        parts: [
          {
            type: "text",
            text: "Hi there! How can I help you?",
          },
        ],
      };

      // When: Render component
      render(<MessageComponent message={message} />);

      // Then: Text should be displayed
      expect(screen.getByText(/Hi there/i)).toBeTruthy();
    });

    it("should render image message parts", () => {
      // Given: Message with image part
      const message: UIMessageFromAISDKv6 = {
        id: "msg-1",
        role: "user",
        parts: [
          {
            type: "data-image",
            data: {
              content:
                "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
              mediaType: "image/png",
            },
            alt: "Test image",
          } as any,
        ],
      };

      // When: Render component
      render(<MessageComponent message={message} />);

      // Then: Image should be displayed
      const image = document.querySelector("img");
      expect(image).toBeTruthy();
      expect(image?.alt).toBe("Test image");
    });

    it("should render tool invocation parts", () => {
      // Given: Message with tool part (AI SDK v6 format: type="tool-{toolName}")
      const message: UIMessageFromAISDKv6 = {
        id: "msg-1",
        role: "assistant",
        parts: [
          {
            type: "tool-get_weather" as any,
            toolCallId: "call-1",
            args: { location: "Tokyo" },
            state: "input-available",
          },
        ],
      };

      // When: Render component
      render(<MessageComponent message={message} />);

      // Then: Tool invocation should be displayed
      expect(screen.getByTestId("tool-name-primary")).toHaveTextContent(
        "get_weather",
      );
    });

    it("should render mixed message parts in order", () => {
      // Given: Message with multiple parts [text, tool]
      const message: UIMessageFromAISDKv6 = {
        id: "msg-1",
        role: "assistant",
        parts: [
          {
            type: "text",
            text: "Let me check the weather for you.",
          },
          {
            type: "tool-get_weather" as any,
            toolCallId: "call-1",
            args: { location: "Tokyo" },
            state: "output-available",
            result: { temperature: 20, condition: "sunny" },
          },
        ],
      };

      // When: Render component
      render(<MessageComponent message={message} />);

      // Then: All parts should be visible
      expect(screen.getByText(/Let me check the weather/i)).toBeTruthy();
      // Tool name displayed in header for all states
      expect(screen.getByTestId("tool-name")).toHaveTextContent(
        "get_weather",
      );
    });

    it("should render multiple tool invocations", () => {
      // Given: Message with 2 tool invocations
      const message: UIMessageFromAISDKv6 = {
        id: "msg-1",
        role: "assistant",
        parts: [
          {
            type: "tool-get_weather" as any,
            toolCallId: "call-1",
            args: { location: "Tokyo" },
            state: "output-available",
            result: { temp: 20 },
          },
          {
            type: "tool-web_search" as any,
            toolCallId: "call-2",
            args: { query: "AI news" },
            state: "output-available",
            result: { results: [] },
          },
        ],
      };

      // When: Render component
      render(<MessageComponent message={message} />);

      // Then: Both tools should be displayed in header
      const toolNames = screen.getAllByTestId("tool-name");
      expect(toolNames).toHaveLength(2);
      expect(toolNames[0]).toHaveTextContent("get_weather");
      expect(toolNames[1]).toHaveTextContent("web_search");
    });
  });

  describe("Message Metadata", () => {
    it("should handle message with usage metadata", () => {
      // Given: Message with usage metadata
      const message = {
        id: "msg-1",
        role: "assistant",
        parts: [{ type: "text", text: "Response" }],
        metadata: {
          usage: {
            promptTokens: 10,
            completionTokens: 20,
            totalTokens: 30,
          },
        },
      } as UIMessageFromAISDKv6;

      // When: Render component
      render(<MessageComponent message={message} />);

      // Then: Component should render without errors
      expect(screen.getByText(/Response/i)).toBeTruthy();
    });

    it("should handle message with citations", () => {
      // Given: Message with citation metadata
      const message = {
        id: "msg-1",
        role: "assistant",
        parts: [{ type: "text", text: "Information from sources" }],
        metadata: {
          citations: [
            {
              text: "Source text",
              uri: "https://example.com",
              startIndex: 0,
              endIndex: 10,
            },
          ],
        },
      } as UIMessageFromAISDKv6;

      // When: Render component
      render(<MessageComponent message={message} />);

      // Then: Component should render
      expect(screen.getByText(/Information from sources/i)).toBeTruthy();
    });
  });

  describe("Empty and Edge Cases", () => {
    it("should handle empty text message", () => {
      // Given: Message with empty text
      const message: UIMessageFromAISDKv6 = {
        id: "msg-1",
        role: "user",
        parts: [
          {
            type: "text",
            text: "",
          },
        ],
      };

      // When: Render component
      render(<MessageComponent message={message} />);

      // Then: Component should render without errors
      // Note: Empty user messages may be hidden by component logic
      expect(document.body).toBeTruthy();
    });

    it("should handle message with no parts", () => {
      // Given: Message with empty parts array
      const message: UIMessageFromAISDKv6 = {
        id: "msg-1",
        role: "assistant",
        parts: [],
      };

      // When: Render component
      render(<MessageComponent message={message} />);

      // Then: Component should render without crashing
      expect(document.body).toBeTruthy();
    });

    it("should handle streaming message (partial text)", () => {
      // Given: Message being streamed (partial text)
      const message: UIMessageFromAISDKv6 = {
        id: "msg-1",
        role: "assistant",
        parts: [
          {
            type: "text",
            text: "This is a partial",
          },
        ],
      };

      // When: Render component
      render(<MessageComponent message={message} />);

      // Then: Partial text should be displayed
      expect(screen.getByText(/This is a partial/i)).toBeTruthy();
    });
  });

  describe("Tool Approval Integration", () => {
    it("should pass addToolApprovalResponse to tool invocations", () => {
      // Given: Message with tool requiring approval (ADR 0002 pattern)
      const message: UIMessageFromAISDKv6 = {
        id: "msg-1",
        role: "assistant",
        parts: [
          {
            type: "tool-change_bgm" as any,
            toolCallId: "call-1",
            toolName: "change_bgm",
            state: "approval-requested",
            input: {
              track_name: "lofi",
            },
            approval: {
              id: "approval-1",
              approved: undefined,
            },
          },
        ],
      };

      const addToolApprovalResponse = vi.fn();

      // When: Render component with callback
      render(
        <MessageComponent
          message={message}
          addToolApprovalResponse={addToolApprovalResponse}
        />,
      );

      // Then: Tool invocation should be rendered with approval UI
      expect(screen.getByTestId("tool-name")).toHaveTextContent("change_bgm");
      expect(screen.getByTestId("tool-approve-button")).toBeInTheDocument();
    });
  });

  describe("Role-based Rendering", () => {
    it("should render user messages differently from assistant messages", () => {
      // Given: User message
      const userMessage: UIMessageFromAISDKv6 = {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "User question" }],
      };

      // When: Render user message
      const { container: userContainer } = render(
        <MessageComponent message={userMessage} />,
      );

      // Given: Assistant message
      const assistantMessage: UIMessageFromAISDKv6 = {
        id: "assistant-1",
        role: "assistant",
        parts: [{ type: "text", text: "Assistant response" }],
      };

      // When: Render assistant message
      const { container: assistantContainer } = render(
        <MessageComponent message={assistantMessage} />,
      );

      // Then: Both should render successfully
      expect(userContainer.textContent).toContain("User question");
      expect(assistantContainer.textContent).toContain("Assistant response");
    });
  });
});
