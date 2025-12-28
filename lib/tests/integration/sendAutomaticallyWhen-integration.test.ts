/**
 * Integration Tests for sendAutomaticallyWhen - Infinite Loop Prevention
 *
 * CRITICAL: Tests that sendAutomaticallyWhen prevents infinite auto-submission loops.
 * Without proper guards, confirmation completion could trigger endless requests.
 *
 * Tested Scenarios:
 * 1. First confirmation completion → auto-send (true)
 * 2. Backend responds → no auto-send (false) - PREVENTS INFINITE LOOP
 * 3. Error states → no auto-send (false) - PREVENTS INFINITE LOOP
 */

import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import { sendAutomaticallyWhen as bidiSendAuto } from "../../bidi";
import {
  TOOL_STATE_APPROVAL_RESPONDED,
  TOOL_STATE_OUTPUT_AVAILABLE,
} from "../../constants";
import { sendAutomaticallyWhen as sseSendAuto } from "../../sse";

describe("sendAutomaticallyWhen - Infinite Loop Prevention", () => {
  describe("BIDI Mode - Infinite Loop Prevention", () => {
    it("CRITICAL: returns false after backend responds to prevent infinite loop", () => {
      // Scenario: User confirms → auto-send → backend responds with tool result
      // Expected: sendAutomaticallyWhen must return FALSE to prevent re-sending
      //
      // Without this guard: confirmation completion → send → backend responds →
      // confirmation still complete → send → infinite loop! ❌
      //
      // ADR 0002: No separate adk_request_confirmation tool. Original tool transitions:
      // approval-requested → approval-responded → output-available

      const messagesAfterBackendResponse: UIMessage[] = [
        {
          id: "1",
          role: "assistant",
          content: "Here are the search results",
          parts: [
            {
              // ADR 0002: Original tool has transitioned to output-available after approval
              type: "tool-search",
              state: "output-available",
              toolCallId: "orig-1",
              toolName: "search",
              input: { query: "test" },
              output: { results: ["data1", "data2"] },
              approval: {
                id: "approval-1",
                approved: true,
              },
            },
            {
              // Backend has sent text response
              type: "text",
              text: "Here are the search results",
            },
          ],
        } as any,
      ];

      // when
      const shouldSend = bidiSendAuto({
        messages: messagesAfterBackendResponse,
      });

      // then
      expect(shouldSend).toBe(false); // MUST be false to prevent infinite loop
    });

    it("CRITICAL: returns true only on FIRST confirmation completion", () => {
      // Scenario: User just confirmed, backend hasn't responded yet
      // Expected: sendAutomaticallyWhen returns TRUE (trigger auto-send once)
      //
      // ADR 0002: Original tool is in approval-responded state, no output yet

      const messagesFirstConfirmation: UIMessage[] = [
        {
          id: "1",
          role: "assistant",
          content: "",
          parts: [
            {
              // ADR 0002: Original tool in approval-responded state
              type: "tool-search",
              state: TOOL_STATE_APPROVAL_RESPONDED,
              toolCallId: "orig-1",
              toolName: "search",
              input: {},
              approval: {
                id: "approval-1",
                approved: true,
              },
            },
            // No output yet - backend hasn't responded
          ],
        } as any,
      ];

      // when
      const shouldSend = bidiSendAuto({ messages: messagesFirstConfirmation });

      // then
      expect(shouldSend).toBe(true); // OK to send once
    });

    it("CRITICAL: returns false when tool has error state to prevent infinite loop", () => {
      // Scenario: Tool execution failed after approval
      // Expected: Must return FALSE to prevent retry loop
      //
      // ADR 0002: Original tool transitions to output-error state

      const messagesWithError: UIMessage[] = [
        {
          id: "1",
          role: "assistant",
          content: "",
          parts: [
            {
              // ADR 0002: Original tool in error state after approval
              type: "tool-search",
              state: "output-error",
              toolCallId: "orig-1",
              toolName: "search",
              input: {},
              approval: {
                id: "approval-1",
                approved: true,
              },
              error: "Network timeout",
            },
          ],
        } as any,
      ];

      // when
      const shouldSend = bidiSendAuto({ messages: messagesWithError });

      // then
      expect(shouldSend).toBe(false); // MUST NOT retry on error
    });

    it("returns false for user messages to prevent accidental auto-send", () => {
      const userMessage: UIMessage[] = [
        {
          id: "1",
          role: "user",
          content: "Hello",
        },
      ];

      // when
      const shouldSend = bidiSendAuto({ messages: userMessage });

      // then
      expect(shouldSend).toBe(false);
    });

    it("CRITICAL: handles error in sendAutomaticallyWhen gracefully (returns false)", () => {
      // Scenario: Invalid input causes error in sendAutomaticallyWhen
      // Expected: Must return FALSE to prevent infinite loop even on error

      const invalidMessages = null as any;

      // when
      const shouldSend = bidiSendAuto({ messages: invalidMessages });

      // then
      expect(shouldSend).toBe(false); // MUST default to false on error
    });
  });

  describe("SSE Mode - Infinite Loop Prevention", () => {
    it("CRITICAL: returns false after backend responds to prevent infinite loop", () => {
      // ADR 0002: Original tool transitions to output-available after approval
      const messagesAfterBackendResponse: UIMessage[] = [
        {
          id: "1",
          role: "assistant",
          content: "File deleted successfully",
          parts: [
            {
              // ADR 0002: Original tool in output-available state after approval
              type: "tool-delete_file",
              state: "output-available",
              toolCallId: "orig-1",
              toolName: "delete_file",
              input: { path: "/important.txt" },
              output: { deleted: true },
              approval: {
                id: "approval-1",
                approved: true,
              },
            },
            {
              // Backend has sent text response
              type: "text",
              text: "File deleted successfully",
            },
          ],
        } as any,
      ];

      // when
      const shouldSend = sseSendAuto({
        messages: messagesAfterBackendResponse,
      });

      // then
      expect(shouldSend).toBe(false); // MUST prevent infinite loop
    });

    it("CRITICAL: returns true only on FIRST confirmation completion", () => {
      // ADR 0002: Original tool in approval-responded state, no output yet
      const messagesFirstConfirmation: UIMessage[] = [
        {
          id: "1",
          role: "assistant",
          content: "",
          parts: [
            {
              // ADR 0002: Original tool in approval-responded state
              type: "tool-delete_file",
              state: TOOL_STATE_APPROVAL_RESPONDED,
              toolCallId: "orig-1",
              toolName: "delete_file",
              input: {},
              approval: {
                id: "approval-1",
                approved: true,
              },
            },
            // No output yet - backend hasn't responded
          ],
        } as any,
      ];

      // when
      const shouldSend = sseSendAuto({ messages: messagesFirstConfirmation });

      // then
      expect(shouldSend).toBe(true);
    });

    it("CRITICAL: returns false when tool has error state", () => {
      // ADR 0002: Original tool transitions to output-error state after approval
      const messagesWithError: UIMessage[] = [
        {
          id: "1",
          role: "assistant",
          content: "",
          parts: [
            {
              // ADR 0002: Original tool in error state after approval
              type: "tool-delete_file",
              state: "output-error",
              toolCallId: "orig-1",
              toolName: "delete_file",
              input: {},
              approval: {
                id: "approval-1",
                approved: true,
              },
              error: "Permission denied",
            },
          ],
        } as any,
      ];

      // when
      const shouldSend = sseSendAuto({ messages: messagesWithError });

      // then
      expect(shouldSend).toBe(false);
    });

    it("CRITICAL: handles error in sendAutomaticallyWhen gracefully", () => {
      const invalidMessages = null as any;

      // when
      const shouldSend = sseSendAuto({ messages: invalidMessages });

      // then
      expect(shouldSend).toBe(false); // Safe default
    });
  });

  describe("Multi-turn Confirmation Flow Simulation", () => {
    it("CRITICAL: prevents infinite loop across multiple confirmation cycles", () => {
      // Simulation of conversation flow:
      // Turn 1: User confirms → auto-send → backend responds (OK, no loop)
      // Turn 2: Another confirmation → auto-send → backend responds (OK, no loop)
      //
      // ADR 0002: Original tools transition through states

      // Turn 1: After backend responds
      const turn1AfterResponse: UIMessage[] = [
        {
          id: "msg-1",
          role: "user",
          content: "Search for AI news",
        },
        {
          id: "msg-2",
          role: "assistant",
          content: "Here's the latest AI news",
          parts: [
            {
              // ADR 0002: Original search tool in output-available state after approval
              type: "tool-search",
              state: TOOL_STATE_OUTPUT_AVAILABLE,
              toolCallId: "orig-1",
              toolName: "search",
              input: {},
              output: { results: ["news1"] },
              approval: {
                id: "approval-1",
                approved: true,
              },
            },
            {
              type: "text",
              text: "Here's the latest AI news",
            },
          ],
        } as any,
      ];

      expect(bidiSendAuto({ messages: turn1AfterResponse })).toBe(false);

      // Turn 2: New confirmation request
      const turn2FirstConfirmation: UIMessage[] = [
        ...turn1AfterResponse,
        {
          id: "msg-3",
          role: "user",
          content: "Delete the file",
        },
        {
          id: "msg-4",
          role: "assistant",
          content: "",
          parts: [
            {
              // ADR 0002: Original delete_file tool in approval-responded state
              type: "tool-delete_file",
              state: TOOL_STATE_APPROVAL_RESPONDED,
              toolCallId: "orig-2",
              toolName: "delete_file",
              input: {},
              approval: {
                id: "approval-2",
                approved: true,
              },
            },
            // No backend response yet
          ],
        } as any,
      ];

      expect(bidiSendAuto({ messages: turn2FirstConfirmation })).toBe(true);

      // Turn 2: After backend responds
      const turn2AfterResponse: UIMessage[] = [
        ...turn1AfterResponse,
        {
          id: "msg-3",
          role: "user",
          content: "Delete the file",
        },
        {
          id: "msg-4",
          role: "assistant",
          content: "File deleted successfully",
          parts: [
            {
              // ADR 0002: Original delete_file tool in output-available state after approval
              type: "tool-delete_file",
              state: TOOL_STATE_OUTPUT_AVAILABLE,
              toolCallId: "orig-2",
              toolName: "delete_file",
              input: {},
              output: { deleted: true },
              approval: {
                id: "approval-2",
                approved: true,
              },
            },
            {
              type: "text",
              text: "File deleted successfully",
            },
          ],
        } as any,
      ];

      expect(bidiSendAuto({ messages: turn2AfterResponse })).toBe(false);
    });
  });
});
