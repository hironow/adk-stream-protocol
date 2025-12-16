/**
 * Build useChat Options Unit Tests
 *
 * Tests the configuration builder for AI SDK v6 useChat hook.
 * Verifies that each backend mode (Gemini Direct, ADK SSE, ADK BIDI)
 * gets correct transport and configuration.
 *
 * Focus areas:
 * - Correct transport type for each mode (DefaultChatTransport vs WebSocketChatTransport)
 * - Correct API endpoint generation
 * - Correct chatId generation
 * - Tool approval callback integration (ADK BIDI only)
 * - AudioContext integration (ADK BIDI only)
 * - Invalid configuration prevention
 */

import type { UIMessage } from "ai";
import { describe, expect, it, vi } from "vitest";
import {
  type BackendMode,
  buildUseChatOptions,
} from "./build-use-chat-options";

describe("buildUseChatOptions", () => {
  const initialMessages: UIMessage[] = [
    {
      id: "msg-1",
      role: "user",
      content: "Hello",
    },
  ];

  describe("Gemini Direct Mode", () => {
    it("should create DefaultChatTransport for gemini mode", () => {
      // Given: Gemini Direct mode
      const mode: BackendMode = "gemini";

      // When: Building options
      const result = buildUseChatOptions({
        mode,
        initialMessages,
      });

      // Then: Should use ChunkLoggingTransport (wrapping DefaultChatTransport)
      expect(result.useChatOptions.transport).toBeDefined();
      expect(result.useChatOptions.transport.constructor.name).toBe(
        "ChunkLoggingTransport",
      );
      expect(result.transport).toBeUndefined();
    });

    it("should generate correct chatId for gemini mode", () => {
      // Given: Gemini Direct mode
      const mode: BackendMode = "gemini";

      // When: Building options
      const result = buildUseChatOptions({
        mode,
        initialMessages,
      });

      // Then: chatId should include mode and endpoint hash
      expect(result.useChatOptions.id).toMatch(/^chat-gemini-/);
      expect(result.useChatOptions.id).toContain("api-chat");
    });

    it("should include initial messages", () => {
      // Given: Gemini Direct mode with messages
      const mode: BackendMode = "gemini";

      // When: Building options
      const result = buildUseChatOptions({
        mode,
        initialMessages,
      });

      // Then: Messages should be preserved
      expect(result.useChatOptions.messages).toEqual(initialMessages);
    });

    it("should generate unique chatId when forceNewInstance is true", async () => {
      // Given: Gemini Direct mode with forceNewInstance
      const mode: BackendMode = "gemini";

      // When: Building options twice with slight delay to ensure different timestamps
      const result1 = buildUseChatOptions({
        mode,
        initialMessages,
        forceNewInstance: true,
      });

      // Small delay to ensure Date.now() returns different value
      await new Promise((resolve) => setTimeout(resolve, 2));

      const result2 = buildUseChatOptions({
        mode,
        initialMessages,
        forceNewInstance: true,
      });

      // Then: chatIds should be different
      expect(result1.useChatOptions.id).not.toBe(result2.useChatOptions.id);
    });

    it("should generate same chatId when forceNewInstance is false", () => {
      // Given: Gemini Direct mode without forceNewInstance
      const mode: BackendMode = "gemini";

      // When: Building options twice
      const result1 = buildUseChatOptions({
        mode,
        initialMessages,
        forceNewInstance: false,
      });

      const result2 = buildUseChatOptions({
        mode,
        initialMessages,
        forceNewInstance: false,
      });

      // Then: chatIds should be the same
      expect(result1.useChatOptions.id).toBe(result2.useChatOptions.id);
    });
  });

  describe("ADK SSE Mode", () => {
    it("should create DefaultChatTransport for adk-sse mode", () => {
      // Given: ADK SSE mode
      const mode: BackendMode = "adk-sse";

      // When: Building options
      const result = buildUseChatOptions({
        mode,
        initialMessages,
        adkBackendUrl: "http://localhost:8000",
      });

      // Then: Should use ChunkLoggingTransport (wrapping DefaultChatTransport)
      expect(result.useChatOptions.transport).toBeDefined();
      expect(result.useChatOptions.transport.constructor.name).toBe(
        "ChunkLoggingTransport",
      );
      expect(result.transport).toBeUndefined();
    });

    it("should generate correct chatId for adk-sse mode", () => {
      // Given: ADK SSE mode
      const mode: BackendMode = "adk-sse";

      // When: Building options
      const result = buildUseChatOptions({
        mode,
        initialMessages,
        adkBackendUrl: "http://localhost:8000",
      });

      // Then: chatId should include mode and endpoint hash
      expect(result.useChatOptions.id).toMatch(/^chat-adk-sse-/);
      expect(result.useChatOptions.id).toContain("localhost-8000-stream");
    });

    it("should use custom adkBackendUrl", () => {
      // Given: ADK SSE mode with custom backend URL
      const mode: BackendMode = "adk-sse";
      const customUrl = "http://backend.example.com:3000";

      // When: Building options
      const result = buildUseChatOptions({
        mode,
        initialMessages,
        adkBackendUrl: customUrl,
      });

      // Then: chatId should reflect custom URL
      expect(result.useChatOptions.id).toContain("backend-example-com-3000");
    });
  });

  describe("ADK BIDI Mode", () => {
    it("should create WebSocketChatTransport for adk-bidi mode", () => {
      // Given: ADK BIDI mode
      const mode: BackendMode = "adk-bidi";

      // When: Building options
      const result = buildUseChatOptions({
        mode,
        initialMessages,
        adkBackendUrl: "http://localhost:8000",
      });

      // Then: Should use WebSocketChatTransport
      expect(result.useChatOptions.transport).toBeDefined();
      expect(result.useChatOptions.transport.constructor.name).toBe(
        "WebSocketChatTransport",
      );
      // Transport reference should be returned for imperative control
      expect(result.transport).toBe(result.useChatOptions.transport);
    });

    it("should generate correct chatId for adk-bidi mode", () => {
      // Given: ADK BIDI mode
      const mode: BackendMode = "adk-bidi";

      // When: Building options
      const result = buildUseChatOptions({
        mode,
        initialMessages,
        adkBackendUrl: "http://localhost:8000",
      });

      // Then: chatId should include mode and endpoint hash
      // Format: chat-adk-bidi-ws---localhost-8000-live (: and / become -)
      expect(result.useChatOptions.id).toMatch(/^chat-adk-bidi-/);
      expect(result.useChatOptions.id).toContain("ws---localhost");
      expect(result.useChatOptions.id).toContain("8000-live");
    });

    it("should convert http to ws in WebSocket URL", () => {
      // Given: ADK BIDI mode with http URL
      const mode: BackendMode = "adk-bidi";

      // When: Building options
      const result = buildUseChatOptions({
        mode,
        initialMessages,
        adkBackendUrl: "http://localhost:8000",
      });

      // Then: chatId should contain ws protocol (: and / become -)
      expect(result.useChatOptions.id).toContain("ws---localhost");
    });

    it("should convert https to wss in WebSocket URL", () => {
      // Given: ADK BIDI mode with https URL
      const mode: BackendMode = "adk-bidi";

      // When: Building options
      const result = buildUseChatOptions({
        mode,
        initialMessages,
        adkBackendUrl: "https://backend.example.com",
      });

      // Then: chatId should reflect wss protocol (: and / become -)
      expect(result.useChatOptions.id).toContain("wss---backend");
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

      // Then: Transport should be created (implementation receives audioContext internally)
      expect(result.transport).toBeDefined();
      expect(result.transport?.constructor.name).toBe("WebSocketChatTransport");
    });
  });

  describe("Configuration Validation", () => {
    it("should not mix gemini mode with WebSocketChatTransport", () => {
      // Given: Gemini Direct mode
      const mode: BackendMode = "gemini";

      // When: Building options
      const result = buildUseChatOptions({
        mode,
        initialMessages,
      });

      // Then: Should NOT use WebSocketChatTransport
      expect(result.useChatOptions.transport.constructor.name).not.toBe(
        "WebSocketChatTransport",
      );
      expect(result.transport).toBeUndefined();
    });

    it("should not mix adk-sse mode with WebSocketChatTransport", () => {
      // Given: ADK SSE mode
      const mode: BackendMode = "adk-sse";

      // When: Building options
      const result = buildUseChatOptions({
        mode,
        initialMessages,
        adkBackendUrl: "http://localhost:8000",
      });

      // Then: Should NOT use WebSocketChatTransport
      expect(result.useChatOptions.transport.constructor.name).not.toBe(
        "WebSocketChatTransport",
      );
      expect(result.transport).toBeUndefined();
    });

    it("should only use WebSocketChatTransport for adk-bidi mode", () => {
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

      // Then: Only adk-bidi should use WebSocketChatTransport
      expect(results[0].useChatOptions.transport.constructor.name).toBe(
        "ChunkLoggingTransport",
      ); // gemini (wrapped DefaultChatTransport)
      expect(results[1].useChatOptions.transport.constructor.name).toBe(
        "ChunkLoggingTransport",
      ); // adk-sse (wrapped DefaultChatTransport)
      expect(results[2].useChatOptions.transport.constructor.name).toBe(
        "WebSocketChatTransport",
      ); // adk-bidi
    });

    it("should generate different chatIds for different modes", () => {
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

      // Then: All chatIds should be different
      const chatIds = results.map((r) => r.useChatOptions.id);
      const uniqueChatIds = new Set(chatIds);
      expect(uniqueChatIds.size).toBe(3);
    });

    it("should generate different chatIds for different backend URLs", () => {
      // Given: Same mode with different URLs
      const mode: BackendMode = "adk-sse";
      const url1 = "http://localhost:8000";
      const url2 = "http://localhost:9000";

      // When: Building options with different URLs
      const result1 = buildUseChatOptions({
        mode,
        initialMessages,
        adkBackendUrl: url1,
      });

      const result2 = buildUseChatOptions({
        mode,
        initialMessages,
        adkBackendUrl: url2,
      });

      // Then: chatIds should be different
      expect(result1.useChatOptions.id).not.toBe(result2.useChatOptions.id);
    });
  });

  describe("Tool Approval Auto-Submission", () => {
    // RED Phase: This test should FAIL initially
    // Verifies that sendAutomaticallyWhen is configured for automatic tool approval submission

    // SKIPPED: sendAutomaticallyWhen removed due to AI SDK v6 beta bug
    // Manual send pattern implemented instead (see experiments/2025-12-16_manual_send_tool_approval_design.md)
    // Tool approval now triggers manual sendMessage() call with 100ms timeout
    it.skip("should configure sendAutomaticallyWhen for ADK BIDI mode", () => {
      // Given: ADK BIDI mode (supports tool approval)
      const mode: BackendMode = "adk-bidi";
      const adkBackendUrl = "http://localhost:8000";

      // When: Building options
      const result = buildUseChatOptions({
        mode,
        adkBackendUrl,
        initialMessages,
      });

      // Then: sendAutomaticallyWhen should be configured
      // This enables automatic message resubmission after tool approval
      expect(result.useChatOptions.sendAutomaticallyWhen).toBeDefined();
      expect(typeof result.useChatOptions.sendAutomaticallyWhen).toBe(
        "function",
      );
    });

    // SKIPPED: sendAutomaticallyWhen removed due to AI SDK v6 beta bug
    // Manual send pattern implemented instead (see experiments/2025-12-16_manual_send_tool_approval_design.md)
    // Tool approval now triggers manual sendMessage() call with 100ms timeout
    it.skip("should configure sendAutomaticallyWhen for ADK SSE mode", () => {
      // Given: ADK SSE mode (supports tool approval)
      const mode: BackendMode = "adk-sse";
      const adkBackendUrl = "http://localhost:8000";

      // When: Building options
      const result = buildUseChatOptions({
        mode,
        adkBackendUrl,
        initialMessages,
      });

      // Then: sendAutomaticallyWhen should be configured
      expect(result.useChatOptions.sendAutomaticallyWhen).toBeDefined();
      expect(typeof result.useChatOptions.sendAutomaticallyWhen).toBe(
        "function",
      );
    });

    it("should NOT configure sendAutomaticallyWhen for Gemini mode", () => {
      // Given: Gemini Direct mode (no tool approval support)
      const mode: BackendMode = "gemini";

      // When: Building options
      const result = buildUseChatOptions({
        mode,
        initialMessages,
      });

      // Then: sendAutomaticallyWhen should be undefined
      // Gemini mode doesn't use our tool approval flow
      expect(result.useChatOptions.sendAutomaticallyWhen).toBeUndefined();
    });
  });
});
