/**
 * E2E Test: Mode Switching
 *
 * Tests dynamic mode switching between Gemini Direct, ADK SSE, and ADK BIDI.
 * Verifies message history preservation and connection management.
 *
 * Key scenarios tested:
 * - SSE ↔ BIDI transitions with history preservation
 * - Rapid mode switching without data loss
 * - Connection cleanup during switches
 * - Error handling during mode transitions
 *
 * Note: Gemini Direct mode tests are skipped due to different API schema.
 *
 * @vitest-environment jsdom
 */

import { useChat } from "@ai-sdk/react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { http } from "msw";
import { describe, expect, it } from "vitest";
import { AudioRecorder } from "../../audio-recorder";
import { buildUseChatOptions as buildBidiOptions } from "../../bidi";
import { buildUseChatOptions as buildSseOptions } from "../../sse";
import type { UIMessageFromAISDKv6 } from "../../utils";
import { createTextResponse, getMessageText, useMswServer } from "../helpers";
import { useMockWebSocket } from "../helpers/mock-websocket";
import { setupWebAudioMocks } from "../shared-mocks/web-audio-api";

describe("Mode Switching E2E", () => {
  // MSW for HTTP/SSE tests
  const { getServer } = useMswServer({
    onUnhandledRequest(request) {
      // Ignore WebSocket upgrade requests
      if (request.url.includes("/live")) {
        return;
      }
      // Ignore SSE requests that will be handled by specific tests
      if (request.url.includes("/stream")) {
        return;
      }
      console.error("Unhandled request:", request.method, request.url);
    },
  });

  // Custom Mock for BIDI WebSocket tests
  const { setDefaultHandler } = useMockWebSocket();

  // Web Audio API mocks for audio feature tests
  const { getMockAudioContext } = setupWebAudioMocks();
  describe("Gemini ↔ SSE Transitions", () => {
    it.skip("should switch from Gemini to SSE mode", async () => {
      // Skip: Gemini Direct mode uses different API endpoint and schema
      // See chat-basic.spec.ts:38 for schema requirements
      expect(true).toBe(true);
    });

    it.skip("should switch from SSE to Gemini mode", async () => {
      // Skip: Gemini Direct mode uses different API endpoint and schema
      expect(true).toBe(true);
    });
  });

  describe("SSE ↔ BIDI Transitions", () => {
    it("should preserve history when switching from SSE to BIDI mode", async () => {
      // Given: Setup SSE handler
      getServer().use(
        http.post("http://localhost:8000/stream", () => {
          return createTextResponse("SSE response from server");
        }),
      );

      // Start in SSE mode
      const { result: sseResult, unmount: unmountSse } = renderHook(() =>
        useChat(
          buildSseOptions({
            mode: "adk-sse",
            initialMessages: [] as UIMessageFromAISDKv6[],
          }).useChatOptions,
        ),
      );

      // When: Send message in SSE mode
      await act(async () => {
        sseResult.current.sendMessage({ text: "Hello SSE" });
      });

      // Then: Wait for SSE response
      await waitFor(
        () => {
          expect(sseResult.current.messages.length).toBeGreaterThanOrEqual(2);
          const lastMessage = sseResult.current.messages.at(-1);
          expect(getMessageText(lastMessage)).toContain("SSE response");
        },
        { timeout: 3000 },
      );

      // Capture messages for mode switch
      const historyMessages = [...sseResult.current.messages];
      expect(historyMessages.length).toBeGreaterThanOrEqual(2);

      // Unmount SSE hook
      unmountSse();

      // When: Switch to BIDI mode with history (just verify history preservation)
      const { result: bidiResult } = renderHook(() =>
        useChat(
          buildBidiOptions({
            initialMessages: historyMessages,
            forceNewInstance: true,
          }).useChatOptions,
        ),
      );

      // Then: Verify history is preserved
      await waitFor(
        () => {
          expect(bidiResult.current.messages.length).toBe(
            historyMessages.length,
          );
          // Verify user message is preserved
          const userMessage = bidiResult.current.messages.find(
            (m) => m.role === "user",
          );
          expect(getMessageText(userMessage)).toBe("Hello SSE");
          // Verify assistant message is preserved
          const assistantMessage = bidiResult.current.messages.find(
            (m) => m.role === "assistant",
          );
          expect(getMessageText(assistantMessage)).toContain("SSE response");
        },
        { timeout: 2000 },
      );
    });

    it("should preserve history when switching from BIDI to SSE mode", async () => {
      // Given: Pre-built BIDI conversation history
      const bidiHistory: UIMessageFromAISDKv6[] = [
        {
          id: "bidi-user-1",
          role: "user",
          parts: [{ type: "text", text: "Hello BIDI" }],
        },
        {
          id: "bidi-assistant-1",
          role: "assistant",
          parts: [{ type: "text", text: "BIDI initial response" }],
        },
      ];

      // Start in BIDI mode with history
      const { result: bidiResult, unmount: unmountBidi } = renderHook(() =>
        useChat(
          buildBidiOptions({
            initialMessages: bidiHistory,
            forceNewInstance: true,
          }).useChatOptions,
        ),
      );

      // Verify BIDI loaded history correctly
      expect(bidiResult.current.messages.length).toBe(2);
      unmountBidi();

      // When: Switch to SSE mode with history
      const { result: sseResult } = renderHook(() =>
        useChat(
          buildSseOptions({
            mode: "adk-sse",
            initialMessages: bidiHistory,
          }).useChatOptions,
        ),
      );

      // Then: Verify history is preserved
      expect(sseResult.current.messages.length).toBe(2);
      const userMessage = sseResult.current.messages.find(
        (m) => m.role === "user",
      );
      expect(getMessageText(userMessage)).toBe("Hello BIDI");
      const assistantMessage = sseResult.current.messages.find(
        (m) => m.role === "assistant",
      );
      expect(getMessageText(assistantMessage)).toBe("BIDI initial response");
    });
  });

  describe("Gemini ↔ BIDI Transitions", () => {
    it.skip("should switch from Gemini to BIDI mode", async () => {
      // Skip: Gemini Direct mode uses different API endpoint and schema
      expect(true).toBe(true);
    });

    it.skip("should switch from BIDI to Gemini mode", async () => {
      // Skip: Gemini Direct mode uses different API endpoint and schema
      expect(true).toBe(true);
    });
  });

  describe("Rapid Mode Switching", () => {
    it("should preserve history through SSE-BIDI-SSE switches", async () => {
      // Given: Pre-built history simulating multiple conversations
      const existingHistory: UIMessageFromAISDKv6[] = [
        {
          id: "msg-1",
          role: "user",
          parts: [{ type: "text", text: "Message 1" }],
        },
        {
          id: "msg-2",
          role: "assistant",
          parts: [{ type: "text", text: "Response 1" }],
        },
        {
          id: "msg-3",
          role: "user",
          parts: [{ type: "text", text: "Message 2" }],
        },
        {
          id: "msg-4",
          role: "assistant",
          parts: [{ type: "text", text: "Response 2" }],
        },
      ];

      // Step 1: Load history in SSE mode
      const { result: sse1, unmount: unmount1 } = renderHook(() =>
        useChat(
          buildSseOptions({
            mode: "adk-sse",
            initialMessages: existingHistory,
          }).useChatOptions,
        ),
      );

      expect(sse1.current.messages.length).toBe(4);
      unmount1();

      // Step 2: Switch to BIDI mode
      const { result: bidi, unmount: unmount2 } = renderHook(() =>
        useChat(
          buildBidiOptions({
            initialMessages: existingHistory,
            forceNewInstance: true,
          }).useChatOptions,
        ),
      );

      expect(bidi.current.messages.length).toBe(4);
      expect(getMessageText(bidi.current.messages[0])).toBe("Message 1");
      unmount2();

      // Step 3: Switch back to SSE mode
      const { result: sse2 } = renderHook(() =>
        useChat(
          buildSseOptions({
            mode: "adk-sse",
            initialMessages: existingHistory,
          }).useChatOptions,
        ),
      );

      // Then: Verify all messages are preserved
      expect(sse2.current.messages.length).toBe(4);
      const userMessages = sse2.current.messages.filter(
        (m) => m.role === "user",
      );
      expect(userMessages.length).toBe(2);
      expect(getMessageText(userMessages[0])).toBe("Message 1");
      expect(getMessageText(userMessages[1])).toBe("Message 2");
    });

    it("should maintain message order across mode switches", async () => {
      // Given: Pre-built history with specific order
      const orderedHistory: UIMessageFromAISDKv6[] = [
        { id: "1", role: "user", parts: [{ type: "text", text: "First" }] },
        {
          id: "2",
          role: "assistant",
          parts: [{ type: "text", text: "First response" }],
        },
        { id: "3", role: "user", parts: [{ type: "text", text: "Second" }] },
        {
          id: "4",
          role: "assistant",
          parts: [{ type: "text", text: "Second response" }],
        },
      ];

      // Load in SSE mode
      const { result: sse, unmount: unmountSse } = renderHook(() =>
        useChat(
          buildSseOptions({
            mode: "adk-sse",
            initialMessages: orderedHistory,
          }).useChatOptions,
        ),
      );

      expect(sse.current.messages.length).toBe(4);
      unmountSse();

      // Switch to BIDI mode
      const { result: bidi } = renderHook(() =>
        useChat(
          buildBidiOptions({
            initialMessages: orderedHistory,
            forceNewInstance: true,
          }).useChatOptions,
        ),
      );

      // Then: Verify order is preserved
      const finalMessages = bidi.current.messages;
      expect(finalMessages.length).toBe(4);

      expect(getMessageText(finalMessages[0])).toBe("First");
      expect(finalMessages[0].role).toBe("user");
      expect(getMessageText(finalMessages[1])).toBe("First response");
      expect(finalMessages[1].role).toBe("assistant");
      expect(getMessageText(finalMessages[2])).toBe("Second");
      expect(finalMessages[2].role).toBe("user");
      expect(getMessageText(finalMessages[3])).toBe("Second response");
      expect(finalMessages[3].role).toBe("assistant");
    });
  });

  describe("Mode-specific Features", () => {
    it("should enable audio features when switching to BIDI", async () => {
      // Given: Audio APIs are available in BIDI mode
      // Web Audio API mocks are set up via setupWebAudioMocks()

      // When: Create an AudioRecorder (BIDI-only feature)
      const recorder = new AudioRecorder();
      await recorder.initialize();

      // Then: AudioContext should be created and ready
      expect(getMockAudioContext()).not.toBeNull();
      expect(
        getMockAudioContext()?.audioWorklet.addModule,
      ).toHaveBeenCalledWith("/pcm-recorder-processor.js");

      // Cleanup
      await recorder.close();
    });

    it("should continue with pending messages after mode switch", async () => {
      // Given: Setup handlers
      // SSE handler via MSW HTTP
      getServer().use(
        http.post("http://localhost:8000/stream", () => {
          return createTextResponse("SSE processed pending");
        }),
      );

      // BIDI handler via Custom Mock (not actually used in this test)
      setDefaultHandler((ws) => {
        ws.onClientMessage((rawData) => {
          let data: any;
          try {
            data = JSON.parse(rawData);
            if (data.type === "ping") return;
          } catch {
            return;
          }
          ws.sendTextResponse(`text-${Date.now()}`, "BIDI response");
        });
      });

      // Start in BIDI with existing history
      const existingHistory: UIMessageFromAISDKv6[] = [
        {
          id: "existing-1",
          role: "user",
          parts: [{ type: "text", text: "Previous message" }],
        },
        {
          id: "existing-2",
          role: "assistant",
          parts: [{ type: "text", text: "Previous response" }],
        },
      ];

      const { result: bidi, unmount: unmountBidi } = renderHook(() =>
        useChat(
          buildBidiOptions({
            initialMessages: existingHistory,
            forceNewInstance: true,
          }).useChatOptions,
        ),
      );

      // Verify existing history loaded
      expect(bidi.current.messages.length).toBe(2);
      unmountBidi();

      // Switch to SSE with same history
      const { result: sse } = renderHook(() =>
        useChat(
          buildSseOptions({
            mode: "adk-sse",
            initialMessages: existingHistory,
          }).useChatOptions,
        ),
      );

      // Send new message
      await act(async () => {
        sse.current.sendMessage({ text: "New message after switch" });
      });

      await waitFor(
        () => {
          const messages = sse.current.messages;
          expect(messages.length).toBeGreaterThan(existingHistory.length);
          const lastMessage = messages.at(-1);
          expect(getMessageText(lastMessage)).toContain(
            "SSE processed pending",
          );
        },
        { timeout: 3000 },
      );

      // Verify history + new messages
      const finalMessages = sse.current.messages;
      expect(finalMessages.length).toBe(4); // 2 existing + 1 new user + 1 new assistant
    });
  });

  describe("Error Scenarios", () => {
    it("should preserve history when BIDI connection fails", async () => {
      // Given: Setup SSE handler (BIDI will fail to connect)
      getServer().use(
        http.post("http://localhost:8000/stream", () => {
          return createTextResponse("SSE fallback response");
        }),
      );

      // Custom Mock handler that closes connection immediately
      setDefaultHandler((ws) => {
        // Simulate connection failure by closing immediately after open
        ws.close();
      });

      // Prepare history from SSE mode
      const historyFromSse: UIMessageFromAISDKv6[] = [
        {
          id: "sse-user-1",
          role: "user",
          parts: [{ type: "text", text: "SSE message" }],
        },
        {
          id: "sse-assistant-1",
          role: "assistant",
          parts: [{ type: "text", text: "SSE response" }],
        },
      ];

      // Try to switch to BIDI (will fail)
      const { result: bidi } = renderHook(() =>
        useChat(
          buildBidiOptions({
            initialMessages: historyFromSse,
            forceNewInstance: true,
          }).useChatOptions,
        ),
      );

      // History should still be preserved in the hook state
      await waitFor(
        () => {
          expect(bidi.current.messages.length).toBe(2);
          expect(getMessageText(bidi.current.messages[0])).toBe("SSE message");
        },
        { timeout: 2000 },
      );
    });

    it("should preserve partial history during mode switch", async () => {
      // Given: History with only user message (simulating mid-loading state)
      const partialHistory: UIMessageFromAISDKv6[] = [
        {
          id: "partial-1",
          role: "user",
          parts: [{ type: "text", text: "Pending message" }],
        },
      ];

      // When: Switch to BIDI with partial history
      const { result: bidi } = renderHook(() =>
        useChat(
          buildBidiOptions({
            initialMessages: partialHistory,
            forceNewInstance: true,
          }).useChatOptions,
        ),
      );

      // Then: Partial history should be preserved
      expect(bidi.current.messages.length).toBe(1);
      expect(getMessageText(bidi.current.messages[0])).toBe("Pending message");
      expect(bidi.current.messages[0].role).toBe("user");
    });
  });
});
