/**
 * Integration Tests for Unicode and Special Character Handling
 *
 * Tests that the system correctly handles various character encodings,
 * special characters, and edge cases without requiring LLM API calls.
 *
 * Scope:
 * - UTF-8 encoding (Japanese, Chinese, Korean, Emoji, etc.)
 * - Special characters (newlines, tabs, quotes, backslashes)
 * - Mixed content (multi-byte + ASCII)
 * - Boundary cases (empty strings, whitespace, control characters)
 *
 * Note: This tests system encoding/decoding, not LLM language understanding.
 */

import { http } from "msw";
import { describe, expect, it } from "vitest";
import { buildUseChatOptions } from "../../build-use-chat-options";
import type {
  UIMessageChunkFromAISDKv6,
  UIMessageFromAISDKv6,
} from "../../utils";
import { createTextResponse, setupMswServer } from "../helpers";

// Create MSW server with standard lifecycle
const server = setupMswServer();

describe("Unicode and Encoding Integration Tests", () => {
  describe("Multibyte Character Encoding", () => {
    it.each([
      {
        mode: "gemini" as const,
        endpoint: "http://localhost/api/chat",
        lang: "Japanese",
        text: "こんにちは、世界！🌍",
      },
      {
        mode: "adk-sse" as const,
        endpoint: "http://localhost:8000/stream",
        lang: "Japanese",
        text: "こんにちは、世界！🌍",
      },
      {
        mode: "gemini" as const,
        endpoint: "http://localhost/api/chat",
        lang: "Chinese",
        text: "你好，世界！🌏",
      },
      {
        mode: "adk-sse" as const,
        endpoint: "http://localhost:8000/stream",
        lang: "Korean",
        text: "안녕하세요, 세계! 🌎",
      },
    ])("$mode: should correctly encode $lang text", async ({
      mode,
      endpoint,
      text,
    }) => {
      // given
      let capturedPayload: unknown = null;

      server.use(
        http.post(endpoint, async ({ request }) => {
          capturedPayload = await request.json();
          return createTextResponse(text); // Echo back same text
        }),
      );

      const { useChatOptions } = buildUseChatOptions({
        mode,
        initialMessages: [],
        ...(mode === "gemini" && { apiEndpoint: "http://localhost/api/chat" }),
      });

      const messages: UIMessageFromAISDKv6[] = [
        {
          id: "1",
          role: "user",
          parts: [{ type: "text", text }],
        } as UIMessageFromAISDKv6,
      ];

      // when
      const result = await useChatOptions.transport.sendMessages({
        trigger: "submit-message",
        chatId: useChatOptions.id,
        messageId: "msg-1",
        messages,
        abortSignal: undefined,
      });

      const reader = result.getReader();
      const chunks: UIMessageChunkFromAISDKv6[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      // then - verify encoding preserved in request
      expect(capturedPayload).toMatchObject({
        messages: [
          {
            role: "user",
            parts: expect.arrayContaining([
              expect.objectContaining({ type: "text", text }),
            ]),
          },
        ],
      });

      // then - verify encoding preserved in response
      const textDeltas = chunks.filter((c) => c.type === "text-delta");
      expect(textDeltas.length).toBeGreaterThanOrEqual(1);
      const fullText = textDeltas.map((c) => c.delta).join("");
      expect(fullText).toBe(text);
    });
  });

  describe("Emoji Handling", () => {
    it.each([
      { emoji: "😀", description: "Simple emoji" },
      { emoji: "👨‍👩‍👧‍👦", description: "Family emoji (ZWJ sequence)" },
      { emoji: "🏳️‍🌈", description: "Flag emoji (combining)" },
      { emoji: "🇯🇵", description: "Country flag (regional indicators)" },
      { emoji: "👍🏽", description: "Emoji with skin tone modifier" },
    ])("should correctly handle $description: $emoji", async ({ emoji }) => {
      // given
      let capturedPayload: unknown = null;

      server.use(
        http.post("http://localhost:8000/stream", async ({ request }) => {
          capturedPayload = await request.json();
          return createTextResponse(emoji);
        }),
      );

      const { useChatOptions } = buildUseChatOptions({
        mode: "adk-sse",
        initialMessages: [],
      });

      const text = `Test ${emoji} emoji`;
      const messages: UIMessageFromAISDKv6[] = [
        {
          id: "1",
          role: "user",
          parts: [{ type: "text", text }],
        } as UIMessageFromAISDKv6,
      ];

      // when
      const result = await useChatOptions.transport.sendMessages({
        trigger: "submit-message",
        chatId: useChatOptions.id,
        messageId: "msg-1",
        messages,
        abortSignal: undefined,
      });

      const reader = result.getReader();
      const chunks: UIMessageChunkFromAISDKv6[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      // then - emoji preserved in request
      expect(capturedPayload).toMatchObject({
        messages: [
          {
            role: "user",
            parts: expect.arrayContaining([
              expect.objectContaining({ type: "text", text }),
            ]),
          },
        ],
      });

      // then - emoji preserved in response
      const textDeltas = chunks.filter((c) => c.type === "text-delta");
      const fullText = textDeltas.map((c) => c.delta).join("");
      expect(fullText).toBe(emoji);
    });
  });

  describe("Special Character Escaping", () => {
    it.each([
      { char: "\n", description: "newline", display: "\\n" },
      { char: "\t", description: "tab", display: "\\t" },
      { char: "\r", description: "carriage return", display: "\\r" },
      { char: '"', description: "double quote", display: '"' },
      { char: "'", description: "single quote", display: "'" },
      { char: "\\", description: "backslash", display: "\\\\" },
      { char: "/", description: "forward slash", display: "/" },
    ])("should correctly handle $description ($display)", async ({ char }) => {
      // given
      let capturedPayload: unknown = null;

      server.use(
        http.post("http://localhost:8000/stream", async ({ request }) => {
          capturedPayload = await request.json();
          return createTextResponse(`Echo: ${char}`);
        }),
      );

      const { useChatOptions } = buildUseChatOptions({
        mode: "adk-sse",
        initialMessages: [],
      });

      const text = `Before${char}After`;
      const messages: UIMessageFromAISDKv6[] = [
        {
          id: "1",
          role: "user",
          parts: [{ type: "text", text }],
        } as UIMessageFromAISDKv6,
      ];

      // when
      const result = await useChatOptions.transport.sendMessages({
        trigger: "submit-message",
        chatId: useChatOptions.id,
        messageId: "msg-1",
        messages,
        abortSignal: undefined,
      });

      const reader = result.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }

      // then - special character preserved
      expect(capturedPayload).toMatchObject({
        messages: [
          {
            role: "user",
            parts: expect.arrayContaining([
              expect.objectContaining({ type: "text", text }),
            ]),
          },
        ],
      });
    });
  });

  describe("Mixed Content", () => {
    it("should handle mixed ASCII and multibyte characters", async () => {
      // given
      let capturedPayload: unknown = null;

      server.use(
        http.post("http://localhost:8000/stream", async ({ request }) => {
          capturedPayload = await request.json();
          return createTextResponse("OK");
        }),
      );

      const { useChatOptions } = buildUseChatOptions({
        mode: "adk-sse",
        initialMessages: [],
      });

      const text =
        "ASCII text 日本語テキスト Chinese中文 Korean한글 Emoji😀 Special!@#$%";
      const messages: UIMessageFromAISDKv6[] = [
        {
          id: "1",
          role: "user",
          parts: [{ type: "text", text }],
        } as UIMessageFromAISDKv6,
      ];

      // when
      const result = await useChatOptions.transport.sendMessages({
        trigger: "submit-message",
        chatId: useChatOptions.id,
        messageId: "msg-1",
        messages,
        abortSignal: undefined,
      });

      const reader = result.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }

      // then - all characters preserved
      expect(capturedPayload).toMatchObject({
        messages: [
          {
            role: "user",
            parts: expect.arrayContaining([
              expect.objectContaining({ type: "text", text }),
            ]),
          },
        ],
      });
    });

    it("should handle code snippets with mixed content", async () => {
      // given
      let capturedPayload: unknown = null;

      server.use(
        http.post("http://localhost:8000/stream", async ({ request }) => {
          capturedPayload = await request.json();
          return createTextResponse("Received code");
        }),
      );

      const { useChatOptions } = buildUseChatOptions({
        mode: "adk-sse",
        initialMessages: [],
      });

      const codeSnippet = `function greet(name: string) {
  console.log(\`Hello, \${name}! こんにちは！\`);
  return "Welcome 🎉";
}`;

      const messages: UIMessageFromAISDKv6[] = [
        {
          id: "1",
          role: "user",
          parts: [{ type: "text", text: codeSnippet }],
        } as UIMessageFromAISDKv6,
      ];

      // when
      const result = await useChatOptions.transport.sendMessages({
        trigger: "submit-message",
        chatId: useChatOptions.id,
        messageId: "msg-1",
        messages,
        abortSignal: undefined,
      });

      const reader = result.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }

      // then - code preserved exactly
      expect(capturedPayload).toMatchObject({
        messages: [
          {
            role: "user",
            parts: expect.arrayContaining([
              expect.objectContaining({ type: "text", text: codeSnippet }),
            ]),
          },
        ],
      });
    });
  });

  describe("Boundary Cases", () => {
    it("should handle very long single-byte strings", async () => {
      // given
      let capturedPayload: unknown = null;

      server.use(
        http.post("http://localhost:8000/stream", async ({ request }) => {
          capturedPayload = await request.json();
          return createTextResponse("OK");
        }),
      );

      const { useChatOptions } = buildUseChatOptions({
        mode: "adk-sse",
        initialMessages: [],
      });

      // 1000 character string
      const longText = "a".repeat(1000);
      const messages: UIMessageFromAISDKv6[] = [
        {
          id: "1",
          role: "user",
          parts: [{ type: "text", text: longText }],
        } as UIMessageFromAISDKv6,
      ];

      // when
      const result = await useChatOptions.transport.sendMessages({
        trigger: "submit-message",
        chatId: useChatOptions.id,
        messageId: "msg-1",
        messages,
        abortSignal: undefined,
      });

      const reader = result.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }

      // then
      expect(capturedPayload).toMatchObject({
        messages: [
          {
            role: "user",
            parts: expect.arrayContaining([
              expect.objectContaining({ type: "text", text: longText }),
            ]),
          },
        ],
      });
    });

    it("should handle very long multibyte strings", async () => {
      // given
      let capturedPayload: unknown = null;

      server.use(
        http.post("http://localhost:8000/stream", async ({ request }) => {
          capturedPayload = await request.json();
          return createTextResponse("OK");
        }),
      );

      const { useChatOptions } = buildUseChatOptions({
        mode: "adk-sse",
        initialMessages: [],
      });

      // 500 Japanese characters
      const longText = "あ".repeat(500);
      const messages: UIMessageFromAISDKv6[] = [
        {
          id: "1",
          role: "user",
          parts: [{ type: "text", text: longText }],
        } as UIMessageFromAISDKv6,
      ];

      // when
      const result = await useChatOptions.transport.sendMessages({
        trigger: "submit-message",
        chatId: useChatOptions.id,
        messageId: "msg-1",
        messages,
        abortSignal: undefined,
      });

      const reader = result.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }

      // then
      expect(capturedPayload).toMatchObject({
        messages: [
          {
            role: "user",
            parts: expect.arrayContaining([
              expect.objectContaining({ type: "text", text: longText }),
            ]),
          },
        ],
      });
    });

    it("should handle strings with only whitespace characters", async () => {
      // given
      let capturedPayload: unknown = null;

      server.use(
        http.post("http://localhost:8000/stream", async ({ request }) => {
          capturedPayload = await request.json();
          return createTextResponse("Whitespace received");
        }),
      );

      const { useChatOptions } = buildUseChatOptions({
        mode: "adk-sse",
        initialMessages: [],
      });

      const whitespaceText = "   \n\t\r\n   ";
      const messages: UIMessageFromAISDKv6[] = [
        {
          id: "1",
          role: "user",
          parts: [{ type: "text", text: whitespaceText }],
        } as UIMessageFromAISDKv6,
      ];

      // when
      const result = await useChatOptions.transport.sendMessages({
        trigger: "submit-message",
        chatId: useChatOptions.id,
        messageId: "msg-1",
        messages,
        abortSignal: undefined,
      });

      const reader = result.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }

      // then - whitespace preserved
      expect(capturedPayload).toMatchObject({
        messages: [
          {
            role: "user",
            parts: expect.arrayContaining([
              expect.objectContaining({ type: "text", text: whitespaceText }),
            ]),
          },
        ],
      });
    });
  });

  describe("JSON Escaping", () => {
    it("should correctly escape JSON special characters", async () => {
      // given
      let capturedPayload: unknown = null;

      server.use(
        http.post("http://localhost:8000/stream", async ({ request }) => {
          capturedPayload = await request.json();
          return createTextResponse("Received JSON");
        }),
      );

      const { useChatOptions } = buildUseChatOptions({
        mode: "adk-sse",
        initialMessages: [],
      });

      const jsonText = '{"key": "value with \\"quotes\\" and \\nnewlines"}';
      const messages: UIMessageFromAISDKv6[] = [
        {
          id: "1",
          role: "user",
          parts: [{ type: "text", text: jsonText }],
        } as UIMessageFromAISDKv6,
      ];

      // when
      const result = await useChatOptions.transport.sendMessages({
        trigger: "submit-message",
        chatId: useChatOptions.id,
        messageId: "msg-1",
        messages,
        abortSignal: undefined,
      });

      const reader = result.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }

      // then
      expect(capturedPayload).toMatchObject({
        messages: [
          {
            role: "user",
            parts: expect.arrayContaining([
              expect.objectContaining({ type: "text", text: jsonText }),
            ]),
          },
        ],
      });
    });
  });
});
