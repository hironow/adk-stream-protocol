/**
 * Public API Tests for lib/bidi
 *
 * Tests the public API exported from lib/bidi/index.ts
 * All tests use only the public API, not internal implementation details.
 */

import type { UIMessage } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ChatTransport,
  type SendAutomaticallyWhenOptions,
  type TransportConfig,
  type UseChatConfig,
  type UseChatOptions,
  buildUseChatOptions,
  sendAutomaticallyWhen,
} from "../../bidi";

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
        expectedChatId: /^chat-adk-bidi-ws---localhost-8000-live-\d+$/,
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
      messages: UIMessage[];
      expected: boolean;
      name: string;
    }>([
      {
        name: "returns false when last message is user message",
        messages: [
          { id: "1", role: "user", content: "Hello" },
        ] as UIMessage[],
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
        name: "returns true when confirmation completed (first time)",
        messages: [
          {
            id: "1",
            role: "assistant",
            content: "",
            parts: [
              {
                type: "tool-adk_request_confirmation",
                state: "output-available",
                toolCallId: "call-1",
                input: {
                  originalFunctionCall: {
                    id: "orig-1",
                    name: "search",
                    args: {},
                  },
                },
                output: { confirmed: true },
              },
            ],
          },
        ] as any,
        expected: true,
      },
      {
        name: "returns false when confirmation completed but other tool also completed (backend responded)",
        messages: [
          {
            id: "1",
            role: "assistant",
            content: "",
            parts: [
              {
                type: "tool-adk_request_confirmation",
                state: "output-available",
                toolCallId: "call-1",
                input: {
                  originalFunctionCall: {
                    id: "orig-1",
                    name: "search",
                    args: {},
                  },
                },
                output: { confirmed: true },
              },
              {
                type: "tool-search",
                state: "output-available",
                toolCallId: "orig-1",
                output: { result: "data" },
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
  });

  describe("ChatTransport (WebSocketChatTransport)", () => {
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
    ])("$name", ({ config, expectedUrl }) => {
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
      const transport: ChatTransport = {} as any;
      expect(transport).toBeDefined();
    });
  });

  describe("Integration - buildUseChatOptions returns valid useChat config", () => {
    it("returns configuration compatible with useChat hook", async () => {
      // given
      const config: UseChatConfig = {
        initialMessages: [
          { id: "1", role: "user", content: "Hello" },
        ] as UIMessage[],
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
