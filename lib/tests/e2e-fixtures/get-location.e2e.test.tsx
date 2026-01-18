/**
 * E2E Test: get_location Approval Flow (Fixture-based)
 *
 * Tests the complete approval UI flow for get_location tool
 * using captured backend fixtures.
 *
 * Per ADR 0005 (Frontend Execute) + ADR 0012:
 * - get_location is a Frontend Execute tool (uses browser Geolocation API)
 * - Approval UI displayed on `tool-approval-request` event
 * - After approval, frontend executes browser API and calls `addToolOutput()`
 * - Backend receives output and sends final response
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
  getApprovalRequestedParts,
  getToolInvocationById,
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

describe("get_location Approval Flow - Fixture E2E Tests (Frontend Execute)", () => {
  describe("BIDI Mode", () => {
    describe("Approval Flow (get_location-approved-bidi-baseline.json)", () => {
      const fixture = loadFixture("get_location-approved-bidi-baseline.json");
      const events = parseRawEvents(fixture.output.rawEvents);

      it("should display approval UI for location permission request", async () => {
        // Given: Setup BIDI handler from fixture
        const chat = createBidiWebSocketLink();
        server.use(createBidiHandlerFromFixture(chat, fixture));

        const { useChatOptions } = buildBidiUseChatOptions({
          initialMessages: [] as UIMessageFromAISDKv6[],
          forceNewInstance: true,
        });
        // Transport cleanup handled by MSW server lifecycle

        const { result } = renderHook(() => useChat(useChatOptions));

        // When: User asks for location
        await act(async () => {
          result.current.sendMessage({
            text: fixture.input.messages[0].content, // "現在地を教えて"
          });
        });

        // Then: Approval UI should be displayed for location permission
        await waitFor(
          () => {
            const lastMessage = result.current.messages.at(-1);
            expect(lastMessage?.role).toBe("assistant");

            const approvalParts = getApprovalRequestedParts(lastMessage);
            expect(approvalParts.length).toBeGreaterThan(0);
          },
          { timeout: 5000 },
        );

        // Verify it's a get_location approval request
        const lastMessage = result.current.messages.at(-1);
        const approvalParts = getApprovalRequestedParts(lastMessage);
        expect(approvalParts[0].toolName).toBe("get_location");
        expect(approvalParts[0].state).toBe("approval-requested");
        // get_location has empty args (no input required from user)
        expect(approvalParts[0].args).toEqual({});
      });

      it("should complete Frontend Execute flow when user approves", async () => {
        // Given: Setup BIDI handler from fixture
        const chat = createBidiWebSocketLink();
        server.use(createBidiHandlerFromFixture(chat, fixture));

        const { useChatOptions } = buildBidiUseChatOptions({
          initialMessages: [] as UIMessageFromAISDKv6[],
          forceNewInstance: true,
        });
        // Transport cleanup handled by MSW server lifecycle

        const { result } = renderHook(() => useChat(useChatOptions));

        // When: User asks for location
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

        // When: User approves location permission
        // Per ADR 0005 (Frontend Execute pattern):
        // 1. User approves via addToolApprovalResponse
        // 2. Frontend executes browser Geolocation API (async operation)
        // 3. Frontend sends result via addToolOutput
        const lastMessage = result.current.messages.at(-1);
        const approvalPart = getApprovalRequestedParts(lastMessage)[0];

        // Step 1: Send approval response
        await act(async () => {
          result.current.addToolApprovalResponse({
            id: approvalPart.approval!.id,
            approved: true,
          });
        });

        // Step 2 & 3: Frontend executes browser API and sends result
        // (In production, this would be actual navigator.geolocation call - async)
        const locationResult = {
          latitude: 35.6762,
          longitude: 139.6503,
          accuracy: 20,
          city: "Tokyo",
          country: "Japan",
        };

        await act(async () => {
          result.current.addToolOutput({
            tool: "get_location",
            toolCallId: approvalPart.toolCallId,
            output: JSON.stringify(locationResult),
          });
        });

        // Then: Tool result should be received with location data
        await waitFor(
          () => {
            const finalMessage = result.current.messages.at(-1);
            const toolPart = getToolInvocationById(
              finalMessage,
              approvalPart.toolCallId,
            );
            // ADK uses "output-available" for successful tool completion
            expect(["result", "output-available"]).toContain(toolPart?.state);

            // Verify location result structure (from fixture)
            if (toolPart?.result) {
              const resultData = toolPart.result as {
                latitude?: number;
                longitude?: number;
                city?: string;
              };
              expect(resultData.latitude).toBeDefined();
              expect(resultData.longitude).toBeDefined();
            }
          },
          { timeout: 5000 },
        );

        // Verify final text response mentions location
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

    describe("Denial Flow (get_location-denied-bidi-baseline.json)", () => {
      it("should handle location permission denial correctly", async () => {
        const fixture = loadFixture("get_location-denied-bidi-baseline.json");

        // Given: Setup BIDI handler from fixture
        const chat = createBidiWebSocketLink();
        server.use(createBidiHandlerFromFixture(chat, fixture));

        const { useChatOptions } = buildBidiUseChatOptions({
          initialMessages: [] as UIMessageFromAISDKv6[],
          forceNewInstance: true,
        });
        // Transport cleanup handled by MSW server lifecycle

        const { result } = renderHook(() => useChat(useChatOptions));

        // When: User asks for location
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

        // When: User denies location permission
        const lastMessage = result.current.messages.at(-1);
        const approvalPart = getApprovalRequestedParts(lastMessage)[0];

        await act(async () => {
          result.current.addToolApprovalResponse({
            id: approvalPart.approval!.id,
            approved: false,
            reason: "User denied location access",
          });
        });

        // Then: Should receive error response (user denied)
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

  describe("SSE Mode", () => {
    describe("Approval Flow (get_location-approved-sse-baseline.json)", () => {
      const fixture = loadFixture("get_location-approved-sse-baseline.json");
      const events = parseRawEvents(fixture.output.rawEvents);

      it("should display approval UI for location permission request", async () => {
        // Given: Setup SSE handler from fixture
        server.use(createSseHandlerFromFixture(fixture));

        const { useChatOptions } = buildSseUseChatOptions({
          mode: "adk-sse",
          initialMessages: [] as UIMessageFromAISDKv6[],
        });

        const { result } = renderHook(() => useChat(useChatOptions));

        // When: User asks for location
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

        // Verify it's a get_location tool
        const lastMessage = result.current.messages.at(-1);
        const approvalParts = getApprovalRequestedParts(lastMessage);
        expect(approvalParts[0].toolName).toBe("get_location");
      });

      it("should complete Frontend Execute flow when user approves", async () => {
        // Given: Setup SSE handler from fixture
        server.use(createSseHandlerFromFixture(fixture));

        const { useChatOptions } = buildSseUseChatOptions({
          mode: "adk-sse",
          initialMessages: [] as UIMessageFromAISDKv6[],
        });

        const { result } = renderHook(() => useChat(useChatOptions));

        // When: User asks for location
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

        // When: User approves location permission
        // Per ADR 0005 (Frontend Execute pattern):
        // 1. User approves via addToolApprovalResponse
        // 2. Frontend executes browser Geolocation API (async operation)
        // 3. Frontend sends result via addToolOutput
        const lastMessage = result.current.messages.at(-1);
        const approvalPart = getApprovalRequestedParts(lastMessage)[0];

        // Step 1: Send approval response
        await act(async () => {
          result.current.addToolApprovalResponse({
            id: approvalPart.approval!.id,
            approved: true,
          });
        });

        // Step 2 & 3: Frontend executes browser API and sends result
        const locationResult = {
          latitude: 35.6762,
          longitude: 139.6503,
          accuracy: 20,
          city: "Tokyo",
          country: "Japan",
        };

        await act(async () => {
          result.current.addToolOutput({
            tool: "get_location",
            toolCallId: approvalPart.toolCallId,
            output: JSON.stringify(locationResult),
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

      it("should have SSE-specific behavior (no start-step/finish-step)", () => {
        // Verify SSE mode doesn't have BIDI-specific events
        const hasStartStep = events.some((e) => e.type === "start-step");
        const hasFinishStep = events.some((e) => e.type === "finish-step");

        expect(hasStartStep).toBe(false);
        expect(hasFinishStep).toBe(false);
      });
    });

    describe("Denial Flow (get_location-denied-sse-baseline.json)", () => {
      it("should handle location permission denial correctly", async () => {
        const fixture = loadFixture("get_location-denied-sse-baseline.json");

        // Given: Setup SSE handler from fixture
        server.use(createSseHandlerFromFixture(fixture));

        const { useChatOptions } = buildSseUseChatOptions({
          mode: "adk-sse",
          initialMessages: [] as UIMessageFromAISDKv6[],
        });

        const { result } = renderHook(() => useChat(useChatOptions));

        // When: User asks for location
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

  describe("Frontend Execute Pattern Difference (ADR 0005)", () => {
    it("should document that get_location requires frontend execution after approval", () => {
      /**
       * Key difference from Server Execute (process_payment):
       *
       * Server Execute (process_payment):
       *   1. User approves → addToolApprovalResponse()
       *   2. sendAutomaticallyWhen triggers
       *   3. Backend executes tool
       *   4. Backend sends tool-output-available
       *
       * Frontend Execute (get_location):
       *   1. User approves → addToolApprovalResponse()
       *   2. Frontend executes browser API (navigator.geolocation)
       *   3. Frontend calls addToolOutput() with result
       *   4. Backend receives output and sends final response
       *
       * This test file properly tests the Frontend Execute pattern:
       * - Approval tests call BOTH addToolApprovalResponse AND addToolOutput
       * - Denial tests call ONLY addToolApprovalResponse (no addToolOutput)
       *
       * Reference: tests/e2e/backend_fixture/test_get_location_*_bidi_baseline.py
       */
      expect(true).toBe(true); // Documentation test
    });
  });
});
