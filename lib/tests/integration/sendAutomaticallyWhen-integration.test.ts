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
import { sendAutomaticallyWhen as sseSendAuto } from "../../sse";
import {
  TOOL_TYPE_ADK_REQUEST_CONFIRMATION,
  TOOL_STATE_OUTPUT_AVAILABLE,
  TOOL_STATE_OUTPUT_ERROR,
  TOOL_STATE_APPROVAL_RESPONDED,
  TOOL_STATE_APPROVAL_REQUESTED,
} from "../../constants";

describe("sendAutomaticallyWhen - Infinite Loop Prevention", () => {
  describe("BIDI Mode - Infinite Loop Prevention", () => {
    it("CRITICAL: returns false after backend responds to prevent infinite loop", () => {
      // Scenario: User confirms → auto-send → backend responds with tool result
      // Expected: sendAutomaticallyWhen must return FALSE to prevent re-sending
      //
      // Without this guard: confirmation completion → send → backend responds →
      // confirmation still complete → send → infinite loop! ❌

      const messagesAfterBackendResponse: UIMessage[] = [
        {
          id: "1",
          role: "assistant",
          content: "",
          parts: [
            {
              type: "tool-adk_request_confirmation",
              state: "output-available",
              toolCallId: "call-1",
              input: {
                originalFunctionCall: {
                  id: "orig-1",
                  name: "search",
                  args: { query: "test" },
                },
              },
              output: { confirmed: true },
            },
            {
              // Backend has responded with actual tool result
              type: "tool-search",
              state: "output-available",
              toolCallId: "orig-1",
              output: { results: ["data1", "data2"] },
            },
          ],
        } as any,
      ];

      // when
      const shouldSend = bidiSendAuto({ messages: messagesAfterBackendResponse });

      // then
      expect(shouldSend).toBe(false); // MUST be false to prevent infinite loop
    });

    it("CRITICAL: returns true only on FIRST confirmation completion", () => {
      // Scenario: User just confirmed, backend hasn't responded yet
      // Expected: sendAutomaticallyWhen returns TRUE (trigger auto-send once)
      // AI SDK v6 format: state="approval-responded", approval.approved=true

      const messagesFirstConfirmation: UIMessage[] = [
        {
          id: "1",
          role: "assistant",
          content: "",
          parts: [
            {
              type: TOOL_TYPE_ADK_REQUEST_CONFIRMATION,
              state: TOOL_STATE_APPROVAL_RESPONDED,
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
            // No other tool results yet - backend hasn't responded
          ],
        } as any,
      ];

      // when
      const shouldSend = bidiSendAuto({ messages: messagesFirstConfirmation });

      // then
      expect(shouldSend).toBe(true); // OK to send once
    });

    it("CRITICAL: returns false when tool has error state to prevent infinite loop", () => {
      // Scenario: Tool execution failed
      // Expected: Must return FALSE to prevent retry loop

      const messagesWithError: UIMessage[] = [
        {
          id: "1",
          role: "assistant",
          content: "",
          parts: [
            {
              type: "tool-adk_request_confirmation",
              state: "output-available",
              toolCallId: "call-1",
              output: { confirmed: true },
            },
            {
              type: "tool-search",
              state: "output-error", // Error state
              toolCallId: "orig-1",
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
      const messagesAfterBackendResponse: UIMessage[] = [
        {
          id: "1",
          role: "assistant",
          content: "",
          parts: [
            {
              type: "tool-adk_request_confirmation",
              state: "output-available",
              toolCallId: "call-1",
              input: {
                originalFunctionCall: {
                  id: "orig-1",
                  name: "delete_file",
                  args: { path: "/important.txt" },
                },
              },
              output: { confirmed: true },
            },
            {
              // Backend has responded
              type: "tool-delete_file",
              state: "output-available",
              toolCallId: "orig-1",
              output: { deleted: true },
            },
          ],
        } as any,
      ];

      // when
      const shouldSend = sseSendAuto({ messages: messagesAfterBackendResponse });

      // then
      expect(shouldSend).toBe(false); // MUST prevent infinite loop
    });

    it("CRITICAL: returns true only on FIRST confirmation completion", () => {
      // AI SDK v6 format: state="approval-responded", approval.approved=true
      const messagesFirstConfirmation: UIMessage[] = [
        {
          id: "1",
          role: "assistant",
          content: "",
          parts: [
            {
              type: TOOL_TYPE_ADK_REQUEST_CONFIRMATION,
              state: TOOL_STATE_APPROVAL_RESPONDED,
              toolCallId: "call-1",
              input: {
                originalFunctionCall: {
                  id: "orig-1",
                  name: "delete_file",
                  args: {},
                },
              },
              approval: {
                id: "call-1",
                approved: true,
              },
            },
            // No other tool results yet - backend hasn't responded
          ],
        } as any,
      ];

      // when
      const shouldSend = sseSendAuto({ messages: messagesFirstConfirmation });

      // then
      expect(shouldSend).toBe(true);
    });

    it("CRITICAL: returns false when tool has error state", () => {
      const messagesWithError: UIMessage[] = [
        {
          id: "1",
          role: "assistant",
          content: "",
          parts: [
            {
              type: "tool-adk_request_confirmation",
              state: "output-available",
              toolCallId: "call-1",
              output: { confirmed: true },
            },
            {
              type: "tool-delete_file",
              state: "output-error",
              toolCallId: "orig-1",
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
          content: "",
          parts: [
            {
              type: TOOL_TYPE_ADK_REQUEST_CONFIRMATION,
              state: TOOL_STATE_APPROVAL_RESPONDED,
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
              state: TOOL_STATE_OUTPUT_AVAILABLE,
              toolCallId: "orig-1",
              output: { results: ["news1"] },
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
              type: TOOL_TYPE_ADK_REQUEST_CONFIRMATION,
              state: TOOL_STATE_APPROVAL_RESPONDED,
              toolCallId: "call-2",
              input: {
                originalFunctionCall: {
                  id: "orig-2",
                  name: "delete_file",
                  args: {},
                },
              },
              approval: {
                id: "call-2",
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
          content: "",
          parts: [
            {
              type: TOOL_TYPE_ADK_REQUEST_CONFIRMATION,
              state: TOOL_STATE_APPROVAL_RESPONDED,
              toolCallId: "call-2",
              input: {
                originalFunctionCall: {
                  id: "orig-2",
                  name: "delete_file",
                  args: {},
                },
              },
              approval: {
                id: "call-2",
                approved: true,
              },
            },
            {
              type: "tool-delete_file",
              state: TOOL_STATE_OUTPUT_AVAILABLE,
              toolCallId: "orig-2",
              output: { deleted: true },
            },
          ],
        } as any,
      ];

      expect(bidiSendAuto({ messages: turn2AfterResponse })).toBe(false);
    });
  });
});
