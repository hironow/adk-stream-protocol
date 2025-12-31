/**
 * Public API Tests for lib/sse
 *
 * Tests the public API exported from lib/sse/index.ts
 * All tests use only the public API, not internal implementation details.
 */

import { describe, expect, it } from "vitest";
import {
  buildUseChatOptions,
  type ChatTransportFromAISDKv6,
  createTransport,
  type Mode,
  type SendAutomaticallyWhenOptions,
  sendAutomaticallyWhen,
  type TransportConfig,
  type UseChatConfig,
  type UseChatOptions,
} from "../../sse";
import type { UIMessageFromAISDKv6 } from "../../utils";

describe("lib/sse Public API", () => {
  describe("buildUseChatOptions", () => {
    it.each<{
      config: UseChatConfig;
      name: string;
      expectedChatId: string;
      expectSendAuto: boolean;
    }>([
      {
        name: "creates options for adk-sse mode with default URL",
        config: { mode: "adk-sse", initialMessages: [] },
        expectedChatId: "chat-adk-sse-http---localhost-8000-stream",
        expectSendAuto: true,
      },
      {
        name: "creates options for gemini mode",
        config: { mode: "gemini", initialMessages: [] },
        expectedChatId: "chat-gemini--api-chat",
        expectSendAuto: false,
      },
      {
        name: "creates options with custom backend URL",
        config: {
          mode: "adk-sse",
          initialMessages: [],
          adkBackendUrl: "http://example.com:9000",
        },
        expectedChatId: "chat-adk-sse-http---example-com-9000-stream",
        expectSendAuto: true,
      },
      {
        name: "creates options with custom API endpoint",
        config: {
          mode: "adk-sse",
          initialMessages: [],
          apiEndpoint: "/custom/endpoint",
        },
        expectedChatId: "chat-adk-sse--custom-endpoint",
        expectSendAuto: true,
      },
      {
        name: "creates options with forced new instance",
        config: { mode: "gemini", initialMessages: [], forceNewInstance: true },
        expectedChatId: /^chat-gemini--api-chat-\d+$/,
        expectSendAuto: false,
      },
    ])("$name", ({ config, expectedChatId, expectSendAuto }) => {
      // when
      const result = buildUseChatOptions(config);

      // then
      expect(result).toHaveProperty("useChatOptions");
      expect(result.useChatOptions.messages).toEqual(config.initialMessages);
      expect(result.useChatOptions.id).toMatch(
        typeof expectedChatId === "string"
          ? new RegExp(`^${expectedChatId}`)
          : expectedChatId,
      );
      expect(result.useChatOptions.transport).toBeDefined();

      if (expectSendAuto) {
        expect(result.useChatOptions.sendAutomaticallyWhen).toBeDefined();
      } else {
        expect(result.useChatOptions.sendAutomaticallyWhen).toBeUndefined();
      }

      // SSE mode doesn't return transport reference
      expect(result.transport).toBeUndefined();
    });
  });

  describe("sendAutomaticallyWhen", () => {
    it.each<{
      messages: UIMessageFromAISDKv6[];
      expected: boolean;
      name: string;
    }>([
      {
        name: "returns false when last message is user message",
        messages: [
          { id: "1", role: "user", content: "Hello" },
        ] as UIMessageFromAISDKv6[],
        expected: false,
      },
      {
        name: "returns false when no confirmation part exists",
        messages: [
          {
            id: "1",
            role: "assistant",
            content: "Hello",
            parts: [
              {
                type: "text",
                text: "Hello",
              },
            ],
          },
        ] as any,
        expected: false,
      },
      {
        name: "returns false when confirmation event arrives (Phase 1 - first time)",
        messages: [
          {
            id: "1",
            role: "assistant",
            content: "",
            parts: [
              {
                type: "tool-search", // AI SDK v6: original tool, not adk_request_confirmation
                state: "approval-requested", // State remains approval-requested
                toolCallId: "orig-1",
                input: { query: "test" },
                approval: {
                  id: "approval-1", // Just the id, no approved field yet
                },
              },
            ],
          },
        ] as any,
        expected: false, // Phase 1: Don't send yet, wait for user response
      },
      {
        name: "returns false when confirmation completed but other tool also completed (backend responded)",
        messages: [
          {
            id: "1",
            role: "assistant",
            content: "Here are the search results",
            parts: [
              {
                type: "tool-adk_request_confirmation",
                state: "approval-responded",
                toolCallId: "call-1",
                input: {
                  originalFunctionCall: {
                    id: "orig-1",
                    name: "search",
                    args: {},
                  },
                },
                approval: {
                  id: "call-1",
                  approved: true,
                },
              },
              {
                type: "tool-search",
                state: "output-available",
                toolCallId: "orig-1",
                output: { result: "data" },
              },
              {
                type: "text",
                text: "Here are the search results",
              },
            ],
          },
        ] as any,
        expected: false,
      },
      {
        name: "returns false when other tool has error state",
        messages: [
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
                    name: "search",
                    args: {},
                  },
                },
                approval: {
                  id: "call-1",
                  approved: true,
                },
              },
              {
                type: "tool-search",
                state: "output-error",
                toolCallId: "orig-1",
                error: "Failed",
              },
            ],
          },
        ] as any,
        expected: false,
      },
    ])("$name", ({ messages, expected }) => {
      // when
      const result = sendAutomaticallyWhen({ messages });

      // then
      expect(result).toBe(expected);
    });

    it("returns false on error to prevent infinite loops", () => {
      // given
      const invalidMessages = null as any;

      // when
      const result = sendAutomaticallyWhen({ messages: invalidMessages });

      // then
      expect(result).toBe(false);
    });

    it("detects state change from approval-requested to approval-responded", () => {
      // AI SDK v6: When user calls addToolApprovalResponse() with correct approval.id,
      // state changes from "approval-requested" to "approval-responded" immediately

      // given: Message with tool approval request (state="approval-requested")
      const messagesWaiting = [
        {
          id: "msg-1",
          role: "assistant",
          parts: [
            {
              type: "tool-search",
              state: "approval-requested",
              toolCallId: "tool-1",
              input: { query: "test" },
              approval: { id: "approval-1" }, // User hasn't responded yet
            },
          ],
        },
      ] as any;

      // when: User hasn't approved yet
      const firstResult = sendAutomaticallyWhen({ messages: messagesWaiting });

      // then: Should return false (wait for user to respond)
      expect(firstResult).toBe(false);

      // given: Message after user approval (state changed to "approval-responded")
      const messagesApproved = [
        {
          id: "msg-1",
          role: "assistant",
          parts: [
            {
              type: "tool-search",
              state: "approval-responded", // ← State changed after addToolApprovalResponse
              toolCallId: "tool-1",
              input: { query: "test" },
              approval: {
                id: "approval-1",
                approved: true, // ← User's decision
                reason: undefined,
              },
            },
          ],
        },
      ] as any;

      // when: User has approved (state is now approval-responded)
      const secondResult = sendAutomaticallyWhen({
        messages: messagesApproved,
      });

      // then: Should return true (send approval to backend)
      expect(secondResult).toBe(true);
    });
  });

  describe("createTransport", () => {
    it.each<{
      config: TransportConfig;
      name: string;
      expectedApi: string;
    }>([
      {
        name: "creates transport with default API",
        config: { api: "/api/chat" },
        expectedApi: "/api/chat",
      },
      {
        name: "creates transport with custom API",
        config: { api: "/custom/endpoint" },
        expectedApi: "/custom/endpoint",
      },
      {
        name: "creates transport with ADK backend URL",
        config: { api: "http://localhost:8000/stream" },
        expectedApi: "http://localhost:8000/stream",
      },
    ])("$name", ({ config }) => {
      // when
      const transport = createTransport(config);

      // then
      expect(transport).toBeDefined();
      expect(typeof transport.sendMessages).toBe("function");
    });

    it("creates transport with prepareSendMessagesRequest", () => {
      // given
      const prepareSendMessagesRequest = async (options: any) => {
        const { body: _body, ...rest } = options;
        return { ...rest, api: "/overridden" };
      };

      // when
      const transport = createTransport({
        api: "/api/chat",
        prepareSendMessagesRequest,
      });

      // then
      expect(transport).toBeDefined();
      expect(typeof transport.sendMessages).toBe("function");
    });
  });

  describe("Mode Type", () => {
    it.each<{ mode: Mode; name: string }>([
      { mode: "adk-sse", name: "accepts adk-sse mode" },
      { mode: "gemini", name: "accepts gemini mode" },
    ])("$name", ({ mode }) => {
      // This test verifies that Mode type accepts valid values
      const _mode: Mode = mode;
      expect(_mode).toBe(mode);
    });
  });

  describe("Type Exports", () => {
    it("exports required types", () => {
      // This test verifies that types are correctly exported
      // TypeScript will fail compilation if types are not exported

      const _config: UseChatConfig = {
        mode: "adk-sse",
        initialMessages: [],
        adkBackendUrl: "http://localhost:8000",
        forceNewInstance: false,
      };

      const _options: UseChatOptions = {
        useChatOptions: {
          transport: {} as any,
          messages: [],
          id: "test",
          sendAutomaticallyWhen: () => false,
        },
        transport: undefined,
      };

      const _transportConfig: TransportConfig = {
        api: "/api/chat",
      };

      const _sendAutoOptions: SendAutomaticallyWhenOptions = {
        messages: [],
      };

      const _mode: Mode = "adk-sse";

      // If this compiles, types are correctly exported
      expect(_config).toBeDefined();
      expect(_options).toBeDefined();
      expect(_transportConfig).toBeDefined();
      expect(_sendAutoOptions).toBeDefined();
      expect(_mode).toBeDefined();
    });
  });

  describe("Unified API Naming", () => {
    it("exports unified API names", () => {
      // Verify that the public API uses unified names (not mode-specific)
      // This ensures consistency with lib/bidi

      expect(buildUseChatOptions).toBeDefined();
      expect(sendAutomaticallyWhen).toBeDefined();
      expect(createTransport).toBeDefined();

      // Type aliases should work
      const transport: ChatTransportFromAISDKv6 = {} as any;
      expect(transport).toBeDefined();
    });
  });

  describe("Integration - buildUseChatOptions returns valid useChat config", () => {
    it.each<{ mode: Mode; name: string }>([
      {
        mode: "adk-sse",
        name: "adk-sse mode returns valid config",
      },
      {
        mode: "gemini",
        name: "gemini mode returns valid config",
      },
    ])("$name", async ({ mode }) => {
      // given
      const config: UseChatConfig = {
        mode,
        initialMessages: [
          { id: "1", role: "user", content: "Hello" },
        ] as UIMessageFromAISDKv6[],
      };

      // when
      const result = buildUseChatOptions(config);

      // then
      // Verify structure matches what useChat expects
      expect(result.useChatOptions).toHaveProperty("messages");
      expect(result.useChatOptions).toHaveProperty("id");
      expect(result.useChatOptions).toHaveProperty("transport");

      // Verify transport can be called
      expect(typeof result.useChatOptions.transport.sendMessages).toBe(
        "function",
      );

      // Verify sendAutomaticallyWhen exists only for adk-sse
      if (mode === "adk-sse") {
        expect(result.useChatOptions.sendAutomaticallyWhen).toBeDefined();
        const shouldSend = await result.useChatOptions.sendAutomaticallyWhen!({
          messages: config.initialMessages,
        });
        expect(typeof shouldSend).toBe("boolean");
      } else {
        expect(result.useChatOptions.sendAutomaticallyWhen).toBeUndefined();
      }
    });
  });

  describe("Mode-specific behavior", () => {
    it("adk-sse mode includes sendAutomaticallyWhen", () => {
      // when
      const result = buildUseChatOptions({
        mode: "adk-sse",
        initialMessages: [],
      });

      // then
      expect(result.useChatOptions.sendAutomaticallyWhen).toBeDefined();
    });

    it("gemini mode excludes sendAutomaticallyWhen", () => {
      // when
      const result = buildUseChatOptions({
        mode: "gemini",
        initialMessages: [],
      });

      // then
      expect(result.useChatOptions.sendAutomaticallyWhen).toBeUndefined();
    });
  });
});
