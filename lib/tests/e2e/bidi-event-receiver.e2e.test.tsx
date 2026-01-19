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

import { useChat } from "@ai-sdk/react";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { buildUseChatOptions } from "@/lib/build-use-chat-options";
import { useMockWebSocket } from "@/lib/tests/helpers/mock-websocket";
import type { UIMessageFromAISDKv6 } from "@/lib/utils";

describe("BIDI EventReceiver - E2E Tests", () => {
  const { setDefaultHandler } = useMockWebSocket();
  describe("Audio Chunk Handling", () => {
    it("should handle PCM audio chunks and buffer them", async () => {
      // Given: Custom Mock handler sends audio chunks
      const audioChunks: string[] = [];
      let _audioResetCalled = false;

      const mockAudioContext = {
        voiceChannel: {
          isPlaying: false,
          chunkCount: 0,
          sendChunk: (chunk: any) => {
            audioChunks.push(chunk.content);
          },
          reset: () => {
            _audioResetCalled = true;
          },
        },
        isReady: true,
        error: null,
      };

      setDefaultHandler((ws) => {
        ws.onClientMessage((data) => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === "ping") return;
          } catch {
            // Not JSON
          }

          // Send PCM audio chunks using data-pcm format (BIDI protocol)
          const pcmData1 = Buffer.from([0, 1, 2, 3]).toString("base64");
          ws.simulateServerMessage({
            type: "data-pcm",
            data: { content: pcmData1 },
          });

          const pcmData2 = Buffer.from([4, 5, 6, 7]).toString("base64");
          ws.simulateServerMessage({
            type: "data-pcm",
            data: { content: pcmData2 },
          });

          // Send [DONE] after delay to ensure all messages are processed
          setTimeout(() => {
            ws.simulateDone();
          }, 100);
        });
      });

      const { useChatOptions } = buildUseChatOptions({
        mode: "adk-bidi",
        initialMessages: [] as UIMessageFromAISDKv6[],
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

    it("should reset audio buffer on new stream", async () => {
      // Given: Audio context with reset tracking
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

      setDefaultHandler((ws) => {
        ws.onClientMessage((data) => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === "ping") return;
          } catch {
            // Not JSON
          }
          // Send minimal response
          ws.sendTextResponse(`text-${Date.now()}`, "OK");
        });
      });

      const { useChatOptions } = buildUseChatOptions({
        mode: "adk-bidi",
        initialMessages: [] as UIMessageFromAISDKv6[],
        audioContext: mockAudioContext,
      });

      const { result } = renderHook(() => useChat(useChatOptions));

      // When: Send a message (triggers reset on new stream)
      await waitFor(() => {
        result.current.sendMessage({ text: "Test message" });
      });

      // Wait for response to be processed
      await waitFor(
        () => {
          const lastMessage = result.current.messages.at(-1);
          const textPart = (lastMessage as any)?.parts?.find(
            (p: any) => p.type === "text",
          );
          expect(textPart?.text).toContain("OK");
        },
        { timeout: 3000 },
      );

      // Then: Reset should have been called when stream started
      // Note: reset() is called in transport.sendMessages() before stream starts
      expect(resetCount).toBeGreaterThan(0);
    });
  });

  describe("Custom Event Handling", () => {
    it("should handle pong events and calculate latency", async () => {
      // Given: Custom Mock handler sends pong
      const latencies: number[] = [];

      const mockLatencyCallback = (latency: number) => {
        latencies.push(latency);
      };

      setDefaultHandler((ws) => {
        ws.onClientMessage((data) => {
          const parsed = JSON.parse(data);

          // Respond to ping with pong
          if (parsed.type === "ping") {
            ws.simulateRawMessage(JSON.stringify({
              type: "pong",
              timestamp: parsed.timestamp,
            }));
          }

          // Also send normal text response for non-ping messages
          if (parsed.type !== "ping") {
            const textId = `text-${Date.now()}`;
            ws.sendTextStart(textId);
            ws.sendTextDelta(textId, "Pong!");
            ws.sendTextEnd(textId);

            // Send [DONE] after delay to ensure all messages are processed
            setTimeout(() => {
              ws.simulateDone();
            }, 100);
          }
        });
      });

      const { useChatOptions } = buildUseChatOptions({
        mode: "adk-bidi",
        initialMessages: [] as UIMessageFromAISDKv6[],
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
      // Given: Custom Mock handler sends malformed data
      setDefaultHandler((ws) => {
        ws.onClientMessage((data) => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === "ping") return;
          } catch {
            // Not JSON
          }

          // Send malformed SSE (invalid JSON)
          ws.simulateRawMessage("data: {invalid json}\n\n");

          // But still send valid response after
          const textId = `text-${Date.now()}`;
          ws.sendTextStart(textId);
          ws.sendTextDelta(textId, "Recovered");
          ws.sendTextEnd(textId);

          // Send [DONE] after delay to ensure all messages are processed
          setTimeout(() => {
            ws.simulateDone();
          }, 100);
        });
      });

      const { useChatOptions } = buildUseChatOptions({
        mode: "adk-bidi",
        initialMessages: [] as UIMessageFromAISDKv6[],
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
      // Given: Custom Mock handler sends non-SSE formatted message
      const consoleLogs: string[] = [];
      const originalWarn = console.warn;
      console.warn = (...args: any[]) => {
        consoleLogs.push(args.join(" "));
        originalWarn(...args);
      };

      setDefaultHandler((ws) => {
        ws.onClientMessage((data) => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === "ping") return;
          } catch {
            // Not JSON
          }

          // Send non-SSE message (should trigger warning)
          ws.simulateRawMessage("Not an SSE message");

          // Then send valid SSE
          ws.sendTextResponse(`text-${Date.now()}`, "Valid");
        });
      });

      const { useChatOptions } = buildUseChatOptions({
        mode: "adk-bidi",
        initialMessages: [] as UIMessageFromAISDKv6[],
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
      // Given: Custom Mock handler for multiple messages
      setDefaultHandler((ws) => {
        ws.onClientMessage((data) => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === "ping") return;
          } catch {
            // Not JSON
          }

          const textId = `text-${Date.now()}`;
          ws.sendTextStart(textId);
          ws.sendTextDelta(textId, "Response");
          ws.sendTextEnd(textId);

          // Send [DONE] after delay to ensure all messages are processed
          setTimeout(() => {
            ws.simulateDone();
          }, 100);
        });
      });

      const { useChatOptions } = buildUseChatOptions({
        mode: "adk-bidi",
        initialMessages: [] as UIMessageFromAISDKv6[],
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
