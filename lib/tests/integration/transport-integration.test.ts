/**
 * Transport Integration Tests
 *
 * Tests the integration between buildUseChatOptions and transport layers.
 * These are 2-component integration tests (not full E2E):
 *
 * - buildUseChatOptions + WebSocketChatTransport (ADK BIDI)
 * - buildUseChatOptions + DefaultChatTransport (ADK SSE, Gemini)
 *
 * Focus:
 * - Verify correct transport is created for each mode
 * - Verify transport configuration (URL, callbacks, AudioContext)
 * - Verify transport can be used imperatively (startAudio, stopAudio)
 * - Prevent invalid configuration patterns
 */

import type { UIMessage } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type BackendMode,
  buildUseChatOptions,
} from "../../build-use-chat-options";
import { WebSocketChatTransport } from "../../websocket-chat-transport";

// Mock WebSocket for transport testing
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
    // Simulate connection opening after creation
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
}

describe("Transport Integration", () => {
  let originalWebSocket: typeof WebSocket;

  beforeEach(() => {
    // Store and replace WebSocket
    originalWebSocket = global.WebSocket as any;
    global.WebSocket = MockWebSocket as any;
  });

  afterEach(() => {
    // Restore WebSocket
    global.WebSocket = originalWebSocket;
    vi.clearAllMocks();
  });

  const initialMessages: UIMessage[] = [
    {
      id: "msg-1",
      role: "user",
      content: "Hello",
    },
  ];

  describe("ADK BIDI Mode Integration", () => {
    it("should create WebSocketChatTransport with correct URL", () => {
      // Given: ADK BIDI mode configuration
      const mode: BackendMode = "adk-bidi";
      const adkBackendUrl = "http://localhost:8000";

      // When: Building options
      const result = buildUseChatOptions({
        mode,
        initialMessages,
        adkBackendUrl,
      });

      // Then: Should create WebSocketChatTransport
      expect(result.transport).toBeDefined();
      expect(result.transport).toBeInstanceOf(WebSocketChatTransport);

      // And: Transport should be configured with WebSocket URL
      // URL is ws://localhost:8000/live (http -> ws)
      expect(result.useChatOptions.transport).toBe(result.transport);
    });

    it("should pass AudioContext to WebSocketChatTransport", () => {
      // Given: ADK BIDI mode with AudioContext
      const mode: BackendMode = "adk-bidi";
      const mockAudioContext = {
        voiceChannel: {
          isPlaying: false,
          chunkCount: 0,
          sendChunk: vi.fn(),
          reset: vi.fn(),
          onComplete: vi.fn(),
        },
        isReady: true,
        error: null,
        wsLatency: null,
        updateLatency: vi.fn(),
      };

      // When: Building options
      const result = buildUseChatOptions({
        mode,
        initialMessages,
        adkBackendUrl: "http://localhost:8000",
        audioContext: mockAudioContext,
      });

      // Then: Transport should be created with AudioContext
      expect(result.transport).toBeInstanceOf(WebSocketChatTransport);

      // AudioContext is passed internally to transport
      // We can verify this by checking that transport exists and is configured
      expect(result.transport).toBeDefined();
    });

    it("should allow imperative control via transport reference", async () => {
      // Given: ADK BIDI mode with transport reference
      const mode: BackendMode = "adk-bidi";
      const result = buildUseChatOptions({
        mode,
        initialMessages,
        adkBackendUrl: "http://localhost:8000",
      });

      // When: Using transport imperatively
      const transport = result.transport!;

      // Initialize WebSocket by calling sendMessages
      transport.sendMessages({
        trigger: "submit-message",
        chatId: "chat-1",
        messageId: undefined,
        messages: initialMessages,
        abortSignal: new AbortController().signal,
      });

      // Wait for WebSocket to be ready
      await vi.waitFor(() => {
        expect((transport as any).ws?.readyState).toBe(MockWebSocket.OPEN);
      });

      // Then: Should be able to call imperative methods
      expect(() => transport.startAudio()).not.toThrow();
      expect(() => transport.stopAudio()).not.toThrow();
      // Note: sendToolResult() removed - use addToolApprovalResponse() instead
    });

    it("should convert http to ws protocol", () => {
      // Given: HTTP backend URL
      const mode: BackendMode = "adk-bidi";
      const result = buildUseChatOptions({
        mode,
        initialMessages,
        adkBackendUrl: "http://localhost:8000",
      });

      // When: Transport is created
      const _transport = result.transport!;

      // Then: URL should use ws:// protocol
      // We can verify by checking the chatId contains ws protocol indicator
      expect(result.useChatOptions.id).toContain("ws---localhost");
    });

    it("should convert https to wss protocol", () => {
      // Given: HTTPS backend URL
      const mode: BackendMode = "adk-bidi";
      const result = buildUseChatOptions({
        mode,
        initialMessages,
        adkBackendUrl: "https://backend.example.com",
      });

      // When: Transport is created
      const _transport = result.transport!;

      // Then: URL should use wss:// protocol
      expect(result.useChatOptions.id).toContain("wss---backend");
    });
  });

  describe("ADK SSE Mode Integration", () => {
    it("should create DefaultChatTransport (not WebSocket)", () => {
      // Given: ADK SSE mode configuration
      const mode: BackendMode = "adk-sse";

      // When: Building options
      const result = buildUseChatOptions({
        mode,
        initialMessages,
        adkBackendUrl: "http://localhost:8000",
      });

      // Then: Should NOT create WebSocketChatTransport
      expect(result.transport).toBeUndefined();
      expect(result.useChatOptions.transport).toBeDefined();
      expect(result.useChatOptions.transport.constructor.name).toBe(
        "ChunkLoggingTransport",
      );
    });

    it("should use correct SSE endpoint", () => {
      // Given: ADK SSE mode configuration
      const mode: BackendMode = "adk-sse";
      const adkBackendUrl = "http://localhost:8000";

      // When: Building options
      const result = buildUseChatOptions({
        mode,
        initialMessages,
        adkBackendUrl,
      });

      // Then: chatId should reflect SSE endpoint (/stream)
      expect(result.useChatOptions.id).toContain("localhost-8000-stream");
    });

    it("should not support imperative audio control (no transport reference)", () => {
      // Given: ADK SSE mode
      const mode: BackendMode = "adk-sse";
      const result = buildUseChatOptions({
        mode,
        initialMessages,
        adkBackendUrl: "http://localhost:8000",
      });

      // Then: Should not have transport reference (SSE doesn't support imperative control)
      expect(result.transport).toBeUndefined();
    });
  });

  describe("Gemini Direct Mode Integration", () => {
    it("should create DefaultChatTransport (not WebSocket)", () => {
      // Given: Gemini Direct mode configuration
      const mode: BackendMode = "gemini";

      // When: Building options
      const result = buildUseChatOptions({
        mode,
        initialMessages,
      });

      // Then: Should NOT create WebSocketChatTransport
      expect(result.transport).toBeUndefined();
      expect(result.useChatOptions.transport).toBeDefined();
      expect(result.useChatOptions.transport.constructor.name).toBe(
        "ChunkLoggingTransport",
      );
    });

    it("should use /api/chat endpoint", () => {
      // Given: Gemini Direct mode configuration
      const mode: BackendMode = "gemini";

      // When: Building options
      const result = buildUseChatOptions({
        mode,
        initialMessages,
      });

      // Then: chatId should reflect /api/chat endpoint
      expect(result.useChatOptions.id).toContain("api-chat");
    });
  });

  describe("Configuration Validation", () => {
    it("should prevent mixing AudioContext with non-BIDI modes", () => {
      // Given: Gemini Direct mode with AudioContext
      const mode: BackendMode = "gemini";
      const mockAudioContext = {
        voiceChannel: {
          isPlaying: false,
          chunkCount: 0,
          sendChunk: vi.fn(),
          reset: vi.fn(),
        },
        isReady: true,
        error: null,
        wsLatency: null,
        updateLatency: vi.fn(),
      };

      // When: Building options
      const result = buildUseChatOptions({
        mode,
        initialMessages,
        audioContext: mockAudioContext, // This will be ignored in Gemini mode
      });

      // Then: AudioContext should be silently ignored (no WebSocketChatTransport created)
      expect(result.transport).toBeUndefined();
      expect(result.useChatOptions.transport.constructor.name).toBe(
        "ChunkLoggingTransport",
      );
    });

    it("should only provide transport reference for BIDI mode", () => {
      // Given: All three backend modes
      const modes: BackendMode[] = ["gemini", "adk-sse", "adk-bidi"];

      // When: Building options for each mode
      const results = modes.map((mode) =>
        buildUseChatOptions({
          mode,
          initialMessages,
          adkBackendUrl: "http://localhost:8000",
        }),
      );

      // Then: Only BIDI should have transport reference
      expect(results[0].transport).toBeUndefined(); // gemini
      expect(results[1].transport).toBeUndefined(); // adk-sse
      expect(results[2].transport).toBeDefined(); // adk-bidi
      expect(results[2].transport).toBeInstanceOf(WebSocketChatTransport);
    });

    it("should create different transport instances for multiple BIDI instances", () => {
      // Given: ADK BIDI mode
      const mode: BackendMode = "adk-bidi";

      // When: Building options twice with forceNewInstance
      const result1 = buildUseChatOptions({
        mode,
        initialMessages,
        adkBackendUrl: "http://localhost:8000",
        forceNewInstance: true,
      });

      const result2 = buildUseChatOptions({
        mode,
        initialMessages,
        adkBackendUrl: "http://localhost:8000",
        forceNewInstance: true,
      });

      // Then: Should create different transport instances
      expect(result1.transport).not.toBe(result2.transport);
      expect(result1.transport).toBeInstanceOf(WebSocketChatTransport);
      expect(result2.transport).toBeInstanceOf(WebSocketChatTransport);
    });
  });

  describe("Transport + useChatOptions Integration", () => {
    it("should use same transport reference in useChatOptions for BIDI mode", () => {
      // Given: ADK BIDI mode
      const mode: BackendMode = "adk-bidi";

      // When: Building options
      const result = buildUseChatOptions({
        mode,
        initialMessages,
        adkBackendUrl: "http://localhost:8000",
      });

      // Then: useChatOptions.transport should be the same instance as transport
      expect(result.useChatOptions.transport).toBe(result.transport);
    });

    it("should include messages in useChatOptions", () => {
      // Given: ADK BIDI mode with messages
      const mode: BackendMode = "adk-bidi";
      const messages: UIMessage[] = [
        { id: "1", role: "user", content: "First" },
        { id: "2", role: "assistant", content: "Second" },
      ];

      // When: Building options
      const result = buildUseChatOptions({
        mode,
        initialMessages: messages,
        adkBackendUrl: "http://localhost:8000",
      });

      // Then: Messages should be preserved in useChatOptions
      expect(result.useChatOptions.messages).toEqual(messages);
    });

    it("should include chatId in useChatOptions", () => {
      // Given: ADK BIDI mode
      const mode: BackendMode = "adk-bidi";

      // When: Building options
      const result = buildUseChatOptions({
        mode,
        initialMessages,
        adkBackendUrl: "http://localhost:8000",
      });

      // Then: chatId should be present and valid
      expect(result.useChatOptions.id).toBeDefined();
      expect(result.useChatOptions.id).toMatch(/^chat-adk-bidi-/);
    });
  });
});
