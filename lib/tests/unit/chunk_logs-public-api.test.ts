/**
 * Public API Tests for lib/chunk_logs
 *
 * Tests the public API exported from lib/chunk_logs/index.ts
 * All tests use only the public API, not internal implementation details.
 */

import type { ChatRequestOptions, UIMessage, UIMessageChunk } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ChunkLogEntry,
  ChunkLoggingTransport,
  ChunkPlayer,
  ChunkPlayerTransport,
  chunkLogger,
  type Mode,
  type PlaybackMode,
} from "../../chunk_logs";

describe("lib/chunk_logs Public API", () => {
  describe("ChunkPlayer - JSONL Parsing", () => {
    it.each([
      {
        name: "parses valid JSONL with single entry",
        jsonl:
          '{"timestamp":1000,"session_id":"s1","mode":"adk-sse","location":"test","direction":"in","sequence_number":1,"chunk":{"type":"text"},"metadata":null}',
        expectedCount: 1,
        expectedChunk: { type: "text" },
      },
      {
        name: "parses multiple entries",
        jsonl:
          '{"timestamp":1000,"session_id":"s1","mode":"adk-sse","location":"test","direction":"in","sequence_number":1,"chunk":{"type":"text"},"metadata":null}\n{"timestamp":1100,"session_id":"s1","mode":"adk-sse","location":"test","direction":"in","sequence_number":2,"chunk":{"type":"tool"},"metadata":null}',
        expectedCount: 2,
        expectedChunk: { type: "text" },
      },
      {
        name: "handles empty lines",
        jsonl:
          '{"timestamp":1000,"session_id":"s1","mode":"adk-sse","location":"test","direction":"in","sequence_number":1,"chunk":{"type":"text"},"metadata":null}\n\n{"timestamp":1100,"session_id":"s1","mode":"adk-sse","location":"test","direction":"in","sequence_number":2,"chunk":{"type":"tool"},"metadata":null}',
        expectedCount: 2,
        expectedChunk: { type: "text" },
      },
    ])("$name", ({ jsonl, expectedCount, expectedChunk }) => {
      // when
      const player = new ChunkPlayer(jsonl);
      const entries = player.getEntries();

      // then
      expect(entries).toHaveLength(expectedCount);
      expect(entries[0].chunk).toEqual(expectedChunk);
    });

    it("throws error on invalid JSON", () => {
      // given
      const invalidJsonl = "invalid json";

      // when/then
      expect(() => new ChunkPlayer(invalidJsonl)).toThrow(
        "Invalid JSONL at line 1",
      );
    });
  });

  describe("ChunkPlayer - Playback Modes", () => {
    const sampleJsonl = [
      '{"timestamp":1000,"session_id":"s1","mode":"adk-sse","location":"test","direction":"in","sequence_number":1,"chunk":{"event":"1"},"metadata":null}',
      '{"timestamp":1100,"session_id":"s1","mode":"adk-sse","location":"test","direction":"in","sequence_number":2,"chunk":{"event":"2"},"metadata":null}',
      '{"timestamp":1200,"session_id":"s1","mode":"adk-sse","location":"test","direction":"in","sequence_number":3,"chunk":{"event":"3"},"metadata":null}',
    ].join("\n");

    it.each<{
      mode: PlaybackMode;
      name: string;
      expectTiming: boolean;
    }>([
      {
        mode: "fast-forward",
        name: "replays in fast-forward mode without delay",
        expectTiming: false,
      },
      {
        mode: "real-time",
        name: "replays in real-time mode with timing",
        expectTiming: true,
      },
      {
        mode: "step",
        name: "replays in step mode",
        expectTiming: false,
      },
    ])("$name", async ({ mode, expectTiming }) => {
      // given
      const player = new ChunkPlayer(sampleJsonl);

      // when
      const startTime = Date.now();
      const chunks: ChunkLogEntry[] = [];
      for await (const entry of player.play({ mode })) {
        chunks.push(entry);
      }
      const elapsedMs = Date.now() - startTime;

      // then
      expect(chunks).toHaveLength(3);
      expect(chunks[0].chunk).toEqual({ event: "1" });
      expect(chunks[1].chunk).toEqual({ event: "2" });
      expect(chunks[2].chunk).toEqual({ event: "3" });

      if (expectTiming) {
        // Real-time mode should take roughly 200ms (1200 - 1000)
        expect(elapsedMs).toBeGreaterThanOrEqual(180);
        expect(elapsedMs).toBeLessThanOrEqual(300);
      }
    });
  });

  describe("ChunkPlayer - Statistics", () => {
    it.each([
      {
        name: "returns correct stats for non-empty JSONL",
        jsonl: [
          '{"timestamp":1000,"session_id":"s1","mode":"adk-sse","location":"test","direction":"in","sequence_number":1,"chunk":{"e":"1"},"metadata":null}',
          '{"timestamp":1500,"session_id":"s1","mode":"adk-sse","location":"test","direction":"in","sequence_number":2,"chunk":{"e":"2"},"metadata":null}',
        ].join("\n"),
        expectedCount: 2,
        expectedDuration: 500,
        expectedFirst: 1000,
        expectedLast: 1500,
      },
      {
        name: "returns empty stats for empty JSONL",
        jsonl: "",
        expectedCount: 0,
        expectedDuration: 0,
        expectedFirst: null,
        expectedLast: null,
      },
    ])("$name", ({
      jsonl,
      expectedCount,
      expectedDuration,
      expectedFirst,
      expectedLast,
    }) => {
      // given
      const player = new ChunkPlayer(jsonl);

      // when
      const stats = player.getStats();

      // then
      expect(stats.count).toBe(expectedCount);
      expect(stats.duration_ms).toBe(expectedDuration);
      expect(stats.first_timestamp).toBe(expectedFirst);
      expect(stats.last_timestamp).toBe(expectedLast);
    });
  });

  describe("ChunkLoggingTransport - Wrapper Behavior", () => {
    it.each<{ mode: Mode; name: string }>([
      { mode: "adk-bidi", name: "wraps transport for adk-bidi mode" },
      { mode: "adk-sse", name: "wraps transport for adk-sse mode" },
      { mode: "gemini", name: "wraps transport for gemini mode" },
    ])("$name", async ({ mode }) => {
      // given
      const mockDelegate = {
        sendMessages: vi.fn().mockResolvedValue({
          getReader: () => ({
            read: vi
              .fn()
              .mockResolvedValueOnce({
                done: false,
                value: { type: "text-delta", textDelta: "hello" },
              })
              .mockResolvedValueOnce({ done: true }),
            releaseLock: vi.fn(),
          }),
        }),
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
      expect(chunks[0]).toEqual({ type: "text-delta", textDelta: "hello" });
    });
  });

  describe("ChunkPlayerTransport - Mock Transport", () => {
    const fixtureJsonl = [
      '{"timestamp":1000,"session_id":"s1","mode":"adk-sse","location":"test","direction":"in","sequence_number":1,"chunk":{"type":"text-delta","textDelta":"Hello"},"metadata":null}',
      '{"timestamp":1100,"session_id":"s1","mode":"adk-sse","location":"test","direction":"in","sequence_number":2,"chunk":{"type":"text-delta","textDelta":" World"},"metadata":null}',
    ].join("\n");

    beforeEach(() => {
      // Mock fetch for fixture loading
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => fixtureJsonl,
      });
    });

    it("loads fixture and replays chunks", async () => {
      // given
      const transport = ChunkPlayerTransport.fromFixture(
        "/fixtures/test.jsonl",
      );
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
      expect(chunks[0]).toEqual({ type: "text-delta", textDelta: "Hello" });
      expect(chunks[1]).toEqual({ type: "text-delta", textDelta: " World" });
    });
  });

  describe("chunkLogger - Singleton Instance", () => {
    it("exports singleton logger instance with correct API", () => {
      // then
      expect(chunkLogger).toBeDefined();
      expect(typeof chunkLogger.logChunk).toBe("function");
      expect(typeof chunkLogger.isEnabled).toBe("function");
      expect(typeof chunkLogger.export).toBe("function");
      expect(typeof chunkLogger.getEntries).toBe("function");
      expect(typeof chunkLogger.clear).toBe("function");
    });

    it.each<{ mode: Mode }>([
      { mode: "adk-bidi" },
      { mode: "adk-sse" },
      { mode: "gemini" },
    ])("logs chunk for mode $mode", ({ mode }) => {
      // given
      chunkLogger.clear(); // Clear previous entries
      const initialEntryCount = chunkLogger.getEntries().length;

      // when
      chunkLogger.logChunk({
        location: "frontend-test",
        direction: "in",
        chunk: { type: "text-delta", textDelta: "test" },
        mode,
      });

      // then
      const entries = chunkLogger.getEntries();
      expect(entries.length).toBe(initialEntryCount + 1);
      const lastEntry = entries[entries.length - 1];
      expect(lastEntry.mode).toBe(mode);
      expect(lastEntry.location).toBe("frontend-test");
      expect(lastEntry.chunk).toEqual({
        type: "text-delta",
        textDelta: "test",
      });

      // cleanup
      chunkLogger.clear();
    });
  });

  describe("Type Exports", () => {
    it("exports required types", () => {
      // This test verifies that types are correctly exported
      // TypeScript will fail compilation if types are not exported

      const _mode: Mode = "adk-bidi";
      const _playbackMode: PlaybackMode = "fast-forward";
      const _logEntry: ChunkLogEntry = {
        timestamp: 1000,
        session_id: "s1",
        mode: "adk-sse",
        location: "test",
        direction: "in",
        sequence_number: 1,
        chunk: {},
        metadata: null,
      };

      // If this compiles, types are correctly exported
      expect(_mode).toBeDefined();
      expect(_playbackMode).toBeDefined();
      expect(_logEntry).toBeDefined();
    });
  });
});
