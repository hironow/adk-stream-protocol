/**
 * Unit tests for EventSender
 *
 * Tests event construction and WebSocket sending logic
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventSender } from "../../bidi/event_sender";
import { createMockWebSocket, type MockWebSocketInstance } from "../helpers/websocket-mock";

describe("EventSender", () => {
  let mockWebSocket: MockWebSocketInstance;
  let sender: EventSender;

  beforeEach(() => {
    mockWebSocket = createMockWebSocket();
    sender = new EventSender(mockWebSocket as unknown as WebSocket);
  });

  describe("sendToolResult", () => {
    it("should send tool_result event with correct structure", () => {
      // given
      const toolCallId = "test-tool-123";
      const result = { success: true, value: 42 };

      // when
      sender.sendToolResult(toolCallId, result);

      // then
      expect(mockWebSocket.send).toHaveBeenCalledTimes(1);
      const sentData = JSON.parse(mockWebSocket.send.mock.calls[0][0]);

      expect(sentData).toEqual({
        type: "tool_result",
        version: "1.0",
        data: {
          toolCallId,
          result,
        },
      });
    });

    it("should not send if WebSocket is not open", () => {
      // given
      mockWebSocket.readyState = WebSocket.CLOSED;
      const consoleWarn = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      // when
      sender.sendToolResult("test-123", { success: true });

      // then
      expect(mockWebSocket.send).not.toHaveBeenCalled();
      expect(consoleWarn).toHaveBeenCalledWith(
        expect.stringContaining("WebSocket not connected"),
        expect.anything(),
      );

      consoleWarn.mockRestore();
    });
  });

  describe("sendFunctionResponse", () => {
    it("should send message event with tool-result content", () => {
      // given
      const toolCallId = "original-tool-123";
      const toolName = "process_payment";
      const response = { approved: true };

      // when
      sender.sendFunctionResponse(toolCallId, toolName, response);

      // then
      expect(mockWebSocket.send).toHaveBeenCalledTimes(1);
      const sentData = JSON.parse(mockWebSocket.send.mock.calls[0][0]);

      expect(sentData.type).toBe("message");
      expect(sentData.version).toBe("1.0");
      expect(sentData.data.messages).toHaveLength(1);

      const message = sentData.data.messages[0];
      expect(message.role).toBe("user");
      expect(message.content).toHaveLength(1);

      const content = message.content[0];
      expect(content.type).toBe("tool-result");
      expect(content.toolCallId).toBe(toolCallId);
      expect(content.toolName).toBe(toolName);
      expect(content.result).toEqual(response);
    });
  });

  describe("sendMessages", () => {
    it("should send message event with user messages", () => {
      // given
      const messages = [
        {
          id: "msg-1",
          role: "user" as const,
          content: "Hello, AI!",
        },
      ];

      // when
      sender.sendMessages(messages);

      // then
      expect(mockWebSocket.send).toHaveBeenCalledTimes(1);
      const sentData = JSON.parse(mockWebSocket.send.mock.calls[0][0]);

      expect(sentData).toEqual({
        type: "message",
        version: "1.0",
        data: {
          messages,
        },
      });
    });

    it("should handle multiple messages", () => {
      // given
      const messages = [
        { id: "msg-1", role: "user" as const, content: "Message 1" },
        { id: "msg-2", role: "assistant" as const, content: "Response 1" },
        { id: "msg-3", role: "user" as const, content: "Message 2" },
      ];

      // when
      sender.sendMessages(messages);

      // then
      const sentData = JSON.parse(mockWebSocket.send.mock.calls[0][0]);
      expect(sentData.data.messages).toHaveLength(3);
      expect(sentData.data.messages).toEqual(messages);
    });
  });

  describe("audio control", () => {
    it("should send startAudio event", () => {
      // when
      sender.startAudio();

      // then
      const sentData = JSON.parse(mockWebSocket.send.mock.calls[0][0]);
      expect(sentData).toEqual({
        type: "audio_control",
        version: "1.0",
        action: "start",
      });
    });

    it("should send stopAudio event", () => {
      // when
      sender.stopAudio();

      // then
      const sentData = JSON.parse(mockWebSocket.send.mock.calls[0][0]);
      expect(sentData).toEqual({
        type: "audio_control",
        version: "1.0",
        action: "stop",
      });
    });
  });

  describe("sendAudioChunk", () => {
    it("should send audio chunk with metadata", () => {
      // given
      const chunk = {
        content: "base64encodeddata",
        sampleRate: 24000,
        channels: 1,
        bitDepth: 16,
      };

      // when
      sender.sendAudioChunk(chunk);

      // then
      const sentData = JSON.parse(mockWebSocket.send.mock.calls[0][0]);
      expect(sentData).toEqual({
        type: "audio_chunk",
        version: "1.0",
        data: {
          chunk: chunk.content,
          sampleRate: chunk.sampleRate,
          channels: chunk.channels,
          bitDepth: chunk.bitDepth,
        },
      });
    });
  });

  describe("interrupt", () => {
    it("should send interrupt event with reason", () => {
      // when
      sender.interrupt("user_abort");

      // then
      const sentData = JSON.parse(mockWebSocket.send.mock.calls[0][0]);
      expect(sentData).toEqual({
        type: "interrupt",
        version: "1.0",
        reason: "user_abort",
      });
    });

    it("should send interrupt event without reason", () => {
      // when
      sender.interrupt();

      // then
      const sentData = JSON.parse(mockWebSocket.send.mock.calls[0][0]);
      expect(sentData).toEqual({
        type: "interrupt",
        version: "1.0",
        reason: undefined,
      });
    });
  });

  describe("ping", () => {
    it("should send ping event with timestamp", () => {
      // given
      const timestamp = Date.now();

      // when
      sender.ping(timestamp);

      // then
      const sentData = JSON.parse(mockWebSocket.send.mock.calls[0][0]);
      expect(sentData).toEqual({
        type: "ping",
        version: "1.0",
        timestamp,
      });
    });
  });

  describe("setWebSocket", () => {
    it("should update WebSocket instance", () => {
      // given
      const newMockWebSocket = {
        send: vi.fn(),
        readyState: WebSocket.OPEN,
      };

      // when
      sender.setWebSocket(newMockWebSocket as unknown as WebSocket);
      sender.ping(123);

      // then
      expect(newMockWebSocket.send).toHaveBeenCalledTimes(1);
      expect(mockWebSocket.send).not.toHaveBeenCalled();
    });

    it("should handle null WebSocket", () => {
      // when
      sender.setWebSocket(null);

      const consoleWarn = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});
      sender.ping(123);

      // then
      expect(consoleWarn).toHaveBeenCalledWith(
        expect.stringContaining("WebSocket not connected"),
        expect.anything(),
      );

      consoleWarn.mockRestore();
    });
  });

  describe("WebSocket state handling", () => {
    it("should not send when WebSocket is CONNECTING", () => {
      // given
      mockWebSocket.readyState = WebSocket.CONNECTING;
      const consoleWarn = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      // when
      sender.ping(123);

      // then
      expect(mockWebSocket.send).not.toHaveBeenCalled();
      expect(consoleWarn).toHaveBeenCalled();

      consoleWarn.mockRestore();
    });

    it("should not send when WebSocket is CLOSING", () => {
      // given
      mockWebSocket.readyState = WebSocket.CLOSING;
      const consoleWarn = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      // when
      sender.ping(123);

      // then
      expect(mockWebSocket.send).not.toHaveBeenCalled();

      consoleWarn.mockRestore();
    });
  });
});
