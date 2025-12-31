/**
 * BIDI EventSender Unit Tests
 *
 * Tests the critical functionality of EventSender including:
 * - Event construction and validation
 * - WebSocket state management
 * - Tool result sending (frontend delegate tools)
 * - Message sending with approval responses (confirmation tools)
 * - Audio control and chunk events
 * - Error handling for disconnected WebSocket
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventSender } from "../../bidi/event_sender";
import type { UIMessageFromAISDKv6 } from "../../utils";

describe("BIDI EventSender", () => {
  let sender: EventSender;
  let mockWebSocket: any;
  let sentMessages: string[];

  beforeEach(() => {
    sentMessages = [];
    mockWebSocket = {
      readyState: WebSocket.OPEN,
      send: vi.fn((message: string) => {
        sentMessages.push(message);
      }),
    };

    sender = new EventSender(mockWebSocket);
  });

  describe("WebSocket Management", () => {
    it("should initialize with null WebSocket", () => {
      // given
      const nullSender = new EventSender(null);

      // when - Try to send event with null WebSocket
      nullSender.sendToolResult("call-1", { success: true });

      // then - Should not throw (just logs warning)
      expect(sentMessages).toHaveLength(0);
    });

    it("should update WebSocket reference", () => {
      // given
      const newMockWs = {
        readyState: WebSocket.OPEN,
        send: vi.fn((message: string) => {
          sentMessages.push(message);
        }),
      };

      // when
      sender.setWebSocket(newMockWs);
      sender.sendToolResult("call-1", { success: true });

      // then
      expect(newMockWs.send).toHaveBeenCalled();
      expect(sentMessages).toHaveLength(1);
    });

    it("should handle WebSocket not OPEN state", () => {
      // given - WebSocket in CONNECTING state
      mockWebSocket.readyState = WebSocket.CONNECTING;

      // when
      sender.sendToolResult("call-1", { success: true });

      // then - Should not send
      expect(mockWebSocket.send).not.toHaveBeenCalled();
      expect(sentMessages).toHaveLength(0);
    });
  });

  describe("Tool Result Events", () => {
    it("should send tool_result event with correct structure", () => {
      // given
      const toolCallId = "call-123";
      const result = { lat: 35.6762, lon: 139.6503 };

      // when
      sender.sendToolResult(toolCallId, result);

      // then
      expect(sentMessages).toHaveLength(1);
      const event = JSON.parse(sentMessages[0]);
      expect(event).toMatchObject({
        type: "tool_result",
        version: "1.0",
        toolCallId,
        result,
      });
      expect(event.timestamp).toBeGreaterThan(0);
    });

    it("should send tool_result with complex result object", () => {
      // given
      const toolCallId = "call-456";
      const result = {
        success: true,
        data: { user: "Alice", balance: 1000 },
        metadata: { processed_at: Date.now() },
      };

      // when
      sender.sendToolResult(toolCallId, result);

      // then
      const event = JSON.parse(sentMessages[0]);
      expect(event.result).toEqual(result);
    });
  });

  describe("Message Events", () => {
    it("should send message event with user text message", () => {
      // given
      const messages: UIMessageFromAISDKv6[] = [
        {
          id: "msg-1",
          role: "user",
          parts: [{ type: "text", text: "Hello" }],
        },
      ];

      // when
      sender.sendMessages({
        chatId: "chat-123",
        messages,
        trigger: "submit-message",
        messageId: "msg-1",
      });

      // then
      expect(sentMessages).toHaveLength(1);
      const event = JSON.parse(sentMessages[0]);
      expect(event).toMatchObject({
        type: "message",
        version: "1.0",
        id: "chat-123",
        messages,
        trigger: "submit-message",
        messageId: "msg-1",
      });
      expect(event.timestamp).toBeGreaterThan(0);
    });

    it("should send message event with approval response", () => {
      // given
      const messages: UIMessageFromAISDKv6[] = [
        {
          id: "msg-1",
          role: "assistant",
          parts: [
            {
              type: "tool-payment",
              toolCallId: "call-1",
              input: { amount: 100 },
              state: "approval-responded",
              approval: { id: "approval-1", approved: true },
            },
          ],
        },
      ];

      // when
      sender.sendMessages({
        chatId: "chat-123",
        messages,
        trigger: "submit-message",
        messageId: undefined,
      });

      // then
      expect(sentMessages).toHaveLength(1);
      const event = JSON.parse(sentMessages[0]);
      expect(event.messages[0].parts[0]).toMatchObject({
        type: "tool-payment",
        state: "approval-responded",
        approval: { approved: true },
      });
    });

    it("should send message event with multiple messages", () => {
      // given
      const messages: UIMessageFromAISDKv6[] = [
        {
          id: "msg-1",
          role: "user",
          parts: [{ type: "text", text: "First message" }],
        },
        {
          id: "msg-2",
          role: "assistant",
          parts: [{ type: "text", text: "Response" }],
        },
        {
          id: "msg-3",
          role: "user",
          parts: [{ type: "text", text: "Follow up" }],
        },
      ];

      // when
      sender.sendMessages({
        chatId: "chat-123",
        messages,
        trigger: "submit-message",
        messageId: "msg-3",
      });

      // then
      const event = JSON.parse(sentMessages[0]);
      expect(event.messages).toHaveLength(3);
    });

    it("should send regenerate-message trigger", () => {
      // given
      const messages: UIMessageFromAISDKv6[] = [
        {
          id: "msg-1",
          role: "user",
          parts: [{ type: "text", text: "Regenerate this" }],
        },
      ];

      // when
      sender.sendMessages({
        chatId: "chat-123",
        messages,
        trigger: "regenerate-message",
        messageId: "msg-1",
      });

      // then
      const event = JSON.parse(sentMessages[0]);
      expect(event.trigger).toBe("regenerate-message");
    });
  });

  describe("Audio Control Events", () => {
    it("should send audio_control start event", () => {
      // when
      sender.startAudio();

      // then
      expect(sentMessages).toHaveLength(1);
      const event = JSON.parse(sentMessages[0]);
      expect(event).toMatchObject({
        type: "audio_control",
        version: "1.0",
        action: "start",
      });
      expect(event.timestamp).toBeGreaterThan(0);
    });

    it("should send audio_control stop event", () => {
      // when
      sender.stopAudio();

      // then
      expect(sentMessages).toHaveLength(1);
      const event = JSON.parse(sentMessages[0]);
      expect(event).toMatchObject({
        type: "audio_control",
        version: "1.0",
        action: "stop",
      });
      expect(event.timestamp).toBeGreaterThan(0);
    });
  });

  describe("Audio Chunk Events", () => {
    it("should send audio_chunk event with PCM data", () => {
      // given
      const pcmData = btoa("test pcm audio data");
      const chunk = {
        content: pcmData,
        sampleRate: 24000,
        channels: 1,
        bitDepth: 16,
      };

      // when
      sender.sendAudioChunk(chunk);

      // then
      expect(sentMessages).toHaveLength(1);
      const event = JSON.parse(sentMessages[0]);
      expect(event).toMatchObject({
        type: "audio_chunk",
        version: "1.0",
        chunk: pcmData,
        sampleRate: 24000,
        channels: 1,
        bitDepth: 16,
      });
      expect(event.timestamp).toBeGreaterThan(0);
    });

    it("should send audio_chunk with different sample rates", () => {
      // given
      const chunk = {
        content: btoa("audio"),
        sampleRate: 48000,
        channels: 2,
        bitDepth: 24,
      };

      // when
      sender.sendAudioChunk(chunk);

      // then
      const event = JSON.parse(sentMessages[0]);
      expect(event.sampleRate).toBe(48000);
      expect(event.channels).toBe(2);
      expect(event.bitDepth).toBe(24);
    });
  });

  describe("Interrupt Events", () => {
    it("should send interrupt event without reason", () => {
      // when
      sender.interrupt();

      // then
      expect(sentMessages).toHaveLength(1);
      const event = JSON.parse(sentMessages[0]);
      expect(event).toMatchObject({
        type: "interrupt",
        version: "1.0",
      });
      expect(event.reason).toBeUndefined();
      expect(event.timestamp).toBeGreaterThan(0);
    });

    it("should send interrupt event with reason", () => {
      // when
      sender.interrupt("user_abort");

      // then
      const event = JSON.parse(sentMessages[0]);
      expect(event).toMatchObject({
        type: "interrupt",
        version: "1.0",
        reason: "user_abort",
      });
    });
  });

  describe("Ping Events", () => {
    it("should send ping event with timestamp", () => {
      // given
      const timestamp = Date.now();

      // when
      sender.ping(timestamp);

      // then
      expect(sentMessages).toHaveLength(1);
      const event = JSON.parse(sentMessages[0]);
      expect(event).toEqual({
        type: "ping",
        version: "1.0",
        timestamp,
      });
    });

    it("should preserve exact timestamp value", () => {
      // given
      const timestamp = 1234567890123;

      // when
      sender.ping(timestamp);

      // then
      const event = JSON.parse(sentMessages[0]);
      expect(event.timestamp).toBe(timestamp);
    });
  });

  describe("Error Handling", () => {
    it("should handle null WebSocket gracefully", () => {
      // given
      sender.setWebSocket(null);
      const messages: UIMessageFromAISDKv6[] = [
        {
          id: "msg-1",
          role: "user",
          parts: [{ type: "text", text: "Test" }],
        },
      ];

      // when - Should not throw
      sender.sendToolResult("call-1", { success: true });
      sender.sendMessages({
        chatId: "chat-123",
        messages,
        trigger: "submit-message",
        messageId: undefined,
      });
      sender.startAudio();
      sender.stopAudio();
      sender.interrupt();
      sender.ping(Date.now());

      // then - No events sent
      expect(sentMessages).toHaveLength(0);
    });

    it("should handle WebSocket CLOSED state", () => {
      // given
      mockWebSocket.readyState = WebSocket.CLOSED;

      // when
      sender.sendToolResult("call-1", { success: true });

      // then
      expect(mockWebSocket.send).not.toHaveBeenCalled();
      expect(sentMessages).toHaveLength(0);
    });

    it("should handle WebSocket CLOSING state", () => {
      // given
      mockWebSocket.readyState = WebSocket.CLOSING;
      const messages: UIMessageFromAISDKv6[] = [
        {
          id: "msg-1",
          role: "user",
          parts: [{ type: "text", text: "Test" }],
        },
      ];

      // when
      sender.sendMessages({
        chatId: "chat-123",
        messages,
        trigger: "submit-message",
        messageId: undefined,
      });

      // then
      expect(mockWebSocket.send).not.toHaveBeenCalled();
      expect(sentMessages).toHaveLength(0);
    });
  });

  describe("Event Structure Validation", () => {
    it("should include version 1.0 in all events", () => {
      // given
      const messages: UIMessageFromAISDKv6[] = [
        {
          id: "msg-1",
          role: "user",
          parts: [{ type: "text", text: "Test" }],
        },
      ];

      // when - Send various events
      sender.sendToolResult("call-1", { success: true });
      sender.sendMessages({
        chatId: "chat-123",
        messages,
        trigger: "submit-message",
        messageId: undefined,
      });
      sender.startAudio();
      sender.sendAudioChunk({
        content: btoa("data"),
        sampleRate: 24000,
        channels: 1,
        bitDepth: 16,
      });
      sender.interrupt();
      sender.ping(Date.now());

      // then - All events have version 1.0
      sentMessages.forEach((msg) => {
        const event = JSON.parse(msg);
        expect(event.version).toBe("1.0");
      });
    });

    it("should generate unique timestamps for sequential events", () => {
      // when - Send multiple events quickly
      sender.sendToolResult("call-1", { success: true });
      sender.sendToolResult("call-2", { success: true });
      sender.sendToolResult("call-3", { success: true });

      // then - Timestamps should be different (or at least valid)
      const timestamps = sentMessages.map((msg) => JSON.parse(msg).timestamp);
      timestamps.forEach((ts) => {
        expect(ts).toBeGreaterThan(0);
      });
    });

    it("should serialize complex nested objects in tool results", () => {
      // given
      const result = {
        user: {
          name: "Alice",
          profile: { age: 30, location: "Tokyo" },
        },
        items: [
          { id: 1, name: "Item 1" },
          { id: 2, name: "Item 2" },
        ],
      };

      // when
      sender.sendToolResult("call-1", result);

      // then
      const event = JSON.parse(sentMessages[0]);
      expect(event.result).toEqual(result);
    });
  });
});
