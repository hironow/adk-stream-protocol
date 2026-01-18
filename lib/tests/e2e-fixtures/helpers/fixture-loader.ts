/**
 * Fixture Loader for E2E Tests
 *
 * Loads fixture JSON files from fixtures/frontend/ directory
 * and provides typed access to fixture data.
 *
 * Reference: ADR 0012 - Frontend Approval UI Display Timing
 */

import { readFileSync } from "fs";
import { join } from "path";
import type { SSEEvent } from "../../helpers/event-types";
import { parseSSEDataLine } from "../../helpers/event-types";

// ============================================================================
// Types
// ============================================================================

export interface FixtureInput {
  messages: Array<{
    id?: string;
    role: "user" | "assistant";
    content: string;
  }>;
  trigger: "submit-message";
}

export interface FixtureOutput {
  rawEvents: string[];
  expectedChunks: SSEEvent[];
  expectedDoneCount: number;
  expectedStreamCompletion: boolean;
}

export interface FixtureData {
  description: string;
  mode: "sse" | "bidi";
  source: string;
  scenario: string;
  note?: string;
  input: FixtureInput;
  output: FixtureOutput;
}

// ============================================================================
// Loader Functions
// ============================================================================

/**
 * Get the path to fixtures/frontend/ directory
 */
function getFixturesDir(): string {
  // Navigate from lib/tests/e2e-fixtures/helpers/ to fixtures/frontend/
  return join(__dirname, "../../../../fixtures/frontend");
}

/**
 * Load a fixture JSON file by name
 *
 * @param fixtureName - The fixture file name (e.g., "process_payment-approved-bidi-baseline.json")
 * @returns Typed fixture data
 *
 * @example
 * ```typescript
 * const fixture = loadFixture("process_payment-approved-bidi-baseline.json");
 * console.log(fixture.mode); // "bidi"
 * console.log(fixture.input.messages[0].content); // "次郎さんに200ドル送金してください"
 * ```
 */
export function loadFixture(fixtureName: string): FixtureData {
  const fixturePath = join(getFixturesDir(), fixtureName);
  const content = readFileSync(fixturePath, "utf-8");
  return JSON.parse(content) as FixtureData;
}

/**
 * Parse rawEvents from fixture into typed SSEEvent array
 *
 * @param rawEvents - Raw SSE event strings from fixture
 * @returns Array of parsed events (excluding [DONE] markers)
 *
 * @example
 * ```typescript
 * const fixture = loadFixture("process_payment-approved-bidi-baseline.json");
 * const events = parseRawEvents(fixture.output.rawEvents);
 * const approvalEvent = events.find(e => e.type === "tool-approval-request");
 * ```
 */
export function parseRawEvents(rawEvents: string[]): SSEEvent[] {
  const events: SSEEvent[] = [];

  for (const rawEvent of rawEvents) {
    // Each rawEvent is like "data: {...}\n\n"
    const lines = rawEvent.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("data: ")) {
        const event = parseSSEDataLine(trimmed);
        if (event) {
          events.push(event);
        }
      }
    }
  }

  return events;
}

// ============================================================================
// Event Extraction Helpers
// ============================================================================

/**
 * Find the first tool-approval-request event in parsed events
 */
export function findApprovalRequestEvent(
  events: SSEEvent[],
): SSEEvent | undefined {
  return events.find((e) => e.type === "tool-approval-request");
}

/**
 * Find all tool-approval-request events in parsed events
 */
export function findAllApprovalRequestEvents(events: SSEEvent[]): SSEEvent[] {
  return events.filter((e) => e.type === "tool-approval-request");
}

/**
 * Get events up to and including tool-approval-request
 * This represents what frontend receives before showing approval UI
 */
export function getEventsUntilApprovalRequest(events: SSEEvent[]): SSEEvent[] {
  const result: SSEEvent[] = [];
  for (const event of events) {
    result.push(event);
    if (event.type === "tool-approval-request") {
      break;
    }
  }
  return result;
}

/**
 * Get events after approval (from tool-output-available onwards)
 * This represents what frontend receives after user approves
 */
export function getEventsAfterApproval(events: SSEEvent[]): SSEEvent[] {
  let foundApproval = false;
  const result: SSEEvent[] = [];

  for (const event of events) {
    if (foundApproval) {
      result.push(event);
    }
    // In BIDI, approval response events come after finish-step
    // In SSE, they come in a separate request
    if (event.type === "finish-step" || event.type === "tool-output-available") {
      if (event.type === "tool-output-available") {
        foundApproval = true;
        result.push(event);
      } else if (event.type === "finish-step") {
        foundApproval = true;
      }
    }
  }

  return result;
}

/**
 * Split events for BIDI mode into approval phase and execution phase
 *
 * BIDI mode has a single stream with:
 * - Phase 1: start → tool-input-* → start-step → tool-approval-request → finish-step
 * - Phase 2: tool-output-available → text-* → finish
 */
export function splitBidiEventsForApprovalFlow(events: SSEEvent[]): {
  approvalPhase: SSEEvent[];
  executionPhase: SSEEvent[];
} {
  const approvalPhase: SSEEvent[] = [];
  const executionPhase: SSEEvent[] = [];
  let inExecutionPhase = false;

  for (const event of events) {
    if (event.type === "finish-step") {
      approvalPhase.push(event);
      inExecutionPhase = true;
      continue;
    }

    if (inExecutionPhase) {
      executionPhase.push(event);
    } else {
      approvalPhase.push(event);
    }
  }

  return { approvalPhase, executionPhase };
}

/**
 * Split events for SSE mode into request 1 and request 2
 *
 * SSE mode has two separate HTTP requests:
 * - Request 1: start → tool-input-* → tool-approval-request → finish → [DONE]
 * - Request 2: start → tool-output-available → text-* → finish → [DONE]
 */
export function splitSseEventsForApprovalFlow(rawEvents: string[]): {
  request1Events: SSEEvent[];
  request2Events: SSEEvent[];
} {
  const request1Events: SSEEvent[] = [];
  const request2Events: SSEEvent[] = [];
  let doneCount = 0;

  for (const rawEvent of rawEvents) {
    const lines = rawEvent.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === "data: [DONE]") {
        doneCount++;
        continue;
      }
      if (trimmed.startsWith("data: ")) {
        const event = parseSSEDataLine(trimmed);
        if (event) {
          if (doneCount === 0) {
            request1Events.push(event);
          } else {
            request2Events.push(event);
          }
        }
      }
    }
  }

  return { request1Events, request2Events };
}
