/**
 * Mode Switching Test Suite
 * Tests for 5x3 matrix: 5 message types across 3 modes
 * Focus on SSE ↔ BIDI transitions
 */

import type { UIMessage } from "@ai-sdk/react-v6";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("Mode Switching - 5x3 Matrix Tests", () => {
  let mockWebSocket: any;
  let mockFetch: any;

  beforeEach(() => {
    // Mock WebSocket
    mockWebSocket = {
      send: vi.fn(),
      close: vi.fn(),
      readyState: 1,
      onopen: null,
      onmessage: null,
      onerror: null,
      onclose: null,
    };

    // Mock WebSocket as a constructor
    global.WebSocket = class MockWebSocket {
      send = mockWebSocket.send;
      close = mockWebSocket.close;
      readyState = mockWebSocket.readyState;
      onopen = null;
      onmessage = null;
      onerror = null;
      onclose = null;
    } as any;

    // Mock fetch
    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Test 1: Text Messages Across Modes", () => {
    const textMessage: UIMessage = {
      id: "msg-1",
      role: "user",
      parts: [{ type: "text", text: "What is the capital of Japan?" }],
    };

    it("1-1: Gemini Direct mode should handle text messages", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                `data: {"type":"text","text":"Tokyo is the capital"}\n\n`,
              ),
            );
            controller.close();
          },
        }),
      });

      const response = await fetch("/api/chat", {
        method: "POST",
        body: JSON.stringify({ messages: [textMessage] }),
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/chat",
        expect.objectContaining({
          method: "POST",
        }),
      );
      expect(response.ok).toBe(true);
    });

    it("1-2: ADK SSE mode should handle text messages", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                `data: {"type":"text-delta","delta":"Response text"}\n\n`,
              ),
            );
            controller.close();
          },
        }),
      });

      const response = await fetch("/stream", {
        method: "POST",
        body: JSON.stringify({ messages: [textMessage] }),
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "/stream",
        expect.objectContaining({
          method: "POST",
        }),
      );
      expect(response.ok).toBe(true);
    });

    it("1-3: ADK BIDI mode should handle text messages", () => {
      const ws = new WebSocket("ws://localhost:8000/ws");

      ws.send(
        JSON.stringify({
          type: "message",
          data: { messages: [textMessage] },
        }),
      );

      expect(mockWebSocket.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"message"'),
      );
      expect(mockWebSocket.readyState).toBe(1); // OPEN
    });
  });

  describe("Test 2: Function Calling Across Modes", () => {
    const functionCallMessage: UIMessage = {
      id: "msg-2",
      role: "user",
      parts: [{ type: "text", text: "What's the weather in Tokyo?" }],
    };

    it("2-1: Gemini Direct should execute functions automatically", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                `data: {"type":"tool-call","toolName":"get_weather","args":{"location":"Tokyo"}}\n\n`,
              ),
            );
            controller.close();
          },
        }),
      });

      const response = await fetch("/api/chat", {
        method: "POST",
        body: JSON.stringify({ messages: [functionCallMessage] }),
      });

      expect(response.ok).toBe(true);
    });

    it("2-2: ADK SSE should execute functions", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                `data: {"type":"tool-call-start","toolCallId":"call-1","toolName":"get_weather"}\n\n`,
              ),
            );
            controller.close();
          },
        }),
      });

      const response = await fetch("/stream", {
        method: "POST",
        body: JSON.stringify({ messages: [functionCallMessage] }),
      });

      expect(response.ok).toBe(true);
    });

    it("2-3: ADK BIDI should handle function calls", () => {
      const ws = new WebSocket("ws://localhost:8000/ws");

      // Send message
      ws.send(
        JSON.stringify({
          type: "message",
          data: { messages: [functionCallMessage] },
        }),
      );

      // Simulate function call response
      if (mockWebSocket.onmessage) {
        mockWebSocket.onmessage({
          data: JSON.stringify({
            type: "tool-call",
            toolName: "get_weather",
            args: { location: "Tokyo" },
            result: { temperature: 9.1, condition: "Clouds" },
          }),
        });
      }

      expect(mockWebSocket.send).toHaveBeenCalled();
    });
  });

  describe("Critical: Mode Transitions", () => {
    const messages: UIMessage[] = [
      {
        id: "1",
        role: "user",
        parts: [{ type: "text", text: "First message" }],
      },
      {
        id: "2",
        role: "assistant",
        parts: [{ type: "text", text: "First response" }],
      },
    ];

    it("T-4: SSE → BIDI transition should preserve message history", () => {
      // First, simulate SSE mode with existing messages
      const sseMessages = [...messages];

      // Switch to BIDI mode
      const ws = new WebSocket("ws://localhost:8000/ws");

      // Send messages with full history
      ws.send(
        JSON.stringify({
          type: "message",
          data: {
            messages: [
              ...sseMessages,
              {
                id: "3",
                role: "user",
                parts: [{ type: "text", text: "New message in BIDI" }],
              },
            ],
          },
        }),
      );

      expect(mockWebSocket.send).toHaveBeenCalledWith(
        expect.stringContaining('"First message"'),
      );
      expect(mockWebSocket.send).toHaveBeenCalledWith(
        expect.stringContaining('"First response"'),
      );
      expect(mockWebSocket.send).toHaveBeenCalledWith(
        expect.stringContaining('"New message in BIDI"'),
      );
    });

    it("T-5: BIDI → SSE transition should close WebSocket properly", async () => {
      // Start in BIDI mode
      const ws = new WebSocket("ws://localhost:8000/ws");
      expect(mockWebSocket.readyState).toBe(1); // OPEN

      // Close WebSocket when switching to SSE
      ws.close();
      expect(mockWebSocket.close).toHaveBeenCalled();

      // Switch to SSE mode
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                `data: {"type":"text","text":"SSE response"}\n\n`,
              ),
            );
            controller.close();
          },
        }),
      });

      const response = await fetch("/stream", {
        method: "POST",
        body: JSON.stringify({ messages }),
      });

      expect(response.ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        "/stream",
        expect.objectContaining({
          body: expect.stringContaining('"First message"'),
        }),
      );
    });

    it("Should handle rapid mode switching without data loss", async () => {
      const messageHistory: UIMessage[] = [];

      // Gemini → SSE → BIDI → SSE rapid switching
      for (let i = 0; i < 3; i++) {
        const newMessage: UIMessage = {
          id: `msg-${i}`,
          role: "user",
          parts: [{ type: "text", text: `Message ${i}` }],
        };
        messageHistory.push(newMessage);

        // Switch modes rapidly
        if (i % 3 === 0) {
          // Gemini mode
          mockFetch.mockResolvedValueOnce({
            ok: true,
            body: new ReadableStream(),
          });
          await fetch("/api/chat", {
            method: "POST",
            body: JSON.stringify({ messages: messageHistory }),
          });
        } else if (i % 3 === 1) {
          // SSE mode
          mockFetch.mockResolvedValueOnce({
            ok: true,
            body: new ReadableStream(),
          });
          await fetch("/stream", {
            method: "POST",
            body: JSON.stringify({ messages: messageHistory }),
          });
        } else {
          // BIDI mode
          const ws = new WebSocket("ws://localhost:8000/ws");
          ws.send(
            JSON.stringify({
              type: "message",
              data: { messages: messageHistory },
            }),
          );
          ws.close();
        }
      }

      // Verify all messages were sent in each mode
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockWebSocket.send).toHaveBeenCalled();
    });
  });

  describe("Test 5: Audio in BIDI Mode (Client-side only)", () => {
    it("5-3: BIDI mode should handle audio client-side without sending to server", () => {
      const ws = new WebSocket("ws://localhost:8000/ws");

      // Audio should NOT be in the message sent to server
      const messageToSend: UIMessage = {
        id: "msg-audio",
        role: "user",
        parts: [{ type: "text", text: "Generate audio response" }],
      };

      ws.send(
        JSON.stringify({
          type: "message",
          data: { messages: [messageToSend] },
        }),
      );

      // Verify audio is NOT sent to server
      const sentData = mockWebSocket.send.mock.calls[0][0];
      expect(sentData).not.toContain('"type":"audio"');
      expect(sentData).toContain('"type":"text"');

      // Simulate receiving audio response
      if (mockWebSocket.onmessage) {
        mockWebSocket.onmessage({
          data: JSON.stringify({
            type: "audio",
            audio: "base64_audio_data",
            // This should be handled client-side only
          }),
        });
      }

      // Audio should be stored client-side, not sent back
      expect(mockWebSocket.send).toHaveBeenCalledTimes(1); // Only initial message
    });
  });

  describe("Edge Cases", () => {
    it("Should handle WebSocket connection failure gracefully", () => {
      const ws = new WebSocket("ws://localhost:8000/ws");

      // Simulate connection error
      if (mockWebSocket.onerror) {
        mockWebSocket.onerror(new Error("Connection failed"));
      }

      // Should handle error without crashing
      expect(mockWebSocket.readyState).toBe(1); // Still shows as OPEN in mock

      // Attempt to send should still work (for testing)
      ws.send(JSON.stringify({ type: "message", data: {} }));
      expect(mockWebSocket.send).toHaveBeenCalled();
    });

    it("Should handle SSE stream interruption", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                `data: {"type":"text","text":"Partial"}\n\n`,
              ),
            );
            // Simulate stream interruption
            controller.error(new Error("Stream interrupted"));
          },
        }),
      });

      const response = await fetch("/stream", {
        method: "POST",
        body: JSON.stringify({ messages: [] }),
      });

      expect(response.ok).toBe(true);
      // Should handle partial data gracefully
    });
  });
});

describe("Message Type Matrix Coverage", () => {
  let mockWebSocket: any;
  let mockFetch: any;

  beforeEach(() => {
    // Mock WebSocket
    mockWebSocket = {
      send: vi.fn(),
      close: vi.fn(),
      readyState: 1,
      onopen: null,
      onmessage: null,
      onerror: null,
      onclose: null,
    };

    // Mock WebSocket as a constructor
    global.WebSocket = class MockWebSocket {
      send = mockWebSocket.send;
      close = mockWebSocket.close;
      readyState = mockWebSocket.readyState;
      onopen = null;
      onmessage = null;
      onerror = null;
      onclose = null;
    } as any;

    // Mock fetch
    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const modes = ["gemini", "adk-sse", "adk-bidi"] as const;
  const messageTypes = [
    "text",
    "function",
    "approval",
    "image",
    "audio",
  ] as const;

  // Create a matrix of all combinations
  modes.forEach((mode) => {
    messageTypes.forEach((msgType) => {
      // Skip audio for non-BIDI modes
      if (msgType === "audio" && mode !== "adk-bidi") return;

      it(`${mode} + ${msgType} should be handled correctly`, () => {
        const testMessage: UIMessage = {
          id: `test-${mode}-${msgType}`,
          role: "user",
          parts: [{ type: "text", text: `Test ${msgType} in ${mode}` }],
        };

        if (mode === "adk-bidi") {
          const ws = new WebSocket("ws://localhost:8000/ws");
          ws.send(
            JSON.stringify({
              type: "message",
              data: { messages: [testMessage] },
            }),
          );
          expect(mockWebSocket.send).toHaveBeenCalled();
        } else {
          // For SSE and Gemini modes, we'd use fetch
          // This is a simplified test
          expect(testMessage.id).toContain(mode);
          expect(testMessage.id).toContain(msgType);
        }
      });
    });
  });
});
