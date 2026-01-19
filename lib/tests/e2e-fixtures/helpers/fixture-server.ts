/**
 * Fixture Server - MSW Handler Generators
 *
 * Creates MSW handlers from fixture data to simulate backend behavior.
 * Supports both SSE and BIDI modes.
 *
 * Reference: ADR 0012 - Frontend Approval UI Display Timing
 */

import { http, HttpResponse } from "msw";
import { ws } from "msw";
import type { FixtureData } from "./fixture-loader";
import {
  splitBidiEventsForApprovalFlow,
  splitSseEventsForApprovalFlow,
} from "./fixture-loader";
import { trackClient } from "../../helpers/bidi-ws-handlers";
import type { BidiMockWebSocket } from "../../helpers/mock-websocket";

// ============================================================================
// Constants
// ============================================================================

export const DEFAULT_SSE_URL = "http://localhost:8000/stream";
export const DEFAULT_BIDI_WS_URL = "ws://localhost:8000/live";

// ============================================================================
// SSE Mode Handlers
// ============================================================================

/**
 * Create SSE handler from fixture for approval flow
 *
 * SSE mode uses two separate HTTP requests:
 * - Request 1: Returns events up to and including finish (approval phase)
 * - Request 2: Returns events after approval (execution phase)
 *
 * @param fixture - Fixture data
 * @param url - SSE endpoint URL (defaults to DEFAULT_SSE_URL)
 * @returns MSW http handler
 *
 * @example
 * ```typescript
 * const fixture = loadFixture("process_payment-approved-sse-baseline.json");
 * server.use(createSseHandlerFromFixture(fixture));
 * ```
 */
export function createSseHandlerFromFixture(
  fixture: FixtureData,
  url: string = DEFAULT_SSE_URL,
) {
  if (fixture.mode !== "sse") {
    throw new Error(`Fixture mode must be "sse", got "${fixture.mode}"`);
  }

  const { request1Events, request2Events } = splitSseEventsForApprovalFlow(
    fixture.output.rawEvents,
  );

  let requestCount = 0;

  return http.post(url, async () => {
    requestCount++;

    const encoder = new TextEncoder();
    const events = requestCount === 1 ? request1Events : request2Events;

    const stream = new ReadableStream({
      start(controller) {
        for (const event of events) {
          const data = `data: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(encoder.encode(data));
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    return new HttpResponse(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  });
}

/**
 * Create SSE handler that streams raw events directly from fixture
 *
 * Use this for non-approval flows (like change_bgm, get_weather)
 * where all events are sent in a single request.
 *
 * @param fixture - Fixture data
 * @param url - SSE endpoint URL
 * @returns MSW http handler
 */
export function createSseStreamHandlerFromFixture(
  fixture: FixtureData,
  url: string = DEFAULT_SSE_URL,
) {
  return http.post(url, async () => {
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      start(controller) {
        for (const rawEvent of fixture.output.rawEvents) {
          controller.enqueue(encoder.encode(rawEvent));
        }
        controller.close();
      },
    });

    return new HttpResponse(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  });
}

// ============================================================================
// BIDI Mode Handlers
// ============================================================================

/**
 * Create BIDI WebSocket link
 */
export function createBidiWebSocketLink(url: string = DEFAULT_BIDI_WS_URL) {
  return ws.link(url);
}

/**
 * Create BIDI handler from fixture for approval flow
 *
 * BIDI mode uses a single WebSocket stream:
 * - Phase 1: Send events until finish-step (approval phase)
 * - Wait for user approval message
 * - Phase 2: Send remaining events (execution phase)
 *
 * @param chat - MSW WebSocket link
 * @param fixture - Fixture data
 * @returns MSW WebSocket handler
 *
 * @example
 * ```typescript
 * const chat = createBidiWebSocketLink();
 * const fixture = loadFixture("process_payment-approved-bidi-baseline.json");
 * server.use(createBidiHandlerFromFixture(chat, fixture));
 * ```
 */
export function createBidiHandlerFromFixture(
  chat: ReturnType<typeof ws.link>,
  fixture: FixtureData,
) {
  if (fixture.mode !== "bidi") {
    throw new Error(`Fixture mode must be "bidi", got "${fixture.mode}"`);
  }

  const { approvalPhase, executionPhase } = splitBidiEventsForApprovalFlow(
    fixture.output.expectedChunks,
  );

  // Find the tool call ID for this approval flow
  const toolCallId = approvalPhase.find(
    (e) => e.type === "tool-approval-request",
  )?.toolCallId;

  // Generate a unique fixture ID for tracking
  const fixtureId = `single-${fixture.mode}-${toolCallId || "unknown"}`;

  // Clear any previous state for this fixture
  singleToolSentPhasesMap.set(fixtureId, new Set());

  return chat.addEventListener("connection", ({ server, client }) => {
    // Track client for cleanup (prevents "Worker exited unexpectedly" errors)
    trackClient(client);

    server.connect();

    client.addEventListener("message", (event) => {
      // Skip ping messages
      let messageData: Record<string, unknown> | null = null;
      try {
        messageData = JSON.parse(event.data as string);
        if (messageData?.type === "ping") {
          return;
        }
      } catch {
        // Not JSON, continue
      }

      // Get sent phases for this fixture
      const sentPhases = singleToolSentPhasesMap.get(fixtureId) || new Set();

      // Detect if message contains an approval response or tool output
      // Per ADR 0005 (Frontend Execute pattern):
      // - Approval: message contains part with state "approval-responded"
      // - Tool Output: message contains part with type "tool-result" or state "output-available"
      let hasApprovalResponse = false;
      let hasToolOutput = false;
      if (messageData?.messages && Array.isArray(messageData.messages)) {
        for (const msg of messageData.messages) {
          if (msg.parts && Array.isArray(msg.parts)) {
            for (const part of msg.parts) {
              // Check if this is an approval-responded tool part
              if (part.state === "approval-responded" && part.toolCallId) {
                hasApprovalResponse = true;
              }
              // Check if this is a tool output (Frontend Execute pattern)
              if (
                part.type === "tool-result" ||
                part.state === "output-available"
              ) {
                hasToolOutput = true;
              }
            }
          }
        }
      }

      // Send execution phase when:
      // 1. Approval response received (Server Execute or denial case)
      // 2. Tool output received (Frontend Execute approval case)
      const shouldSendExecution =
        (hasApprovalResponse || hasToolOutput) && !sentPhases.has("execution");

      if (shouldSendExecution) {
        // Approval/output received: Send execution phase events
        sentPhases.add("execution");
        for (const e of executionPhase) {
          const msg = `data: ${JSON.stringify(e)}\n\n`;
          client.send(msg);
        }
        // Send [DONE] to signal stream completion
        client.send("data: [DONE]\n\n");
      } else if (!sentPhases.has("approval")) {
        // Initial message: Send approval phase events
        sentPhases.add("approval");
        for (const e of approvalPhase) {
          const msg = `data: ${JSON.stringify(e)}\n\n`;
          client.send(msg);
        }
        // Don't send [DONE] yet - wait for approval
      }
    });
  });
}

/**
 * Create BIDI handler that streams all events immediately (no approval wait)
 *
 * Use this for non-approval flows (like change_bgm, get_weather)
 * where all events are sent without waiting for user interaction.
 *
 * @param chat - MSW WebSocket link
 * @param fixture - Fixture data
 * @returns MSW WebSocket handler
 */
export function createBidiStreamHandlerFromFixture(
  chat: ReturnType<typeof ws.link>,
  fixture: FixtureData,
) {
  return chat.addEventListener("connection", ({ server, client }) => {
    // Track client for cleanup (prevents "Worker exited unexpectedly" errors)
    trackClient(client);

    server.connect();

    client.addEventListener("message", (event) => {
      // Skip ping messages
      try {
        const data = JSON.parse(event.data as string);
        if (data.type === "ping") {
          return;
        }
      } catch {
        // Not JSON, continue
      }

      // Send all raw events
      for (const rawEvent of fixture.output.rawEvents) {
        client.send(rawEvent);
      }
    });
  });
}

// ============================================================================
// Multi-Tool Handlers (Sequential/Parallel)
// ============================================================================

/**
 * Create BIDI handler for sequential multi-tool approval flow
 *
 * For fixtures like multiple-payments-sequential-bidi-baseline.json:
 * - Turn 1: User message → Alice approval request
 * - Turn 2: Alice approval → Alice result + Bob approval request
 * - Turn 3: Bob approval → Bob result + final response
 *
 * @param chat - MSW WebSocket link
 * @param fixture - Fixture data
 * @returns MSW WebSocket handler
 */
// Track sent phases globally to handle WebSocket reconnections
const sentPhasesMap = new Map<string, Set<number>>();
// Track single-tool approval flow state
const singleToolSentPhasesMap = new Map<string, Set<"approval" | "execution">>();

export function createBidiSequentialApprovalHandler(
  chat: ReturnType<typeof ws.link>,
  fixture: FixtureData,
) {
  if (fixture.mode !== "bidi") {
    throw new Error(`Fixture mode must be "bidi", got "${fixture.mode}"`);
  }

  const events = fixture.output.expectedChunks;

  // Find tool approval request events to identify phase boundaries
  // Each approval request marks the end of a phase (before the finish-step)
  const approvalToolCallIds: string[] = [];
  events.forEach((e) => {
    if (e.type === "tool-approval-request" && e.toolCallId) {
      approvalToolCallIds.push(e.toolCallId);
    }
  });

  // Find indices of finish-step events (approval boundaries)
  const finishStepIndices: number[] = [];
  events.forEach((e, i) => {
    if (e.type === "finish-step") {
      finishStepIndices.push(i);
    }
  });

  // Split events by approval phases
  const phases: Array<typeof events> = [];
  let lastEnd = 0;
  for (const idx of finishStepIndices) {
    phases.push(events.slice(lastEnd, idx + 1));
    lastEnd = idx + 1;
  }
  // Add remaining events as final phase
  if (lastEnd < events.length) {
    phases.push(events.slice(lastEnd));
  }

  // Generate a unique fixture ID for tracking
  const fixtureId = `${fixture.mode}-${approvalToolCallIds.join("-")}`;

  // Clear any previous state for this fixture
  sentPhasesMap.set(fixtureId, new Set());

  return chat.addEventListener("connection", ({ server, client }) => {
    // Track client for cleanup (prevents "Worker exited unexpectedly" errors)
    trackClient(client);

    server.connect();

    client.addEventListener("message", (event) => {

      // Skip ping messages
      let messageData: Record<string, unknown> | null = null;
      try {
        messageData = JSON.parse(event.data as string);
        if (messageData?.type === "ping") {
          return;
        }
      } catch {
        // Not JSON, continue
      }

      // Determine which phase to send based on message content
      // Look for approval responses in the message to determine which approvals have been given
      const sentPhases = sentPhasesMap.get(fixtureId) || new Set();

      // Extract approved tool IDs from the message
      const approvedToolIds = new Set<string>();
      if (messageData?.messages && Array.isArray(messageData.messages)) {
        for (const msg of messageData.messages) {
          if (msg.parts && Array.isArray(msg.parts)) {
            for (const part of msg.parts) {
              // Check if this is an approval-responded tool part
              if (
                part.state === "approval-responded" &&
                part.toolCallId &&
                part.approval?.approved === true
              ) {
                approvedToolIds.add(part.toolCallId);
              }
            }
          }
        }
      }

      // Determine the phase to send:
      // - Phase 0: No approvals yet (initial message)
      // - Phase 1: First approval received (Alice approved)
      // - Phase 2: Second approval received (Bob approved)
      // etc.
      let phaseToSend = 0;
      for (let i = 0; i < approvalToolCallIds.length; i++) {
        if (approvedToolIds.has(approvalToolCallIds[i])) {
          phaseToSend = i + 1; // Each approval advances to the next phase
        }
      }

      // Don't resend phases we've already sent
      if (sentPhases.has(phaseToSend)) {
        return;
      }

      if (phaseToSend < phases.length) {
        sentPhases.add(phaseToSend);

        for (const e of phases[phaseToSend]) {
          const msg = `data: ${JSON.stringify(e)}\n\n`;
          client.send(msg);
        }

        // Only send [DONE] after the last phase
        if (phaseToSend === phases.length - 1) {
          client.send("data: [DONE]\n\n");
        }
      }
    });
  });
}

/**
 * Create SSE handler for parallel multi-tool approval flow
 *
 * For fixtures like multiple-payments-approved-sse-baseline.json:
 * - Request 1: Both tool approval requests sent together
 * - Request 2: Both tool results sent after approval
 *
 * @param fixture - Fixture data
 * @param url - SSE endpoint URL
 * @returns MSW http handler
 */
export function createSseParallelApprovalHandler(
  fixture: FixtureData,
  url: string = DEFAULT_SSE_URL,
) {
  if (fixture.mode !== "sse") {
    throw new Error(`Fixture mode must be "sse", got "${fixture.mode}"`);
  }

  // Same as standard SSE handler - events are already structured correctly
  return createSseHandlerFromFixture(fixture, url);
}

// ============================================================================
// Custom Mock BIDI Handlers (MSW Alternative)
//
// These handlers use BidiMockWebSocket instead of MSW's ws.link()
// to avoid libuv handle cleanup issues in Vitest parallel execution.
// ============================================================================

// Track single-tool approval flow state for mock handlers
const mockSingleToolSentPhasesMap = new Map<
  string,
  Set<"approval" | "execution">
>();

// Track multi-tool approval flow state for mock handlers
const mockSentPhasesMap = new Map<string, Set<number>>();

/**
 * Create BIDI handler from fixture for Custom Mock (MSW alternative)
 *
 * This is the Custom Mock equivalent of createBidiHandlerFromFixture.
 * Use with useMockWebSocket's setDefaultHandler.
 *
 * @param fixture - Fixture data
 * @returns Handler function for setDefaultHandler
 *
 * @example
 * ```typescript
 * const fixture = loadFixture("process_payment-approved-bidi-baseline.json");
 * setDefaultHandler(createBidiHandlerFromFixtureForMock(fixture));
 * ```
 */
export function createBidiHandlerFromFixtureForMock(
  fixture: FixtureData,
): (ws: BidiMockWebSocket) => void {
  if (fixture.mode !== "bidi") {
    throw new Error(`Fixture mode must be "bidi", got "${fixture.mode}"`);
  }

  const { approvalPhase, executionPhase } = splitBidiEventsForApprovalFlow(
    fixture.output.expectedChunks,
  );

  // Find the tool call ID for this approval flow
  const toolCallId = approvalPhase.find(
    (e) => e.type === "tool-approval-request",
  )?.toolCallId;

  // Generate a unique fixture ID for tracking
  const fixtureId = `mock-single-${fixture.mode}-${toolCallId || "unknown"}`;

  // Clear any previous state for this fixture
  mockSingleToolSentPhasesMap.set(fixtureId, new Set());

  return (ws: BidiMockWebSocket) => {
    ws.onClientMessage((data) => {
      // Skip non-JSON messages
      let messageData: Record<string, unknown> | null = null;
      try {
        messageData = JSON.parse(data);
        if (messageData?.type === "ping") {
          return;
        }
      } catch {
        return; // Not JSON, skip
      }

      // Get sent phases for this fixture
      const sentPhases = mockSingleToolSentPhasesMap.get(fixtureId) || new Set();

      // Detect if message contains an approval response or tool output
      let hasApprovalResponse = false;
      let hasToolOutput = false;
      if (messageData?.messages && Array.isArray(messageData.messages)) {
        for (const msg of messageData.messages) {
          if (msg.parts && Array.isArray(msg.parts)) {
            for (const part of msg.parts) {
              if (part.state === "approval-responded" && part.toolCallId) {
                hasApprovalResponse = true;
              }
              if (
                part.type === "tool-result" ||
                part.state === "output-available"
              ) {
                hasToolOutput = true;
              }
            }
          }
        }
      }

      const shouldSendExecution =
        (hasApprovalResponse || hasToolOutput) && !sentPhases.has("execution");

      if (shouldSendExecution) {
        sentPhases.add("execution");
        for (const e of executionPhase) {
          ws.simulateServerMessage(e);
        }
        ws.simulateDone();
      } else if (!sentPhases.has("approval")) {
        sentPhases.add("approval");
        for (const e of approvalPhase) {
          ws.simulateServerMessage(e);
        }
        // Don't send [DONE] yet - wait for approval
      }
    });
  };
}

/**
 * Create BIDI handler for sequential multi-tool approval flow (Custom Mock)
 *
 * This is the Custom Mock equivalent of createBidiSequentialApprovalHandler.
 * Use with useMockWebSocket's setDefaultHandler.
 *
 * @param fixture - Fixture data
 * @returns Handler function for setDefaultHandler
 *
 * @example
 * ```typescript
 * const fixture = loadFixture("multiple-payments-sequential-bidi-baseline.json");
 * setDefaultHandler(createBidiSequentialApprovalHandlerForMock(fixture));
 * ```
 */
export function createBidiSequentialApprovalHandlerForMock(
  fixture: FixtureData,
): (ws: BidiMockWebSocket) => void {
  if (fixture.mode !== "bidi") {
    throw new Error(`Fixture mode must be "bidi", got "${fixture.mode}"`);
  }

  const events = fixture.output.expectedChunks;

  // Find tool approval request events to identify phase boundaries
  const approvalToolCallIds: string[] = [];
  events.forEach((e) => {
    if (e.type === "tool-approval-request" && e.toolCallId) {
      approvalToolCallIds.push(e.toolCallId);
    }
  });

  // Find indices of finish-step events (approval boundaries)
  const finishStepIndices: number[] = [];
  events.forEach((e, i) => {
    if (e.type === "finish-step") {
      finishStepIndices.push(i);
    }
  });

  // Split events by approval phases
  const phases: Array<typeof events> = [];
  let lastEnd = 0;
  for (const idx of finishStepIndices) {
    phases.push(events.slice(lastEnd, idx + 1));
    lastEnd = idx + 1;
  }
  if (lastEnd < events.length) {
    phases.push(events.slice(lastEnd));
  }

  // Generate a unique fixture ID for tracking
  const fixtureId = `mock-${fixture.mode}-${approvalToolCallIds.join("-")}`;

  // Clear any previous state for this fixture
  mockSentPhasesMap.set(fixtureId, new Set());

  return (ws: BidiMockWebSocket) => {
    ws.onClientMessage((data) => {
      // Skip non-JSON messages
      let messageData: Record<string, unknown> | null = null;
      try {
        messageData = JSON.parse(data);
        if (messageData?.type === "ping") {
          return;
        }
      } catch {
        return;
      }

      const sentPhases = mockSentPhasesMap.get(fixtureId) || new Set();

      // Extract approved tool IDs from the message
      const approvedToolIds = new Set<string>();
      if (messageData?.messages && Array.isArray(messageData.messages)) {
        for (const msg of messageData.messages) {
          if (msg.parts && Array.isArray(msg.parts)) {
            for (const part of msg.parts) {
              if (
                part.state === "approval-responded" &&
                part.toolCallId &&
                part.approval?.approved === true
              ) {
                approvedToolIds.add(part.toolCallId);
              }
            }
          }
        }
      }

      // Determine the phase to send
      let phaseToSend = 0;
      for (let i = 0; i < approvalToolCallIds.length; i++) {
        if (approvedToolIds.has(approvalToolCallIds[i])) {
          phaseToSend = i + 1;
        }
      }

      // Don't resend phases we've already sent
      if (sentPhases.has(phaseToSend)) {
        return;
      }

      if (phaseToSend < phases.length) {
        sentPhases.add(phaseToSend);

        for (const e of phases[phaseToSend]) {
          ws.simulateServerMessage(e);
        }

        // Only send [DONE] after the last phase
        if (phaseToSend === phases.length - 1) {
          ws.simulateDone();
        }
      }
    });
  };
}
