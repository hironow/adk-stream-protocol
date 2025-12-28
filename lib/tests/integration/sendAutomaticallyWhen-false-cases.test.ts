/**
 * Comprehensive False-Case Tests for sendAutomaticallyWhen
 *
 * Tests ALL conditions where sendAutomaticallyWhen must return false.
 * Ensures no edge case can cause unwanted auto-submission.
 */

import { describe, expect, it } from "vitest";
import { sendAutomaticallyWhen as bidiSendAuto } from "../../bidi";
import { sendAutomaticallyWhen as sseSendAuto } from "../../sse";
import type { UIMessageFromAISDKv6 } from "../../utils";

describe("sendAutomaticallyWhen - Comprehensive False Cases", () => {
  describe("BIDI Mode - All False Conditions", () => {
    describe("Empty or Invalid Message Arrays", () => {
      it("returns false when messages array is empty", () => {
        // given
        const messages: UIMessageFromAISDKv6[] = [];

        // when
        const result = bidiSendAuto({ messages });

        // then
        expect(result).toBe(false);
      });

      it("returns false when messages is null (error handling)", () => {
        // given
        const messages = null as any;

        // when
        const result = bidiSendAuto({ messages });

        // then
        expect(result).toBe(false); // Caught by try-catch
      });

      it("returns false when messages is undefined (error handling)", () => {
        // given
        const messages = undefined as any;

        // when
        const result = bidiSendAuto({ messages });

        // then
        expect(result).toBe(false); // Caught by try-catch
      });
    });

    describe("Last Message Role Conditions", () => {
      it("returns false when last message role is 'user'", () => {
        // given
        const messages: UIMessageFromAISDKv6[] = [
          { id: "1", role: "user", content: "Hello" },
        ];

        // when
        const result = bidiSendAuto({ messages });

        // then
        expect(result).toBe(false);
      });

      it("returns false when last message role is 'system'", () => {
        // given
        const messages: UIMessageFromAISDKv6[] = [
          { id: "1", role: "system", content: "System message" } as any,
        ];

        // when
        const result = bidiSendAuto({ messages });

        // then
        expect(result).toBe(false);
      });

      it("returns false when last message has no role", () => {
        // given
        const messages: UIMessageFromAISDKv6[] = [
          { id: "1", content: "No role" } as any,
        ];

        // when
        const result = bidiSendAuto({ messages });

        // then
        expect(result).toBe(false);
      });

      it("returns false when last message is undefined", () => {
        // given
        const messages: UIMessageFromAISDKv6[] = [undefined as any];

        // when
        const result = bidiSendAuto({ messages });

        // then
        expect(result).toBe(false);
      });
    });

    describe("Parts Array Conditions", () => {
      it("returns false when parts array is missing", () => {
        // given
        const messages: UIMessageFromAISDKv6[] = [
          {
            id: "1",
            role: "assistant",
            content: "No parts field",
          } as any,
        ];

        // when
        const result = bidiSendAuto({ messages });

        // then
        expect(result).toBe(false);
      });

      it("returns false when parts array is empty", () => {
        // given
        const messages: UIMessageFromAISDKv6[] = [
          {
            id: "1",
            role: "assistant",
            content: "",
            parts: [],
          } as any,
        ];

        // when
        const result = bidiSendAuto({ messages });

        // then
        expect(result).toBe(false);
      });

      it("returns false when parts is null", () => {
        // given
        const messages: UIMessageFromAISDKv6[] = [
          {
            id: "1",
            role: "assistant",
            content: "",
            parts: null,
          } as any,
        ];

        // when
        const result = bidiSendAuto({ messages });

        // then
        expect(result).toBe(false);
      });
    });

    describe("Confirmation Part Conditions", () => {
      it("returns false when no confirmation part exists", () => {
        // given
        const messages: UIMessageFromAISDKv6[] = [
          {
            id: "1",
            role: "assistant",
            content: "",
            parts: [
              {
                type: "text",
                text: "Regular text",
              },
            ],
          } as any,
        ];

        // when
        const result = bidiSendAuto({ messages });

        // then
        expect(result).toBe(false);
      });

      it("returns false when confirmation part state is 'partial'", () => {
        // given
        const messages: UIMessageFromAISDKv6[] = [
          {
            id: "1",
            role: "assistant",
            content: "",
            parts: [
              {
                type: "tool-adk_request_confirmation",
                state: "partial", // Not output-available
                toolCallId: "call-1",
              },
            ],
          } as any,
        ];

        // when
        const result = bidiSendAuto({ messages });

        // then
        expect(result).toBe(false);
      });

      it("returns false when confirmation part state is 'call'", () => {
        // given
        const messages: UIMessageFromAISDKv6[] = [
          {
            id: "1",
            role: "assistant",
            content: "",
            parts: [
              {
                type: "tool-adk_request_confirmation",
                state: "call", // Not output-available
                toolCallId: "call-1",
              },
            ],
          } as any,
        ];

        // when
        const result = bidiSendAuto({ messages });

        // then
        expect(result).toBe(false);
      });

      it("returns false when confirmation part has no state field", () => {
        // given
        const messages: UIMessageFromAISDKv6[] = [
          {
            id: "1",
            role: "assistant",
            content: "",
            parts: [
              {
                type: "tool-adk_request_confirmation",
                // state field missing
                toolCallId: "call-1",
              },
            ],
          } as any,
        ];

        // when
        const result = bidiSendAuto({ messages });

        // then
        expect(result).toBe(false);
      });

      it("returns false when part type is similar but not exact match", () => {
        // given
        const messages: UIMessageFromAISDKv6[] = [
          {
            id: "1",
            role: "assistant",
            content: "",
            parts: [
              {
                type: "tool-adk_request_confirmation_v2", // Wrong name
                state: "output-available",
                toolCallId: "call-1",
              },
            ],
          } as any,
        ];

        // when
        const result = bidiSendAuto({ messages });

        // then
        expect(result).toBe(false);
      });
    });

    describe("Other Tool States - Backend Already Responded", () => {
      it("returns false when other tool state is 'output-available'", () => {
        // given
        const messages: UIMessageFromAISDKv6[] = [
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
                state: "output-available", // Backend responded
                toolCallId: "orig-1",
                output: { results: [] },
              },
            ],
          } as any,
        ];

        // when
        const result = bidiSendAuto({ messages });

        // then
        expect(result).toBe(false);
      });

      it("returns false when other tool state is 'output-error'", () => {
        // given
        const messages: UIMessageFromAISDKv6[] = [
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
                error: "Network error",
              },
            ],
          } as any,
        ];

        // when
        const result = bidiSendAuto({ messages });

        // then
        expect(result).toBe(false);
      });

      it("returns false when other tool has error field", () => {
        // given
        const messages: UIMessageFromAISDKv6[] = [
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
                state: "partial",
                toolCallId: "orig-1",
                error: "Unexpected error", // Has error field
              },
            ],
          } as any,
        ];

        // when
        const result = bidiSendAuto({ messages });

        // then
        expect(result).toBe(false);
      });
    });

    describe("Multiple Other Tools Edge Cases", () => {
      it("returns false when ANY of multiple other tools is complete", () => {
        // given
        const messages: UIMessageFromAISDKv6[] = [
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
                state: "partial", // Still running
                toolCallId: "orig-1",
              },
              {
                type: "tool-analyze",
                state: "output-available", // This one completed
                toolCallId: "orig-2",
                output: { analysis: "done" },
              },
            ],
          } as any,
        ];

        // when
        const result = bidiSendAuto({ messages });

        // then
        expect(result).toBe(false);
      });

      it("returns false when first tool in loop has error", () => {
        // given
        const messages: UIMessageFromAISDKv6[] = [
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
                type: "tool-first",
                state: "partial",
                toolCallId: "t1",
                error: "First tool error", // First tool has error
              },
              {
                type: "tool-second",
                state: "partial",
                toolCallId: "t2",
              },
            ],
          } as any,
        ];

        // when
        const result = bidiSendAuto({ messages });

        // then
        expect(result).toBe(false);
      });
    });

    describe("Mixed Content Edge Cases", () => {
      it("returns false when confirmation exists but backend also sent text", () => {
        // given
        const messages: UIMessageFromAISDKv6[] = [
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
                type: "text",
                text: "I searched and found results",
              },
              {
                type: "tool-search",
                state: "output-available",
                toolCallId: "orig-1",
                output: { results: ["a", "b"] },
              },
            ],
          } as any,
        ];

        // when
        const result = bidiSendAuto({ messages });

        // then
        expect(result).toBe(false);
      });

      it("returns false when parts contain non-tool items only", () => {
        // given
        const messages: UIMessageFromAISDKv6[] = [
          {
            id: "1",
            role: "assistant",
            content: "",
            parts: [
              {
                type: "text",
                text: "Just text",
              },
              {
                type: "image",
                url: "https://example.com/image.png",
              },
            ],
          } as any,
        ];

        // when
        const result = bidiSendAuto({ messages });

        // then
        expect(result).toBe(false);
      });
    });
  });

  describe("SSE Mode - All False Conditions (Same Logic)", () => {
    it("returns false for empty messages array", () => {
      expect(sseSendAuto({ messages: [] })).toBe(false);
    });

    it("returns false for null messages", () => {
      expect(sseSendAuto({ messages: null as any })).toBe(false);
    });

    it("returns false when last message is user", () => {
      expect(
        sseSendAuto({
          messages: [{ id: "1", role: "user", content: "Hi" }],
        }),
      ).toBe(false);
    });

    it("returns false when no parts array", () => {
      expect(
        sseSendAuto({
          messages: [
            { id: "1", role: "assistant", content: "No parts" } as any,
          ],
        }),
      ).toBe(false);
    });

    it("returns false when confirmation state is not output-available", () => {
      expect(
        sseSendAuto({
          messages: [
            {
              id: "1",
              role: "assistant",
              content: "",
              parts: [
                {
                  type: "tool-adk_request_confirmation",
                  state: "partial",
                  toolCallId: "call-1",
                },
              ],
            } as any,
          ],
        }),
      ).toBe(false);
    });

    it("returns false when other tool completed", () => {
      expect(
        sseSendAuto({
          messages: [
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
                  type: "tool-delete",
                  state: "output-available",
                  toolCallId: "orig-1",
                  output: { deleted: true },
                },
              ],
            } as any,
          ],
        }),
      ).toBe(false);
    });

    it("returns false when tool has error", () => {
      expect(
        sseSendAuto({
          messages: [
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
                  type: "tool-delete",
                  state: "partial",
                  toolCallId: "orig-1",
                  error: "File not found",
                },
              ],
            } as any,
          ],
        }),
      ).toBe(false);
    });
  });

  describe("Cross-Mode Consistency", () => {
    it("BIDI and SSE return same result for identical input (false case)", () => {
      const messages: UIMessageFromAISDKv6[] = [
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
              state: "output-available",
              toolCallId: "orig-1",
              output: { results: [] },
            },
          ],
        } as any,
      ];

      const bidiResult = bidiSendAuto({ messages });
      const sseResult = sseSendAuto({ messages });

      expect(bidiResult).toBe(false);
      expect(sseResult).toBe(false);
      expect(bidiResult).toBe(sseResult); // Consistency check
    });

    it("BIDI and SSE return same result for user message", () => {
      const messages: UIMessageFromAISDKv6[] = [
        { id: "1", role: "user", content: "Test" },
      ];

      expect(bidiSendAuto({ messages })).toBe(false);
      expect(sseSendAuto({ messages })).toBe(false);
    });

    it("BIDI and SSE return same result for empty array", () => {
      const messages: UIMessageFromAISDKv6[] = [];

      expect(bidiSendAuto({ messages })).toBe(false);
      expect(sseSendAuto({ messages })).toBe(false);
    });
  });
});
