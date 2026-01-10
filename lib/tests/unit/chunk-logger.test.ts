/**
 * ChunkLogger Tests
 * Tests for logging and debugging message chunks
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChunkLogger } from "../../chunk_logs/chunk-logger";

describe("ChunkLogger", () => {
  describe("Enable/Disable", () => {
    it("should respect enabled state via constructor", () => {
      // given
      const enabledLogger = new ChunkLogger(true, "test-session");
      const disabledLogger = new ChunkLogger(false, "test-session");

      // then
      expect(enabledLogger.isEnabled()).toBe(true);
      expect(disabledLogger.isEnabled()).toBe(false);
    });

    it("should not log chunks when disabled", () => {
      // given
      const logger = new ChunkLogger(false, "test-session");

      // when
      logger.logChunk({
        location: "transport",
        direction: "out",
        chunk: { type: "text-delta", textDelta: "Hello" },
      });

      // then
      expect(logger.getEntries()).toHaveLength(0);
    });

    it("should log chunks when enabled", () => {
      // given
      const logger = new ChunkLogger(true, "test-session");

      // when
      logger.logChunk({
        location: "transport",
        direction: "out",
        chunk: { type: "text-delta", textDelta: "Hello" },
      });

      // then
      expect(logger.getEntries()).toHaveLength(1);
    });
  });

  describe("Chunk Logging", () => {
    let logger: ChunkLogger;

    beforeEach(() => {
      logger = new ChunkLogger(true, "test-session");
    });

    it("should log text-delta chunks", () => {
      // given
      const chunk = { type: "text-delta", textDelta: "Hello World" };

      // when
      logger.logChunk({
        location: "transport",
        direction: "out",
        chunk,
        mode: "adk-sse",
      });

      // then
      const entries = logger.getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        session_id: "test-session",
        mode: "adk-sse",
        location: "transport",
        direction: "out",
        sequence_number: 1,
        chunk: { type: "text-delta", textDelta: "Hello World" },
      });
    });

    it("should log tool-call chunks", () => {
      // given
      const chunk = {
        type: "tool-call",
        toolCallId: "call_123",
        toolName: "search",
        args: { query: "test" },
      };

      // when
      logger.logChunk({
        location: "frontend",
        direction: "in",
        chunk,
        mode: "adk-bidi",
      });

      // then
      const entries = logger.getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].chunk).toMatchObject({
        type: "tool-call",
        toolName: "search",
      });
    });

    it("should log tool-result chunks", () => {
      // given
      const chunk = {
        type: "tool-result",
        toolCallId: "call_123",
        toolName: "search",
        result: { results: ["item1", "item2"] },
      };

      // when
      logger.logChunk({
        location: "transport",
        direction: "out",
        chunk,
        mode: "adk-sse",
      });

      // then
      const entries = logger.getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].chunk).toMatchObject({
        type: "tool-result",
        toolName: "search",
      });
    });

    it("should log finish chunks with metadata", () => {
      // given
      const chunk = {
        type: "finish",
        finishReason: "stop",
      };

      // when
      logger.logChunk({
        location: "transport",
        direction: "out",
        chunk,
        metadata: { messageId: "msg_123" },
      });

      // then
      const entries = logger.getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].metadata).toEqual({ messageId: "msg_123" });
    });
  });

  describe("Session Management", () => {
    it("should track sequence numbers per location", () => {
      // given
      const logger = new ChunkLogger(true, "test-session");
      const chunk = { type: "text-delta", textDelta: "test" };

      // when - log to two different locations
      logger.logChunk({ location: "transport", direction: "out", chunk });
      logger.logChunk({ location: "transport", direction: "out", chunk });
      logger.logChunk({ location: "frontend", direction: "in", chunk });
      logger.logChunk({ location: "transport", direction: "out", chunk });

      // then
      const entries = logger.getEntries();
      expect(entries[0]).toMatchObject({
        location: "transport",
        sequence_number: 1,
      });
      expect(entries[1]).toMatchObject({
        location: "transport",
        sequence_number: 2,
      });
      expect(entries[2]).toMatchObject({
        location: "frontend",
        sequence_number: 1,
      });
      expect(entries[3]).toMatchObject({
        location: "transport",
        sequence_number: 3,
      });
    });

    it("should include timestamp in entries", () => {
      // given
      const logger = new ChunkLogger(true, "test-session");
      const beforeTimestamp = Date.now();

      // when
      logger.logChunk({
        location: "transport",
        direction: "out",
        chunk: { type: "text-delta" },
      });

      // then
      const afterTimestamp = Date.now();
      const entries = logger.getEntries();
      expect(entries[0].timestamp).toBeGreaterThanOrEqual(beforeTimestamp);
      expect(entries[0].timestamp).toBeLessThanOrEqual(afterTimestamp);
    });

    it("should clear entries and reset sequence counters", () => {
      // given
      const logger = new ChunkLogger(true, "test-session");
      logger.logChunk({
        location: "transport",
        direction: "out",
        chunk: { type: "text-delta" },
      });
      logger.logChunk({
        location: "transport",
        direction: "out",
        chunk: { type: "text-delta" },
      });

      // when
      logger.clear();

      // then
      expect(logger.getEntries()).toHaveLength(0);

      // sequence should reset
      logger.logChunk({
        location: "transport",
        direction: "out",
        chunk: { type: "text-delta" },
      });
      expect(logger.getEntries()[0].sequence_number).toBe(1);
    });
  });

  describe("Output Formatting", () => {
    it("should export entries as valid JSONL format", () => {
      // given
      const logger = new ChunkLogger(true, "test-session");
      logger.logChunk({
        location: "transport",
        direction: "out",
        chunk: { type: "text-delta", textDelta: "Hello" },
        mode: "adk-sse",
      });
      logger.logChunk({
        location: "transport",
        direction: "out",
        chunk: { type: "finish", finishReason: "stop" },
        mode: "adk-sse",
      });

      // then - each entry should be valid JSON
      const entries = logger.getEntries();
      for (const entry of entries) {
        const jsonString = JSON.stringify(entry);
        expect(() => JSON.parse(jsonString)).not.toThrow();
      }
    });

    it("should include all required fields in entries", () => {
      // given
      const logger = new ChunkLogger(true, "test-session");

      // when
      logger.logChunk({
        location: "transport",
        direction: "out",
        chunk: { type: "text-delta" },
        mode: "adk-bidi",
      });

      // then
      const entry = logger.getEntries()[0];
      expect(entry).toHaveProperty("timestamp");
      expect(entry).toHaveProperty("session_id");
      expect(entry).toHaveProperty("mode");
      expect(entry).toHaveProperty("location");
      expect(entry).toHaveProperty("direction");
      expect(entry).toHaveProperty("sequence_number");
      expect(entry).toHaveProperty("chunk");
    });

    it("should default mode to adk-sse when not specified", () => {
      // given
      const logger = new ChunkLogger(true, "test-session");

      // when
      logger.logChunk({
        location: "transport",
        direction: "out",
        chunk: { type: "text-delta" },
      });

      // then
      const entry = logger.getEntries()[0];
      expect(entry.mode).toBe("adk-sse");
    });
  });

  describe("Filtering", () => {
    it("should allow filtering entries by location", () => {
      // given
      const logger = new ChunkLogger(true, "test-session");
      logger.logChunk({
        location: "transport",
        direction: "out",
        chunk: { type: "text-delta" },
      });
      logger.logChunk({
        location: "frontend",
        direction: "in",
        chunk: { type: "text-delta" },
      });
      logger.logChunk({
        location: "transport",
        direction: "out",
        chunk: { type: "finish" },
      });

      // when - filter by location (client-side filtering)
      const entries = logger.getEntries();
      const transportEntries = entries.filter((e) => e.location === "transport");
      const frontendEntries = entries.filter((e) => e.location === "frontend");

      // then
      expect(transportEntries).toHaveLength(2);
      expect(frontendEntries).toHaveLength(1);
    });

    it("should allow filtering entries by direction", () => {
      // given
      const logger = new ChunkLogger(true, "test-session");
      logger.logChunk({
        location: "transport",
        direction: "out",
        chunk: { type: "text-delta" },
      });
      logger.logChunk({
        location: "transport",
        direction: "in",
        chunk: { type: "text-delta" },
      });

      // when
      const entries = logger.getEntries();
      const outEntries = entries.filter((e) => e.direction === "out");
      const inEntries = entries.filter((e) => e.direction === "in");

      // then
      expect(outEntries).toHaveLength(1);
      expect(inEntries).toHaveLength(1);
    });

    it("should allow filtering entries by chunk type", () => {
      // given
      const logger = new ChunkLogger(true, "test-session");
      logger.logChunk({
        location: "transport",
        direction: "out",
        chunk: { type: "text-delta", textDelta: "Hello" },
      });
      logger.logChunk({
        location: "transport",
        direction: "out",
        chunk: { type: "tool-call", toolName: "search" },
      });
      logger.logChunk({
        location: "transport",
        direction: "out",
        chunk: { type: "finish", finishReason: "stop" },
      });

      // when
      const entries = logger.getEntries();
      // biome-ignore lint/suspicious/noExplicitAny: Test filtering
      const textDeltas = entries.filter((e) => (e.chunk as any)?.type === "text-delta");
      // biome-ignore lint/suspicious/noExplicitAny: Test filtering
      const toolCalls = entries.filter((e) => (e.chunk as any)?.type === "tool-call");

      // then
      expect(textDeltas).toHaveLength(1);
      expect(toolCalls).toHaveLength(1);
    });
  });
});
