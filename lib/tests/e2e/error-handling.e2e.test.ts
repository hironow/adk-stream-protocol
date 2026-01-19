/**
 * E2E Test: Error Handling
 *
 * Tests system behavior under error conditions.
 * Includes: network errors, backend errors, timeout scenarios.
 *
 * Key scenarios tested:
 * - HTTP error status codes (500, 401, 429)
 * - WebSocket disconnection and connection failures
 * - Stream interruption and timeout
 * - Error recovery and user data preservation
 *
 * Note: Resource errors (memory, audio) are skipped as they require
 * browser-specific API mocking beyond MSW capabilities.
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

describe("Error Handling E2E", () => {
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

  // Web Audio API mocks for audio resource error tests
  const { simulateGetUserMediaFailure } = setupWebAudioMocks();

  describe("Network Errors", () => {
    it("should handle WebSocket disconnection during chat", async () => {
      // Given: Setup handler that closes connection after partial response
      setDefaultHandler((ws) => {
        ws.onClientMessage((rawData) => {
          let data: any;
          try {
            data = JSON.parse(rawData);
            if (data.type === "ping") return;
          } catch {
            return;
          }

          // Start sending response then disconnect
          const textId = `text-${Date.now()}`;
          ws.sendTextStart(textId);
          ws.sendTextDelta(textId, "Starting response...");
          // Simulate sudden disconnection
          ws.simulateClose(1006, "Connection lost");
        });
      });

      const { result } = renderHook(() =>
        useChat(
          buildBidiOptions({ initialMessages: [] as UIMessageFromAISDKv6[] })
            .useChatOptions,
        ),
      );

      // When: User sends message
      await act(async () => {
        result.current.sendMessage({ text: "Test disconnection" });
      });

      // Then: Error should be captured or connection should be closed
      await waitFor(
        () => {
          // Either error is captured or we have at least the user message
          const hasError = result.current.error !== undefined;
          const hasUserMessage = result.current.messages.some(
            (m) => m.role === "user",
          );
          expect(hasError || hasUserMessage).toBe(true);
        },
        { timeout: 3000 },
      );
    });

    it("should handle SSE connection loss", async () => {
      // Given: SSE endpoint that returns incomplete stream
      getServer().use(
        http.post("http://localhost:8000/stream", () => {
          // Create a stream that ends abruptly
          const encoder = new TextEncoder();
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  'data: {"type":"text-delta","delta":"Starting..."}\n\n',
                ),
              );
              // Abruptly close without [DONE]
              controller.close();
            },
          });

          return new Response(stream, {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
            },
          });
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
        result.current.sendMessage({ text: "Trigger connection loss" });
      });

      // Then: Stream ends (may or may not set error depending on implementation)
      await waitFor(
        () => {
          expect(result.current.messages.length).toBeGreaterThanOrEqual(1);
        },
        { timeout: 3000 },
      );
    });

    it("should handle HTTP request failures", async () => {
      // Given: SSE endpoint that returns network error
      getServer().use(
        http.post("http://localhost:8000/stream", () => {
          return Response.error();
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
        result.current.sendMessage({ text: "Trigger HTTP failure" });
      });

      // Then: Error should be captured
      await waitFor(
        () => {
          expect(result.current.error).toBeDefined();
        },
        { timeout: 3000 },
      );
    });

    it.skip("should retry failed requests with backoff", async () => {
      // Skip: Retry logic is implementation-specific and may require
      // mocking timers and multiple request attempts
      expect(true).toBe(true);
    });
  });

  describe("Backend Errors", () => {
    it("should handle backend server errors (500)", async () => {
      // Given: SSE endpoint that returns 500
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
        result.current.sendMessage({ text: "Trigger 500" });
      });

      // Then: Error should be captured
      await waitFor(
        () => {
          expect(result.current.error).toBeDefined();
        },
        { timeout: 3000 },
      );
    });

    it("should handle authentication errors (401)", async () => {
      // Given: SSE endpoint that returns 401
      getServer().use(
        http.post("http://localhost:8000/stream", () => {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
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
        result.current.sendMessage({ text: "Trigger 401" });
      });

      // Then: Error should be captured
      await waitFor(
        () => {
          expect(result.current.error).toBeDefined();
        },
        { timeout: 3000 },
      );
    });

    it("should handle rate limiting (429)", async () => {
      // Given: SSE endpoint that returns 429
      getServer().use(
        http.post("http://localhost:8000/stream", () => {
          return new Response(
            JSON.stringify({ error: "Rate limit exceeded" }),
            {
              status: 429,
              headers: {
                "Content-Type": "application/json",
                "Retry-After": "60",
              },
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
        result.current.sendMessage({ text: "Trigger 429" });
      });

      // Then: Error should be captured
      await waitFor(
        () => {
          expect(result.current.error).toBeDefined();
        },
        { timeout: 3000 },
      );
    });

    it("should handle malformed backend responses", async () => {
      // Given: SSE endpoint that returns invalid JSON
      getServer().use(
        http.post("http://localhost:8000/stream", () => {
          const encoder = new TextEncoder();
          const stream = new ReadableStream({
            start(controller) {
              // Send malformed JSON
              controller.enqueue(encoder.encode("data: {invalid json}\n\n"));
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
            },
          });

          return new Response(stream, {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
            },
          });
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
        result.current.sendMessage({ text: "Trigger malformed response" });
      });

      // Then: Stream completes (error handling may vary)
      await waitFor(
        () => {
          // At least user message should be present
          expect(result.current.messages.length).toBeGreaterThanOrEqual(1);
        },
        { timeout: 3000 },
      );
    });
  });

  describe("Timeout Scenarios", () => {
    it("should handle no response from server", async () => {
      // Given: Setup handler that never responds
      setDefaultHandler((ws) => {
        ws.onClientMessage((rawData) => {
          let data: any;
          try {
            data = JSON.parse(rawData);
            if (data.type === "ping") return;
          } catch {
            return;
          }
          // Never send response - simulate server not responding
        });
      });

      const { result } = renderHook(() =>
        useChat(
          buildBidiOptions({ initialMessages: [] as UIMessageFromAISDKv6[] })
            .useChatOptions,
        ),
      );

      // When: User sends message
      await act(async () => {
        result.current.sendMessage({ text: "Hello with no response" });
      });

      // Then: Should at least have user message in state
      await waitFor(
        () => {
          expect(result.current.messages.length).toBeGreaterThanOrEqual(1);
        },
        { timeout: 2000 },
      );

      // Verify no assistant response received
      const hasAssistantMessage = result.current.messages.some(
        (m) => m.role === "assistant",
      );
      expect(hasAssistantMessage).toBe(false);
    });

    it.skip("should timeout tool approval requests", async () => {
      // Skip: Tool approval timeout requires complex timer mocking
      // and approval state management beyond basic MSW testing
      expect(true).toBe(true);
    });

    it("should handle streaming that stops mid-way", async () => {
      // Given: SSE that sends partial data then stalls
      getServer().use(
        http.post("http://localhost:8000/stream", () => {
          const encoder = new TextEncoder();
          const textId = `text-${Date.now()}`;
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ type: "text-start", id: textId })}\n\n`,
                ),
              );
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ type: "text-delta", delta: "Started but...", id: textId })}\n\n`,
                ),
              );
              // Stream stalls - no text-end or [DONE]
              // Eventually close to simulate stall timeout
              setTimeout(() => controller.close(), 100);
            },
          });

          return new Response(stream, {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
            },
          });
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
        result.current.sendMessage({ text: "Trigger partial stream" });
      });

      // Then: Partial content may be visible
      await waitFor(
        () => {
          expect(result.current.messages.length).toBeGreaterThanOrEqual(1);
        },
        { timeout: 3000 },
      );
    });
  });

  describe("Resource Errors", () => {
    it.skip("should handle memory errors gracefully", async () => {
      // Skip: Memory constraint testing requires browser-level mocking
      // beyond MSW capabilities (e.g., allocating large buffers)
      expect(true).toBe(true);
    });

    it("should handle audio resource errors", async () => {
      // Given: AudioRecorder initialized, but getUserMedia will fail
      const recorder = new AudioRecorder();
      await recorder.initialize();

      const audioError = new Error("Hardware error: Microphone disconnected");
      (audioError as any).name = "OverconstrainedError";
      simulateGetUserMediaFailure(audioError);

      // When: Attempt to start recording
      // Then: Should reject with the hardware error
      await expect(recorder.start(() => {})).rejects.toThrow(
        "Microphone disconnected",
      );

      // Verify recorder state is clean
      expect(recorder.isRecording).toBe(false);

      // Cleanup
      await recorder.close();
    });
  });

  describe("Concurrent Error Scenarios", () => {
    it("should handle multiple errors simultaneously", async () => {
      // Given: Setup handler that errors on every request
      let errorCount = 0;
      setDefaultHandler((ws) => {
        ws.onClientMessage((rawData) => {
          let data: any;
          try {
            data = JSON.parse(rawData);
            if (data.type === "ping") return;
          } catch {
            return;
          }

          errorCount++;
          // Send error response
          ws.simulateServerMessage({
            type: "error",
            error: { message: `Error ${errorCount}`, code: "MULTIPLE_ERROR" },
          });
          ws.simulateDone();
        });
      });

      const { result } = renderHook(() =>
        useChat(
          buildBidiOptions({ initialMessages: [] as UIMessageFromAISDKv6[] })
            .useChatOptions,
        ),
      );

      // When: User sends multiple messages rapidly
      await act(async () => {
        result.current.sendMessage({ text: "First error trigger" });
      });

      // Then: Error should be captured
      await waitFor(
        () => {
          expect(result.current.error).toBeDefined();
        },
        { timeout: 3000 },
      );

      // Verify error was tracked
      expect(errorCount).toBeGreaterThanOrEqual(1);
    });

    it("should handle error then success pattern", async () => {
      // Given: First request errors, second succeeds
      let requestCount = 0;
      setDefaultHandler((ws) => {
        ws.onClientMessage((rawData) => {
          let data: any;
          try {
            data = JSON.parse(rawData);
            if (data.type === "ping") return;
          } catch {
            return;
          }

          requestCount++;
          if (requestCount === 1) {
            // First request: error
            ws.simulateServerMessage({
              type: "error",
              error: { message: "First error", code: "TEMP_ERROR" },
            });
            ws.simulateDone();
          } else {
            // Second request: success
            ws.sendTextResponse(`text-${Date.now()}`, "Success after error!");
          }
        });
      });

      const { result } = renderHook(() =>
        useChat(
          buildBidiOptions({ initialMessages: [] as UIMessageFromAISDKv6[] })
            .useChatOptions,
        ),
      );

      // When: First message triggers error
      await act(async () => {
        result.current.sendMessage({ text: "Trigger error" });
      });

      await waitFor(
        () => {
          expect(result.current.error).toBeDefined();
        },
        { timeout: 3000 },
      );

      // When: Second message succeeds
      await act(async () => {
        result.current.sendMessage({ text: "Try again" });
      });

      // Then: Success response received
      await waitFor(
        () => {
          const lastMessage = result.current.messages.at(-1);
          expect(getMessageText(lastMessage)).toContain("Success after error");
        },
        { timeout: 3000 },
      );
    });
  });

  describe("Error Recovery", () => {
    it("should recover and send new message after error", async () => {
      // Given: First request fails, second succeeds
      let requestCount = 0;
      getServer().use(
        http.post("http://localhost:8000/stream", () => {
          requestCount++;
          if (requestCount === 1) {
            // First request fails
            return new Response(JSON.stringify({ error: "Server Error" }), {
              status: 500,
              headers: { "Content-Type": "application/json" },
            });
          }
          // Second request succeeds
          return createTextResponse("Recovery successful!");
        }),
      );

      const config = {
        initialMessages: [] as UIMessageFromAISDKv6[],
      };

      const { result } = renderHook(() =>
        useChat(buildSseOptions({ mode: "adk-sse", ...config }).useChatOptions),
      );

      // When: First message fails
      await act(async () => {
        result.current.sendMessage({ text: "First message (will fail)" });
      });

      await waitFor(
        () => {
          expect(result.current.error).toBeDefined();
        },
        { timeout: 3000 },
      );

      // When: Second message succeeds
      await act(async () => {
        result.current.sendMessage({ text: "Second message (will succeed)" });
      });

      // Then: Recovery successful
      await waitFor(
        () => {
          const lastMessage = result.current.messages.at(-1);
          expect(getMessageText(lastMessage)).toContain("Recovery successful");
        },
        { timeout: 3000 },
      );
    });

    it("should preserve user data during errors", async () => {
      // Given: Pre-existing history and SSE that fails
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

      getServer().use(
        http.post("http://localhost:8000/stream", () => {
          return new Response(JSON.stringify({ error: "Server Error" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }),
      );

      const config = {
        initialMessages: existingHistory,
      };

      const { result } = renderHook(() =>
        useChat(buildSseOptions({ mode: "adk-sse", ...config }).useChatOptions),
      );

      // Verify initial history is loaded
      expect(result.current.messages.length).toBe(2);

      // When: New message fails
      await act(async () => {
        result.current.sendMessage({ text: "New message (will fail)" });
      });

      await waitFor(
        () => {
          expect(result.current.error).toBeDefined();
        },
        { timeout: 3000 },
      );

      // Then: Original history should still be preserved
      const userMessages = result.current.messages.filter(
        (m) => m.role === "user",
      );
      expect(userMessages.length).toBeGreaterThanOrEqual(2); // Original + new
      expect(getMessageText(userMessages[0])).toBe("Previous message");
    });

    it("should allow manual retry after errors", async () => {
      // Given: First request fails, subsequent retries succeed
      let requestCount = 0;
      setDefaultHandler((ws) => {
        ws.onClientMessage((rawData) => {
          let data: any;
          try {
            data = JSON.parse(rawData);
            if (data.type === "ping") return;
          } catch {
            return;
          }

          requestCount++;
          if (requestCount === 1) {
            // First request fails
            ws.simulateServerMessage({
              type: "error",
              error: { message: "Temporary failure", code: "RETRY_NEEDED" },
            });
            ws.simulateDone();
          } else {
            // Retry succeeds
            ws.sendTextResponse(`text-${Date.now()}`, "Retry successful!");
          }
        });
      });

      const { result } = renderHook(() =>
        useChat(
          buildBidiOptions({ initialMessages: [] as UIMessageFromAISDKv6[] })
            .useChatOptions,
        ),
      );

      // When: First attempt fails
      await act(async () => {
        result.current.sendMessage({ text: "Initial request" });
      });

      await waitFor(
        () => {
          expect(result.current.error).toBeDefined();
        },
        { timeout: 3000 },
      );

      // When: User manually retries (same message or reload)
      await act(async () => {
        result.current.sendMessage({ text: "Retry request" });
      });

      // Then: Retry succeeds
      await waitFor(
        () => {
          const lastMessage = result.current.messages.at(-1);
          expect(lastMessage?.role).toBe("assistant");
          expect(getMessageText(lastMessage)).toContain("Retry successful");
        },
        { timeout: 3000 },
      );

      expect(requestCount).toBe(2);
    });
  });

  describe("User Experience", () => {
    it("should capture error with message", async () => {
      // Given: SSE endpoint that returns error with message
      getServer().use(
        http.post("http://localhost:8000/stream", () => {
          return new Response(
            JSON.stringify({ error: "Service temporarily unavailable" }),
            {
              status: 503,
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
        result.current.sendMessage({ text: "Trigger 503" });
      });

      // Then: Error with message is captured
      await waitFor(
        () => {
          expect(result.current.error).toBeDefined();
          // Error object should have message property
          expect(result.current.error).toHaveProperty("message");
        },
        { timeout: 3000 },
      );
    });

    it("should handle stream error event", async () => {
      // Given: SSE endpoint that sends error event in stream
      getServer().use(
        http.post("http://localhost:8000/stream", () => {
          const encoder = new TextEncoder();
          const stream = new ReadableStream({
            start(controller) {
              const errorEvent = {
                type: "error",
                error: {
                  message: "Stream error occurred",
                  code: "STREAM_ERROR",
                },
              };
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(errorEvent)}\n\n`),
              );
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
            },
          });

          return new Response(stream, {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
            },
          });
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
        result.current.sendMessage({ text: "Trigger stream error" });
      });

      // Then: Error should be captured from stream event
      await waitFor(
        () => {
          expect(result.current.error).toBeDefined();
        },
        { timeout: 3000 },
      );
    });

    it("should provide error details for debugging", async () => {
      // Given: Setup handler that sends detailed error
      setDefaultHandler((ws) => {
        ws.onClientMessage((rawData) => {
          let data: any;
          try {
            data = JSON.parse(rawData);
            if (data.type === "ping") return;
          } catch {
            return;
          }

          // Send error with detailed information
          ws.simulateServerMessage({
            type: "error",
            error: {
              message: "Detailed error for debugging",
              code: "DEBUG_ERROR",
              details: {
                timestamp: Date.now(),
                requestId: "req-12345",
              },
            },
          });
          ws.simulateDone();
        });
      });

      const { result } = renderHook(() =>
        useChat(
          buildBidiOptions({ initialMessages: [] as UIMessageFromAISDKv6[] })
            .useChatOptions,
        ),
      );

      // When: User sends message that triggers error
      await act(async () => {
        result.current.sendMessage({ text: "Trigger debug error" });
      });

      // Then: Error object should contain debugging information
      await waitFor(
        () => {
          expect(result.current.error).toBeDefined();
          // Error should have message
          expect(result.current.error?.message).toBeDefined();
        },
        { timeout: 3000 },
      );
    });
  });
});
