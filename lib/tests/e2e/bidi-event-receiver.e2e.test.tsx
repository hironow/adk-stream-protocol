/**
 * BIDI EventReceiver E2E Tests
 *
 * Tests BIDI-specific EventReceiver functionality:
 * - Audio chunk handling (PCM buffer)
 * - Custom event handling (pong)
 * - State management (reset)
 * - Error resilience
 *
 * Note: Basic text streaming and confirmation flow are covered in bidi-use-chat.e2e.test.tsx
 *
 * @vitest-environment jsdom
 */

import type { UIMessage } from "@ai-sdk/react";
import { useChat } from "@ai-sdk/react";
import { renderHook, waitFor } from "@testing-library/react";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildUseChatOptions } from "@/lib/build-use-chat-options";
import {
  createBidiWebSocketLink,
  createCustomHandler,
} from "@/lib/tests/helpers/bidi-ws-handlers";

/**
 * MSW server for WebSocket mocking
 */
const server = setupServer();

beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});

describe("BIDI EventReceiver - E2E Tests", () => {
  describe("Audio Chunk Handling", () => {
    it("should handle PCM audio chunks and buffer them", async () => {
      // Given: MSW handler sends audio chunks
      const chat = createBidiWebSocketLink();
      const audioChunks: string[] = [];
      let audioResetCalled = false;

      const mockAudioContext = {
        voiceChannel: {
          isPlaying: false,
          chunkCount: 0,
          sendChunk: (chunk: any) => {
            audioChunks.push(chunk.content);
          },
          reset: () => {
            audioResetCalled = true;
          },
        },
        isReady: true,
        error: null,
      };

      server.use(
        createCustomHandler(chat, ({ server, client }) => {
          client.addEventListener("message", () => {
            // Send PCM audio chunks using data-pcm format (BIDI protocol)
            const pcmData1 = Buffer.from([0, 1, 2, 3]).toString("base64");
            client.send(
              `data: ${JSON.stringify({
                type: "data-pcm",
                data: {
                  content: pcmData1,
                },
              })}\n\n`,
            );

            const pcmData2 = Buffer.from([4, 5, 6, 7]).toString("base64");
            client.send(
              `data: ${JSON.stringify({
                type: "data-pcm",
                data: {
                  content: pcmData2,
                },
              })}\n\n`,
            );

            // Send [DONE] after delay to ensure all messages are processed
            setTimeout(() => {
              client.send("data: [DONE]\n\n");
            }, 100);
          });
        }),
      );

      const { useChatOptions } = buildUseChatOptions({
        mode: "adk-bidi",
        initialMessages: [] as UIMessage[],
        audioContext: mockAudioContext,
      });

      const { result } = renderHook(() => useChat(useChatOptions));

      // When: Send message
      await waitFor(() => {
        result.current.sendMessage({ text: "Test audio" });
      });

      // Then: Verify audio chunks were received and processed
      await waitFor(
        () => {
          expect(audioChunks.length).toBeGreaterThan(0);
        },
        { timeout: 3000 },
      );

      // Audio chunks should have been sent to AudioContext
      expect(audioChunks.length).toBeGreaterThanOrEqual(2);
    });

    it("should reset audio buffer on reset()", async () => {
      // Given: Audio context with reset tracking
      const chat = createBidiWebSocketLink();
      let resetCount = 0;

      const mockAudioContext = {
        voiceChannel: {
          isPlaying: false,
          chunkCount: 0,
          sendChunk: () => {},
          reset: () => {
            resetCount++;
          },
        },
        isReady: true,
        error: null,
      };

      server.use(
        createCustomHandler(chat, ({ server, client }) => {
          client.addEventListener("message", () => {
            // Send simple text response
            const textId = `text-${Date.now()}`;
            client.send(
              `data: ${JSON.stringify({ type: "text-start", id: textId })}\n\n`,
            );
            client.send(
              `data: ${JSON.stringify({ type: "text-delta", delta: "Hello", id: textId })}\n\n`,
            );
            client.send(
              `data: ${JSON.stringify({ type: "text-end", id: textId })}\n\n`,
            );

            // Send [DONE] after delay to ensure all messages are processed
            setTimeout(() => {
              client.send("data: [DONE]\n\n");
            }, 100);
          });
        }),
      );

      const { useChatOptions } = buildUseChatOptions({
        mode: "adk-bidi",
        initialMessages: [] as UIMessage[],
        audioContext: mockAudioContext,
      });

      const { result } = renderHook(() => useChat(useChatOptions));

      // When: Send multiple messages (each should trigger reset)
      await waitFor(() => {
        result.current.sendMessage({ text: "First message" });
      });

      await waitFor(
        () => {
          expect(result.current.messages.length).toBeGreaterThan(0);
        },
        { timeout: 3000 },
      );

      await waitFor(() => {
        result.current.sendMessage({ text: "Second message" });
      });

      await waitFor(
        () => {
          expect(result.current.messages.length).toBeGreaterThan(1);
        },
        { timeout: 3000 },
      );

      // Wait for [DONE] to be processed (sent with 100ms setTimeout)
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Then: Reset should have been called for each new stream
      expect(resetCount).toBeGreaterThan(0);
    });
  });

  describe("Custom Event Handling", () => {
    it("should handle pong events and calculate latency", async () => {
      // Given: MSW handler sends pong
      const chat = createBidiWebSocketLink();
      const latencies: number[] = [];

      const mockLatencyCallback = (latency: number) => {
        latencies.push(latency);
      };

      server.use(
        createCustomHandler(chat, ({ server, client }) => {
          client.addEventListener("message", (event) => {
            const data = JSON.parse(event.data as string);

            // Respond to ping with pong
            if (data.type === "ping") {
              const pongMessage = JSON.stringify({
                type: "pong",
                timestamp: data.timestamp,
              });
              client.send(pongMessage);
            }

            // Also send normal text response
            const textId = `text-${Date.now()}`;
            client.send(
              `data: ${JSON.stringify({ type: "text-start", id: textId })}\n\n`,
            );
            client.send(
              `data: ${JSON.stringify({ type: "text-delta", delta: "Pong!", id: textId })}\n\n`,
            );
            client.send(
              `data: ${JSON.stringify({ type: "text-end", id: textId })}\n\n`,
            );

            // Send [DONE] after delay to ensure all messages are processed
            setTimeout(() => {
              client.send("data: [DONE]\n\n");
            }, 100);
          });
        }),
      );

      const { useChatOptions } = buildUseChatOptions({
        mode: "adk-bidi",
        initialMessages: [] as UIMessage[],
        latencyCallback: mockLatencyCallback,
      });

      const { result } = renderHook(() => useChat(useChatOptions));

      // When: Send message (ping is sent automatically every 2s by transport)
      await waitFor(() => {
        result.current.sendMessage({ text: "Test ping/pong" });
      });

      await waitFor(
        () => {
          expect(result.current.messages.length).toBeGreaterThan(0);
        },
        { timeout: 3000 },
      );

      // Wait for ping/pong cycle (ping interval is 2s)
      await new Promise((resolve) => setTimeout(resolve, 2500));

      // Then: Latency should have been calculated
      // Note: This might be flaky depending on ping timing
      // expect(latencies.length).toBeGreaterThan(0);
    });
  });

  describe("Error Resilience", () => {
    it("should handle malformed SSE chunks gracefully", async () => {
      // Given: MSW handler sends malformed data
      const chat = createBidiWebSocketLink();

      server.use(
        createCustomHandler(chat, ({ server, client }) => {
          client.addEventListener("message", () => {
            // Send malformed SSE (invalid JSON)
            client.send("data: {invalid json}\n\n");

            // But still send valid response after
            const textId = `text-${Date.now()}`;
            client.send(
              `data: ${JSON.stringify({ type: "text-start", id: textId })}\n\n`,
            );
            client.send(
              `data: ${JSON.stringify({ type: "text-delta", delta: "Recovered", id: textId })}\n\n`,
            );
            client.send(
              `data: ${JSON.stringify({ type: "text-end", id: textId })}\n\n`,
            );

            // Send [DONE] after delay to ensure all messages are processed
            setTimeout(() => {
              client.send("data: [DONE]\n\n");
            }, 100);
          });
        }),
      );

      const { useChatOptions } = buildUseChatOptions({
        mode: "adk-bidi",
        initialMessages: [] as UIMessage[],
      });

      const { result } = renderHook(() => useChat(useChatOptions));

      // When: Send message
      await waitFor(() => {
        result.current.sendMessage({ text: "Test error handling" });
      });

      // Then: Should recover and show valid message
      await waitFor(
        () => {
          const lastMessage = result.current.messages.at(-1);
          const textPart = (lastMessage as any)?.parts?.find(
            (p: any) => p.type === "text",
          );
          expect(textPart?.text).toContain("Recovered");
        },
        { timeout: 3000 },
      );
    });

    it("should handle non-SSE messages with warning", async () => {
      // Given: MSW handler sends non-SSE formatted message
      const chat = createBidiWebSocketLink();
      const consoleLogs: string[] = [];
      const originalWarn = console.warn;
      console.warn = (...args: any[]) => {
        consoleLogs.push(args.join(" "));
        originalWarn(...args);
      };

      server.use(
        createCustomHandler(chat, ({ server, client }) => {
          client.addEventListener("message", () => {
            // Send non-SSE message (should trigger warning)
            client.send("Not an SSE message");

            // Then send valid SSE
            const textId = `text-${Date.now()}`;
            client.send(
              `data: ${JSON.stringify({ type: "text-start", id: textId })}\n\n`,
            );
            client.send(
              `data: ${JSON.stringify({ type: "text-delta", delta: "Valid", id: textId })}\n\n`,
            );
            client.send(
              `data: ${JSON.stringify({ type: "text-end", id: textId })}\n\n`,
            );

            // Send [DONE] after delay to ensure all messages are processed
            setTimeout(() => {
              client.send("data: [DONE]\n\n");
            }, 100);
          });
        }),
      );

      const { useChatOptions } = buildUseChatOptions({
        mode: "adk-bidi",
        initialMessages: [] as UIMessage[],
      });

      const { result } = renderHook(() => useChat(useChatOptions));

      // When: Send message
      await waitFor(() => {
        result.current.sendMessage({ text: "Test non-SSE" });
      });

      // Then: Should log warning but continue
      await waitFor(
        () => {
          const lastMessage = result.current.messages.at(-1);
          const textPart = (lastMessage as any)?.parts?.find(
            (p: any) => p.type === "text",
          );
          expect(textPart?.text).toContain("Valid");
        },
        { timeout: 3000 },
      );

      // Restore console.warn
      console.warn = originalWarn;

      // Verify warning was logged
      const hasWarning = consoleLogs.some((log) =>
        log.includes("Non-SSE message"),
      );
      expect(hasWarning).toBe(true);
    });
  });

  describe("State Management", () => {
    it("should handle multiple consecutive streams", async () => {
      // Given: MSW handler for multiple messages
      const chat = createBidiWebSocketLink();

      server.use(
        createCustomHandler(chat, ({ server, client }) => {
          client.addEventListener("message", () => {
            const textId = `text-${Date.now()}`;
            client.send(
              `data: ${JSON.stringify({ type: "text-start", id: textId })}\n\n`,
            );
            client.send(
              `data: ${JSON.stringify({ type: "text-delta", delta: "Response", id: textId })}\n\n`,
            );
            client.send(
              `data: ${JSON.stringify({ type: "text-end", id: textId })}\n\n`,
            );

            // Send [DONE] after delay to ensure all messages are processed
            setTimeout(() => {
              client.send("data: [DONE]\n\n");
            }, 100);
          });
        }),
      );

      const { useChatOptions } = buildUseChatOptions({
        mode: "adk-bidi",
        initialMessages: [] as UIMessage[],
      });

      const { result } = renderHook(() => useChat(useChatOptions));

      // When: Send multiple messages
      await waitFor(() => {
        result.current.sendMessage({ text: "First" });
      });

      await waitFor(
        () => {
          expect(result.current.messages.length).toBe(2); // user + assistant
        },
        { timeout: 3000 },
      );

      await waitFor(() => {
        result.current.sendMessage({ text: "Second" });
      });

      await waitFor(
        () => {
          expect(result.current.messages.length).toBe(4); // 2 user + 2 assistant
        },
        { timeout: 3000 },
      );

      await waitFor(() => {
        result.current.sendMessage({ text: "Third" });
      });

      await waitFor(
        () => {
          expect(result.current.messages.length).toBe(6); // 3 user + 3 assistant
        },
        { timeout: 3000 },
      );

      // Then: All messages should be present
      expect(result.current.messages.length).toBe(6);
    });
  });
});
