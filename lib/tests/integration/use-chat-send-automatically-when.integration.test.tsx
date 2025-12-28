/**
 * Integration Tests for sendAutomaticallyWhen Configuration
 *
 * CRITICAL: Tests that sendAutomaticallyWhen is properly configured when
 * using buildUseChatOptions for both SSE and BIDI modes.
 *
 * Note: Behavior tests with fixture replay are in lib/tests/e2e/ since
 * ChunkPlayerTransport requires a real browser environment (Playwright).
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildUseChatOptions } from "../../build-use-chat-options";

describe("sendAutomaticallyWhen Integration with useChat", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe("Configuration Verification", () => {
    it("SSE mode: sendAutomaticallyWhen is configured", () => {
      const { useChatOptions } = buildUseChatOptions({
        mode: "adk-sse",
        initialMessages: [],
        forceNewInstance: true,
      });

      expect(useChatOptions.sendAutomaticallyWhen).toBeDefined();
      expect(typeof useChatOptions.sendAutomaticallyWhen).toBe("function");
    });

    it("BIDI mode: sendAutomaticallyWhen is configured", () => {
      const { useChatOptions } = buildUseChatOptions({
        mode: "adk-bidi",
        initialMessages: [],
        forceNewInstance: true,
      });

      expect(useChatOptions.sendAutomaticallyWhen).toBeDefined();
      expect(typeof useChatOptions.sendAutomaticallyWhen).toBe("function");
    });

    it("SSE mode: ChunkPlayerTransport is used in E2E mode", () => {
      localStorage.setItem("E2E_CHUNK_PLAYER_MODE", "true");
      localStorage.setItem(
        "E2E_CHUNK_PLAYER_FIXTURE",
        "fixtures/backend/process_payment-approved-sse-from-frontend.jsonl",
      );

      const { useChatOptions } = buildUseChatOptions({
        mode: "adk-sse",
        initialMessages: [],
        forceNewInstance: true,
      });

      expect(useChatOptions.transport).toBeDefined();
      expect(useChatOptions.transport.constructor.name).toBe(
        "ChunkPlayerTransport",
      );
    });

    it("BIDI mode: ChunkPlayerTransport is used in E2E mode", () => {
      localStorage.setItem("E2E_CHUNK_PLAYER_MODE", "true");
      localStorage.setItem(
        "E2E_CHUNK_PLAYER_FIXTURE",
        "fixtures/backend/process_payment-approved-bidi-from-frontend.jsonl",
      );

      const { useChatOptions } = buildUseChatOptions({
        mode: "adk-bidi",
        initialMessages: [],
        forceNewInstance: true,
      });

      expect(useChatOptions.transport).toBeDefined();
      expect(useChatOptions.transport.constructor.name).toBe(
        "ChunkPlayerTransport",
      );
    });

    it("BIDI mode: sendAutomaticallyWhen returns boolean for all message types", () => {
      const { useChatOptions } = buildUseChatOptions({
        mode: "adk-bidi",
        initialMessages: [],
        forceNewInstance: true,
      });

      const sendAuto = useChatOptions.sendAutomaticallyWhen!;

      // Empty messages array
      expect(typeof sendAuto({ messages: [] })).toBe("boolean");

      // User message
      expect(
        typeof sendAuto({
          messages: [{ id: "1", role: "user", content: "Hello" }],
        }),
      ).toBe("boolean");

      // Assistant message
      expect(
        typeof sendAuto({
          messages: [{ id: "2", role: "assistant", content: "Hi" }],
        }),
      ).toBe("boolean");
    });

    it("SSE mode: sendAutomaticallyWhen returns boolean for all message types", () => {
      const { useChatOptions } = buildUseChatOptions({
        mode: "adk-sse",
        initialMessages: [],
        forceNewInstance: true,
      });

      const sendAuto = useChatOptions.sendAutomaticallyWhen!;

      // Empty messages array
      expect(typeof sendAuto({ messages: [] })).toBe("boolean");

      // User message
      expect(
        typeof sendAuto({
          messages: [{ id: "1", role: "user", content: "Hello" }],
        }),
      ).toBe("boolean");

      // Assistant message
      expect(
        typeof sendAuto({
          messages: [{ id: "2", role: "assistant", content: "Hi" }],
        }),
      ).toBe("boolean");
    });
  });
});
