/**
 * E2E Test: Chat Flow
 *
 * Tests complete chat interaction from user input to AI response.
 * Includes: message sending, streaming responses, message history.
 *
 * @vitest-environment jsdom
 */

import { useChat } from "@ai-sdk/react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { http } from "msw";
import { describe, expect, it } from "vitest";
import { buildUseChatOptions as buildBidiOptions } from "../../bidi";
import { buildUseChatOptions as buildSseOptions } from "../../sse";
import type { UIMessageFromAISDKv6 } from "../../utils";
import { createTextResponse, getMessageText, useMswServer } from "../helpers";
import { useMockWebSocket } from "../helpers/mock-websocket";

describe("Chat Flow E2E", () => {
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
  describe("ADK BIDI Mode", () => {
    it("should send user message and receive AI response", async () => {
      // Given: Setup Custom Mock handler to send text response
      setDefaultHandler((ws) => {
        ws.onClientMessage((rawData) => {
          let data: any;
          try {
            data = JSON.parse(rawData);
            if (data.type === "ping") return;
          } catch {
            return;
          }

          const textId = `text-${Date.now()}`;
          ws.sendTextStart(textId);
          ws.sendTextDelta(textId, "Hello");
          ws.sendTextDelta(textId, " from");
          ws.sendTextDelta(textId, " AI!");
          ws.sendTextEnd(textId);
          ws.simulateDone();
        });
      });

      const config = {
        initialMessages: [] as UIMessageFromAISDKv6[],
      };

      const { result } = renderHook(() =>
        useChat(buildBidiOptions(config).useChatOptions),
      );

      // When: User submits a message
      await act(async () => {
        result.current.sendMessage({ text: "Hello AI" });
      });

      // Then: Wait for AI response
      await waitFor(
        () => {
          const messages = result.current.messages;
          expect(messages.length).toBeGreaterThanOrEqual(2);

          const lastMessage = messages[messages.length - 1];
          expect(lastMessage?.role).toBe("assistant");

          const text = getMessageText(lastMessage);
          expect(text).toContain("Hello");
          expect(text).toContain("from");
          expect(text).toContain("AI!");
        },
        { timeout: 3000 },
      );
    });

    it("should maintain conversation history across turns", async () => {
      // Given: Setup Custom Mock handler with echo-like behavior
      let turnCount = 0;

      setDefaultHandler((ws) => {
        ws.onClientMessage((rawData) => {
          let data: any;
          try {
            data = JSON.parse(rawData);
            if (data.type === "ping") return;
          } catch {
            return;
          }

          turnCount++;
          const textId = `text-${Date.now()}`;

          // Verify history is being sent
          const historyLength = data.messages?.length || 0;
          const responseText =
            turnCount === 1
              ? "First response"
              : `Response ${turnCount} (history: ${historyLength} messages)`;

          ws.sendTextStart(textId);
          ws.sendTextDelta(textId, responseText);
          ws.sendTextEnd(textId);
          ws.simulateDone();
        });
      });

      const config = {
        initialMessages: [] as UIMessageFromAISDKv6[],
      };

      const { result } = renderHook(() =>
        useChat(buildBidiOptions(config).useChatOptions),
      );

      // When: First turn
      await act(async () => {
        result.current.sendMessage({ text: "First message" });
      });

      await waitFor(
        () => {
          expect(result.current.messages.length).toBeGreaterThanOrEqual(2);
          expect(getMessageText(result.current.messages[1])).toContain(
            "First response",
          );
        },
        { timeout: 3000 },
      );

      // When: Second turn
      await act(async () => {
        result.current.sendMessage({ text: "Second message" });
      });

      // Then: Verify history was sent
      await waitFor(
        () => {
          expect(result.current.messages.length).toBeGreaterThanOrEqual(4);
          const lastMessage =
            result.current.messages[result.current.messages.length - 1];
          const text = getMessageText(lastMessage);
          expect(text).toContain("Response 2");
          expect(text).toContain("history:");
        },
        { timeout: 3000 },
      );
    });

    it("should handle message streaming correctly", async () => {
      // Given: Setup Custom Mock handler to send multiple chunks
      const streamedParts = ["This ", "is ", "a ", "streaming ", "response."];

      setDefaultHandler((ws) => {
        ws.onClientMessage((rawData) => {
          let data: any;
          try {
            data = JSON.parse(rawData);
            if (data.type === "ping") return;
          } catch {
            return;
          }

          const textId = `text-${Date.now()}`;

          // Send start
          ws.sendTextStart(textId);

          // Send each part with small delay simulation
          for (const part of streamedParts) {
            ws.sendTextDelta(textId, part);
          }

          // Send end
          ws.sendTextEnd(textId);
          ws.simulateDone();
        });
      });

      const config = {
        initialMessages: [] as UIMessageFromAISDKv6[],
      };

      const { result } = renderHook(() =>
        useChat(buildBidiOptions(config).useChatOptions),
      );

      // When: User sends message
      await act(async () => {
        result.current.sendMessage({ text: "Stream test" });
      });

      // Then: Verify final assembled message
      await waitFor(
        () => {
          const lastMessage =
            result.current.messages[result.current.messages.length - 1];
          const text = getMessageText(lastMessage);
          expect(text).toBe("This is a streaming response.");
        },
        { timeout: 3000 },
      );
    });
  });

  describe("ADK SSE Mode", () => {
    it("should send user message and receive AI response via SSE", async () => {
      // Given: Setup MSW handler for SSE endpoint
      getServer().use(
        http.post("http://localhost:8000/stream", () => {
          return createTextResponse("SSE response received!");
        }),
      );

      const config = {
        initialMessages: [] as UIMessageFromAISDKv6[],
      };

      const { result } = renderHook(() =>
        useChat(buildSseOptions({ mode: "adk-sse", ...config }).useChatOptions),
      );

      // When: User sends message
      await act(async () => {
        result.current.sendMessage({ text: "Hello SSE" });
      });

      // Then: Verify response received
      await waitFor(
        () => {
          const messages = result.current.messages;
          expect(messages.length).toBeGreaterThanOrEqual(2);

          const lastMessage = messages[messages.length - 1];
          expect(lastMessage?.role).toBe("assistant");
          expect(getMessageText(lastMessage)).toContain("SSE response");
        },
        { timeout: 3000 },
      );
    });

    it("should handle long-running responses", async () => {
      // Given: Setup MSW handler with many chunks
      const longText = Array(10)
        .fill("chunk ")
        .map((c, i) => c + i)
        .join("");

      getServer().use(
        http.post("http://localhost:8000/stream", () => {
          return createTextResponse(longText);
        }),
      );

      const config = {
        initialMessages: [] as UIMessageFromAISDKv6[],
      };

      const { result } = renderHook(() =>
        useChat(buildSseOptions({ mode: "adk-sse", ...config }).useChatOptions),
      );

      // When: User sends message
      await act(async () => {
        result.current.sendMessage({ text: "Long response test" });
      });

      // Then: Verify complete response
      await waitFor(
        () => {
          const lastMessage =
            result.current.messages[result.current.messages.length - 1];
          const text = getMessageText(lastMessage);
          expect(text).toBe(longText);
        },
        { timeout: 5000 },
      );
    });
  });

  describe("Gemini Direct Mode", () => {
    it.skip("should send user message and receive AI response via HTTP", async () => {
      // Skip: Gemini Direct mode uses different API endpoint
      // and requires specific schema handling (see chat-basic.spec.ts:38)
      expect(true).toBe(true);
    });
  });

  describe("Error Scenarios", () => {
    it("should handle network disconnection gracefully", async () => {
      // Given: Setup Custom Mock handler that closes connection
      setDefaultHandler((ws) => {
        ws.onClientMessage((rawData) => {
          let data: any;
          try {
            data = JSON.parse(rawData);
            if (data.type === "ping") return;
          } catch {
            return;
          }

          // Simulate network error by sending error event
          ws.simulateServerMessage({
            type: "error",
            error: { message: "Connection lost", code: "NETWORK_ERROR" },
          });
          ws.simulateDone();
        });
      });

      const config = {
        initialMessages: [] as UIMessageFromAISDKv6[],
      };

      const { result } = renderHook(() =>
        useChat(buildBidiOptions(config).useChatOptions),
      );

      // When: User sends message
      await act(async () => {
        result.current.sendMessage({ text: "Trigger error" });
      });

      // Then: Error should be captured
      await waitFor(
        () => {
          expect(result.current.error).toBeDefined();
        },
        { timeout: 3000 },
      );
    });

    it("should handle backend error responses", async () => {
      // Given: Setup MSW handler that returns error
      getServer().use(
        http.post("http://localhost:8000/stream", () => {
          return new Response(
            JSON.stringify({ error: "Internal Server Error" }),
            {
              status: 500,
              headers: { "Content-Type": "application/json" },
            },
          );
        }),
      );

      const config = {
        initialMessages: [] as UIMessageFromAISDKv6[],
      };

      const { result } = renderHook(() =>
        useChat(buildSseOptions({ mode: "adk-sse", ...config }).useChatOptions),
      );

      // When: User sends message
      await act(async () => {
        result.current.sendMessage({ text: "Trigger 500 error" });
      });

      // Then: Error should be captured
      await waitFor(
        () => {
          expect(result.current.error).toBeDefined();
        },
        { timeout: 3000 },
      );
    });

    it("should handle timeout scenarios", async () => {
      // Given: Setup Custom Mock handler that never responds
      setDefaultHandler((ws) => {
        ws.onClientMessage((rawData) => {
          let data: any;
          try {
            data = JSON.parse(rawData);
            if (data.type === "ping") return;
          } catch {
            return;
          }
          // Never send response - simulate timeout
        });
      });

      const config = {
        initialMessages: [] as UIMessageFromAISDKv6[],
      };

      const { result } = renderHook(() =>
        useChat(buildBidiOptions(config).useChatOptions),
      );

      // When: User sends message
      await act(async () => {
        result.current.sendMessage({ text: "Timeout test" });
      });

      // Then: Should still be loading (no response)
      // Note: Actual timeout handling depends on client implementation
      await waitFor(
        () => {
          // After sending, message count should increase
          expect(result.current.messages.length).toBeGreaterThanOrEqual(1);
        },
        { timeout: 2000 },
      );

      // Verify we're in a waiting state (no assistant response yet)
      const hasAssistantResponse = result.current.messages.some(
        (m) => m.role === "assistant",
      );
      expect(hasAssistantResponse).toBe(false);
    });
  });
});
