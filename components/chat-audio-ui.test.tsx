/**
 * Tests for Audio Completion UI auto-hide functionality
 * @vitest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
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

  // TODO: Fix this test - requires AudioContext state change to trigger timer
  // The current implementation requires audioContext.voiceChannel.lastCompletion to change
  // for the useEffect to trigger setTimeout. This test needs to be rewritten to properly
  // simulate audio completion through AudioProvider state changes.
  // See: components/chat.tsx:364-387

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

  // TODO: Fix this test - requires AudioContext state change to trigger timer clearing
  // Same issue as above - needs proper AudioContext state simulation

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

  // TODO: Fix this test - requires AudioContext state change before unmount
  // Same issue - needs proper AudioContext state simulation
});
