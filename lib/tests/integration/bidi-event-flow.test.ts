/**
 * Integration tests for BIDI event flow
 *
 * Tests EventSender and EventReceiver working together in realistic scenarios
 */

import type { UIMessageChunk } from "@ai-sdk/ui-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventReceiver } from "../../bidi/event_receiver";
import { EventSender } from "../../bidi/event_sender";
import {
  createMockWebSocket,
  type MockWebSocketInstance,
} from "../helpers/websocket-mock";

describe("BIDI Event Flow Integration", () => {
  let mockWebSocket: MockWebSocketInstance & { sentMessages: string[] };
  let mockController: {
    enqueue: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
  let sender: EventSender;
  let receiver: EventReceiver;

  beforeEach(() => {
    // Create mock WebSocket that captures sent messages
    const baseMock = createMockWebSocket();
    mockWebSocket = {
      ...baseMock,
      sentMessages: [],
      send: vi.fn((msg: string) => {
        mockWebSocket.sentMessages.push(msg);
      }),
    };

    // Create mock controller
    mockController = {
      enqueue: vi.fn(),
      close: vi.fn(),
      error: vi.fn(),
    };

    sender = new EventSender(mockWebSocket as unknown as WebSocket);
    receiver = new EventReceiver({});
  });

  describe("Frontend Delegate Tool Flow (change_bgm pattern)", () => {
    it("should complete full tool execution flow", () => {
      // Scenario: Frontend executes change_bgm tool and sends result back

      // Step 1: Backend sends tool-input-available
      const toolInputSSE = `data: ${JSON.stringify({
        type: "tool-input-available",
        toolCallId: "tool-change-bgm-123",
        toolName: "change_bgm",
        input: { track: 2 },
      })}\n\n`;

      receiver.handleMessage(
        toolInputSSE,
        mockController as unknown as ReadableStreamDefaultController<UIMessageChunk>,
      );

      expect(mockController.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "tool-input-available",
          toolName: "change_bgm",
        }),
      );

      // Step 2: Frontend executes tool and sends result
      sender.sendToolResult("tool-change-bgm-123", {
        success: true,
        track: 2,
      });

      const sentData = JSON.parse(mockWebSocket.sentMessages[0]);
      expect(sentData).toEqual({
        type: "tool_result",
        version: "1.0",
        data: {
          toolCallId: "tool-change-bgm-123",
          result: { success: true, track: 2 },
        },
      });

      // Step 3: Backend sends tool-output-available
      const toolOutputSSE = `data: ${JSON.stringify({
        type: "tool-output-available",
        toolCallId: "tool-change-bgm-123",
        toolName: "change_bgm",
        output: { success: true, track: 2 },
      })}\n\n`;

      receiver.handleMessage(
        toolOutputSSE,
        mockController as unknown as ReadableStreamDefaultController<UIMessageChunk>,
      );

      expect(mockController.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "tool-output-available",
          toolName: "change_bgm",
        }),
      );
    });
  });

  describe("Confirmation Tool Flow (process_payment pattern)", () => {
    it("should complete confirmation flow with approval", () => {
      // Step 1: Backend sends adk_request_confirmation tool-input-available
      const confirmationInputSSE = `data: ${JSON.stringify({
        type: "tool-input-available",
        toolCallId: "confirmation-abc-123",
        toolName: "adk_request_confirmation",
        input: {
          originalFunctionCall: {
            id: "payment-tool-456",
            name: "process_payment",
            args: { amount: 50, recipient: "花子" },
          },
          toolConfirmation: { confirmed: false },
        },
      })}\n\n`;

      receiver.handleMessage(
        confirmationInputSSE,
        mockController as unknown as ReadableStreamDefaultController<UIMessageChunk>,
      );

      expect(mockController.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          toolName: "adk_request_confirmation",
        }),
      );

      // Step 2: User approves - Frontend sends function_response
      sender.sendFunctionResponse("payment-tool-456", "process_payment", {
        approved: true,
      });

      const sentData = JSON.parse(mockWebSocket.sentMessages[0]);
      expect(sentData.type).toBe("message");
      expect(sentData.data.messages[0].content[0]).toEqual(
        expect.objectContaining({
          type: "tool-result",
          toolCallId: "payment-tool-456",
          toolName: "process_payment",
          result: { approved: true },
        }),
      );

      // Step 3: Backend executes tool and sends result
      const toolOutputSSE = `data: ${JSON.stringify({
        type: "tool-output-available",
        toolCallId: "payment-tool-456",
        toolName: "process_payment",
        output: { status: "success", transactionId: "txn-789" },
      })}\n\n`;

      receiver.handleMessage(
        toolOutputSSE,
        mockController as unknown as ReadableStreamDefaultController<UIMessageChunk>,
      );

      expect(mockController.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "tool-output-available",
          toolName: "process_payment",
        }),
      );
    });
  });

  describe("Chat Message Flow", () => {
    it("should handle user message and AI response", () => {
      // Step 1: User sends message
      sender.sendMessages([
        {
          id: "msg-1",
          role: "user",
          content: "Hello, AI!",
        },
      ]);

      const sentData = JSON.parse(mockWebSocket.sentMessages[0]);
      expect(sentData).toEqual({
        type: "message",
        version: "1.0",
        data: {
          messages: [
            {
              id: "msg-1",
              role: "user",
              content: "Hello, AI!",
            },
          ],
        },
      });

      // Step 2: AI responds with text stream
      const textStartSSE = `data: ${JSON.stringify({
        type: "text-start",
      })}\n\n`;

      const textDeltaSSE1 = `data: ${JSON.stringify({
        type: "text-delta",
        text: "Hello",
      })}\n\n`;

      const textDeltaSSE2 = `data: ${JSON.stringify({
        type: "text-delta",
        text: " there!",
      })}\n\n`;

      const finishSSE = `data: ${JSON.stringify({
        type: "finish",
        messageMetadata: { usage: { totalTokens: 10 } },
      })}\n\n`;

      receiver.handleMessage(
        textStartSSE,
        mockController as unknown as ReadableStreamDefaultController<UIMessageChunk>,
      );
      receiver.handleMessage(
        textDeltaSSE1,
        mockController as unknown as ReadableStreamDefaultController<UIMessageChunk>,
      );
      receiver.handleMessage(
        textDeltaSSE2,
        mockController as unknown as ReadableStreamDefaultController<UIMessageChunk>,
      );
      receiver.handleMessage(
        finishSSE,
        mockController as unknown as ReadableStreamDefaultController<UIMessageChunk>,
      );

      expect(mockController.enqueue).toHaveBeenCalledTimes(4);
      expect(mockController.enqueue.mock.calls[0][0]).toEqual({
        type: "text-start",
      });
      expect(mockController.enqueue.mock.calls[1][0]).toEqual({
        type: "text-delta",
        text: "Hello",
      });
      expect(mockController.enqueue.mock.calls[2][0]).toEqual({
        type: "text-delta",
        text: " there!",
      });
    });
  });

  describe("Audio Streaming Flow", () => {
    it("should handle audio control and chunks", () => {
      // Step 1: Start audio recording
      sender.startAudio();
      let sentData = JSON.parse(mockWebSocket.sentMessages[0]);
      expect(sentData).toEqual({
        type: "audio_control",
        version: "1.0",
        action: "start",
      });

      // Step 2: Send audio chunks
      sender.sendAudioChunk({
        content: "base64data1",
        sampleRate: 24000,
        channels: 1,
        bitDepth: 16,
      });

      sentData = JSON.parse(mockWebSocket.sentMessages[1]);
      expect(sentData.type).toBe("audio_chunk");
      expect(sentData.data.chunk).toBe("base64data1");

      // Step 3: Stop audio
      sender.stopAudio();
      sentData = JSON.parse(mockWebSocket.sentMessages[2]);
      expect(sentData).toEqual({
        type: "audio_control",
        version: "1.0",
        action: "stop",
      });
    });

    it("should receive and process PCM audio from backend", () => {
      const mockAudioContext = {
        voiceChannel: {
          reset: vi.fn(),
          playPCM: vi.fn(),
        },
      };

      const audioReceiver = new EventReceiver({
        audioContext: mockAudioContext,
      });

      // Backend sends PCM chunk
      const pcmBase64 = btoa(
        String.fromCharCode(...new Uint8Array([1, 2, 3, 4])),
      );
      const pcmSSE = `data: ${JSON.stringify({
        type: "data-pcm",
        data: pcmBase64,
      })}\n\n`;

      audioReceiver.handleMessage(
        pcmSSE,
        mockController as unknown as ReadableStreamDefaultController<UIMessageChunk>,
      );

      expect(mockAudioContext.voiceChannel.playPCM).toHaveBeenCalledTimes(1);
      expect(mockController.enqueue).not.toHaveBeenCalled(); // PCM bypasses enqueue
    });
  });

  describe("Ping/Pong Latency Monitoring", () => {
    it("should exchange ping/pong messages", () => {
      const onPong = vi.fn();
      const monitoringReceiver = new EventReceiver({ onPong });

      // Frontend sends ping
      const timestamp = Date.now();
      sender.ping(timestamp);

      const sentData = JSON.parse(mockWebSocket.sentMessages[0]);
      expect(sentData).toEqual({
        type: "ping",
        version: "1.0",
        timestamp,
      });

      // Backend responds with pong
      const pongData = JSON.stringify({ type: "pong", timestamp });
      monitoringReceiver.handleMessage(
        pongData,
        mockController as unknown as ReadableStreamDefaultController<UIMessageChunk>,
      );

      expect(onPong).toHaveBeenCalledWith(timestamp);
    });
  });

  describe("Interrupt Flow", () => {
    it("should send interrupt and close stream", () => {
      // User interrupts
      sender.interrupt("user_abort");

      const sentData = JSON.parse(mockWebSocket.sentMessages[0]);
      expect(sentData).toEqual({
        type: "interrupt",
        version: "1.0",
        reason: "user_abort",
      });

      // Backend sends [DONE]
      receiver.handleMessage(
        "data: [DONE]\n\n",
        mockController as unknown as ReadableStreamDefaultController<UIMessageChunk>,
      );

      expect(mockController.close).toHaveBeenCalledTimes(1);
    });
  });

  describe("Stream Lifecycle", () => {
    it("should handle multiple conversation turns with reset", () => {
      // Turn 1: Send message, receive response, get [DONE]
      sender.sendMessages([{ id: "1", role: "user", content: "Hi" }]);
      receiver.handleMessage(
        'data: {"type":"text-delta","text":"Hello"}\n\n',
        mockController as unknown as ReadableStreamDefaultController<UIMessageChunk>,
      );
      receiver.handleMessage(
        "data: [DONE]\n\n",
        mockController as unknown as ReadableStreamDefaultController<UIMessageChunk>,
      );

      expect(mockController.close).toHaveBeenCalledTimes(1);
      expect(mockController.enqueue).toHaveBeenCalledTimes(1);

      // Reset for new turn
      receiver.reset();
      mockController.enqueue.mockClear();
      mockController.close.mockClear();

      // Turn 2: New conversation
      sender.sendMessages([{ id: "2", role: "user", content: "Bye" }]);
      receiver.handleMessage(
        'data: {"type":"text-delta","text":"Goodbye"}\n\n',
        mockController as unknown as ReadableStreamDefaultController<UIMessageChunk>,
      );
      receiver.handleMessage(
        "data: [DONE]\n\n",
        mockController as unknown as ReadableStreamDefaultController<UIMessageChunk>,
      );

      expect(mockController.close).toHaveBeenCalledTimes(1);
      expect(mockController.enqueue).toHaveBeenCalledTimes(1);
    });
  });

  describe("Error Recovery", () => {
    it("should recover from parse errors", () => {
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      // Invalid JSON
      receiver.handleMessage(
        "data: {invalid}\n\n",
        mockController as unknown as ReadableStreamDefaultController<UIMessageChunk>,
      );

      expect(mockController.error).toHaveBeenCalledTimes(1);

      // Should still work after reset
      receiver.reset();
      mockController.error.mockClear();

      receiver.handleMessage(
        'data: {"type":"text-delta","text":"OK"}\n\n',
        mockController as unknown as ReadableStreamDefaultController<UIMessageChunk>,
      );

      expect(mockController.enqueue).toHaveBeenCalledWith({
        type: "text-delta",
        text: "OK",
      });

      consoleError.mockRestore();
    });

    it("should handle WebSocket disconnection gracefully", () => {
      const consoleWarn = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      // Simulate disconnection
      mockWebSocket.readyState = WebSocket.CLOSED;

      // Attempt to send should not throw
      expect(() => sender.ping(Date.now())).not.toThrow();
      expect(consoleWarn).toHaveBeenCalled();

      consoleWarn.mockRestore();
    });
  });
});
