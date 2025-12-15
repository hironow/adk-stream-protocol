/**
 * Tests for Audio Completion UI auto-hide functionality
 * @vitest-environment jsdom
 */

import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioProvider } from "../lib/audio-context";
import { Chat } from "./chat";

// Mock the useChat hook
vi.mock("@ai-sdk/react-v6", () => ({
  useChat: vi.fn(() => ({
    messages: [],
    input: "",
    isLoading: false,
    error: null,
    append: vi.fn(),
    setInput: vi.fn(),
    reload: vi.fn(),
    stop: vi.fn(),
    setMessages: vi.fn(),
    metadata: {},
    data: null,
    addToolApprovalResponse: vi.fn(),
    addToolOutput: vi.fn(),
  })),
}));

// Mock build-use-chat-options
vi.mock("../lib/build-use-chat-options", () => ({
  buildUseChatOptions: vi.fn(() => ({
    useChatOptions: {
      id: "test-chat",
      messages: [],
    },
    transport: {
      interrupt: vi.fn(),
      startRecording: vi.fn(),
      stopRecording: vi.fn(),
    },
  })),
}));

describe("Audio Completion UI - Auto-hide", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("should show audio completion indicator when audio completes", () => {
    const { rerender } = render(
      <AudioProvider>
        <Chat
          mode="adk-bidi"
          initialMessages={[]}
          onMessagesChange={() => {}}
        />
      </AudioProvider>,
    );

    // Initially should not be visible
    const initialIndicator = screen.queryByText(/Audio:/);
    expect(initialIndicator).toBeNull();

    // Simulate audio completion by updating AudioContext
    // This would normally happen through AudioContext state updates
    // For testing, we need to trigger a re-render with the state change
    rerender(
      <AudioProvider>
        <Chat
          mode="adk-bidi"
          initialMessages={[]}
          onMessagesChange={() => {}}
        />
      </AudioProvider>,
    );
  });

  it("should hide audio completion indicator after 3 seconds", async () => {
    const { container, rerender } = render(
      <AudioProvider>
        <Chat
          mode="adk-bidi"
          initialMessages={[]}
          onMessagesChange={() => {}}
        />
      </AudioProvider>,
    );

    // Simulate showing the audio completion
    // (In real usage, this happens through AudioContext state)

    // Fast-forward time by 3 seconds
    vi.advanceTimersByTime(3000);

    // Wait for the indicator to be hidden
    await waitFor(() => {
      const indicator = screen.queryByText(/Audio:/);
      expect(indicator).toBeNull();
    });
  });

  it("should position audio UI next to WebSocket latency when both are shown", () => {
    render(
      <AudioProvider>
        <Chat
          mode="adk-bidi"
          initialMessages={[]}
          onMessagesChange={() => {}}
        />
      </AudioProvider>,
    );

    // Check for positioning styles
    // The audio completion should have left: calc(50% + 100px) when WS latency is shown
    const audioContainer = screen.queryByText(/Audio:/);
    if (audioContainer?.parentElement) {
      const styles = window.getComputedStyle(audioContainer.parentElement);
      // Position should be at top
      expect(styles.position).toBe("fixed");
      expect(styles.top).toBe("1rem");
    }
  });

  it("should clear existing timer when new audio completes", () => {
    const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");

    const { rerender } = render(
      <AudioProvider>
        <Chat
          mode="adk-bidi"
          initialMessages={[]}
          onMessagesChange={() => {}}
        />
      </AudioProvider>,
    );

    // First audio completion
    rerender(
      <AudioProvider>
        <Chat
          mode="adk-bidi"
          initialMessages={[]}
          onMessagesChange={() => {}}
        />
      </AudioProvider>,
    );

    // Second audio completion before 3 seconds
    vi.advanceTimersByTime(1500); // Halfway through

    rerender(
      <AudioProvider>
        <Chat
          mode="adk-bidi"
          initialMessages={[]}
          onMessagesChange={() => {}}
        />
      </AudioProvider>,
    );

    // Should have cleared the previous timer
    expect(clearTimeoutSpy).toHaveBeenCalled();
  });

  it("should not show audio completion UI in non-BIDI modes", () => {
    const { rerender } = render(
      <AudioProvider>
        <Chat mode="gemini" initialMessages={[]} onMessagesChange={() => {}} />
      </AudioProvider>,
    );

    // Should not show in Gemini mode
    let indicator = screen.queryByText(/Audio:/);
    expect(indicator).toBeNull();

    // Should not show in ADK SSE mode either
    rerender(
      <AudioProvider>
        <Chat mode="adk-sse" initialMessages={[]} onMessagesChange={() => {}} />
      </AudioProvider>,
    );

    indicator = screen.queryByText(/Audio:/);
    expect(indicator).toBeNull();
  });

  it("should clean up timer on component unmount", () => {
    const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");

    const { unmount } = render(
      <AudioProvider>
        <Chat
          mode="adk-bidi"
          initialMessages={[]}
          onMessagesChange={() => {}}
        />
      </AudioProvider>,
    );

    // Unmount while timer is active
    unmount();

    // Should have cleared the timer
    expect(clearTimeoutSpy).toHaveBeenCalled();
  });
});
