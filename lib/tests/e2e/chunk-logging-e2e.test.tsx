/**
 * E2E Test: ChunkLogging with Real WebSocket
 *
 * Tests that ChunkLoggingTransport correctly logs all chunks in real E2E scenarios:
 * 1. BIDI mode with buildUseChatOptions wrapping WebSocketChatTransport
 * 2. Real useChat hook consuming the wrapped transport
 * 3. Actual WebSocket communication (mocked with MSW)
 * 4. Chunk logger capturing all chunks with correct metadata
 *
 * This is an E2E test - we use:
 * - Real React components and useChat hook
 * - Real WebSocketChatTransport wrapped with ChunkLoggingTransport
 * - Real EventSender/EventReceiver
 * - MSW for WebSocket mocking (simulates real backend)
 *
 * @vitest-environment jsdom
 */

import { useChat } from "@ai-sdk/react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { buildUseChatOptions } from "../../bidi";
import { chunkLogger } from "../../chunk_logs";
import type { UIMessageFromAISDKv6 } from "../../utils";
import { isTextUIPartFromAISDKv6 } from "../../utils";
import { useMockWebSocket } from "../helpers/mock-websocket";

/**
 * Helper function to extract text content from UIMessageFromAISDKv6 parts
 */
function getMessageText(message: UIMessageFromAISDKv6 | undefined): string {
  if (!message) return "";
  return message.parts
    .filter((part): part is { type: "text"; text: string } =>
      isTextUIPartFromAISDKv6(part),
    )
    .map((part) => part.text)
    .join("");
}

describe("ChunkLogging E2E Tests", () => {
  const { setDefaultHandler } = useMockWebSocket();

  // Additional cleanup: Clear chunk logger after each test
  afterEach(() => {
    chunkLogger.clear();
  });

  describe("BIDI Mode - ChunkLogging with Real WebSocket", () => {
    it("should log all chunks in BIDI mode with real WebSocket flow", async () => {
      // given
      setDefaultHandler((ws) => {
        ws.onClientMessage((data) => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === "ping") return;
          } catch {
            return;
          }
          const textId = `text-${Date.now()}`;
          ws.sendTextStart(textId);
          ws.sendTextDelta(textId, "Hello");
          ws.sendTextDelta(textId, " ");
          ws.sendTextDelta(textId, "World");
          ws.sendTextEnd(textId);
          ws.simulateDone();
        });
      });

      const { useChatOptions, transport } = buildUseChatOptions({
        initialMessages: [],
        adkBackendUrl: "http://localhost:8000",
        forceNewInstance: true,
      });

      // Clear logger before test
      chunkLogger.clear();
      const initialLogCount = chunkLogger.getEntries().length;
      expect(initialLogCount).toBe(0);

      // when
      const { result } = renderHook(() => useChat(useChatOptions));

      // Send message through useChat
      await act(async () => {
        result.current.sendMessage({ text: "Test message" });
      });

      // Wait for response to complete
      await waitFor(
        () => {
          const lastMessage =
            result.current.messages[result.current.messages.length - 1];
          return (
            lastMessage?.role === "assistant" &&
            getMessageText(lastMessage) === "Hello World"
          );
        },
        { timeout: 5000 },
      );

      // then
      const loggedEntries = chunkLogger.getEntries();

      // Verify chunks were logged
      expect(loggedEntries.length).toBeGreaterThan(0);

      // Verify all entries have correct mode
      const allBidiMode = loggedEntries.every(
        (entry) => entry.mode === "adk-bidi",
      );
      expect(allBidiMode).toBe(true);

      // Verify we logged text deltas
      const textDeltaChunks = loggedEntries.filter((entry) => {
        const chunk = entry.chunk as any;
        return chunk?.type === "text-delta";
      });
      expect(textDeltaChunks.length).toBeGreaterThan(0);

      // Verify logged chunks include our text
      const loggedText = textDeltaChunks
        .map((entry) => (entry.chunk as any).delta)
        .join("");
      expect(loggedText).toBe("Hello World");

      // Cleanup
      transport._close();
    });

    it("should log chunks with correct sequence numbers", async () => {
      // given
      setDefaultHandler((ws) => {
        ws.onClientMessage((data) => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === "ping") return;
          } catch {
            return;
          }
          const textId = `text-${Date.now()}`;
          ws.sendTextStart(textId);
          ws.sendTextDelta(textId, "First");
          ws.sendTextDelta(textId, "Second");
          ws.sendTextDelta(textId, "Third");
          ws.sendTextEnd(textId);
          ws.simulateDone();
        });
      });

      const { useChatOptions, transport } = buildUseChatOptions({
        initialMessages: [],
        adkBackendUrl: "http://localhost:8000",
        forceNewInstance: true,
      });

      chunkLogger.clear();

      // when
      const { result } = renderHook(() => useChat(useChatOptions));

      await act(async () => {
        result.current.sendMessage({ text: "Test" });
      });

      await waitFor(
        () => {
          const lastMessage =
            result.current.messages[result.current.messages.length - 1];
          return (
            lastMessage?.role === "assistant" &&
            getMessageText(lastMessage) === "FirstSecondThird"
          );
        },
        { timeout: 5000 },
      );

      // then
      const loggedEntries = chunkLogger.getEntries();
      expect(loggedEntries.length).toBeGreaterThan(0);

      // Verify sequence numbers are sequential
      const sequences = loggedEntries.map((e) => e.sequence_number);
      for (let i = 1; i < sequences.length; i++) {
        expect(sequences[i]).toBe(sequences[i - 1] + 1);
      }

      // Verify all entries have session_id
      const allHaveSessionId = loggedEntries.every((entry) => entry.session_id);
      expect(allHaveSessionId).toBe(true);

      // Verify all entries have timestamps
      const allHaveTimestamp = loggedEntries.every(
        (entry) => entry.timestamp && entry.timestamp > 0,
      );
      expect(allHaveTimestamp).toBe(true);

      transport._close();
    });

    it("should log chunks with correct location and direction metadata", async () => {
      // given
      setDefaultHandler((ws) => {
        ws.onClientMessage((data) => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === "ping") return;
          } catch {
            return;
          }
          ws.sendTextResponse(`text-${Date.now()}`, "Test");
        });
      });

      const { useChatOptions, transport } = buildUseChatOptions({
        initialMessages: [],
        adkBackendUrl: "http://localhost:8000",
        forceNewInstance: true,
      });

      chunkLogger.clear();

      // when
      const { result } = renderHook(() => useChat(useChatOptions));

      await act(async () => {
        result.current.sendMessage({ text: "Message" });
      });

      await waitFor(
        () => {
          const lastMessage =
            result.current.messages[result.current.messages.length - 1];
          return (
            lastMessage?.role === "assistant" &&
            getMessageText(lastMessage) === "Test"
          );
        },
        { timeout: 5000 },
      );

      // then
      const loggedEntries = chunkLogger.getEntries();

      // Verify location metadata
      const allHaveLocation = loggedEntries.every((entry) => entry.location);
      expect(allHaveLocation).toBe(true);

      // Verify direction metadata (should be "in" for incoming chunks)
      const allHaveDirection = loggedEntries.every(
        (entry) => entry.direction === "in",
      );
      expect(allHaveDirection).toBe(true);

      transport._close();
    });

    it("should log multiple message exchanges in sequence", async () => {
      // given
      let messageCount = 0;

      setDefaultHandler((ws) => {
        ws.onClientMessage((data) => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === "ping") return;
          } catch {
            return;
          }

          messageCount++;
          const textId = `text-${Date.now()}-${messageCount}`;

          ws.sendTextStart(textId);
          ws.sendTextDelta(textId, `Response${messageCount}`);
          ws.sendTextEnd(textId);
          ws.simulateDone();
        });
      });

      const { useChatOptions, transport } = buildUseChatOptions({
        initialMessages: [],
        adkBackendUrl: "http://localhost:8000",
        forceNewInstance: true,
      });

      chunkLogger.clear();

      // when
      const { result } = renderHook(() => useChat(useChatOptions));

      // Send first message
      await act(async () => {
        result.current.sendMessage({ text: "First" });
      });

      await waitFor(
        () => {
          const lastMessage =
            result.current.messages[result.current.messages.length - 1];
          return (
            lastMessage?.role === "assistant" &&
            getMessageText(lastMessage) === "Response1"
          );
        },
        { timeout: 5000 },
      );

      const entriesAfterFirst = chunkLogger.getEntries().length;

      // Send second message
      await act(async () => {
        result.current.sendMessage({ text: "Second" });
      });

      await waitFor(
        () => {
          const lastMessage =
            result.current.messages[result.current.messages.length - 1];
          return (
            lastMessage?.role === "assistant" &&
            getMessageText(lastMessage) === "Response2"
          );
        },
        { timeout: 5000 },
      );

      // then
      const totalEntries = chunkLogger.getEntries();

      // Verify we logged chunks for both messages
      expect(totalEntries.length).toBeGreaterThan(entriesAfterFirst);

      // Verify sequence numbers continue incrementing across messages
      const sequences = totalEntries.map((e) => e.sequence_number);
      for (let i = 1; i < sequences.length; i++) {
        expect(sequences[i]).toBe(sequences[i - 1] + 1);
      }

      transport._close();
    });
  });

  describe("ChunkLogging - Export and Replay", () => {
    it("should be able to export logged chunks for replay", async () => {
      // given
      setDefaultHandler((ws) => {
        ws.onClientMessage((data) => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === "ping") return;
          } catch {
            return;
          }
          const textId = `text-${Date.now()}`;
          ws.sendTextStart(textId);
          ws.sendTextDelta(textId, "Export");
          ws.sendTextDelta(textId, "Test");
          ws.sendTextEnd(textId);
          ws.simulateDone();
        });
      });

      const { useChatOptions, transport } = buildUseChatOptions({
        initialMessages: [],
        adkBackendUrl: "http://localhost:8000",
        forceNewInstance: true,
      });

      chunkLogger.clear();

      // when
      const { result } = renderHook(() => useChat(useChatOptions));

      await act(async () => {
        result.current.sendMessage({ text: "Test" });
      });

      await waitFor(
        () => {
          const lastMessage =
            result.current.messages[result.current.messages.length - 1];
          return (
            lastMessage?.role === "assistant" &&
            getMessageText(lastMessage) === "ExportTest"
          );
        },
        { timeout: 5000 },
      );

      // then
      const entries = chunkLogger.getEntries();
      expect(entries.length).toBeGreaterThan(0);

      // Verify entries are in JSONL-compatible format
      entries.forEach((entry) => {
        // Each entry should be serializable to JSON
        const jsonString = JSON.stringify(entry);
        expect(jsonString).toBeDefined();

        // Should be able to parse back
        const parsed = JSON.parse(jsonString);
        expect(parsed.mode).toBe("adk-bidi");
        expect(parsed.sequence_number).toBeDefined();
      });

      transport._close();
    });
  });
});
