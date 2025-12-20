/**
 * Unit tests for EventReceiver
 *
 * Tests SSE parsing, UIMessageChunk conversion, and custom event handling
 */

import type { UIMessageChunk } from "@ai-sdk/ui-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventReceiver } from "../../bidi/event_receiver";

describe("EventReceiver", () => {
  let mockController: {
    enqueue: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
  let mockAudioContext: {
    voiceChannel: {
      reset: ReturnType<typeof vi.fn>;
      playPCM: ReturnType<typeof vi.fn>;
    };
  };
  let receiver: EventReceiver;
  let onPongCallback: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Create mock controller
    mockController = {
      enqueue: vi.fn(),
      close: vi.fn(),
      error: vi.fn(),
    };

    // Create mock audio context
    mockAudioContext = {
      voiceChannel: {
        reset: vi.fn(),
        playPCM: vi.fn(),
      },
    };

    // Create mock onPong callback
    onPongCallback = vi.fn();

    receiver = new EventReceiver({
      audioContext: mockAudioContext,
      onPong: onPongCallback,
    });
  });

  describe("handleMessage - SSE format parsing", () => {
    it("should parse and enqueue text-delta event", () => {
      // given
      const sseData = 'data: {"type":"text-delta","text":"Hello"}\n\n';

      // when
      receiver.handleMessage(
        sseData,
        mockController as unknown as ReadableStreamDefaultController<UIMessageChunk>,
      );

      // then
      expect(mockController.enqueue).toHaveBeenCalledTimes(1);
      expect(mockController.enqueue).toHaveBeenCalledWith({
        type: "text-delta",
        text: "Hello",
      });
    });

    it("should parse and enqueue tool-input-available event", () => {
      // given
      const event = {
        type: "tool-input-available",
        toolCallId: "tool-123",
        toolName: "process_payment",
        input: { amount: 50 },
      };
      const sseData = `data: ${JSON.stringify(event)}\n\n`;

      // when
      receiver.handleMessage(
        sseData,
        mockController as unknown as ReadableStreamDefaultController<UIMessageChunk>,
      );

      // then
      expect(mockController.enqueue).toHaveBeenCalledWith(event);
    });

    it("should log tool-approval-request events", () => {
      // given
      const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
      const event = {
        type: "tool-approval-request",
        approvalId: "approval-123",
        toolCallId: "tool-123",
      };
      const sseData = `data: ${JSON.stringify(event)}\n\n`;

      // when
      receiver.handleMessage(
        sseData,
        mockController as unknown as ReadableStreamDefaultController<UIMessageChunk>,
      );

      // then
      expect(consoleLog).toHaveBeenCalledWith(
        expect.stringContaining("Received tool-approval-request"),
      );
      expect(mockController.enqueue).toHaveBeenCalledWith(event);

      consoleLog.mockRestore();
    });
  });

  describe("[DONE] marker handling", () => {
    it("should close controller on [DONE]", () => {
      // given
      const sseData = "data: [DONE]\n\n";

      // when
      receiver.handleMessage(
        sseData,
        mockController as unknown as ReadableStreamDefaultController<UIMessageChunk>,
      );

      // then
      expect(mockController.close).toHaveBeenCalledTimes(1);
      expect(mockAudioContext.voiceChannel.reset).toHaveBeenCalledTimes(1);
    });

    it("should ignore multiple [DONE] markers", () => {
      // given
      const consoleWarn = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});
      const sseData = "data: [DONE]\n\n";

      // when
      receiver.handleMessage(
        sseData,
        mockController as unknown as ReadableStreamDefaultController<UIMessageChunk>,
      );
      receiver.handleMessage(
        sseData,
        mockController as unknown as ReadableStreamDefaultController<UIMessageChunk>,
      );

      // then
      expect(mockController.close).toHaveBeenCalledTimes(1);
      expect(consoleWarn).toHaveBeenCalledWith(
        expect.stringContaining("Multiple [DONE] markers"),
      );

      consoleWarn.mockRestore();
    });

    it("should reset state for new stream after [DONE]", () => {
      // given
      const doneData = "data: [DONE]\n\n";
      const textData = 'data: {"type":"text-delta","text":"New"}\n\n';

      // when
      receiver.handleMessage(
        doneData,
        mockController as unknown as ReadableStreamDefaultController<UIMessageChunk>,
      );
      receiver.reset();
      receiver.handleMessage(
        textData,
        mockController as unknown as ReadableStreamDefaultController<UIMessageChunk>,
      );

      // then
      expect(mockController.close).toHaveBeenCalledTimes(1);
      expect(mockController.enqueue).toHaveBeenCalledWith({
        type: "text-delta",
        text: "New",
      });
    });
  });

  describe("PCM audio chunk handling", () => {
    it("should process PCM chunks and send to AudioContext", () => {
      // given
      const pcmBase64 = btoa(
        String.fromCharCode(...new Uint8Array([1, 2, 3, 4])),
      );
      const event = {
        type: "data-pcm",
        data: pcmBase64,
      };
      const sseData = `data: ${JSON.stringify(event)}\n\n`;

      // when
      receiver.handleMessage(
        sseData,
        mockController as unknown as ReadableStreamDefaultController<UIMessageChunk>,
      );

      // then
      expect(mockAudioContext.voiceChannel.playPCM).toHaveBeenCalledTimes(1);
      expect(mockController.enqueue).not.toHaveBeenCalled(); // PCM chunks skip enqueue
    });

    it("should buffer PCM data for WAV conversion", () => {
      // given
      const pcmBase64 = btoa(
        String.fromCharCode(...new Uint8Array([1, 2, 3, 4])),
      );
      const event = { type: "data-pcm", data: pcmBase64 };
      const sseData = `data: ${JSON.stringify(event)}\n\n`;

      // when
      receiver.handleMessage(
        sseData,
        mockController as unknown as ReadableStreamDefaultController<UIMessageChunk>,
      );

      // then
      const buffer = receiver.getPcmBuffer();
      expect(buffer).toHaveLength(1);
      expect(buffer[0]).toBeInstanceOf(Int16Array);
    });

    it("should handle invalid PCM data gracefully", () => {
      // given
      const consoleWarn = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});
      const event = {
        type: "data-pcm",
        data: null, // Invalid: should be string
      };
      const sseData = `data: ${JSON.stringify(event)}\n\n`;

      // when
      receiver.handleMessage(
        sseData,
        mockController as unknown as ReadableStreamDefaultController<UIMessageChunk>,
      );

      // then
      expect(consoleWarn).toHaveBeenCalled();
      expect(mockController.error).not.toHaveBeenCalled(); // Graceful handling

      consoleWarn.mockRestore();
    });
  });

  describe("pong message handling", () => {
    it("should call onPong callback for pong messages", () => {
      // given
      const timestamp = Date.now();
      const pongData = JSON.stringify({ type: "pong", timestamp });

      // when
      receiver.handleMessage(
        pongData,
        mockController as unknown as ReadableStreamDefaultController<UIMessageChunk>,
      );

      // then
      expect(onPongCallback).toHaveBeenCalledWith(timestamp);
      expect(mockController.enqueue).not.toHaveBeenCalled();
    });

    it("should ignore invalid JSON in non-SSE messages", () => {
      // given
      const invalidData = "not json";

      // when/then (should not throw)
      expect(() =>
        receiver.handleMessage(
          invalidData,
          mockController as unknown as ReadableStreamDefaultController<UIMessageChunk>,
        ),
      ).not.toThrow();
    });
  });

  describe("reset", () => {
    it("should reset all state", () => {
      // given
      const pcmBase64 = btoa(
        String.fromCharCode(...new Uint8Array([1, 2, 3, 4])),
      );
      const pcmData = `data: ${JSON.stringify({ type: "data-pcm", data: pcmBase64 })}\n\n`;
      receiver.handleMessage(
        pcmData,
        mockController as unknown as ReadableStreamDefaultController<UIMessageChunk>,
      );

      // when
      receiver.reset();

      // then
      expect(receiver.getPcmBuffer()).toHaveLength(0);
    });

    it("should allow processing after reset", () => {
      // given
      const doneData = "data: [DONE]\n\n";
      receiver.handleMessage(
        doneData,
        mockController as unknown as ReadableStreamDefaultController<UIMessageChunk>,
      );

      // when
      receiver.reset();
      const textData = 'data: {"type":"text-delta","text":"After reset"}\n\n';
      receiver.handleMessage(
        textData,
        mockController as unknown as ReadableStreamDefaultController<UIMessageChunk>,
      );

      // then
      expect(mockController.enqueue).toHaveBeenCalledWith({
        type: "text-delta",
        text: "After reset",
      });
    });
  });

  describe("error handling", () => {
    it("should call controller.error on parse error", () => {
      // given
      const invalidSSE = "data: {invalid json}\n\n";

      // when
      receiver.handleMessage(
        invalidSSE,
        mockController as unknown as ReadableStreamDefaultController<UIMessageChunk>,
      );

      // then
      expect(mockController.error).toHaveBeenCalledTimes(1);
    });

    it("should log error on message handling failure", () => {
      // given
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const invalidData = "data: {malformed}\n\n";

      // when
      receiver.handleMessage(
        invalidData,
        mockController as unknown as ReadableStreamDefaultController<UIMessageChunk>,
      );

      // then
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining("Error handling message"),
        expect.anything(),
      );

      consoleError.mockRestore();
    });
  });

  describe("finish event with audio", () => {
    it("should inject recorded audio before finish event", () => {
      // given
      const pcmBase64 = btoa(
        String.fromCharCode(
          ...new Uint8Array(new Int16Array([100, 200]).buffer),
        ),
      );
      const pcmData = `data: ${JSON.stringify({ type: "data-pcm", data: pcmBase64 })}\n\n`;
      const finishData = `data: ${JSON.stringify({
        type: "finish",
        messageMetadata: { audio: { chunks: 1 } },
      })}\n\n`;

      const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

      // when
      receiver.handleMessage(
        pcmData,
        mockController as unknown as ReadableStreamDefaultController<UIMessageChunk>,
      );
      receiver.handleMessage(
        finishData,
        mockController as unknown as ReadableStreamDefaultController<UIMessageChunk>,
      );

      // then
      expect(mockController.enqueue).toHaveBeenCalledTimes(2); // audio chunk + finish
      const firstCall = mockController.enqueue.mock.calls[0][0];
      expect(firstCall.type).toBe("file");
      expect(firstCall.mediaType).toBe("audio/wav");
      expect(firstCall.url).toContain("data:audio/wav;base64,");

      consoleLog.mockRestore();
    });
  });

  describe("EventReceiver without audio context", () => {
    it("should work without audio context", () => {
      // given
      const receiverNoAudio = new EventReceiver({});
      const textData = 'data: {"type":"text-delta","text":"No audio"}\n\n';

      // when/then (should not throw)
      expect(() =>
        receiverNoAudio.handleMessage(
          textData,
          mockController as unknown as ReadableStreamDefaultController<UIMessageChunk>,
        ),
      ).not.toThrow();
    });

    it("should skip PCM processing without audio context", () => {
      // given
      const receiverNoAudio = new EventReceiver({});
      const pcmBase64 = btoa(
        String.fromCharCode(...new Uint8Array([1, 2, 3, 4])),
      );
      const pcmData = `data: ${JSON.stringify({ type: "data-pcm", data: pcmBase64 })}\n\n`;

      // when
      receiverNoAudio.handleMessage(
        pcmData,
        mockController as unknown as ReadableStreamDefaultController<UIMessageChunk>,
      );

      // then
      expect(mockController.enqueue).not.toHaveBeenCalled();
      // Should still buffer for WAV conversion
      expect(receiverNoAudio.getPcmBuffer()).toHaveLength(1);
    });
  });
});
