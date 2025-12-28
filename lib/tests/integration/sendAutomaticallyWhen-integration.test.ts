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

import { describe, expect, it } from "vitest";
import { sendAutomaticallyWhen as bidiSendAuto } from "../../bidi";
import { sendAutomaticallyWhen as sseSendAuto } from "../../sse";
import type { UIMessageFromAISDKv6 } from "../../utils";

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

      const messagesAfterBackendResponse: UIMessageFromAISDKv6[] = [
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

    it("CRITICAL: detects state change from approval-requested to approval-responded", () => {
      // AI SDK v6: When user calls addToolApprovalResponse() with correct approval.id,
      // state changes from "approval-requested" to "approval-responded" immediately
      //
      // Expected: approval-requested → false, approval-responded → true

      // when: Tool waiting for approval (state="approval-requested")
      const messagesWaiting: UIMessageFromAISDKv6[] = [
        {
          id: "1",
          role: "assistant",
          content: "",
          parts: [
            {
              type: "tool-search",
              state: "approval-requested", // User hasn't responded yet
              toolCallId: "orig-1",
              toolName: "search",
              input: {},
              approval: {
                id: "approval-1", // Approval request exists, but no user response yet
              },
            },
          ],
        } as any,
      ];

      const firstCall = bidiSendAuto({ messages: messagesWaiting });

      // then: Should return false (wait for user to respond)
      expect(firstCall).toBe(false);

      // when: User approved (state changed to "approval-responded")
      const messagesApproved: UIMessageFromAISDKv6[] = [
        {
          id: "1",
          role: "assistant",
          content: "",
          parts: [
            {
              type: "tool-search",
              state: "approval-responded", // ← State changed after addToolApprovalResponse
              toolCallId: "orig-1",
              toolName: "search",
              input: {},
              approval: {
                id: "approval-1",
                approved: true, // ← User's decision
                reason: undefined,
              },
            },
          ],
        } as any,
      ];

      const secondCall = bidiSendAuto({ messages: messagesApproved });

      // then: Should return true (send approval to backend)
      expect(secondCall).toBe(true);
    });

    it("CRITICAL: returns false when tool has error state to prevent infinite loop", () => {
      // Scenario: Tool execution failed after approval
      // Expected: Must return FALSE to prevent retry loop
      //
      // ADR 0002: Original tool transitions to output-error state

      const messagesWithError: UIMessageFromAISDKv6[] = [
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
      const userMessage: UIMessageFromAISDKv6[] = [
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
      const messagesAfterBackendResponse: UIMessageFromAISDKv6[] = [
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

    it("CRITICAL: detects state change from approval-requested to approval-responded", () => {
      // AI SDK v6: When user calls addToolApprovalResponse() with correct approval.id,
      // state changes from "approval-requested" to "approval-responded" immediately
      //
      // Expected: approval-requested → false, approval-responded → true

      // when: Tool waiting for approval (state="approval-requested")
      const messagesWaiting: UIMessageFromAISDKv6[] = [
        {
          id: "1",
          role: "assistant",
          content: "",
          parts: [
            {
              type: "tool-delete_file",
              state: "approval-requested", // User hasn't responded yet
              toolCallId: "orig-1",
              toolName: "delete_file",
              input: {},
              approval: {
                id: "approval-1", // Approval request exists, but no user response yet
              },
            },
          ],
        } as any,
      ];

      const firstCall = sseSendAuto({ messages: messagesWaiting });

      // then: Should return false (wait for user to respond)
      expect(firstCall).toBe(false);

      // when: User approved (state changed to "approval-responded")
      const messagesApproved: UIMessageFromAISDKv6[] = [
        {
          id: "1",
          role: "assistant",
          content: "",
          parts: [
            {
              type: "tool-delete_file",
              state: "approval-responded", // ← State changed after addToolApprovalResponse
              toolCallId: "orig-1",
              toolName: "delete_file",
              input: {},
              approval: {
                id: "approval-1",
                approved: true, // ← User's decision
                reason: undefined,
              },
            },
          ],
        } as any,
      ];

      const secondCall = sseSendAuto({ messages: messagesApproved });

      // then: Should return true (send approval to backend)
      expect(secondCall).toBe(true);
    });

    it("CRITICAL: returns false when tool has error state", () => {
      // ADR 0002: Original tool transitions to output-error state after approval
      const messagesWithError: UIMessageFromAISDKv6[] = [
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

  describe("Multiple Tools in Single Message", () => {
    describe("SSE Mode - Multiple Approvals", () => {
      it("returns true when ALL tools are approved (parallel approvals)", () => {
        // AI SDK v6: When user calls addToolApprovalResponse() with correct approval.id,
        // state changes from "approval-requested" to "approval-responded" immediately
        //
        // Expected: ALL tools in approval-responded → true

        // when: Both tools waiting for approval (state="approval-requested")
        const messagesWaiting: UIMessageFromAISDKv6[] = [
          {
            id: "1",
            role: "assistant",
            content: "",
            parts: [
              {
                type: "tool-process_payment",
                state: "approval-requested", // User hasn't responded yet
                toolCallId: "payment-1",
                toolName: "process_payment",
                input: { recipient: "Alice", amount: 30 },
                approval: {
                  id: "approval-1",
                },
              },
              {
                type: "tool-process_payment",
                state: "approval-requested", // User hasn't responded yet
                toolCallId: "payment-2",
                toolName: "process_payment",
                input: { recipient: "Bob", amount: 40 },
                approval: {
                  id: "approval-2",
                },
              },
            ],
          } as any,
        ];

        const firstCall = sseSendAuto({ messages: messagesWaiting });

        // then: Should return false (both still waiting)
        expect(firstCall).toBe(false);

        // when: Both tools approved (both states changed to "approval-responded")
        const messagesAllApproved: UIMessageFromAISDKv6[] = [
          {
            id: "1",
            role: "assistant",
            content: "",
            parts: [
              {
                type: "tool-process_payment",
                state: "approval-responded", // ← State changed
                toolCallId: "payment-1",
                toolName: "process_payment",
                input: { recipient: "Alice", amount: 30 },
                approval: {
                  id: "approval-1",
                  approved: true,
                  reason: undefined,
                },
              },
              {
                type: "tool-process_payment",
                state: "approval-responded", // ← State changed
                toolCallId: "payment-2",
                toolName: "process_payment",
                input: { recipient: "Bob", amount: 40 },
                approval: {
                  id: "approval-2",
                  approved: true,
                  reason: undefined,
                },
              },
            ],
          } as any,
        ];

        const secondCall = sseSendAuto({ messages: messagesAllApproved });

        // then: Should return true (send both approvals to backend)
        expect(secondCall).toBe(true);
      });

      it("returns false when SOME tools are still pending approval", () => {
        // Scenario: User approved ONLY 1 of 2 tools
        // Expected: sendAutomaticallyWhen returns FALSE (wait for all approvals)
        //
        // AI SDK v6: User approving adds approval object, not approving means NO approval object
        // Prevents partial submission:
        // - Tool 1: approval-requested with approval object (user clicked approve)
        // - Tool 2: approval-requested NO approval object (still waiting)
        // → Don't send yet, wait for user to approve Tool 2

        const messagesWithPartialApproval: UIMessageFromAISDKv6[] = [
          {
            id: "1",
            role: "assistant",
            content: "",
            parts: [
              {
                // First tool: approved (has approval object)
                type: "tool-process_payment",
                state: "approval-requested",
                toolCallId: "payment-1",
                toolName: "process_payment",
                input: { recipient: "Alice", amount: 30 },
                approval: {
                  id: "approval-1",
                },
              },
              {
                // Second tool: still pending (NO approval object)
                type: "tool-process_payment",
                state: "approval-requested",
                toolCallId: "payment-2",
                toolName: "process_payment",
                input: { recipient: "Bob", amount: 40 },
                // NO approval object - user hasn't approved yet
              },
            ],
          } as any,
        ];

        // when
        const shouldSend = sseSendAuto({
          messages: messagesWithPartialApproval,
        });

        // then
        expect(shouldSend).toBe(false); // Wait for all approvals
      });

      it("returns false after backend responds to prevent infinite loop", () => {
        // Scenario: Backend executed both payments and responded
        // Expected: sendAutomaticallyWhen returns FALSE (prevent re-sending)

        const messagesAfterBothExecuted: UIMessageFromAISDKv6[] = [
          {
            id: "1",
            role: "assistant",
            content: "Both payments completed successfully",
            parts: [
              {
                // First tool: executed
                type: "tool-process_payment",
                state: "output-available",
                toolCallId: "payment-1",
                toolName: "process_payment",
                input: { recipient: "Alice", amount: 30 },
                output: { success: true, transaction_id: "txn-001" },
                approval: {
                  id: "approval-1",
                  approved: true,
                },
              },
              {
                // Second tool: executed
                type: "tool-process_payment",
                state: "output-available",
                toolCallId: "payment-2",
                toolName: "process_payment",
                input: { recipient: "Bob", amount: 40 },
                output: { success: true, transaction_id: "txn-002" },
                approval: {
                  id: "approval-2",
                  approved: true,
                },
              },
              {
                // Backend text response
                type: "text",
                text: "Both payments completed successfully",
              },
            ],
          } as any,
        ];

        // when
        const shouldSend = sseSendAuto({
          messages: messagesAfterBothExecuted,
        });

        // then
        expect(shouldSend).toBe(false); // MUST prevent infinite loop
      });
    });

    describe("BIDI Mode - Multiple Approvals", () => {
      it("returns true when ALL tools are approved (parallel approvals)", () => {
        // BIDI mode: Same as SSE - state changes from "approval-requested" to "approval-responded"
        //
        // AI SDK v6: When user calls addToolApprovalResponse() with correct approval.id,
        // state changes immediately
        //
        // Note: BIDI typically uses sequential execution (ADR 0003),
        // but this tests the parallel case if it occurs

        // when: Both tools waiting for approval
        const messagesWaiting: UIMessageFromAISDKv6[] = [
          {
            id: "1",
            role: "assistant",
            content: "",
            parts: [
              {
                type: "tool-process_payment",
                state: "approval-requested", // User hasn't responded yet
                toolCallId: "payment-1",
                toolName: "process_payment",
                input: { recipient: "Alice", amount: 30 },
                approval: {
                  id: "approval-1",
                },
              },
              {
                type: "tool-process_payment",
                state: "approval-requested", // User hasn't responded yet
                toolCallId: "payment-2",
                toolName: "process_payment",
                input: { recipient: "Bob", amount: 40 },
                approval: {
                  id: "approval-2",
                },
              },
            ],
          } as any,
        ];

        const firstCall = bidiSendAuto({ messages: messagesWaiting });

        // then: Should return false (both still waiting)
        expect(firstCall).toBe(false);

        // when: Both tools approved (both states changed to "approval-responded")
        const messagesAllApproved: UIMessageFromAISDKv6[] = [
          {
            id: "1",
            role: "assistant",
            content: "",
            parts: [
              {
                type: "tool-process_payment",
                state: "approval-responded", // ← State changed
                toolCallId: "payment-1",
                toolName: "process_payment",
                input: { recipient: "Alice", amount: 30 },
                approval: {
                  id: "approval-1",
                  approved: true,
                  reason: undefined,
                },
              },
              {
                type: "tool-process_payment",
                state: "approval-responded", // ← State changed
                toolCallId: "payment-2",
                toolName: "process_payment",
                input: { recipient: "Bob", amount: 40 },
                approval: {
                  id: "approval-2",
                  approved: true,
                  reason: undefined,
                },
              },
            ],
          } as any,
        ];

        const secondCall = bidiSendAuto({ messages: messagesAllApproved });

        // then: Should return true (send both approvals)
        expect(secondCall).toBe(true);
      });

      it("returns false when SOME tools are still pending approval", () => {
        // AI SDK v6: User approving adds approval object, not approving means NO approval object
        const messagesWithPartialApproval: UIMessageFromAISDKv6[] = [
          {
            id: "1",
            role: "assistant",
            content: "",
            parts: [
              {
                type: "tool-process_payment",
                state: "approval-requested",
                toolCallId: "payment-1",
                toolName: "process_payment",
                input: { recipient: "Alice", amount: 30 },
                approval: {
                  id: "approval-1",
                },
              },
              {
                type: "tool-process_payment",
                state: "approval-requested",
                toolCallId: "payment-2",
                toolName: "process_payment",
                input: { recipient: "Bob", amount: 40 },
                // NO approval object - user hasn't approved yet
              },
            ],
          } as any,
        ];

        // when
        const shouldSend = bidiSendAuto({
          messages: messagesWithPartialApproval,
        });

        // then
        expect(shouldSend).toBe(false);
      });

      it("returns false after backend responds to prevent infinite loop", () => {
        const messagesAfterBothExecuted: UIMessageFromAISDKv6[] = [
          {
            id: "1",
            role: "assistant",
            content: "Both payments completed successfully",
            parts: [
              {
                type: "tool-process_payment",
                state: "output-available",
                toolCallId: "payment-1",
                toolName: "process_payment",
                input: { recipient: "Alice", amount: 30 },
                output: { success: true, transaction_id: "txn-001" },
                approval: {
                  id: "approval-1",
                  approved: true,
                },
              },
              {
                type: "tool-process_payment",
                state: "output-available",
                toolCallId: "payment-2",
                toolName: "process_payment",
                input: { recipient: "Bob", amount: 40 },
                output: { success: true, transaction_id: "txn-002" },
                approval: {
                  id: "approval-2",
                  approved: true,
                },
              },
              {
                type: "text",
                text: "Both payments completed successfully",
              },
            ],
          } as any,
        ];

        // when
        const shouldSend = bidiSendAuto({
          messages: messagesAfterBothExecuted,
        });

        // then
        expect(shouldSend).toBe(false);
      });
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
      const turn1AfterResponse: UIMessageFromAISDKv6[] = [
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
              state: "output-available",
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

      // Turn 2: New confirmation request - waiting for user approval
      const turn2Waiting: UIMessageFromAISDKv6[] = [
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
              type: "tool-delete_file",
              state: "approval-requested", // User hasn't responded yet
              toolCallId: "orig-2",
              toolName: "delete_file",
              input: {},
              approval: {
                id: "approval-2",
              },
            },
          ],
        } as any,
      ];

      // Should return false (waiting for user approval)
      expect(bidiSendAuto({ messages: turn2Waiting })).toBe(false);

      // Turn 2: User approved (state changed to approval-responded)
      const turn2Approved: UIMessageFromAISDKv6[] = [
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
              type: "tool-delete_file",
              state: "approval-responded", // ← State changed
              toolCallId: "orig-2",
              toolName: "delete_file",
              input: {},
              approval: {
                id: "approval-2",
                approved: true,
                reason: undefined,
              },
            },
          ],
        } as any,
      ];

      // Should return true (send approval to backend)
      expect(bidiSendAuto({ messages: turn2Approved })).toBe(true);

      // Turn 2: After backend responds
      const turn2AfterResponse: UIMessageFromAISDKv6[] = [
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
              state: "output-available",
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
