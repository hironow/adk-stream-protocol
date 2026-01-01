/**
 * sendAutomaticallyWhenCore Unit Tests
 *
 * Tests core auto-send decision logic for tool approval workflow.
 * Uses exact message structures from bidi-public-api.test.ts to ensure compatibility.
 */

import { describe, expect, it } from "vitest";
import { sendAutomaticallyWhenCore } from "../../core/send-automatically-when";

describe("sendAutomaticallyWhenCore", () => {
  const mockLog = (msg: string) => console.log(`[Test Log] ${msg}`);

  describe("Basic validation", () => {
    it("returns false when messages array is empty", () => {
      const result = sendAutomaticallyWhenCore({ messages: [] }, mockLog);
      expect(result).toBe(false);
    });

    it("returns false when last message is not from assistant", () => {
      const messages = [
        {
          id: "msg-1",
          role: "user",
          parts: [{ type: "text", text: "Hello" }],
        },
      ] as any;

      const result = sendAutomaticallyWhenCore({ messages }, mockLog);
      expect(result).toBe(false);
    });

    it("returns false on error to prevent infinite loops", () => {
      const invalidMessages = null as any;
      const result = sendAutomaticallyWhenCore(
        { messages: invalidMessages },
        mockLog,
      );
      expect(result).toBe(false);
    });
  });

  describe("Text part handling", () => {
    it("returns false when assistant has text part and NO approval workflow", () => {
      const messages = [
        {
          id: "msg-1",
          role: "assistant",
          parts: [{ type: "text", text: "Hello!" }],
        },
      ] as any;

      const result = sendAutomaticallyWhenCore({ messages }, mockLog);
      expect(result).toBe(false);
    });

    it("allows send when text part present BUT approval workflow active", () => {
      const messages = [
        {
          id: "msg-1",
          role: "assistant",
          parts: [
            { type: "text", text: "Processing..." },
            {
              type: "tool-payment",
              toolCallId: "call-1",
              input: { amount: 100 },
              state: "approval-responded",
              approval: { id: "approval-1", approved: true },
            },
          ],
        },
      ] as any;

      const result = sendAutomaticallyWhenCore({ messages }, mockLog);
      expect(result).toBe(true);
    });
  });

  describe("Approval state detection", () => {
    it("returns false when tool is approval-requested (pending)", () => {
      const messages = [
        {
          id: "msg-1",
          role: "assistant",
          parts: [
            {
              type: "tool-payment",
              toolCallId: "call-1",
              input: { amount: 100 },
              state: "approval-requested",
              approval: { id: "approval-1" },
            },
          ],
        },
      ] as any;

      const result = sendAutomaticallyWhenCore({ messages }, mockLog);
      expect(result).toBe(false);
    });

    it("returns true when tool is approval-responded (approved)", () => {
      const messages = [
        {
          id: "msg-approval-test",
          role: "assistant",
          parts: [
            {
              type: "tool-payment",
              toolCallId: "call-approval-test",
              input: { amount: 100 },
              state: "approval-responded",
              approval: { id: "approval-1", approved: true },
            },
          ],
        },
      ] as any;

      const result = sendAutomaticallyWhenCore({ messages }, mockLog);
      expect(result).toBe(true);
    });

    it("returns false when multiple tools with pending approvals", () => {
      const messages = [
        {
          id: "msg-1",
          role: "assistant",
          parts: [
            {
              type: "tool-payment",
              toolCallId: "call-1",
              input: { amount: 100 },
              state: "approval-responded",
              approval: { id: "approval-1", approved: true },
            },
            {
              type: "tool-location",
              toolCallId: "call-2",
              input: {},
              state: "approval-requested",
              approval: { id: "approval-2" },
            },
          ],
        },
      ] as any;

      const result = sendAutomaticallyWhenCore({ messages }, mockLog);
      expect(result).toBe(false);
    });

    it("returns true when all tools are approved", () => {
      const messages = [
        {
          id: "msg-1",
          role: "assistant",
          parts: [
            {
              type: "tool-payment",
              toolCallId: "call-1",
              input: { amount: 100 },
              state: "approval-responded",
              approval: { id: "approval-1", approved: true },
            },
            {
              type: "tool-location",
              toolCallId: "call-2",
              input: {},
              state: "approval-responded",
              approval: { id: "approval-2", approved: true },
            },
          ],
        },
      ] as any;

      const result = sendAutomaticallyWhenCore({ messages }, mockLog);
      expect(result).toBe(true);
    });
  });

  describe("Frontend Execute pattern (addToolOutput priority)", () => {
    it("returns true when tool has output-available with output data", () => {
      const messages = [
        {
          id: "msg-1",
          role: "assistant",
          parts: [
            {
              type: "tool-location",
              toolCallId: "call-1",
              input: {},
              state: "output-available",
              output: { lat: 35.6762, lon: 139.6503 },
            },
          ],
        },
      ] as any;

      const result = sendAutomaticallyWhenCore({ messages }, mockLog);
      expect(result).toBe(true);
    });

    it("returns false when output-available but no output field", () => {
      const messages = [
        {
          id: "msg-1",
          role: "assistant",
          parts: [
            {
              type: "tool-location",
              toolCallId: "call-1",
              input: {},
              state: "output-available",
            },
          ],
        },
      ] as any;

      const result = sendAutomaticallyWhenCore({ messages }, mockLog);
      expect(result).toBe(false);
    });
  });

  describe("Error handling", () => {
    it("returns false when tool is in output-error state", () => {
      const messages = [
        {
          id: "msg-1",
          role: "assistant",
          parts: [
            {
              type: "tool-payment",
              toolCallId: "call-1",
              input: { amount: 100 },
              state: "output-error",
              error: "Insufficient funds",
            },
          ],
        },
      ] as any;

      const result = sendAutomaticallyWhenCore({ messages }, mockLog);
      expect(result).toBe(false);
    });

    it("returns false when tool has error field", () => {
      const messages = [
        {
          id: "msg-1",
          role: "assistant",
          parts: [
            {
              type: "tool-payment",
              toolCallId: "call-1",
              input: { amount: 100 },
              state: "approval-responded",
              approval: { id: "approval-1", approved: true },
              error: "Network error",
            },
          ],
        },
      ] as any;

      const result = sendAutomaticallyWhenCore({ messages }, mockLog);
      expect(result).toBe(false);
    });
  });

  describe("Infinite loop prevention", () => {
    it("returns false when same approval state already sent", () => {
      const messages = [
        {
          id: "msg-infinite-loop-test",
          role: "assistant",
          parts: [
            {
              type: "tool-payment",
              toolCallId: "call-infinite-loop-test",
              input: { amount: 100 },
              state: "approval-responded",
              approval: { id: "approval-1", approved: true },
            },
          ],
        },
      ] as any;

      // First call should return true
      const result1 = sendAutomaticallyWhenCore({ messages }, mockLog);
      expect(result1).toBe(true);

      // Second call with same state should return false
      const result2 = sendAutomaticallyWhenCore({ messages }, mockLog);
      expect(result2).toBe(false);
    });
  });
});
