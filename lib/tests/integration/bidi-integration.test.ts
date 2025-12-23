/**
 * Integration Tests for lib/bidi
 *
 * Tests WebSocket communication layer with mocked WebSocket.
 * Verifies message payloads, response handling, and confirmation flow.
 */

import type { UIMessage, UIMessageChunk } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildUseChatOptions } from "../../bidi";
import {
  createBidiConfirmationRequest,
  createBidiEndOfTurnEvent,
  createBidiMessageEvent,
  createTextDeltaEvent,
} from "../helpers/websocket-message-builders";
import {
  type MockWebSocket,
  installMockWebSocket,
  restoreMockWebSocket,
} from "../mocks/mock-websocket";

describe("lib/bidi Integration Tests", () => {
  let originalWebSocket: typeof WebSocket;
  let mockWebSocket: MockWebSocket;

  beforeEach(() => {
    originalWebSocket = installMockWebSocket();
  });

  afterEach(() => {
    restoreMockWebSocket(originalWebSocket);
    vi.clearAllMocks();
  });

  describe("WebSocket Connection and Message Payloads", () => {
    it.each([
      {
        name: "connects to default ADK backend WebSocket",
        adkBackendUrl: undefined,
        expectedUrl: "ws://localhost:8000/live",
      },
      {
        name: "connects to custom ADK backend WebSocket",
        adkBackendUrl: "http://example.com:9000",
        expectedUrl: "ws://example.com:9000/live",
      },
    ])("$name", async ({ adkBackendUrl, expectedUrl }) => {
      // given
      const { useChatOptions, transport } = buildUseChatOptions({
        initialMessages: [],
        ...(adkBackendUrl && { adkBackendUrl }),
      });

      const messages: UIMessage[] = [
        { id: "1", role: "user", content: "Test message" },
      ];

      // when
      const sendPromise = useChatOptions.transport.sendMessages({
        trigger: "submit-message",
        chatId: useChatOptions.id,
        messageId: "msg-1",
        messages,
        abortSignal: undefined,
      });

      // Wait for WebSocket connection to open
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Get mock WebSocket instance from tracked instances
      mockWebSocket = (global.WebSocket as typeof MockWebSocket).instances[0];

      // Simulate server response
      mockWebSocket.simulateMessage(JSON.stringify(createTextDeltaEvent("Response")));
      mockWebSocket.simulateMessage(JSON.stringify(createBidiEndOfTurnEvent()));

      const result = await sendPromise;
      const reader = result.getReader();
      const chunks: UIMessageChunk[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      // then
      expect(mockWebSocket.url).toBe(expectedUrl);
      expect(chunks.length).toBeGreaterThan(0);
    });

    it("sends correct message payload over WebSocket", async () => {
      // given
      const { useChatOptions, transport } = buildUseChatOptions({
        initialMessages: [],
      });

      const messages: UIMessage[] = [
        { id: "1", role: "user", content: "Hello ADK" },
      ];

      // when
      const sendPromise = useChatOptions.transport.sendMessages({
        trigger: "submit-message",
        chatId: useChatOptions.id,
        messageId: "msg-1",
        messages,
        abortSignal: undefined,
      });

      // Wait for connection and message send
      await new Promise((resolve) => setTimeout(resolve, 10));

      mockWebSocket = (global.WebSocket as typeof MockWebSocket).instances[0];

      // then
      expect(mockWebSocket.getSentMessages().length).toBeGreaterThan(0);

      // Verify message event was sent
      const messageEvents = mockWebSocket.getParsedSentMessages().filter(
        (event: any) => event?.type === "message",
      );

      expect(messageEvents.length).toBeGreaterThan(0);
      expect(messageEvents[0]).toMatchObject({
        type: "message",
        content: "Hello ADK",
      });

      // Clean up
      mockWebSocket.simulateMessage(JSON.stringify(createBidiEndOfTurnEvent()));
      await sendPromise;
    });
  });

  describe("Confirmation Flow", () => {
    it("receives adk_request_confirmation from backend", async () => {
      // given
      const { useChatOptions, transport } = buildUseChatOptions({
        initialMessages: [],
      });

      const messages: UIMessage[] = [
        { id: "1", role: "user", content: "Do dangerous operation" },
      ];

      // when
      const sendPromise = useChatOptions.transport.sendMessages({
        trigger: "submit-message",
        chatId: useChatOptions.id,
        messageId: "msg-1",
        messages,
        abortSignal: undefined,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      mockWebSocket = (global.WebSocket as typeof MockWebSocket).instances[0];

      // Simulate confirmation request from backend
      const confirmationEvent = createBidiConfirmationRequest({
        id: "orig-1",
        name: "dangerous_operation",
        args: { param: "value" },
      });
      mockWebSocket.simulateMessage(JSON.stringify(confirmationEvent));
      mockWebSocket.simulateMessage(JSON.stringify(createBidiEndOfTurnEvent()));

      const result = await sendPromise;
      const reader = result.getReader();
      const chunks: UIMessageChunk[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      // then
      const confirmationChunks = chunks.filter(
        (c) =>
          c.type === "tool-invocation" &&
          "toolName" in c &&
          c.toolName === "adk_request_confirmation",
      );
      expect(confirmationChunks.length).toBeGreaterThan(0);
    });

    it("sends confirmation response as function_response event", async () => {
      // given
      const { useChatOptions, transport } = buildUseChatOptions({
        initialMessages: [],
      });

      // User confirms after receiving confirmation request
      const messages: UIMessage[] = [
        {
          id: "1",
          role: "assistant",
          content: "",
          parts: [
            {
              type: "tool-adk_request_confirmation",
              state: "approval-responded",
              toolCallId: "call-1",
              input: {
                originalFunctionCall: {
                  id: "orig-1",
                  name: "dangerous_operation",
                  args: {},
                },
              },
              approval: { approved: true },
            },
          ],
        } as any,
      ];

      // when
      const sendPromise = useChatOptions.transport.sendMessages({
        trigger: "submit-message",
        chatId: useChatOptions.id,
        messageId: "msg-2",
        messages,
        abortSignal: undefined,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      mockWebSocket = (global.WebSocket as typeof MockWebSocket).instances[0];

      // Simulate backend acknowledging confirmation
      mockWebSocket.simulateMessage(JSON.stringify(createBidiEndOfTurnEvent()));

      await sendPromise;

      // then - verify function_response event was sent
      const functionResponseEvents = mockWebSocket
        .getParsedSentMessages()
        .filter((event: any) => event?.type === "function_response");

      expect(functionResponseEvents.length).toBeGreaterThan(0);
      expect(functionResponseEvents[0]).toMatchObject({
        type: "function_response",
        id: "call-1",
        response: { confirmed: true },
      });
    });

    it("sendAutomaticallyWhen detects confirmation completion", async () => {
      // given
      const messages: UIMessage[] = [
        {
          id: "1",
          role: "assistant",
          content: "",
          parts: [
            {
              type: "tool-adk_request_confirmation",
              state: "approval-responded",
              toolCallId: "call-1",
              input: {
                originalFunctionCall: {
                  id: "orig-1",
                  name: "dangerous_operation",
                  args: {},
                },
              },
              approval: { approved: true },
            },
          ],
        } as any,
      ];

      const { useChatOptions } = buildUseChatOptions({
        initialMessages: [],
      });

      // when
      const shouldSend = useChatOptions.sendAutomaticallyWhen({ messages });

      // then
      expect(shouldSend).toBe(true);
    });
  });

  describe("Audio Context Integration", () => {
    it("passes audio context to WebSocket transport", async () => {
      // given
      const mockAudioContext = {
        voiceChannel: {
          isPlaying: false,
          chunkCount: 0,
          sendChunk: vi.fn(),
          reset: vi.fn(),
        },
        isReady: true,
        error: null,
        needsUserActivation: false,
        activate: vi.fn(),
      };

      // when
      const { useChatOptions, transport } = buildUseChatOptions({
        initialMessages: [],
        audioContext: mockAudioContext,
      });

      // then
      expect(useChatOptions).toBeDefined();
      expect(transport).toBeDefined();
      // Audio context is passed to transport (verified by no errors)
    });
  });
});
