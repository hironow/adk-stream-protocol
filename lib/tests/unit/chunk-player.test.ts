/**
 * Tests for Chunk Player (Frontend)
 */

import { describe, expect, it } from "vitest";
import type { ChunkLogEntry } from "../../chunk-logger";
import { ChunkPlayer } from "../../chunk-player";

describe("ChunkPlayer", () => {
  const sampleJsonl = `{"timestamp":1000,"session_id":"test-001","mode":"adk-sse","location":"frontend-ws-chunk","direction":"in","sequence_number":1,"chunk":{"event":"1"},"metadata":null}
{"timestamp":1100,"session_id":"test-001","mode":"adk-sse","location":"frontend-ws-chunk","direction":"in","sequence_number":2,"chunk":{"event":"2"},"metadata":null}
{"timestamp":1200,"session_id":"test-001","mode":"adk-sse","location":"frontend-ws-chunk","direction":"in","sequence_number":3,"chunk":{"event":"3"},"metadata":null}`;

  it("should parse JSONL content", () => {
    // given/when
    const player = new ChunkPlayer(sampleJsonl);
    const entries = player.getEntries();

    // then
    expect(entries).toHaveLength(3);
    expect(entries[0].chunk).toEqual({ event: "1" });
    expect(entries[1].chunk).toEqual({ event: "2" });
    expect(entries[2].chunk).toEqual({ event: "3" });
  });

  it("should sort entries by sequence_number", () => {
    // given
    const unorderedJsonl = `{"timestamp":1000,"session_id":"test-001","mode":"adk-sse","location":"frontend-ws-chunk","direction":"in","sequence_number":3,"chunk":{"event":"3"},"metadata":null}
{"timestamp":1100,"session_id":"test-001","mode":"adk-sse","location":"frontend-ws-chunk","direction":"in","sequence_number":1,"chunk":{"event":"1"},"metadata":null}
{"timestamp":1200,"session_id":"test-001","mode":"adk-sse","location":"frontend-ws-chunk","direction":"in","sequence_number":2,"chunk":{"event":"2"},"metadata":null}`;

    // when
    const player = new ChunkPlayer(unorderedJsonl);
    const entries = player.getEntries();

    // then
    expect(entries[0].sequence_number).toBe(1);
    expect(entries[1].sequence_number).toBe(2);
    expect(entries[2].sequence_number).toBe(3);
  });

  it("should skip empty lines", () => {
    // given
    const jsonlWithEmptyLines = `{"timestamp":1000,"session_id":"test-001","mode":"adk-sse","location":"frontend-ws-chunk","direction":"in","sequence_number":1,"chunk":{"event":"1"},"metadata":null}

{"timestamp":1100,"session_id":"test-001","mode":"adk-sse","location":"frontend-ws-chunk","direction":"in","sequence_number":2,"chunk":{"event":"2"},"metadata":null}`;

    // when
    const player = new ChunkPlayer(jsonlWithEmptyLines);
    const entries = player.getEntries();

    // then
    expect(entries).toHaveLength(2);
  });

  it("should throw error on invalid JSON", () => {
    // given
    const invalidJsonl = "invalid json";

    // when/then
    expect(() => new ChunkPlayer(invalidJsonl)).toThrow(
      "Invalid JSONL at line 1",
    );
  });

  it("should replay chunks in fast-forward mode", async () => {
    // given
    const player = new ChunkPlayer(sampleJsonl);

    // when
    const chunks: ChunkLogEntry[] = [];
    for await (const entry of player.play({ mode: "fast-forward" })) {
      chunks.push(entry);
    }

    // then
    expect(chunks).toHaveLength(3);
    expect(chunks[0].chunk).toEqual({ event: "1" });
    expect(chunks[1].chunk).toEqual({ event: "2" });
    expect(chunks[2].chunk).toEqual({ event: "3" });
  });

  it("should replay chunks in real-time mode with timing", async () => {
    // given
    const player = new ChunkPlayer(sampleJsonl);

    // when
    const startTime = Date.now();
    const chunks: ChunkLogEntry[] = [];
    for await (const entry of player.play({ mode: "real-time" })) {
      chunks.push(entry);
    }
    const elapsedMs = Date.now() - startTime;

    // then
    expect(chunks).toHaveLength(3);
    // Should take roughly 200ms (original duration: 1200 - 1000 = 200ms)
    // Allow some tolerance for timing
    expect(elapsedMs).toBeGreaterThanOrEqual(180);
    expect(elapsedMs).toBeLessThanOrEqual(300);
  });

  it("should replay chunks in step mode", async () => {
    // given
    const player = new ChunkPlayer(sampleJsonl);

    // when
    const chunks: ChunkLogEntry[] = [];
    for await (const entry of player.play({ mode: "step" })) {
      chunks.push(entry);
    }

    // then
    expect(chunks).toHaveLength(3);
  });

  it("should return correct stats", () => {
    // given
    const player = new ChunkPlayer(sampleJsonl);

    // when
    const stats = player.getStats();

    // then
    expect(stats.count).toBe(3);
    expect(stats.duration_ms).toBe(200); // 1200 - 1000
    expect(stats.first_timestamp).toBe(1000);
    expect(stats.last_timestamp).toBe(1200);
  });

  it("should return empty stats for empty JSONL", () => {
    // given
    const player = new ChunkPlayer("");

    // when
    const stats = player.getStats();

    // then
    expect(stats.count).toBe(0);
    expect(stats.duration_ms).toBe(0);
    expect(stats.first_timestamp).toBeNull();
    expect(stats.last_timestamp).toBeNull();
  });

  it("should use fast-forward as default mode", async () => {
    // given
    const player = new ChunkPlayer(sampleJsonl);

    // when
    const chunks: ChunkLogEntry[] = [];
    for await (const entry of player.play()) {
      // No mode specified
      chunks.push(entry);
    }

    // then
    expect(chunks).toHaveLength(3);
  });
});
