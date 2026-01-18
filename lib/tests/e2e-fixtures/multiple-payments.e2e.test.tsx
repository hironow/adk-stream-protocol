/**
 * E2E Test: Multiple Payments Approval Flow (Fixture-based)
 *
 * Tests approval UI flow for multiple tool calls in a single request.
 *
 * Per ADR 0003 + ADR 0012:
 * - BIDI Mode: Sequential execution (Alice approval → Alice result → Bob approval → Bob result)
 * - SSE Mode: Parallel approval (both approval requests sent together)
 *
 * @vitest-environment jsdom
 */

import { useChat } from "@ai-sdk/react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { buildUseChatOptions as buildBidiUseChatOptions } from "../../bidi";
import { buildUseChatOptions as buildSseUseChatOptions } from "../../sse";
import type { UIMessageFromAISDKv6 } from "../../utils";
import {
  createBidiWebSocketLink,
  useMswServer,
} from "../helpers";
import {
  loadFixture,
  parseRawEvents,
  findAllApprovalRequestEvents,
} from "./helpers/fixture-loader";
import {
  createBidiSequentialApprovalHandler,
  createSseParallelApprovalHandler,
} from "./helpers/fixture-server";
import {
  getApprovalRequestedParts,
  getToolInvocationById,
  getToolInvocationParts,
  getMessageText,
  assertMultipleApprovalsDisplayed,
} from "./helpers/approval-ui-assertions";

describe("Multiple Payments Approval Flow - Fixture E2E Tests", () => {
  // Create MSW server with custom handler for WebSocket requests
  const { getServer } = useMswServer({
    onUnhandledRequest(request) {
      // Ignore WebSocket upgrade requests
      if (request.url.includes("/live")) {
        return;
      }
      console.error("Unhandled request:", request.method, request.url);
    },
  });
  describe("BIDI Mode - Sequential Execution (ADR 0003)", () => {
    describe("Sequential Approval Flow (multiple-payments-sequential-bidi-baseline.json)", () => {
      const fixture = loadFixture("multiple-payments-sequential-bidi-baseline.json");
      const events = parseRawEvents(fixture.output.rawEvents);
      const approvalEvents = findAllApprovalRequestEvents(events);

      it("should have two approval requests in fixture (Alice and Bob)", () => {
        expect(approvalEvents.length).toBe(2);
      });

      it("should display Alice approval first, then Bob after Alice is approved", async () => {
        // Given: Setup BIDI sequential handler from fixture
        const chat = createBidiWebSocketLink();
        getServer().use(createBidiSequentialApprovalHandler(chat, fixture));

        const { useChatOptions } = buildBidiUseChatOptions({
          initialMessages: [] as UIMessageFromAISDKv6[],
          forceNewInstance: true,
        });
        // Transport cleanup handled by MSW server lifecycle

        const { result } = renderHook(() => useChat(useChatOptions));

        // When: User sends message requesting two payments
        await act(async () => {
          result.current.sendMessage({
            text: fixture.input.messages[0].content, // "Aliceに30ドル、Bobに40ドル送金してください"
          });
        });

        // Then: First approval (Alice) should be displayed
        await waitFor(
          () => {
            const lastMessage = result.current.messages.at(-1);
            expect(lastMessage?.role).toBe("assistant");

            const approvalParts = getApprovalRequestedParts(lastMessage);
            expect(approvalParts.length).toBe(1);
            // First approval should be for Alice
            expect(approvalParts[0].args.recipient).toBe("Alice");
          },
          { timeout: 5000 },
        );

        // When: Approve Alice
        const aliceMessage = result.current.messages.at(-1);
        const alicePart = getApprovalRequestedParts(aliceMessage)[0];

        await act(async () => {
          result.current.addToolApprovalResponse({
            id: alicePart.approval!.id,
            approved: true,
          });
        });

        // Then: Alice result received and Bob approval displayed
        await waitFor(
          () => {
            const lastMessage = result.current.messages.at(-1);
            const toolParts = getToolInvocationParts(lastMessage);

            // Alice should have result (ADK uses "output-available")
            const aliceToolPart = toolParts.find(
              (p) => p.args.recipient === "Alice",
            );
            expect(["result", "output-available"]).toContain(aliceToolPart?.state);

            // Bob should be in approval-requested
            const bobToolPart = toolParts.find(
              (p) => p.args.recipient === "Bob",
            );
            expect(bobToolPart?.state).toBe("approval-requested");
          },
          { timeout: 5000 },
        );

        // When: Approve Bob
        const bobMessage = result.current.messages.at(-1);
        const bobParts = getApprovalRequestedParts(bobMessage);
        const bobPart = bobParts.find((p) => p.args.recipient === "Bob");

        await act(async () => {
          result.current.addToolApprovalResponse({
            id: bobPart!.approval!.id,
            approved: true,
          });
        });

        // Then: Both should have results
        await waitFor(
          () => {
            const lastMessage = result.current.messages.at(-1);
            const toolParts = getToolInvocationParts(lastMessage);

            const aliceToolPart = toolParts.find(
              (p) => p.args.recipient === "Alice",
            );
            const bobToolPart = toolParts.find(
              (p) => p.args.recipient === "Bob",
            );

            // ADK uses "output-available" for successful tool completion
            expect(["result", "output-available"]).toContain(aliceToolPart?.state);
            expect(["result", "output-available"]).toContain(bobToolPart?.state);
          },
          { timeout: 5000 },
        );

        // Verify final text response
        await waitFor(
          () => {
            const lastMessage = result.current.messages.at(-1);
            const text = getMessageText(lastMessage);
            expect(text.length).toBeGreaterThan(0);
          },
          { timeout: 5000 },
        );
      });

      it("should have BIDI-specific expectedDoneCount of 1", () => {
        // BIDI mode uses single continuous stream
        expect(fixture.output.expectedDoneCount).toBe(1);
      });
    });
  });

  describe("SSE Mode - Parallel Approval (ADR 0003)", () => {
    describe("Parallel Approval Flow (multiple-payments-approved-sse-baseline.json)", () => {
      const fixture = loadFixture("multiple-payments-approved-sse-baseline.json");
      const events = parseRawEvents(fixture.output.rawEvents);

      it("should display both approval requests simultaneously", async () => {
        // Given: Setup SSE parallel handler from fixture
        getServer().use(createSseParallelApprovalHandler(fixture));

        const { useChatOptions } = buildSseUseChatOptions({
          mode: "adk-sse",
          initialMessages: [] as UIMessageFromAISDKv6[],
        });

        const { result } = renderHook(() => useChat(useChatOptions));

        // When: User sends message requesting two payments
        await act(async () => {
          result.current.sendMessage({
            text: fixture.input.messages[0].content,
          });
        });

        // Then: Both approvals should be displayed together (parallel)
        await waitFor(
          () => {
            const lastMessage = result.current.messages.at(-1);
            expect(lastMessage?.role).toBe("assistant");

            const approvalParts = getApprovalRequestedParts(lastMessage);
            // SSE mode: both approval requests should be present simultaneously
            expect(approvalParts.length).toBe(2);
          },
          { timeout: 5000 },
        );

        // Verify both Alice and Bob are in the approval list
        const lastMessage = result.current.messages.at(-1);
        const approvalParts = getApprovalRequestedParts(lastMessage);
        const recipients = approvalParts.map((p) => p.args.recipient);
        expect(recipients).toContain("Alice");
        expect(recipients).toContain("Bob");
      });

      it("should complete both approvals when user approves all", async () => {
        // Given: Setup SSE parallel handler
        getServer().use(createSseParallelApprovalHandler(fixture));

        const { useChatOptions } = buildSseUseChatOptions({
          mode: "adk-sse",
          initialMessages: [] as UIMessageFromAISDKv6[],
        });

        const { result } = renderHook(() => useChat(useChatOptions));

        // When: User sends message
        await act(async () => {
          result.current.sendMessage({
            text: fixture.input.messages[0].content,
          });
        });

        // Wait for both approvals
        await waitFor(
          () => {
            const lastMessage = result.current.messages.at(-1);
            const approvalParts = getApprovalRequestedParts(lastMessage);
            expect(approvalParts.length).toBe(2);
          },
          { timeout: 5000 },
        );

        // When: Approve both (user can approve in any order in SSE mode)
        const lastMessage = result.current.messages.at(-1);
        const approvalParts = getApprovalRequestedParts(lastMessage);

        for (const part of approvalParts) {
          await act(async () => {
            result.current.addToolApprovalResponse({
              id: part.approval!.id,
              approved: true,
            });
          });
        }

        // Then: Both should have results
        await waitFor(
          () => {
            const finalMessage = result.current.messages.at(-1);
            const toolParts = getToolInvocationParts(finalMessage);

            const alicePart = toolParts.find((p) => p.args.recipient === "Alice");
            const bobPart = toolParts.find((p) => p.args.recipient === "Bob");

            // ADK uses "output-available" for successful tool completion
            expect(["result", "output-available"]).toContain(alicePart?.state);
            expect(["result", "output-available"]).toContain(bobPart?.state);
          },
          { timeout: 5000 },
        );
      });

      it("should have SSE-specific expectedDoneCount of 2", () => {
        // SSE mode uses two separate HTTP requests
        expect(fixture.output.expectedDoneCount).toBe(2);
      });

      it("should NOT have BIDI-specific events (start-step, finish-step)", () => {
        const hasStartStep = events.some((e) => e.type === "start-step");
        const hasFinishStep = events.some((e) => e.type === "finish-step");

        expect(hasStartStep).toBe(false);
        expect(hasFinishStep).toBe(false);
      });
    });
  });

  describe("Protocol Comparison (ADR 0003)", () => {
    it("should document the fundamental difference between BIDI and SSE multi-tool handling", () => {
      /**
       * BIDI Mode (ADK Blocking Mode):
       * - Single WebSocket stream (expectedDoneCount: 1)
       * - Tools execute SEQUENTIALLY due to types.Behavior.BLOCKING
       * - Flow: Alice request → Alice approval → Alice result → Bob request → Bob approval → Bob result
       * - Each tool must complete before next begins
       *
       * SSE Mode (HTTP Request-Response):
       * - Two HTTP requests (expectedDoneCount: 2)
       * - Tools can have PARALLEL approval requests
       * - Flow: (Alice + Bob requests) → (Alice + Bob approvals) → (Alice + Bob results)
       * - Multiple tools can be in approval-requested state simultaneously
       *
       * This is a fundamental architectural difference, not a bug.
       * See ADR 0003 for detailed explanation.
       */

      const bidiFixture = loadFixture("multiple-payments-sequential-bidi-baseline.json");
      const sseFixture = loadFixture("multiple-payments-approved-sse-baseline.json");

      // BIDI: Single stream
      expect(bidiFixture.output.expectedDoneCount).toBe(1);
      expect(bidiFixture.mode).toBe("bidi");

      // SSE: Two requests
      expect(sseFixture.output.expectedDoneCount).toBe(2);
      expect(sseFixture.mode).toBe("sse");
    });
  });
});
