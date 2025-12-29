/**
 * BIDI EventReceiver Unit Tests
 *
 * Tests the critical functionality of EventReceiver including:
 * - Approval request handling with [DONE] sending (Phase 12 BLOCKING fix)
 * - [DONE] marker processing and doneReceived flag
 * - SSE message parsing and chunk conversion
 * - State management (reset, isDoneReceived)
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { EventReceiver } from "../../bidi/event_receiver";
import type { UIMessageChunkFromAISDKv6 } from "../../utils";

describe("BIDI EventReceiver", () => {
  let receiver: EventReceiver;
  let mockController: any;
  let enqueuedChunks: UIMessageChunkFromAISDKv6[];

  beforeEach(() => {
    enqueuedChunks = [];
    mockController = {
      enqueue: vi.fn((chunk: UIMessageChunkFromAISDKv6) => {
        enqueuedChunks.push(chunk);
      }),
      close: vi.fn(),
      error: vi.fn(),
    };

    receiver = new EventReceiver({});
  });

  describe("State Management", () => {
    it("should initialize with doneReceived = false", () => {
      expect(receiver.isDoneReceived()).toBe(false);
    });

    it("should reset doneReceived flag", () => {
      // given - Simulate [DONE] received
      receiver.handleMessage("data: [DONE]\n\n", mockController);

      // when
      receiver.reset();

      // then
      expect(receiver.isDoneReceived()).toBe(false);
    });

    it("should reset PCM buffer", () => {
      // given - Add PCM data
      const pcmChunk = {
        type: "data-pcm",
        data: { content: btoa("test") },
      };
      receiver.handleMessage(
        `data: ${JSON.stringify(pcmChunk)}\n\n`,
        mockController,
      );

      // when
      receiver.reset();

      // then
      expect(receiver.getPcmBuffer()).toEqual([]);
    });
  });

  describe("SSE Message Handling", () => {
    it("should parse and enqueue SSE text-delta chunk", () => {
      // given
      const chunk = {
        type: "text-delta",
        textDelta: "Hello",
      };
      const sseMessage = `data: ${JSON.stringify(chunk)}\n\n`;

      // when
      receiver.handleMessage(sseMessage, mockController);

      // then
      expect(enqueuedChunks).toHaveLength(1);
      expect(enqueuedChunks[0]).toEqual(chunk);
    });

    it("should parse and enqueue tool-approval-request chunk", () => {
      // given
      const chunk = {
        type: "tool-approval-request",
        toolCallId: "call-1",
        toolName: "process_payment",
        approvalId: "approval-1",
        input: { amount: 100 },
      };
      const sseMessage = `data: ${JSON.stringify(chunk)}\n\n`;

      // when
      receiver.handleMessage(sseMessage, mockController);

      // then - Should enqueue approval request AND finish chunk
      expect(enqueuedChunks).toHaveLength(2);
      expect(enqueuedChunks[0]).toEqual(chunk);
      expect(enqueuedChunks[1]).toEqual({ type: "finish" });
    });

    it("should handle malformed JSON gracefully", () => {
      // given
      const malformedMessage = "data: {invalid json}\n\n";

      // when
      receiver.handleMessage(malformedMessage, mockController);

      // then - Should not throw, controller should not be closed
      expect(mockController.close).not.toHaveBeenCalled();
      expect(mockController.error).not.toHaveBeenCalled();
    });
  });

  describe("[DONE] Marker Handling", () => {
    it("should set doneReceived flag when [DONE] received", () => {
      // given
      const doneMessage = "data: [DONE]\n\n";

      // when
      receiver.handleMessage(doneMessage, mockController);

      // then
      expect(receiver.isDoneReceived()).toBe(true);
    });

    it("should close controller when [DONE] received", () => {
      // given
      const doneMessage = "data: [DONE]\n\n";

      // when
      receiver.handleMessage(doneMessage, mockController);

      // then
      expect(mockController.close).toHaveBeenCalled();
    });

    it("should ignore subsequent [DONE] markers", () => {
      // given - First [DONE]
      receiver.handleMessage("data: [DONE]\n\n", mockController);
      mockController.close.mockClear();

      // when - Second [DONE]
      receiver.handleMessage("data: [DONE]\n\n", mockController);

      // then - Should not close again
      expect(mockController.close).not.toHaveBeenCalled();
    });
  });

  describe("Approval Request Handling (Phase 12 BLOCKING Fix)", () => {
    it("should send [DONE] after approval request to enable sendAutomaticallyWhen", () => {
      // given
      const approvalChunk = {
        type: "tool-approval-request",
        toolCallId: "call-1",
        toolName: "process_payment",
        approvalId: "approval-1",
        input: { amount: 100 },
      };
      const sseMessage = `data: ${JSON.stringify(approvalChunk)}\n\n`;

      // when
      receiver.handleMessage(sseMessage, mockController);

      // then - Should enqueue approval request, finish chunk, and close controller
      expect(enqueuedChunks).toHaveLength(2);
      expect(enqueuedChunks[0].type).toBe("tool-approval-request");
      expect(enqueuedChunks[1].type).toBe("finish");
      expect(mockController.close).toHaveBeenCalled();
    });

    it("should set doneReceived flag after approval request", () => {
      // given
      const approvalChunk = {
        type: "tool-approval-request",
        toolCallId: "call-1",
        toolName: "process_payment",
        approvalId: "approval-1",
        input: { amount: 100 },
      };
      const sseMessage = `data: ${JSON.stringify(approvalChunk)}\n\n`;

      // when
      receiver.handleMessage(sseMessage, mockController);

      // then - CRITICAL: doneReceived must be true for transport to create new controller
      expect(receiver.isDoneReceived()).toBe(true);
    });

    it("should not skip normal enqueue for approval request", () => {
      // given
      const approvalChunk = {
        type: "tool-approval-request",
        toolCallId: "call-1",
        toolName: "process_payment",
        approvalId: "approval-1",
        input: { amount: 100 },
      };
      const sseMessage = `data: ${JSON.stringify(approvalChunk)}\n\n`;

      // when
      receiver.handleMessage(sseMessage, mockController);

      // then - Should enqueue the approval request itself
      expect(enqueuedChunks[0].type).toBe("tool-approval-request");
      expect(enqueuedChunks[0]).toMatchObject({
        toolCallId: "call-1",
        toolName: "process_payment",
        approvalId: "approval-1",
      });
    });
  });

  describe("PCM Audio Handling", () => {
    it("should skip normal enqueue for data-pcm chunks", () => {
      // given
      const pcmChunk = {
        type: "data-pcm",
        data: { content: btoa("test pcm data") },
      };
      const sseMessage = `data: ${JSON.stringify(pcmChunk)}\n\n`;

      // when
      receiver.handleMessage(sseMessage, mockController);

      // then - Should NOT enqueue (handled separately)
      expect(enqueuedChunks).toHaveLength(0);
    });

    it("should buffer PCM data for recording", () => {
      // given
      const pcmChunk = {
        type: "data-pcm",
        data: { content: btoa("test") },
      };
      const sseMessage = `data: ${JSON.stringify(pcmChunk)}\n\n`;

      // when
      receiver.handleMessage(sseMessage, mockController);

      // then - PCM data should be buffered
      expect(receiver.getPcmBuffer().length).toBeGreaterThan(0);
    });
  });

  describe("Non-SSE Message Handling", () => {
    it("should handle pong messages", () => {
      // given
      const onPong = vi.fn();
      receiver = new EventReceiver({ onPong });
      const pongMessage = JSON.stringify({ type: "pong", timestamp: 123456 });

      // when
      receiver.handleMessage(pongMessage, mockController);

      // then
      expect(onPong).toHaveBeenCalledWith(123456);
    });

    it("should handle non-JSON non-SSE messages gracefully", () => {
      // given
      const invalidMessage = "not json and not sse";

      // when
      receiver.handleMessage(invalidMessage, mockController);

      // then - Should not throw or close controller
      expect(mockController.close).not.toHaveBeenCalled();
      expect(mockController.error).not.toHaveBeenCalled();
    });
  });

  describe("Error Handling", () => {
    it("should call controller.error on exception in handleMessage", () => {
      // given - Create receiver that will throw
      mockController.enqueue = vi.fn(() => {
        throw new Error("Enqueue failed");
      });

      const chunk = { type: "text-delta", textDelta: "test" };
      const sseMessage = `data: ${JSON.stringify(chunk)}\n\n`;

      // when
      receiver.handleMessage(sseMessage, mockController);

      // then
      expect(mockController.error).toHaveBeenCalled();
    });

    it("should handle controller already closed gracefully", () => {
      // given - Controller that throws ERR_INVALID_STATE on enqueue
      const closedError: any = new Error("Controller already closed");
      closedError.code = "ERR_INVALID_STATE";
      mockController.enqueue = vi.fn(() => {
        throw closedError;
      });

      const chunk = { type: "text-delta", textDelta: "test" };
      const sseMessage = `data: ${JSON.stringify(chunk)}\n\n`;

      // when
      receiver.handleMessage(sseMessage, mockController);

      // then - Should not call error (graceful handling)
      expect(mockController.error).not.toHaveBeenCalled();
    });
  });
});
