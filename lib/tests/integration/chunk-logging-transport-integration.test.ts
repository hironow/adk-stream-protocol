/**
 * Integration Tests for ChunkLoggingTransport
 *
 * Tests that ChunkLoggingTransport correctly wraps real transports and logs chunks.
 * Verifies buildUseChatOptions properly integrates chunk logging across all modes.
 *
 * Test Strategy:
 * - Use MSW to mock WebSocket and HTTP endpoints
 * - Create real transport instances (WebSocketChatTransport, DefaultChatTransport)
 * - Wrap with ChunkLoggingTransport
 * - Verify chunks are logged with correct metadata
 * - Verify buildUseChatOptions returns ChunkLoggingTransport wrapper
 */

import type { UIMessage } from "ai";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildBidiUseChatOptions } from "../../bidi/use-chat-options";
import { WebSocketChatTransport } from "../../bidi/transport";
import { ChunkLoggingTransport, chunkLogger } from "../../chunk_logs";
import { buildSseUseChatOptions } from "../../sse/use-chat-options";
import { createBidiWebSocketLink, createTextResponseHandler } from "../helpers/bidi-ws-handlers";

const server = setupServer();

beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  server.resetHandlers();
  chunkLogger.clear();
});

afterAll(() => {
  server.close();
});

describe("ChunkLoggingTransport Integration Tests", () => {
  describe("BIDI Mode - WebSocketChatTransport Wrapping", () => {
    it("should wrap WebSocketChatTransport and log all chunks", async () => {
      // given
      const chat = createBidiWebSocketLink();
      server.use(createTextResponseHandler(chat, "Hello", " ", "World"));

      const wsTransport = new WebSocketChatTransport({
        url: "ws://localhost:8000/live",
      });
      const loggingTransport = new ChunkLoggingTransport(wsTransport, "adk-bidi");

      const messages: UIMessage[] = [
        { id: "1", role: "user", parts: [{ type: "text", text: "Test" }] },
      ] as UIMessage[];

      const initialLogCount = chunkLogger.getEntries().length;

      // when
      const stream = await loggingTransport.sendMessages({
        trigger: "submit-message",
        chatId: "test-chat",
        messages,
        messageId: "msg-1",
        abortSignal: new AbortController().signal,
      });

      // Consume stream
      const reader = stream.getReader();
      const chunks = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      // then
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.some((c) => c.type === "text-delta")).toBe(true);

      // Verify chunks were logged
      const loggedEntries = chunkLogger.getEntries();
      expect(loggedEntries.length).toBeGreaterThan(initialLogCount);

      // Verify logged entry metadata
      const loggedEntry = loggedEntries[loggedEntries.length - 1];
      expect(loggedEntry.mode).toBe("adk-bidi");
      expect(loggedEntry.chunk).toBeDefined();

      wsTransport._close();
    });

    it("should verify buildBidiUseChatOptions returns ChunkLoggingTransport wrapper", async () => {
      // given
      const chat = createBidiWebSocketLink();
      server.use(createTextResponseHandler(chat, "Test"));

      // when
      const { useChatOptions, transport } = buildBidiUseChatOptions({
        initialMessages: [],
        adkBackendUrl: "http://localhost:8000",
      });

      // then
      expect(useChatOptions.transport).toBeInstanceOf(ChunkLoggingTransport);
      expect(transport).toBeInstanceOf(WebSocketChatTransport);

      // Verify wrapped transport works
      const messages: UIMessage[] = [
        { id: "1", role: "user", parts: [{ type: "text", text: "Test" }] },
      ] as UIMessage[];

      const stream = await useChatOptions.transport.sendMessages({
        trigger: "submit-message",
        chatId: "test-chat",
        messages,
        messageId: "msg-1",
        abortSignal: new AbortController().signal,
      });

      const reader = stream.getReader();
      const chunks = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      expect(chunks.length).toBeGreaterThan(0);

      transport._close();
    });

    it("should log chunks with correct sequence numbers for BIDI mode", async () => {
      // given
      const chat = createBidiWebSocketLink();
      server.use(createTextResponseHandler(chat, "First", "Second", "Third"));

      const wsTransport = new WebSocketChatTransport({
        url: "ws://localhost:8000/live",
      });
      const loggingTransport = new ChunkLoggingTransport(wsTransport, "adk-bidi");

      chunkLogger.clear();

      // when
      const messages: UIMessage[] = [
        { id: "1", role: "user", parts: [{ type: "text", text: "Test" }] },
      ] as UIMessage[];

      const stream = await loggingTransport.sendMessages({
        trigger: "submit-message",
        chatId: "test-chat",
        messages,
        messageId: "msg-1",
        abortSignal: new AbortController().signal,
      });

      const reader = stream.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }

      // then
      const entries = chunkLogger.getEntries();
      expect(entries.length).toBeGreaterThan(0);

      // Verify sequence numbers are sequential for same location
      const sequences = entries.map((e) => e.sequence_number);
      for (let i = 1; i < sequences.length; i++) {
        expect(sequences[i]).toBe(sequences[i - 1] + 1);
      }

      wsTransport._close();
    });
  });

  describe("SSE Mode - DefaultChatTransport Wrapping", () => {
    it("should verify buildSseUseChatOptions returns ChunkLoggingTransport wrapper for ADK SSE", () => {
      // when
      const { useChatOptions, transport } = buildSseUseChatOptions({
        mode: "adk-sse",
        initialMessages: [],
        adkBackendUrl: "http://localhost:8000",
      });

      // then
      expect(useChatOptions.transport).toBeInstanceOf(ChunkLoggingTransport);
      expect(transport).toBeUndefined(); // SSE mode doesn't expose transport reference
      expect(useChatOptions.sendAutomaticallyWhen).toBeDefined(); // ADK SSE has confirmation flow
    });

    it("should verify buildSseUseChatOptions returns ChunkLoggingTransport wrapper for Gemini", () => {
      // when
      const { useChatOptions, transport } = buildSseUseChatOptions({
        mode: "gemini",
        initialMessages: [],
      });

      // then
      expect(useChatOptions.transport).toBeInstanceOf(ChunkLoggingTransport);
      expect(transport).toBeUndefined();
      expect(useChatOptions.sendAutomaticallyWhen).toBeUndefined(); // Gemini doesn't have confirmation flow
    });
  });

  describe("ChunkLoggingTransport - Mode Differentiation", () => {
    it("should log chunks with correct mode metadata for different transport types", async () => {
      // given
      const chat = createBidiWebSocketLink();
      server.use(createTextResponseHandler(chat, "Test"));

      const wsTransport = new WebSocketChatTransport({
        url: "ws://localhost:8000/live",
      });

      // Test different modes
      const modes = ["adk-bidi", "adk-sse", "gemini"] as const;
      const results: Array<{ mode: string; logged: boolean }> = [];

      for (const mode of modes) {
        chunkLogger.clear();

        const loggingTransport = new ChunkLoggingTransport(wsTransport, mode);

        const messages: UIMessage[] = [
          { id: "1", role: "user", parts: [{ type: "text", text: "Test" }] },
        ] as UIMessage[];

        const stream = await loggingTransport.sendMessages({
          trigger: "submit-message",
          chatId: `test-${mode}`,
          messages,
          messageId: "msg-1",
          abortSignal: new AbortController().signal,
        });

        const reader = stream.getReader();
        while (true) {
          const { done } = await reader.read();
          if (done) break;
        }

        const entries = chunkLogger.getEntries();
        const hasCorrectMode = entries.every((e) => e.mode === mode);

        results.push({ mode, logged: entries.length > 0 && hasCorrectMode });
      }

      // then
      expect(results.every((r) => r.logged)).toBe(true);

      wsTransport._close();
    });
  });

  describe("ChunkLoggingTransport - Stream Passthrough", () => {
    it("should pass through all chunks without modification", async () => {
      // given
      const chat = createBidiWebSocketLink();
      const expectedTexts = ["Hello", " ", "World", "!"];
      server.use(createTextResponseHandler(chat, ...expectedTexts));

      const wsTransport = new WebSocketChatTransport({
        url: "ws://localhost:8000/live",
      });
      const loggingTransport = new ChunkLoggingTransport(wsTransport, "adk-bidi");

      // when
      const messages: UIMessage[] = [
        { id: "1", role: "user", parts: [{ type: "text", text: "Test" }] },
      ] as UIMessage[];

      const stream = await loggingTransport.sendMessages({
        trigger: "submit-message",
        chatId: "test-chat",
        messages,
        messageId: "msg-1",
        abortSignal: new AbortController().signal,
      });

      const reader = stream.getReader();
      const chunks = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      // then
      const textDeltas = chunks.filter((c) => c.type === "text-delta");
      expect(textDeltas.length).toBe(expectedTexts.length);

      const receivedTexts = textDeltas.map((c) => c.delta);
      expect(receivedTexts).toEqual(expectedTexts);

      wsTransport._close();
    });
  });
});
