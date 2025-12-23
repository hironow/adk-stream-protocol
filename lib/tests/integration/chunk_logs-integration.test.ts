/**
 * Integration Tests for lib/chunk_logs
 *
 * Tests chunk logging and replay functionality with real transport wrapping.
 * Verifies logging behavior, JSONL parsing, and fixture-based playback.
 */

import type { ChatRequestOptions, UIMessage, UIMessageChunk } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ChunkLogEntry,
  ChunkLoggingTransport,
  ChunkPlayer,
  ChunkPlayerTransport,
  type Mode,
  chunkLogger,
} from "../../chunk_logs";

describe("lib/chunk_logs Integration Tests", () => {
  beforeEach(() => {
    chunkLogger.clear();
  });

  describe("ChunkLoggingTransport - Transport Wrapping", () => {
    it.each<{ mode: Mode }>([
      { mode: "adk-bidi" },
      { mode: "adk-sse" },
      { mode: "gemini" },
    ])("wraps $mode transport and logs chunks", async ({ mode }) => {
      // given
      const mockDelegate = {
        sendMessages: vi.fn().mockResolvedValue({
          getReader: () => ({
            read: vi
              .fn()
              .mockResolvedValueOnce({
                done: false,
                value: { type: "text-delta", textDelta: "Test" },
              })
              .mockResolvedValueOnce({ done: true }),
            releaseLock: vi.fn(),
          }),
        }),
        reconnectToStream: vi.fn(),
      };

      const transport = new ChunkLoggingTransport(mockDelegate as any, mode);

      const messages: UIMessage[] = [];
      const requestOptions = {
        trigger: "submit-message" as const,
        chatId: "test-chat",
        messageId: "test-message",
        messages,
        abortSignal: undefined,
      };

      chunkLogger.clear();
      const initialCount = chunkLogger.getEntries().length;

      // when
      const result = await transport.sendMessages(requestOptions);
      const reader = result.getReader();
      const chunks: UIMessageChunk[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      // then
      expect(mockDelegate.sendMessages).toHaveBeenCalledWith(requestOptions);
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toEqual({ type: "text-delta", textDelta: "Test" });

      // Verify chunk was logged
      const loggedEntries = chunkLogger.getEntries();
      expect(loggedEntries.length).toBeGreaterThan(initialCount);

      const lastEntry = loggedEntries[loggedEntries.length - 1];
      expect(lastEntry.mode).toBe(mode);
      expect(lastEntry.chunk).toEqual({ type: "text-delta", textDelta: "Test" });
    });

    it("forwards all chunks through the stream", async () => {
      // given
      const mockChunks = [
        { type: "text-delta", textDelta: "Hello" },
        { type: "text-delta", textDelta: " " },
        { type: "text-delta", textDelta: "World" },
      ] as UIMessageChunk[];

      const mockDelegate = {
        sendMessages: vi.fn().mockResolvedValue({
          getReader: () => ({
            read: vi
              .fn()
              .mockResolvedValueOnce({ done: false, value: mockChunks[0] })
              .mockResolvedValueOnce({ done: false, value: mockChunks[1] })
              .mockResolvedValueOnce({ done: false, value: mockChunks[2] })
              .mockResolvedValueOnce({ done: true }),
            releaseLock: vi.fn(),
          }),
        }),
        reconnectToStream: vi.fn(),
      };

      const transport = new ChunkLoggingTransport(mockDelegate as any, "adk-sse");

      chunkLogger.clear();

      // when
      const result = await transport.sendMessages({
        trigger: "submit-message",
        chatId: "test-chat",
        messageId: "test-message",
        messages: [],
        abortSignal: undefined,
      });

      const reader = result.getReader();
      const receivedChunks: UIMessageChunk[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        receivedChunks.push(value);
      }

      // then
      expect(receivedChunks).toEqual(mockChunks);
      expect(chunkLogger.getEntries()).toHaveLength(3);
    });
  });

  describe("ChunkPlayer - JSONL Replay", () => {
    it("replays chunks from JSONL fixture in fast-forward mode", async () => {
      // given
      const fixtureJsonl = [
        '{"timestamp":1000,"session_id":"s1","mode":"adk-sse","location":"test","direction":"in","sequence_number":1,"chunk":{"type":"text-delta","textDelta":"First"},"metadata":null}',
        '{"timestamp":1100,"session_id":"s1","mode":"adk-sse","location":"test","direction":"in","sequence_number":2,"chunk":{"type":"text-delta","textDelta":"Second"},"metadata":null}',
        '{"timestamp":1200,"session_id":"s1","mode":"adk-sse","location":"test","direction":"in","sequence_number":3,"chunk":{"type":"text-delta","textDelta":"Third"},"metadata":null}',
      ].join("\n");

      const player = new ChunkPlayer(fixtureJsonl);

      // when
      const chunks: ChunkLogEntry[] = [];
      for await (const entry of player.play({ mode: "fast-forward" })) {
        chunks.push(entry);
      }

      // then
      expect(chunks).toHaveLength(3);
      expect(chunks[0].chunk).toEqual({ type: "text-delta", textDelta: "First" });
      expect(chunks[1].chunk).toEqual({ type: "text-delta", textDelta: "Second" });
      expect(chunks[2].chunk).toEqual({ type: "text-delta", textDelta: "Third" });
    });

    it("provides accurate statistics for JSONL fixture", () => {
      // given
      const fixtureJsonl = [
        '{"timestamp":1000,"session_id":"s1","mode":"adk-sse","location":"test","direction":"in","sequence_number":1,"chunk":{"type":"text-delta","textDelta":"A"},"metadata":null}',
        '{"timestamp":1500,"session_id":"s1","mode":"adk-sse","location":"test","direction":"in","sequence_number":2,"chunk":{"type":"text-delta","textDelta":"B"},"metadata":null}',
      ].join("\n");

      // when
      const player = new ChunkPlayer(fixtureJsonl);
      const stats = player.getStats();

      // then
      expect(stats.count).toBe(2);
      expect(stats.duration_ms).toBe(500); // 1500 - 1000
      expect(stats.first_timestamp).toBe(1000);
      expect(stats.last_timestamp).toBe(1500);
    });
  });

  describe("ChunkPlayerTransport - Mock Transport for Testing", () => {
    it("loads fixture and replays as transport", async () => {
      // given
      const fixtureJsonl = [
        '{"timestamp":1000,"session_id":"s1","mode":"adk-sse","location":"test","direction":"in","sequence_number":1,"chunk":{"type":"text-delta","textDelta":"Mocked"},"metadata":null}',
        '{"timestamp":1100,"session_id":"s1","mode":"adk-sse","location":"test","direction":"in","sequence_number":2,"chunk":{"type":"text-delta","textDelta":" Response"},"metadata":null}',
      ].join("\n");

      // Mock fetch for fixture loading
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => fixtureJsonl,
      });

      const transport = ChunkPlayerTransport.fromFixture("/fixtures/test.jsonl");

      const messages: UIMessage[] = [];
      const options: ChatRequestOptions = {};

      // when
      const result = await transport.sendMessages(messages, options);
      const reader = result.getReader();
      const chunks: UIMessageChunk[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      // then
      expect(chunks).toHaveLength(2);
      expect(chunks[0]).toEqual({ type: "text-delta", textDelta: "Mocked" });
      expect(chunks[1]).toEqual({ type: "text-delta", textDelta: " Response" });
    });

    it("reconnectToStream returns null (not supported)", async () => {
      // given
      const transport = ChunkPlayerTransport.fromFixture("/fixtures/test.jsonl");

      // when
      const result = await transport.reconnectToStream({ chatId: "test" });

      // then
      expect(result).toBeNull();
    });
  });

  describe("chunkLogger - Singleton Instance", () => {
    it("logs chunks with correct metadata", () => {
      // given
      chunkLogger.clear();

      // when
      chunkLogger.logChunk({
        location: "frontend-test",
        direction: "in",
        chunk: { type: "test", data: "value" },
        mode: "adk-sse",
        metadata: { source: "integration-test" },
      });

      // then
      const entries = chunkLogger.getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        mode: "adk-sse",
        location: "frontend-test",
        direction: "in",
        chunk: { type: "test", data: "value" },
        metadata: { source: "integration-test" },
      });
      expect(entries[0].timestamp).toBeGreaterThan(0);
      expect(entries[0].sequence_number).toBeGreaterThan(0);
    });

    it("tracks sequence numbers per location", () => {
      // given
      chunkLogger.clear();

      // when
      chunkLogger.logChunk({
        location: "frontend-test",
        direction: "in",
        chunk: { a: 1 },
        mode: "adk-sse",
      });
      chunkLogger.logChunk({
        location: "frontend-test",
        direction: "in",
        chunk: { a: 2 },
        mode: "adk-sse",
      });
      chunkLogger.logChunk({
        location: "frontend-other",
        direction: "in",
        chunk: { b: 1 },
        mode: "adk-sse",
      });

      // then
      const entries = chunkLogger.getEntries();
      expect(entries).toHaveLength(3);
      expect(entries[0].sequence_number).toBe(1);
      expect(entries[1].sequence_number).toBe(2);
      expect(entries[2].sequence_number).toBe(1); // Different location resets counter
    });
  });
});
