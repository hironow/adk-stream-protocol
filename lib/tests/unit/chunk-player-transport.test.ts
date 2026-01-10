/**
 * ChunkPlayerTransport Tests
 * Tests for transport that replays recorded chunks
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { ChunkPlayerTransport } from "../../chunk_logs/chunk-player-transport";
import { ChunkPlayer } from "../../chunk_logs/chunk-player";

// Sample JSONL content for testing
const sampleJsonl = `{"timestamp":1704067200000,"session_id":"test-session","mode":"adk-sse","location":"transport","direction":"out","sequence_number":1,"chunk":{"type":"text-delta","textDelta":"Hello"}}
{"timestamp":1704067200100,"session_id":"test-session","mode":"adk-sse","location":"transport","direction":"out","sequence_number":2,"chunk":{"type":"text-delta","textDelta":" World"}}
{"timestamp":1704067200200,"session_id":"test-session","mode":"adk-sse","location":"transport","direction":"out","sequence_number":3,"chunk":{"type":"finish","finishReason":"stop"}}`;

describe("ChunkPlayerTransport", () => {
  describe("Static Factory Methods", () => {
    it("should create transport from fixture path", () => {
      // given
      const fixturePath = "/fixtures/test.jsonl";

      // when
      const transport = ChunkPlayerTransport.fromFixture(fixturePath);

      // then
      expect(transport).toBeInstanceOf(ChunkPlayerTransport);
    });

    it("should create transport from File object", () => {
      // given
      const file = new File([sampleJsonl], "test.jsonl", {
        type: "application/jsonl",
      });

      // when
      const transport = ChunkPlayerTransport.fromFile(file);

      // then
      expect(transport).toBeInstanceOf(ChunkPlayerTransport);
    });

    it("should create transport from pre-loaded ChunkPlayer", () => {
      // given
      const player = new ChunkPlayer(sampleJsonl);

      // when
      const transport = ChunkPlayerTransport.fromPlayer(player);

      // then
      expect(transport).toBeInstanceOf(ChunkPlayerTransport);
    });
  });

  describe("Chunk Playback", () => {
    it("should replay recorded chunks via sendMessages", async () => {
      // given
      const player = new ChunkPlayer(sampleJsonl);
      const transport = ChunkPlayerTransport.fromPlayer(player);

      // when
      const stream = await transport.sendMessages({
        trigger: "submit-message",
        chatId: "test-chat",
        messageId: undefined,
        messages: [],
        abortSignal: undefined,
      });

      // then
      const chunks: unknown[] = [];
      const reader = stream.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      expect(chunks).toHaveLength(3);
      expect(chunks[0]).toMatchObject({
        type: "text-delta",
        textDelta: "Hello",
      });
      expect(chunks[1]).toMatchObject({
        type: "text-delta",
        textDelta: " World",
      });
      expect(chunks[2]).toMatchObject({
        type: "finish",
        finishReason: "stop",
      });
    });

    it("should replay empty JSONL without error", async () => {
      // given
      const emptyJsonl = "";
      const player = new ChunkPlayer(emptyJsonl);
      const transport = ChunkPlayerTransport.fromPlayer(player);

      // when
      const stream = await transport.sendMessages({
        trigger: "submit-message",
        chatId: "test-chat",
        messageId: undefined,
        messages: [],
        abortSignal: undefined,
      });

      // then
      const reader = stream.getReader();
      const { done } = await reader.read();
      expect(done).toBe(true);
    });
  });

  describe("Lazy Loading", () => {
    it("should load player lazily from File when sendMessages called", async () => {
      // given
      const file = new File([sampleJsonl], "test.jsonl", {
        type: "application/jsonl",
      });
      const transport = ChunkPlayerTransport.fromFile(file);

      // when - first call should load the player
      const stream = await transport.sendMessages({
        trigger: "submit-message",
        chatId: "test-chat",
        messageId: undefined,
        messages: [],
        abortSignal: undefined,
      });

      // then
      const chunks: unknown[] = [];
      const reader = stream.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      expect(chunks).toHaveLength(3);
    });
  });

  describe("Reconnection", () => {
    it("should return null for reconnectToStream (not supported)", async () => {
      // given
      const player = new ChunkPlayer(sampleJsonl);
      const transport = ChunkPlayerTransport.fromPlayer(player);

      // when
      const result = await transport.reconnectToStream({
        chatId: "test-chat",
      });

      // then
      expect(result).toBeNull();
    });
  });

  describe("Error Handling", () => {
    it("should throw on malformed JSONL", () => {
      // given
      const malformedJsonl = `{"timestamp":1234,"chunk":{"type":"text"}}
not valid json
{"timestamp":5678,"chunk":{"type":"finish"}}`;

      // when/then - ChunkPlayer constructor throws on invalid JSONL
      expect(() => new ChunkPlayer(malformedJsonl)).toThrow(
        /Invalid JSONL at line 2/
      );
    });
  });
});
