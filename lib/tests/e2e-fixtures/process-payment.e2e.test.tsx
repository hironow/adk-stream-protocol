/**
 * E2E Test: process_payment Approval Flow (Fixture-based)
 *
 * Tests the complete approval UI flow for process_payment tool
 * using captured backend fixtures.
 *
 * Per ADR 0012:
 * - Approval UI displayed on `tool-approval-request` event
 * - OK: `addToolApprovalResponse(approved: true)` → `tool-output-available`
 * - NG: `addToolApprovalResponse(approved: false)` → `tool-output-error`
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
  setupMswServer,
} from "../helpers";
import {
  loadFixture,
  parseRawEvents,
  findApprovalRequestEvent,
} from "./helpers/fixture-loader";
import {
  createBidiHandlerFromFixture,
  createSseHandlerFromFixture,
} from "./helpers/fixture-server";
import {
  assertApprovalUIDisplayed,
  assertToolResultReceived,
  getToolInvocationById,
  getApprovalRequestedParts,
  getMessageText,
} from "./helpers/approval-ui-assertions";

// Create MSW server with custom handler for WebSocket requests
const server = setupMswServer({
  onUnhandledRequest(request) {
    // Ignore WebSocket upgrade requests
    if (request.url.includes("/live")) {
      return;
    }
    console.error("Unhandled request:", request.method, request.url);
  },
});

describe("process_payment Approval Flow - Fixture E2E Tests", () => {
  describe("BIDI Mode", () => {
    describe("Approval Flow (process_payment-approved-bidi-baseline.json)", () => {
      const fixture = loadFixture("process_payment-approved-bidi-baseline.json");
      const events = parseRawEvents(fixture.output.rawEvents);
      const approvalEvent = findApprovalRequestEvent(events);

      it("should display approval UI when tool-approval-request is received", async () => {
        // Given: Setup BIDI handler from fixture
        const chat = createBidiWebSocketLink();
        server.use(createBidiHandlerFromFixture(chat, fixture));

        const { useChatOptions } = buildBidiUseChatOptions({
          initialMessages: [] as UIMessageFromAISDKv6[],
          forceNewInstance: true,
        });
        // Transport cleanup handled by MSW server lifecycle

        const { result } = renderHook(() => useChat(useChatOptions));

        // When: User sends message (from fixture input)
        await act(async () => {
          result.current.sendMessage({
            text: fixture.input.messages[0].content,
          });
        });

        // Then: Approval UI should be displayed
        await waitFor(
          () => {
            const lastMessage = result.current.messages.at(-1);
            expect(lastMessage?.role).toBe("assistant");

            const approvalParts = getApprovalRequestedParts(lastMessage);
            expect(approvalParts.length).toBeGreaterThan(0);
          },
          { timeout: 5000 },
        );

        // Verify approval UI details match fixture
        const lastMessage = result.current.messages.at(-1);
        const approvalParts = getApprovalRequestedParts(lastMessage);
        expect(approvalParts[0].toolName).toBe("process_payment");
        expect(approvalParts[0].state).toBe("approval-requested");
      });

      it("should complete approval flow when user approves", async () => {
        // Given: Setup BIDI handler from fixture
        const chat = createBidiWebSocketLink();
        server.use(createBidiHandlerFromFixture(chat, fixture));

        const { useChatOptions } = buildBidiUseChatOptions({
          initialMessages: [] as UIMessageFromAISDKv6[],
          forceNewInstance: true,
        });
        // Transport cleanup handled by MSW server lifecycle

        const { result } = renderHook(() => useChat(useChatOptions));

        // When: User sends message
        await act(async () => {
          result.current.sendMessage({
            text: fixture.input.messages[0].content,
          });
        });

        // Wait for approval request
        await waitFor(
          () => {
            const lastMessage = result.current.messages.at(-1);
            const approvalParts = getApprovalRequestedParts(lastMessage);
            expect(approvalParts.length).toBeGreaterThan(0);
          },
          { timeout: 5000 },
        );

        // When: User approves
        const lastMessage = result.current.messages.at(-1);
        const approvalPart = getApprovalRequestedParts(lastMessage)[0];

        await act(async () => {
          result.current.addToolApprovalResponse({
            id: approvalPart.approval!.id,
            approved: true,
          });
        });

        // Then: Tool result should be received (from fixture)
        await waitFor(
          () => {
            const finalMessage = result.current.messages.at(-1);
            const toolPart = getToolInvocationById(
              finalMessage,
              approvalPart.toolCallId,
            );
            // State should be "result" or "output-available" after tool completion
            // ADK uses "output-available" for successful tool completion
            expect(["result", "output-available"]).toContain(toolPart?.state);
          },
          { timeout: 5000 },
        );

        // Verify final text response
        await waitFor(
          () => {
            const finalMessage = result.current.messages.at(-1);
            const text = getMessageText(finalMessage);
            expect(text.length).toBeGreaterThan(0);
          },
          { timeout: 5000 },
        );
      });

      it("should have BIDI-specific events (start-step, finish-step)", () => {
        // Verify fixture structure per ADR 0011
        const hasStartStep = events.some((e) => e.type === "start-step");
        const hasFinishStep = events.some((e) => e.type === "finish-step");

        expect(hasStartStep).toBe(true);
        expect(hasFinishStep).toBe(true);
        expect(fixture.output.expectedDoneCount).toBe(1);
      });
    });

    describe("Denial Flow (process_payment-denied-bidi-baseline.json)", () => {
      it("should handle denial correctly", async () => {
        const fixture = loadFixture("process_payment-denied-bidi-baseline.json");

        // Given: Setup BIDI handler from fixture
        const chat = createBidiWebSocketLink();
        server.use(createBidiHandlerFromFixture(chat, fixture));

        const { useChatOptions } = buildBidiUseChatOptions({
          initialMessages: [] as UIMessageFromAISDKv6[],
          forceNewInstance: true,
        });
        // Transport cleanup handled by MSW server lifecycle

        const { result } = renderHook(() => useChat(useChatOptions));

        // When: User sends message
        await act(async () => {
          result.current.sendMessage({
            text: fixture.input.messages[0].content,
          });
        });

        // Wait for approval request
        await waitFor(
          () => {
            const lastMessage = result.current.messages.at(-1);
            const approvalParts = getApprovalRequestedParts(lastMessage);
            expect(approvalParts.length).toBeGreaterThan(0);
          },
          { timeout: 5000 },
        );

        // When: User denies
        const lastMessage = result.current.messages.at(-1);
        const approvalPart = getApprovalRequestedParts(lastMessage)[0];

        await act(async () => {
          result.current.addToolApprovalResponse({
            id: approvalPart.approval!.id,
            approved: false,
            reason: "User denied the payment",
          });
        });

        // Then: Should receive error response (tool-output-error in fixture)
        await waitFor(
          () => {
            const finalMessage = result.current.messages.at(-1);
            const toolPart = getToolInvocationById(
              finalMessage,
              approvalPart.toolCallId,
            );
            // After denial, tool should have error state
            // ADK uses "output-error" state for denied tools
            expect(["result", "output-error"]).toContain(toolPart?.state);
          },
          { timeout: 5000 },
        );
      });
    });
  });

  describe("SSE Mode", () => {
    describe("Approval Flow (process_payment-approved-sse-baseline.json)", () => {
      const fixture = loadFixture("process_payment-approved-sse-baseline.json");
      const events = parseRawEvents(fixture.output.rawEvents);

      it("should display approval UI when tool-approval-request is received", async () => {
        // Given: Setup SSE handler from fixture
        server.use(createSseHandlerFromFixture(fixture));

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

        // Then: Approval UI should be displayed
        await waitFor(
          () => {
            const lastMessage = result.current.messages.at(-1);
            expect(lastMessage?.role).toBe("assistant");

            const approvalParts = getApprovalRequestedParts(lastMessage);
            expect(approvalParts.length).toBeGreaterThan(0);
          },
          { timeout: 5000 },
        );

        // Verify SSE-specific behavior (no start-step/finish-step)
        const hasStartStep = events.some((e) => e.type === "start-step");
        const hasFinishStep = events.some((e) => e.type === "finish-step");
        expect(hasStartStep).toBe(false);
        expect(hasFinishStep).toBe(false);
      });

      it("should complete approval flow when user approves", async () => {
        // Given: Setup SSE handler from fixture
        server.use(createSseHandlerFromFixture(fixture));

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

        // Wait for approval request
        await waitFor(
          () => {
            const lastMessage = result.current.messages.at(-1);
            const approvalParts = getApprovalRequestedParts(lastMessage);
            expect(approvalParts.length).toBeGreaterThan(0);
          },
          { timeout: 5000 },
        );

        // When: User approves
        const lastMessage = result.current.messages.at(-1);
        const approvalPart = getApprovalRequestedParts(lastMessage)[0];

        await act(async () => {
          result.current.addToolApprovalResponse({
            id: approvalPart.approval!.id,
            approved: true,
          });
        });

        // Then: Tool result should be received
        await waitFor(
          () => {
            const finalMessage = result.current.messages.at(-1);
            const toolPart = getToolInvocationById(
              finalMessage,
              approvalPart.toolCallId,
            );
            // ADK uses "output-available" for successful tool completion
            expect(["result", "output-available"]).toContain(toolPart?.state);
          },
          { timeout: 5000 },
        );
      });

      it("should have SSE-specific behavior (expectedDoneCount: 2)", () => {
        // Verify fixture structure per ADR 0003
        expect(fixture.output.expectedDoneCount).toBe(2);
      });
    });

    describe("Denial Flow (process_payment-denied-sse-baseline.json)", () => {
      it("should handle denial correctly", async () => {
        const fixture = loadFixture("process_payment-denied-sse-baseline.json");

        // Given: Setup SSE handler from fixture
        server.use(createSseHandlerFromFixture(fixture));

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

        // Wait for approval request
        await waitFor(
          () => {
            const lastMessage = result.current.messages.at(-1);
            const approvalParts = getApprovalRequestedParts(lastMessage);
            expect(approvalParts.length).toBeGreaterThan(0);
          },
          { timeout: 5000 },
        );

        // When: User denies
        const lastMessage = result.current.messages.at(-1);
        const approvalPart = getApprovalRequestedParts(lastMessage)[0];

        await act(async () => {
          result.current.addToolApprovalResponse({
            id: approvalPart.approval!.id,
            approved: false,
          });
        });

        // Then: Should receive error response
        await waitFor(
          () => {
            const finalMessage = result.current.messages.at(-1);
            const toolPart = getToolInvocationById(
              finalMessage,
              approvalPart.toolCallId,
            );
            // ADK uses "output-error" state for denied tools
            expect(["result", "output-error"]).toContain(toolPart?.state);
          },
          { timeout: 5000 },
        );
      });
    });
  });
});
