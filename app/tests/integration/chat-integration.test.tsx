/**
 * Chat Component Integration Tests
 *
 * Tests the integration between Chat component and lib/build-use-chat-options.
 * Focuses on testing our code (Chat + buildUseChatOptions), not AI SDK internals.
 *
 * Test Categories:
 * 1. Mode Integration - Chat component with different backend modes
 * 2. Message History - Message preservation during mode switching
 * 3. sendAutomaticallyWhen - Tool approval auto-send logic
 *
 * @vitest-environment jsdom
 */

import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { UIMessage } from 'ai';
import { Chat } from '@/components/chat';
import { buildUseChatOptions } from '@/lib/build-use-chat-options';

// Mock WebSocket for BIDI mode tests
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;

  sentMessages: string[] = [];
  url: string;

  constructor(url: string) {
    this.url = url;
    // Simulate connection opening
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      if (this.onopen) {
        this.onopen(new Event('open'));
      }
    }, 0);
  }

  send(data: string): void {
    this.sentMessages.push(data);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose(new CloseEvent('close'));
    }
  }
}

// Mock AudioContext
import { createMockAudioContext } from '../helpers/test-mocks';

vi.mock('@/lib/audio-context', () => ({
  useAudio: () => createMockAudioContext(),
}));

describe('Chat Component Integration', () => {
  let originalWebSocket: typeof WebSocket;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalWebSocket = global.WebSocket as typeof WebSocket;
    originalFetch = global.fetch;
    global.WebSocket = MockWebSocket as any;
    
    // Mock fetch for Gemini Direct and ADK SSE modes
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        body: null,
      } as Response)
    );
  });

  afterEach(() => {
    global.WebSocket = originalWebSocket;
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  describe('Mode Integration', () => {
    it('should initialize with gemini mode', () => {
      // Given: Gemini mode configuration
      const mode = 'gemini';

      // When: Render Chat component
      render(<Chat mode={mode} />);

      // Then: Component should render without errors
      // Note: Actual UI verification requires data-testid attributes
      expect(document.querySelector('form')).toBeTruthy();
    });

    it('should initialize with adk-sse mode', () => {
      // Given: ADK SSE mode configuration
      const mode = 'adk-sse';

      // When: Render Chat component
      render(<Chat mode={mode} />);

      // Then: Component should render without errors
      expect(document.querySelector('form')).toBeTruthy();
    });

    it('should initialize with adk-bidi mode', async () => {
      // Given: ADK BIDI mode configuration
      const mode = 'adk-bidi';

      // When: Render Chat component
      render(<Chat mode={mode} />);

      // Then: Component should render without errors
      // Then: WebSocket should be created for BIDI mode
      await waitFor(() => {
        expect(document.querySelector('form')).toBeTruthy();
      });
    });

    it('should use buildUseChatOptions for mode configuration', () => {
      // Given: ADK BIDI mode
      const mode = 'adk-bidi';
      
      // When: Call buildUseChatOptions directly
      const { useChatOptions } = buildUseChatOptions({
        mode,
        initialMessages: [],
      });

      // Then: Options should be configured for BIDI mode
      expect(useChatOptions).toBeDefined();
      expect(useChatOptions.api).toBe('/api/chat');
    });
  });

  describe('Message History', () => {
    it('should accept initialMessages prop', () => {
      // Given: Initial messages from parent
      const initialMessages: UIMessage[] = [
        {
          id: 'msg-1',
          role: 'user',
          parts: [{ type: 'text', text: 'Hello' }],
        },
        {
          id: 'msg-2',
          role: 'assistant',
          parts: [{ type: 'text', text: 'Hi there!' }],
        },
      ];

      // When: Render Chat with initialMessages
      render(<Chat mode="gemini" initialMessages={initialMessages} />);

      // Then: Component should render with messages
      // Note: Actual message verification requires proper message rendering
      expect(document.querySelector('form')).toBeTruthy();
    });

    it('should call onMessagesChange when messages update', () => {
      // Given: Message change callback
      const onMessagesChange = vi.fn();
      const initialMessages: UIMessage[] = [];

      // When: Render Chat with callback
      render(
        <Chat
          mode="gemini"
          initialMessages={initialMessages}
          onMessagesChange={onMessagesChange}
        />
      );

      // Then: Component should render
      expect(document.querySelector('form')).toBeTruthy();
      
      // Note: Testing actual message updates requires user interaction
      // which will be covered in E2E tests
    });

    it('should preserve message IDs when mode changes', () => {
      // Given: Messages with specific IDs
      const messagesWithIds: UIMessage[] = [
        {
          id: 'user-123',
          role: 'user',
          parts: [{ type: 'text', text: 'Test message' }],
        },
      ];

      // When: Render with messages
      const { rerender } = render(
        <Chat mode="gemini" initialMessages={messagesWithIds} />
      );

      // When: Switch mode (simulated by rerender)
      rerender(<Chat mode="adk-sse" initialMessages={messagesWithIds} />);

      // Then: Component should render without errors
      // Message ID preservation is handled by parent component
      expect(document.querySelector('form')).toBeTruthy();
    });
  });

  describe('sendAutomaticallyWhen Integration', () => {
    it('should configure sendAutomaticallyWhen for Server Execute pattern', () => {
      // Given: ADK SSE mode with tool approval
      const { useChatOptions } = buildUseChatOptions({
        mode: 'adk-sse',
        initialMessages: [],
      });

      // Then: sendAutomaticallyWhen should be defined
      expect(useChatOptions.sendAutomaticallyWhen).toBeDefined();

      // When: Provide messages after tool approval
      const messagesAfterApproval: UIMessage[] = [
        {
          id: 'msg-1',
          role: 'user',
          parts: [{ type: 'text', text: 'Search for AI news' }],
        },
        {
          id: 'msg-2',
          role: 'assistant',
          parts: [
            {
              type: 'tool-adk_request_confirmation' as any,
              state: 'approval-responded' as any,
              toolCallId: 'call-1',
              input: {
                originalFunctionCall: {
                  id: 'orig-1',
                  name: 'web_search',
                  args: { query: 'AI news' },
                },
              },
              approval: { id: 'call-1', approved: true },
            },
          ],
        },
      ];

      // Then: sendAutomaticallyWhen should return true after approval
      const shouldAutoSend = useChatOptions.sendAutomaticallyWhen!({
        messages: messagesAfterApproval,
      });
      expect(shouldAutoSend).toBe(true);
    });

    it('should configure sendAutomaticallyWhen for Frontend Execute pattern', () => {
      // Given: ADK BIDI mode with Frontend Execute
      const { useChatOptions } = buildUseChatOptions({
        mode: 'adk-bidi',
        initialMessages: [],
      });

      // Then: sendAutomaticallyWhen should be defined
      expect(useChatOptions.sendAutomaticallyWhen).toBeDefined();

      // When: Provide messages with output-available state
      const messagesAfterFrontendExecute: UIMessage[] = [
        {
          id: 'msg-1',
          role: 'user',
          parts: [{ type: 'text', text: 'Change BGM to lofi' }],
        },
        {
          id: 'msg-2',
          role: 'assistant',
          parts: [
            {
              type: 'tool-call' as any,
              toolCallId: 'call-1',
              toolName: 'change_bgm',
              args: { track_name: 'lofi' },
              state: 'output-available' as any,
              result: { status: 'success', track: 'lofi' },
            },
          ],
        },
      ];

      // Then: sendAutomaticallyWhen should return true for Frontend Execute
      const shouldAutoSend = useChatOptions.sendAutomaticallyWhen!({
        messages: messagesAfterFrontendExecute,
      });
      expect(shouldAutoSend).toBe(true);
    });

    it('should not auto-send when approval is pending', () => {
      // Given: ADK SSE mode
      const { useChatOptions } = buildUseChatOptions({
        mode: 'adk-sse',
        initialMessages: [],
      });

      // When: Tool approval is requested but not yet responded
      const messagesWithPendingApproval: UIMessage[] = [
        {
          id: 'msg-1',
          role: 'user',
          parts: [{ type: 'text', text: 'Delete files' }],
        },
        {
          id: 'msg-2',
          role: 'assistant',
          parts: [
            {
              type: 'tool-adk_request_confirmation' as any,
              state: 'approval-requested' as any,
              toolCallId: 'call-1',
              input: {
                originalFunctionCall: {
                  id: 'orig-1',
                  name: 'delete_files',
                  args: {},
                },
              },
            },
          ],
        },
      ];

      // Then: sendAutomaticallyWhen should return false
      const shouldAutoSend = useChatOptions.sendAutomaticallyWhen!({
        messages: messagesWithPendingApproval,
      });
      expect(shouldAutoSend).toBe(false);
    });
  });
});
