/**
 * Comprehensive parameterized tests for WebSocket Chat Transport.
 *
 * This test file corresponds 1:1 with agents/reviews.md coverage table.
 * Each test case validates that AI SDK v6 SSE format is correctly parsed
 * and converted to UIMessageChunk for useChat hook consumption.
 *
 * Based on AI SDK v6 specification:
 * https://v6.ai-sdk.dev/docs/ai-sdk-ui/stream-protocol
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { WebSocketChatTransport } from "./websocket-chat-transport";
import type { UIMessageChunk } from "ai";

/**
 * Helper to create mock controller for ReadableStream
 */
function createMockController() {
  return {
    enqueue: vi.fn(),
    close: vi.fn(),
    error: vi.fn(),
  };
}

describe("WebSocketChatTransport - SSE Format Parsing", () => {
  let transport: WebSocketChatTransport;
  let controller: ReturnType<typeof createMockController>;

  beforeEach(() => {
    transport = new WebSocketChatTransport({ url: "ws://test" });
    controller = createMockController();
  });

  describe("Category 1: Text Content Events", () => {
    it.each([
      {
        name: "text-start event",
        input: 'data: {"type":"text-start","id":"0"}\n\n',
        expected: { type: "text-start", id: "0" },
      },
      {
        name: "text-delta event",
        input: 'data: {"type":"text-delta","id":"0","delta":"Hello"}\n\n',
        expected: { type: "text-delta", id: "0", delta: "Hello" },
      },
      {
        name: "text-end event",
        input: 'data: {"type":"text-end","id":"0"}\n\n',
        expected: { type: "text-end", id: "0" },
      },
      {
        name: "text-delta with unicode",
        input: 'data: {"type":"text-delta","id":"1","delta":"日本語 🎉"}\n\n',
        expected: { type: "text-delta", id: "1", delta: "日本語 🎉" },
      },
    ])("should parse $name correctly", ({ input, expected }) => {
      /**
       * Coverage: reviews.md Section 1 - Text Content
       * - text-start
       * - text-delta
       * - text-end
       */
      (transport as any).handleWebSocketMessage(input, controller);

      expect(controller.enqueue).toHaveBeenCalledWith(expected);
      expect(controller.close).not.toHaveBeenCalled();
      expect(controller.error).not.toHaveBeenCalled();
    });
  });

  describe("Category 2: Reasoning Content Events", () => {
    it.each([
      {
        name: "reasoning-start event",
        input: 'data: {"type":"reasoning-start","id":"0"}\n\n',
        expected: { type: "reasoning-start", id: "0" },
      },
      {
        name: "reasoning-delta event",
        input: 'data: {"type":"reasoning-delta","id":"0","delta":"Let me think..."}\n\n',
        expected: { type: "reasoning-delta", id: "0", delta: "Let me think..." },
      },
      {
        name: "reasoning-end event",
        input: 'data: {"type":"reasoning-end","id":"0"}\n\n',
        expected: { type: "reasoning-end", id: "0" },
      },
    ])("should parse $name correctly", ({ input, expected }) => {
      /**
       * Coverage: reviews.md Section 2 - Reasoning Content
       * - reasoning-start
       * - reasoning-delta
       * - reasoning-end
       */
      (transport as any).handleWebSocketMessage(input, controller);

      expect(controller.enqueue).toHaveBeenCalledWith(expected);
    });
  });

  describe("Category 3: Tool Execution Events", () => {
    it.each([
      {
        name: "tool-call-start event",
        input: 'data: {"type":"tool-call-start","toolCallId":"call_0","toolName":"get_weather"}\n\n',
        expected: { type: "tool-call-start", toolCallId: "call_0", toolName: "get_weather" },
      },
      {
        name: "tool-call-available event",
        input: 'data: {"type":"tool-call-available","toolCallId":"call_0","toolName":"get_weather","input":{"location":"Tokyo"}}\n\n',
        expected: {
          type: "tool-call-available",
          toolCallId: "call_0",
          toolName: "get_weather",
          input: { location: "Tokyo" },
        },
      },
      {
        name: "tool-result-available event",
        input: 'data: {"type":"tool-result-available","toolCallId":"call_0","output":{"temperature":20,"condition":"sunny"}}\n\n',
        expected: {
          type: "tool-result-available",
          toolCallId: "call_0",
          output: { temperature: 20, condition: "sunny" },
        },
      },
    ])("should parse $name correctly", ({ input, expected }) => {
      /**
       * Coverage: reviews.md Section 3 - Tool Execution
       * - tool-call-start
       * - tool-call-available
       * - tool-result-available
       */
      (transport as any).handleWebSocketMessage(input, controller);

      expect(controller.enqueue).toHaveBeenCalledWith(expected);
    });
  });

  describe("Category 4: Audio Content Events", () => {
    it.each([
      {
        name: "data-pcm event (PCM audio)",
        input: 'data: {"type":"data-pcm","data":{"content":"AAABAAACAAA=","sampleRate":24000,"channels":1,"bitDepth":16}}\n\n',
        expected: {
          type: "data-pcm",
          data: {
            content: "AAABAAACAAA=",
            sampleRate: 24000,
            channels: 1,
            bitDepth: 16,
          },
        },
      },
      {
        name: "data-audio event (non-PCM audio)",
        input: 'data: {"type":"data-audio","data":{"mediaType":"audio/mp3","content":"base64data"}}\n\n',
        expected: {
          type: "data-audio",
          data: {
            mediaType: "audio/mp3",
            content: "base64data",
          },
        },
      },
    ])("should parse $name correctly", ({ input, expected }) => {
      /**
       * Coverage: reviews.md Section 4 - Audio Content
       * - data-pcm (custom)
       * - data-audio (custom)
       */
      (transport as any).handleWebSocketMessage(input, controller);

      expect(controller.enqueue).toHaveBeenCalledWith(expected);
    });
  });

  describe("Category 5: Image Content Events", () => {
    it.each([
      {
        name: "data-image event (PNG)",
        input: 'data: {"type":"data-image","data":{"mediaType":"image/png","content":"iVBORw0KGgoAAAA..."}}\n\n',
        expected: {
          type: "data-image",
          data: {
            mediaType: "image/png",
            content: "iVBORw0KGgoAAAA...",
          },
        },
      },
      {
        name: "data-image event (JPEG)",
        input: 'data: {"type":"data-image","data":{"mediaType":"image/jpeg","content":"/9j/4AAQSkZJRg..."}}\n\n',
        expected: {
          type: "data-image",
          data: {
            mediaType: "image/jpeg",
            content: "/9j/4AAQSkZJRg...",
          },
        },
      },
    ])("should parse $name correctly", ({ input, expected }) => {
      /**
       * Coverage: reviews.md Section 5 - Image Content
       * - data-image (custom)
       */
      (transport as any).handleWebSocketMessage(input, controller);

      expect(controller.enqueue).toHaveBeenCalledWith(expected);
    });
  });

  describe("Category 6: Code Execution Events", () => {
    it.each([
      {
        name: "data-executable-code event",
        input: 'data: {"type":"data-executable-code","data":{"language":"python","code":"print(hello)"}}\n\n',
        expected: {
          type: "data-executable-code",
          data: {
            language: "python",
            code: "print(hello)",
          },
        },
      },
      {
        name: "data-code-execution-result event",
        input: 'data: {"type":"data-code-execution-result","data":{"outcome":"OUTCOME_OK","output":"hello"}}\n\n',
        expected: {
          type: "data-code-execution-result",
          data: {
            outcome: "OUTCOME_OK",
            output: "hello",
          },
        },
      },
    ])("should parse $name correctly", ({ input, expected }) => {
      /**
       * Coverage: reviews.md Section 6 - Code Execution
       * - data-executable-code (custom)
       * - data-code-execution-result (custom)
       *
       * Note: Frontend rendering for code execution is NOT implemented yet.
       */
      (transport as any).handleWebSocketMessage(input, controller);

      expect(controller.enqueue).toHaveBeenCalledWith(expected);
    });
  });

  describe("Category 7: Message Control Events", () => {
    it.each([
      {
        name: "start event",
        input: 'data: {"type":"start","messageId":"test-msg-123"}\n\n',
        expected: { type: "start", messageId: "test-msg-123" },
      },
      {
        name: "finish event",
        input: 'data: {"type":"finish"}\n\n',
        expected: { type: "finish" },
      },
      {
        name: "error event",
        input: 'data: {"type":"error","error":"Test error message"}\n\n',
        expected: { type: "error", error: "Test error message" },
      },
    ])("should parse $name correctly", ({ input, expected }) => {
      /**
       * Coverage: reviews.md Section 7 - Message Control
       * - start
       * - finish
       * - error
       */
      (transport as any).handleWebSocketMessage(input, controller);

      expect(controller.enqueue).toHaveBeenCalledWith(expected);
    });

    it("should close stream on [DONE] marker", () => {
      /**
       * Coverage: reviews.md Section 7 - Message Control
       * - [DONE] marker
       */
      const input = "data: [DONE]\n\n";

      (transport as any).handleWebSocketMessage(input, controller);

      expect(controller.close).toHaveBeenCalled();
      expect(controller.enqueue).not.toHaveBeenCalled();
    });
  });

  describe("Category 8: Step Control Events (AI SDK v6 Multi-step)", () => {
    it.each([
      {
        name: "step-start event",
        input: 'data: {"type":"step-start","id":"step-0"}\n\n',
        expected: { type: "step-start", id: "step-0" },
      },
      {
        name: "step-finish event",
        input: 'data: {"type":"step-finish","id":"step-0"}\n\n',
        expected: { type: "step-finish", id: "step-0" },
      },
    ])("should parse $name correctly", ({ input, expected }) => {
      /**
       * Coverage: reviews.md Section 8 - Step Control
       * - step-start
       * - step-finish
       *
       * Note: Multi-step functionality is currently not used.
       * Frontend skips rendering these events.
       */
      (transport as any).handleWebSocketMessage(input, controller);

      expect(controller.enqueue).toHaveBeenCalledWith(expected);
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("should handle empty SSE data gracefully", () => {
      const input = "data: \n\n";

      // Should not throw
      expect(() => {
        (transport as any).handleWebSocketMessage(input, controller);
      }).not.toThrow();

      expect(controller.error).toHaveBeenCalled();
    });

    it("should handle invalid JSON gracefully", () => {
      const input = "data: {invalid json}\n\n";

      expect(() => {
        (transport as any).handleWebSocketMessage(input, controller);
      }).not.toThrow();

      expect(controller.error).toHaveBeenCalled();
    });

    it("should handle messages without 'data: ' prefix", () => {
      const input = '{"type":"text-delta","text":"Hello"}\n\n';

      (transport as any).handleWebSocketMessage(input, controller);

      // Should log warning but not crash
      expect(controller.enqueue).not.toHaveBeenCalled();
    });

    it("should preserve special characters in text content", () => {
      const input = 'data: {"type":"text-delta","id":"0","delta":"Special: \\"quotes\\", \\n newlines, \\t tabs"}\n\n';

      (transport as any).handleWebSocketMessage(input, controller);

      expect(controller.enqueue).toHaveBeenCalledWith({
        type: "text-delta",
        id: "0",
        delta: 'Special: "quotes", \n newlines, \t tabs',
      });
    });

    it("should handle large base64 content", () => {
      // Simulate large base64 image content
      const largeContent = "A".repeat(10000);
      const input = `data: {"type":"data-image","data":{"mediaType":"image/png","content":"${largeContent}"}}\n\n`;

      (transport as any).handleWebSocketMessage(input, controller);

      expect(controller.enqueue).toHaveBeenCalledWith({
        type: "data-image",
        data: {
          mediaType: "image/png",
          content: largeContent,
        },
      });
    });
  });

  describe("Multi-part Message Sequence", () => {
    it("should handle complete text message sequence", () => {
      /**
       * Test full sequence: start → text-start → text-delta → text-end → finish → [DONE]
       */
      const sequence = [
        'data: {"type":"start","messageId":"msg-1"}\n\n',
        'data: {"type":"text-start","id":"0"}\n\n',
        'data: {"type":"text-delta","id":"0","delta":"Hello"}\n\n',
        'data: {"type":"text-end","id":"0"}\n\n',
        'data: {"type":"finish"}\n\n',
        "data: [DONE]\n\n",
      ];

      sequence.forEach((msg) => {
        (transport as any).handleWebSocketMessage(msg, controller);
      });

      // Verify all events were enqueued (except [DONE] which closes)
      expect(controller.enqueue).toHaveBeenCalledTimes(5);
      expect(controller.close).toHaveBeenCalledTimes(1);
    });

    it("should handle text + image combined message", () => {
      /**
       * Test complex message with multiple content types
       */
      const sequence = [
        'data: {"type":"start","messageId":"msg-1"}\n\n',
        'data: {"type":"text-start","id":"0"}\n\n',
        'data: {"type":"text-delta","id":"0","delta":"Here is an image:"}\n\n',
        'data: {"type":"text-end","id":"0"}\n\n',
        'data: {"type":"data-image","data":{"mediaType":"image/png","content":"base64data"}}\n\n',
        'data: {"type":"finish"}\n\n',
      ];

      sequence.forEach((msg) => {
        (transport as any).handleWebSocketMessage(msg, controller);
      });

      expect(controller.enqueue).toHaveBeenCalledTimes(6);
    });

    it("should handle text + tool call combined message", () => {
      /**
       * Test message with text and tool call
       */
      const sequence = [
        'data: {"type":"start","messageId":"msg-1"}\n\n',
        'data: {"type":"text-start","id":"0"}\n\n',
        'data: {"type":"text-delta","id":"0","delta":"Let me check the weather."}\n\n',
        'data: {"type":"text-end","id":"0"}\n\n',
        'data: {"type":"tool-call-start","toolCallId":"call_0","toolName":"get_weather"}\n\n',
        'data: {"type":"tool-call-available","toolCallId":"call_0","toolName":"get_weather","input":{"location":"Tokyo"}}\n\n',
        'data: {"type":"finish"}\n\n',
      ];

      sequence.forEach((msg) => {
        (transport as any).handleWebSocketMessage(msg, controller);
      });

      expect(controller.enqueue).toHaveBeenCalledTimes(7);
    });
  });

  describe("Performance and Load", () => {
    it("should handle rapid succession of events", () => {
      /**
       * Simulate high-frequency streaming
       */
      const rapidEvents = Array.from({ length: 100 }, (_, i) =>
        `data: {"type":"text-delta","id":"0","delta":"chunk${i}"}\n\n`
      );

      rapidEvents.forEach((msg) => {
        (transport as any).handleWebSocketMessage(msg, controller);
      });

      expect(controller.enqueue).toHaveBeenCalledTimes(100);
      expect(controller.error).not.toHaveBeenCalled();
    });

    it("should handle large JSON payloads", () => {
      /**
       * Test with large tool call arguments
       */
      const largeArgs = { data: Array.from({ length: 1000 }, (_, i) => `item${i}`) };
      const input = `data: {"type":"tool-call-available","toolCallId":"call_0","toolName":"process","input":${JSON.stringify(largeArgs)}}\n\n`;

      (transport as any).handleWebSocketMessage(input, controller);

      expect(controller.enqueue).toHaveBeenCalledWith({
        type: "tool-call-available",
        toolCallId: "call_0",
        toolName: "process",
        input: largeArgs,
      });
    });
  });
});
