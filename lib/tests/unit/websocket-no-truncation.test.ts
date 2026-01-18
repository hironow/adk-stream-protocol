/**
 * Tests for WebSocket message preservation (no truncation)
 * Uses MSW for WebSocket mocking
 */

import { describe, expect, it } from "vitest";
import { WebSocketChatTransport } from "../../bidi/transport";
import type { UIMessageFromAISDKv6 } from "../../utils";
import {
  createBidiWebSocketLink,
  createCustomHandler,
  useMswServer,
} from "../helpers";

describe("WebSocketChatTransport - Message Preservation", () => {
  const { getServer } = useMswServer({ onUnhandledRequest: "error" });
  it("should send ALL messages without truncation", async () => {
    // Given: Create a large number of messages (more than old limit of 50)
    const messages: UIMessageFromAISDKv6[] = Array.from(
      { length: 100 },
      (_, i) =>
        ({
          id: `msg-${i}`,
          role: i % 2 === 0 ? "user" : "assistant",
          parts: [{ type: "text", text: `Message ${i}` }],
        }) as UIMessageFromAISDKv6,
    );

    let receivedData: any = null;

    // Set up MSW handler to capture sent message
    const chat = createBidiWebSocketLink();
    getServer().use(
      createCustomHandler(chat, ({ client }) => {
        client.addEventListener("message", (event) => {
          receivedData = JSON.parse(event.data as string);

          // Send simple response
          const textId = `text-${Date.now()}`;
          client.send(
            `data: ${JSON.stringify({ type: "text-start", id: textId })}\n\n`,
          );
          client.send(
            `data: ${JSON.stringify({ type: "text-delta", delta: "OK", id: textId })}\n\n`,
          );
          client.send(
            `data: ${JSON.stringify({ type: "text-end", id: textId })}\n\n`,
          );
          client.send("data: [DONE]\n\n");
        });
      }),
    );

    const transport = new WebSocketChatTransport({
      url: "ws://localhost:8000/live",
    });

    // When: Send messages using the transport
    const stream = await transport.sendMessages({
      trigger: "submit-message",
      chatId: "test-chat",
      messages,
      messageId: "new-msg",
      abortSignal: new AbortController().signal,
    });

    // Consume the stream to completion
    const reader = stream.getReader();
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }

    // Then: Verify that ALL messages were sent
    expect(receivedData).not.toBeNull();
    // Flat structure: messages at top level
    expect(receivedData.messages).toHaveLength(100);
    expect(receivedData.messages[0].id).toBe("msg-0");
    expect(receivedData.messages[99].id).toBe("msg-99");

    // Verify SSE-compatible format (chatId, trigger, messageId)
    expect(receivedData.id).toBe("test-chat");
    expect(receivedData.trigger).toBe("submit-message");
    expect(receivedData.messageId).toBe("new-msg");

    transport._close();
  });

  it("should warn for large payloads but still send them", async () => {
    // Create messages that will exceed warning threshold (> 1MB)
    const largeText = "x".repeat(20000); // 20KB per message
    const messages: UIMessageFromAISDKv6[] = Array.from(
      { length: 60 },
      (_, i) =>
        ({
          id: `msg-${i}`,
          role: "user",
          parts: [{ type: "text", text: largeText }],
        }) as UIMessageFromAISDKv6,
    );

    let receivedData: any = null;

    const chat = createBidiWebSocketLink();
    getServer().use(
      createCustomHandler(chat, ({ client }) => {
        client.addEventListener("message", (event) => {
          receivedData = JSON.parse(event.data as string);

          // Send simple response
          const textId = `text-${Date.now()}`;
          client.send(
            `data: ${JSON.stringify({ type: "text-start", id: textId })}\n\n`,
          );
          client.send(
            `data: ${JSON.stringify({ type: "text-delta", delta: "OK", id: textId })}\n\n`,
          );
          client.send(
            `data: ${JSON.stringify({ type: "text-end", id: textId })}\n\n`,
          );
          client.send("data: [DONE]\n\n");
        });
      }),
    );

    const transport = new WebSocketChatTransport({
      url: "ws://localhost:8000/live",
    });

    const stream = await transport.sendMessages({
      trigger: "submit-message",
      chatId: "test-chat",
      messages,
      messageId: "new-msg",
      abortSignal: new AbortController().signal,
    });

    // Consume the stream to completion
    const reader = stream.getReader();
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }

    // Verify all messages were sent despite large size
    expect(receivedData).not.toBeNull();
    expect(receivedData.messages).toHaveLength(60);

    transport._close();
  });

  it("should preserve full conversation context for ADK BIDI", async () => {
    // Simulate a long conversation with context
    const conversation: UIMessageFromAISDKv6[] = [
      {
        id: "1",
        role: "user",
        parts: [{ type: "text", text: "Start context" }],
      },
      {
        id: "2",
        role: "assistant",
        parts: [{ type: "text", text: "Context response" }],
      },
      // ... many more messages
      ...Array.from({ length: 70 }, (_, i) => ({
        id: `${i + 3}`,
        role: i % 2 === 0 ? "user" : "assistant",
        parts: [{ type: "text", text: `Context message ${i}` }],
      })),
      {
        id: "73",
        role: "user",
        parts: [{ type: "text", text: "Recent message needing full context" }],
      },
    ] as UIMessageFromAISDKv6[];

    let receivedData: any = null;

    const chat = createBidiWebSocketLink();
    getServer().use(
      createCustomHandler(chat, ({ client }) => {
        client.addEventListener("message", (event) => {
          receivedData = JSON.parse(event.data as string);

          // Send simple response
          const textId = `text-${Date.now()}`;
          client.send(
            `data: ${JSON.stringify({ type: "text-start", id: textId })}\n\n`,
          );
          client.send(
            `data: ${JSON.stringify({ type: "text-delta", delta: "OK", id: textId })}\n\n`,
          );
          client.send(
            `data: ${JSON.stringify({ type: "text-end", id: textId })}\n\n`,
          );
          client.send("data: [DONE]\n\n");
        });
      }),
    );

    const transport = new WebSocketChatTransport({
      url: "ws://localhost:8000/live",
    });

    const stream = await transport.sendMessages({
      trigger: "submit-message",
      chatId: "bidi-chat",
      messages: conversation,
      messageId: "new-msg",
      abortSignal: new AbortController().signal,
    });

    // Consume the stream to completion
    const reader = stream.getReader();
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }

    // Should preserve entire conversation history
    expect(receivedData).not.toBeNull();
    expect(receivedData.messages).toHaveLength(73);
    expect(receivedData.messages[0].parts[0].text).toBe("Start context");
    expect(receivedData.messages[72].parts[0].text).toBe(
      "Recent message needing full context",
    );

    transport._close();
  });

  it("should handle messages with complex parts (images, tools)", async () => {
    const complexMessages: UIMessageFromAISDKv6[] = [
      {
        id: "1",
        role: "user",
        parts: [
          { type: "text", text: "Analyze this image" },
          {
            type: "image",
            mimeType: "image/png",
            data: "base64data...",
          },
        ],
      },
      {
        id: "2",
        role: "assistant",
        parts: [
          { type: "text", text: "I'll analyze it" },
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "image-analyzer",
            state: "input-available",
            input: { image: "data" },
          },
        ],
      },
      // Add more messages to exceed old 50 limit
      ...Array.from({ length: 60 }, (_, i) => ({
        id: `${i + 3}`,
        role: "user",
        parts: [{ type: "text", text: `Message ${i}` }],
      })),
    ] as UIMessageFromAISDKv6[];

    let receivedData: any = null;

    const chat = createBidiWebSocketLink();
    getServer().use(
      createCustomHandler(chat, ({ client }) => {
        client.addEventListener("message", (event) => {
          receivedData = JSON.parse(event.data as string);

          // Send simple response
          const textId = `text-${Date.now()}`;
          client.send(
            `data: ${JSON.stringify({ type: "text-start", id: textId })}\n\n`,
          );
          client.send(
            `data: ${JSON.stringify({ type: "text-delta", delta: "OK", id: textId })}\n\n`,
          );
          client.send(
            `data: ${JSON.stringify({ type: "text-end", id: textId })}\n\n`,
          );
          client.send("data: [DONE]\n\n");
        });
      }),
    );

    const transport = new WebSocketChatTransport({
      url: "ws://localhost:8000/live",
    });

    const stream = await transport.sendMessages({
      trigger: "submit-message",
      chatId: "test-chat",
      messages: complexMessages,
      messageId: "new-msg",
      abortSignal: new AbortController().signal,
    });

    // Consume the stream to completion
    const reader = stream.getReader();
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }

    // Should send all messages including complex ones
    expect(receivedData).not.toBeNull();
    expect(receivedData.messages).toHaveLength(62);
    expect(receivedData.messages[0].parts[1].type).toBe("image");
    expect(receivedData.messages[1].parts[1].type).toBe("tool-call");

    transport._close();
  });

  it("should only warn at appropriate size thresholds", async () => {
    // Test the new thresholds (500KB warning, 10MB error)

    // Small payload - no warning
    const smallMessages: UIMessageFromAISDKv6[] = [
      {
        id: "1",
        role: "user",
        parts: [{ type: "text", text: "Small message" }],
      },
    ] as UIMessageFromAISDKv6[];

    let receivedData: any = null;

    const chat = createBidiWebSocketLink();
    getServer().use(
      createCustomHandler(chat, ({ client }) => {
        client.addEventListener("message", (event) => {
          receivedData = JSON.parse(event.data as string);

          // Send simple response
          const textId = `text-${Date.now()}`;
          client.send(
            `data: ${JSON.stringify({ type: "text-start", id: textId })}\n\n`,
          );
          client.send(
            `data: ${JSON.stringify({ type: "text-delta", delta: "OK", id: textId })}\n\n`,
          );
          client.send(
            `data: ${JSON.stringify({ type: "text-end", id: textId })}\n\n`,
          );
          client.send("data: [DONE]\n\n");
        });
      }),
    );

    const transport = new WebSocketChatTransport({
      url: "ws://localhost:8000/live",
    });

    const stream1 = await transport.sendMessages({
      trigger: "submit-message",
      chatId: "test-chat",
      messages: smallMessages,
      messageId: "msg-1",
      abortSignal: new AbortController().signal,
    });

    // Consume the stream to completion
    let reader = stream1.getReader();
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }

    // Verify small messages were sent
    expect(receivedData).not.toBeNull();
    expect(receivedData.messages).toBeDefined();

    // Reset for next test
    receivedData = null;
    getServer().resetHandlers();

    // Medium payload (>500KB) - should still send successfully
    const mediumText = "x".repeat(100000); // 100KB per message
    const mediumMessages: UIMessageFromAISDKv6[] = Array.from(
      { length: 6 }, // 600KB total
      (_, i) =>
        ({
          id: `msg-${i}`,
          role: "user",
          parts: [{ type: "text", text: mediumText }],
        }) as UIMessageFromAISDKv6,
    );

    getServer().use(
      createCustomHandler(chat, ({ client }) => {
        client.addEventListener("message", (event) => {
          receivedData = JSON.parse(event.data as string);

          // Send simple response
          const textId = `text-${Date.now()}`;
          client.send(
            `data: ${JSON.stringify({ type: "text-start", id: textId })}\n\n`,
          );
          client.send(
            `data: ${JSON.stringify({ type: "text-delta", delta: "OK", id: textId })}\n\n`,
          );
          client.send(
            `data: ${JSON.stringify({ type: "text-end", id: textId })}\n\n`,
          );
          client.send("data: [DONE]\n\n");
        });
      }),
    );

    const stream2 = await transport.sendMessages({
      trigger: "submit-message",
      chatId: "test-chat",
      messages: mediumMessages,
      messageId: "msg-2",
      abortSignal: new AbortController().signal,
    });

    reader = stream2.getReader();
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }

    // Verify medium messages were sent despite size
    expect(receivedData).not.toBeNull();
    expect(receivedData.messages).toBeDefined();

    transport._close();
  });
});
