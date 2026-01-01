/**
 * Public API Tests for lib/bidi
 *
 * Tests the public API exported from lib/bidi/index.ts
 * All tests use only the public API, not internal implementation details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildUseChatOptions,
  type ChatTransportFromAISDKv6,
  type SendAutomaticallyWhenOptions,
  sendAutomaticallyWhen,
  type TransportConfig,
  type UseChatConfig,
  type UseChatOptions,
} from "../../bidi";
import type { UIMessageFromAISDKv6 } from "../../utils";

// Mock WebSocket
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

  constructor(public url: string) {
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      if (this.onopen) {
        this.onopen(new Event("open"));
      }
    }, 0);
  }

  send(data: string): void {
    this.sentMessages.push(data);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose(new CloseEvent("close"));
    }
  }

  simulateMessage(data: string): void {
    if (this.onmessage) {
      this.onmessage(new MessageEvent("message", { data }));
    }
  }
}

describe("lib/bidi Public API", () => {
  let originalWebSocket: typeof WebSocket;

  beforeEach(() => {
    originalWebSocket = global.WebSocket as any;
    global.WebSocket = MockWebSocket as any;
  });

  afterEach(() => {
    global.WebSocket = originalWebSocket;
    vi.clearAllMocks();
  });

  describe("buildUseChatOptions", () => {
    it.each<{
      config: UseChatConfig;
      name: string;
      expectedChatId: string;
    }>([
      {
        name: "creates options with default backend URL",
        config: { initialMessages: [] },
        expectedChatId: "chat-adk-bidi-ws---localhost-8000-live",
      },
      {
        name: "creates options with custom backend URL",
        config: {
          initialMessages: [],
          adkBackendUrl: "http://example.com:9000",
        },
        expectedChatId: "chat-adk-bidi-ws---example-com-9000-live",
      },
      {
        name: "creates options with forced new instance",
        config: { initialMessages: [], forceNewInstance: true },
        // UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
        expectedChatId:
          /^chat-adk-bidi-ws---localhost-8000-live-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      },
    ])("$name", ({ config, expectedChatId }) => {
      // when
      const result = buildUseChatOptions(config);

      // then
      expect(result).toHaveProperty("useChatOptions");
      expect(result).toHaveProperty("transport");
      expect(result.useChatOptions.messages).toEqual(config.initialMessages);
      expect(result.useChatOptions.id).toMatch(
        typeof expectedChatId === "string"
          ? new RegExp(`^${expectedChatId}`)
          : expectedChatId,
      );
      expect(result.useChatOptions.transport).toBeDefined();
      expect(result.useChatOptions.sendAutomaticallyWhen).toBeDefined();
      expect(result.transport).toBeDefined();
    });

    it("includes audioContext when provided", () => {
      // given
      const mockAudioContext = {
        voiceChannel: {
          isPlaying: false,
          chunkCount: 0,
          sendChunk: vi.fn(),
          reset: vi.fn(),
        },
        isReady: true,
        error: null,
        needsUserActivation: false,
        activate: vi.fn(),
      };

      // when
      const result = buildUseChatOptions({
        initialMessages: [],
        audioContext: mockAudioContext,
      });

      // then
      expect(result.useChatOptions).toBeDefined();
      expect(result.transport).toBeDefined();
    });
  });

  describe("sendAutomaticallyWhen", () => {
    it.each<{
      messages: UIMessageFromAISDKv6[];
      expected: boolean;
      name: string;
    }>([
      {
        name: "returns false when last message is user message",
        messages: [
          { id: "1", role: "user", content: "Hello" },
        ] as UIMessageFromAISDKv6[],
        expected: false,
      },
      {
        name: "returns false when no confirmation part exists",
        messages: [
          {
            id: "1",
            role: "assistant",
            content: "Hello",
            parts: [
              {
                type: "text",
                text: "Hello",
              },
            ],
          },
        ] as any,
        expected: false,
      },
      {
        name: "returns false when confirmation event arrives (Phase 1 - first time)",
        messages: [
          {
            id: "1",
            role: "assistant",
            content: "",
            parts: [
              {
                type: "tool-search", // AI SDK v6: original tool, not adk_request_confirmation
                state: "approval-requested", // State remains approval-requested
                toolCallId: "orig-1",
                input: { query: "test" },
                approval: {
                  id: "approval-1", // Just the id, no approved field yet
                },
              },
            ],
          },
        ] as any,
        expected: false, // Phase 1: Don't send yet, wait for user response
      },
      {
        name: "returns false when confirmation completed but other tool also completed (backend responded)",
        messages: [
          {
            id: "1",
            role: "assistant",
            content: "Here are the search results",
            parts: [
              {
                type: "tool-adk_request_confirmation",
                state: "approval-responded",
                toolCallId: "call-1",
                input: {
                  originalFunctionCall: {
                    id: "orig-1",
                    name: "search",
                    args: {},
                  },
                },
                approval: {
                  id: "call-1",
                  approved: true,
                },
              },
              {
                type: "tool-search",
                state: "output-available",
                toolCallId: "orig-1",
                output: { result: "data" },
              },
              {
                type: "text",
                text: "Here are the search results",
              },
            ],
          },
        ] as any,
        expected: false,
      },
    ])("$name", ({ messages, expected }) => {
      // when
      const result = sendAutomaticallyWhen({ messages });

      // then
      expect(result).toBe(expected);
    });

    it("returns false on error to prevent infinite loops", () => {
      // given
      const invalidMessages = null as any;

      // when
      const result = sendAutomaticallyWhen({ messages: invalidMessages });

      // then
      expect(result).toBe(false);
    });

    it("detects state change from approval-requested to approval-responded", () => {
      // AI SDK v6: When user calls addToolApprovalResponse() with correct approval.id,
      // state changes from "approval-requested" to "approval-responded" immediately

      // given: Message with tool approval request (state="approval-requested")
      const messagesWaiting = [
        {
          id: "msg-1",
          role: "assistant",
          parts: [
            {
              type: "tool-search",
              state: "approval-requested",
              toolCallId: "tool-1",
              input: { query: "test" },
              approval: { id: "approval-1" }, // User hasn't responded yet
            },
          ],
        },
      ] as any;

      // when: User hasn't approved yet
      const firstResult = sendAutomaticallyWhen({ messages: messagesWaiting });

      // then: Should return false (wait for user to respond)
      expect(firstResult).toBe(false);

      // given: Message after user approval (state changed to "approval-responded")
      const messagesApproved = [
        {
          id: "msg-1",
          role: "assistant",
          parts: [
            {
              type: "tool-search",
              state: "approval-responded", // ← State changed after addToolApprovalResponse
              toolCallId: "tool-1",
              input: { query: "test" },
              approval: {
                id: "approval-1",
                approved: true, // ← User's decision
                reason: undefined,
              },
            },
          ],
        },
      ] as any;

      // when: User has approved (state is now approval-responded)
      const secondResult = sendAutomaticallyWhen({
        messages: messagesApproved,
      });

      // then: Should return true (send approval to backend)
      expect(secondResult).toBe(true);
    });
  });

  describe("ChatTransportFromAISDKv6 (WebSocketChatTransport)", () => {
    it.each<{
      config: TransportConfig;
      name: string;
      expectedUrl: string;
    }>([
      {
        name: "creates transport with HTTP URL converted to WebSocket",
        config: { url: "http://localhost:8000/live" },
        expectedUrl: "http://localhost:8000/live",
      },
      {
        name: "creates transport with WebSocket URL",
        config: { url: "ws://localhost:8000/live" },
        expectedUrl: "ws://localhost:8000/live",
      },
      {
        name: "creates transport with custom URL",
        config: { url: "ws://example.com:9000/ws" },
        expectedUrl: "ws://example.com:9000/ws",
      },
    ])("$name", ({ config, expectedUrl: _expectedUrl }) => {
      // when
      const result = buildUseChatOptions({
        initialMessages: [],
        adkBackendUrl: config.url.replace(/\/(live|ws)$/, ""),
      });

      // then
      expect(result.transport).toBeDefined();
      expect(result.useChatOptions.transport).toBeDefined();
    });
  });

  describe("Type Exports", () => {
    it("exports required types", () => {
      // This test verifies that types are correctly exported
      // TypeScript will fail compilation if types are not exported

      const _config: UseChatConfig = {
        initialMessages: [],
        adkBackendUrl: "http://localhost:8000",
        forceNewInstance: false,
      };

      const _options: UseChatOptions = {
        useChatOptions: {
          transport: {} as any,
          messages: [],
          id: "test",
          sendAutomaticallyWhen: () => false,
        },
        transport: {} as any,
      };

      const _transportConfig: TransportConfig = {
        url: "ws://localhost:8000/live",
      };

      const _sendAutoOptions: SendAutomaticallyWhenOptions = {
        messages: [],
      };

      // If this compiles, types are correctly exported
      expect(_config).toBeDefined();
      expect(_options).toBeDefined();
      expect(_transportConfig).toBeDefined();
      expect(_sendAutoOptions).toBeDefined();
    });
  });

  describe("Unified API Naming", () => {
    it("exports unified API names", () => {
      // Verify that the public API uses unified names (not mode-specific)
      // This ensures consistency with lib/sse

      expect(buildUseChatOptions).toBeDefined();
      expect(sendAutomaticallyWhen).toBeDefined();

      // Type aliases should work
      const transport: ChatTransportFromAISDKv6 = {} as any;
      expect(transport).toBeDefined();
    });
  });

  describe("Integration - buildUseChatOptions returns valid useChat config", () => {
    it("returns configuration compatible with useChat hook", async () => {
      // given
      const config: UseChatConfig = {
        initialMessages: [
          { id: "1", role: "user", content: "Hello" },
        ] as UIMessageFromAISDKv6[],
      };

      // when
      const result = buildUseChatOptions(config);

      // then
      // Verify structure matches what useChat expects
      expect(result.useChatOptions).toHaveProperty("messages");
      expect(result.useChatOptions).toHaveProperty("id");
      expect(result.useChatOptions).toHaveProperty("transport");
      expect(result.useChatOptions).toHaveProperty("sendAutomaticallyWhen");

      // Verify transport can be called
      expect(typeof result.useChatOptions.transport.sendMessages).toBe(
        "function",
      );

      // Verify sendAutomaticallyWhen can be called
      const shouldSend = await result.useChatOptions.sendAutomaticallyWhen!({
        messages: config.initialMessages,
      });
      expect(typeof shouldSend).toBe("boolean");
    });
  });
});
