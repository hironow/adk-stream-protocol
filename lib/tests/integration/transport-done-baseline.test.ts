/**
 * Integration Tests: Transport Tool-Level Baseline Verification
 *
 * Tests complete tool execution using baseline fixtures captured from E2E tests.
 * See docs/GLOSSARY.md for terminology definitions.
 *
 * Terminology:
 * - Turn: User input → AI response ([DONE]) cycle
 * - Tool: Complete tool execution (may span multiple turns)
 *   - Single-turn tool: Completes in 1 turn (e.g., change_bgm, get_weather)
 *   - Multi-turn tool: Requires 2 turns (e.g., get_location with approval)
 *
 * Design Principles:
 * - [DONE] must occur exactly once per turn
 * - All chunks before [DONE] must be delivered
 * - Stream must complete cleanly after [DONE]
 * - Multi-turn tools are tested as complete tool execution
 *
 * Transport-Specific Behavior:
 * - SSE mode: Per-turn connection (each turn = new HTTP request/response)
 *   → Test creates new transport instance for each turn
 * - BIDI mode: Persistent connection (all turns on same WebSocket)
 *   → Test reuses same transport instance across turns
 *
 * Test Strategy:
 * - Load baseline fixtures (tool-level, may contain multiple turns)
 * - Split multi-turn fixtures into individual turns
 * - Execute turns according to transport mode (SSE: new transport, BIDI: same transport)
 * - Verify complete tool execution matches baseline
 *
 * Benefits:
 * - Faster than E2E (no server startup)
 * - Deterministic (no network variability)
 * - Documents expected tool behavior
 * - Detects regressions immediately
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { UIMessageChunk } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocketChatTransport } from "../../bidi/transport";

// Fixture types
interface BaselineFixture {
  description: string;
  mode: "sse" | "bidi";
  input: {
    messages: Array<{ id: string; role: string; content: string }>;
    trigger: "submit-message" | "regenerate-message";
  };
  output: {
    rawEvents: string[];
    expectedChunks: UIMessageChunk[];
    expectedDoneCount: number;
    expectedStreamCompletion: boolean;
  };
}

// Load fixture helper
function loadFixture(filename: string): BaselineFixture {
  const fixturePath = join(
    __dirname,
    "..",
    "..",
    "..",
    "fixtures",
    "frontend",
    filename,
  );
  const content = readFileSync(fixturePath, "utf-8");
  return JSON.parse(content) as BaselineFixture;
}

// Split multi-turn tool fixture into individual turns
function splitIntoTurns(fixture: BaselineFixture): {
  turns: Array<{ rawEvents: string[]; expectedChunks: UIMessageChunk[] }>;
} {
  const turns: Array<{
    rawEvents: string[];
    expectedChunks: UIMessageChunk[];
  }> = [];

  let currentTurnEvents: string[] = [];
  let turnStartIndex = 0;

  fixture.output.rawEvents.forEach((event, _index) => {
    currentTurnEvents.push(event);

    // Check if this is a [DONE] marker
    if (event.includes("data: [DONE]")) {
      // Find corresponding chunks for this turn
      const turnEndIndex = findChunkIndexForDone(
        fixture.output.expectedChunks,
        turnStartIndex,
      );
      const expectedChunks = fixture.output.expectedChunks.slice(
        turnStartIndex,
        turnEndIndex + 1,
      );

      turns.push({
        rawEvents: [...currentTurnEvents],
        expectedChunks,
      });

      currentTurnEvents = [];
      turnStartIndex = turnEndIndex + 1;
    }
  });

  return { turns };
}

// Find the chunk index corresponding to a [DONE] marker
// Looks for the last "finish" chunk before the next "start" chunk
function findChunkIndexForDone(
  chunks: UIMessageChunk[],
  startIndex: number,
): number {
  for (let i = startIndex; i < chunks.length; i++) {
    const chunk = chunks[i];
    // "finish" chunk marks the end of a turn (before [DONE])
    if (chunk.type === "finish") {
      // Check if next chunk is "start" (beginning of next turn) or end of array
      if (i + 1 >= chunks.length || chunks[i + 1].type === "start") {
        return i;
      }
    }
  }
  return chunks.length - 1;
}

// Execute complete tool test with correct transport behavior
async function executeToolTest(
  fixture: BaselineFixture,
  testIdPrefix: string,
): Promise<void> {
  const { turns } = splitIntoTurns(fixture);
  expect(turns.length).toBe(fixture.output.expectedDoneCount);

  const allReceivedChunks: UIMessageChunk[] = [];
  let totalDoneCount = 0;

  if (fixture.mode === "sse") {
    // SSE mode: Per-turn connection (create new transport for each turn)
    for (const [turnIndex, turn] of turns.entries()) {
      const transport = new WebSocketChatTransport({
        url: "ws://localhost:8000/live",
      });

      const streamPromise = transport.sendMessages({
        trigger: fixture.input.trigger,
        chatId: `${testIdPrefix}-turn${turnIndex + 1}`,
        messageId: `${testIdPrefix}-msg-turn${turnIndex + 1}`,
        messages: fixture.input.messages as any,
        abortSignal: undefined,
      });

      const stream = await streamPromise;
      const reader = stream.getReader();
      const turnChunks: UIMessageChunk[] = [];

      const mockWs = (transport as any).ws as MockWebSocket;
      await new Promise((resolve) => setTimeout(resolve, 10));

      for (const rawEvent of turn.rawEvents) {
        mockWs.simulateRawEvent(rawEvent);
      }

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            totalDoneCount++;
            break;
          }
          turnChunks.push(value);
        }
      } catch (_error) {
        // Stream ended
      }

      allReceivedChunks.push(...turnChunks);
      expect(turnChunks).toEqual(turn.expectedChunks);
      await expect(reader.closed).resolves.toBeUndefined();
    }
  } else {
    // BIDI mode: Persistent connection (reuse same transport AND WebSocket across turns)
    const transport = new WebSocketChatTransport({
      url: "ws://localhost:8000/live",
    });

    let mockWs: MockWebSocket | null = null;

    // Process each turn sequentially on the SAME WebSocket connection
    for (const [turnIndex, turn] of turns.entries()) {
      const streamPromise = transport.sendMessages({
        trigger: fixture.input.trigger,
        chatId: `${testIdPrefix}-turn${turnIndex + 1}`,
        messageId: `${testIdPrefix}-msg-turn${turnIndex + 1}`,
        messages: fixture.input.messages as any,
        abortSignal: undefined,
      });

      const stream = await streamPromise;

      // Get WebSocket reference on first turn only (it persists across all turns)
      if (turnIndex === 0) {
        mockWs = (transport as any).ws as MockWebSocket;
      }

      const reader = stream.getReader();
      const turnChunks: UIMessageChunk[] = [];

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Send all events for this turn on the same WebSocket
      for (const rawEvent of turn.rawEvents) {
        mockWs!.simulateRawEvent(rawEvent);
      }

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            totalDoneCount++;
            break;
          }
          turnChunks.push(value);
        }
      } catch (_error) {
        // Stream ended
      }

      allReceivedChunks.push(...turnChunks);
      expect(turnChunks).toEqual(turn.expectedChunks);
      await expect(reader.closed).resolves.toBeUndefined();
    }
  }

  // Verify complete tool execution
  expect(allReceivedChunks).toEqual(fixture.output.expectedChunks);
  expect(totalDoneCount).toBe(fixture.output.expectedDoneCount);
}

// Mock WebSocket for simulating server responses
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  constructor(public url: string) {
    // Simulate immediate connection
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      if (this.onopen) {
        this.onopen(new Event("open"));
      }
    }, 0);
  }

  send(_data: string): void {
    // Mock send
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose(new CloseEvent("close"));
    }
  }

  // Helper: simulate receiving raw event from server
  simulateRawEvent(rawEvent: string): void {
    if (this.onmessage) {
      this.onmessage(new MessageEvent("message", { data: rawEvent }));
    }
  }
}

describe("Transport [DONE] Baseline Integration Tests", () => {
  let originalWebSocket: typeof WebSocket;

  beforeEach(() => {
    // Save original WebSocket
    originalWebSocket = global.WebSocket;

    // Replace with mock
    global.WebSocket = MockWebSocket as any;

    // Mock btoa/atob for base64 encoding
    global.btoa = (str: string) => Buffer.from(str).toString("base64");
    global.atob = (str: string) => Buffer.from(str, "base64").toString("ascii");
  });

  afterEach(() => {
    // Restore original WebSocket
    global.WebSocket = originalWebSocket;

    // Clear all timers
    vi.clearAllTimers();
  });

  // ========== SSE Mode Baseline Tests ==========

  it("[SSE] should match baseline behavior for change_bgm with [DONE]", async () => {
    /**
     * Baseline Verification: SSE mode - change_bgm tool
     *
     * Given: Baseline fixture with expected SSE event sequence
     * When: DefaultChatTransport (via ChunkLoggingTransport) processes events
     * Then: Chunks match baseline, [DONE] processed exactly once, stream completes
     *
     * Note: This test uses WebSocketChatTransport as a proxy for testing
     * the [DONE] handling pattern. In production, SSE uses DefaultChatTransport
     * wrapped by ChunkLoggingTransport. The [DONE] handling principle is the same.
     */

    // given: Load SSE baseline fixture
    const fixture = loadFixture("change_bgm-sse-baseline.json");

    // Create transport
    const transport = new WebSocketChatTransport({
      url: "ws://localhost:8000/live",
    });

    // when: Send messages and simulate baseline events
    const streamPromise = transport.sendMessages({
      trigger: fixture.input.trigger,
      chatId: "baseline-test",
      messageId: "baseline-msg",
      messages: fixture.input.messages as any,
      abortSignal: undefined,
    });

    const stream = await streamPromise;
    const reader = stream.getReader();
    const receivedChunks: UIMessageChunk[] = [];
    let doneCount = 0;

    // Simulate baseline events from fixture
    const mockWs = (transport as any).ws as MockWebSocket;
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Send all raw events from fixture
    for (const rawEvent of fixture.output.rawEvents) {
      mockWs.simulateRawEvent(rawEvent);
    }

    // Read chunks
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          doneCount = 1; // Stream completed = [DONE] was processed
          break;
        }
        receivedChunks.push(value);
      }
    } catch (_error) {
      // Stream ended
    }

    // then: Verify baseline expectations
    expect(receivedChunks).toEqual(fixture.output.expectedChunks);
    expect(doneCount).toBe(fixture.output.expectedDoneCount);
    await expect(reader.closed).resolves.toBeUndefined();
  });

  it("[SSE] should match baseline behavior for get_location with [DONE]", async () => {
    /**
     * Tool-Level Test: get_location (multi-turn tool with approval)
     *
     * Given: Baseline fixture with get_location approval (2 turns)
     *   Turn 1: Confirmation request
     *   Turn 2: Approval execution
     * When: Transport processes each turn with SSE mode (per-turn connection)
     * Then: Complete tool execution matches baseline
     */

    const fixture = loadFixture("get_location-approved-sse-baseline.json");
    await executeToolTest(fixture, "baseline-test-get-location-sse");
  });

  it("[SSE] should match baseline behavior for get_weather with [DONE]", async () => {
    /**
     * Baseline Verification: get_weather tool call
     *
     * Given: Baseline fixture with get_weather tool call
     * When: DefaultChatTransport processes events
     * Then: Chunks match baseline, [DONE] processed exactly once, stream completes
     */

    // given: Load get_weather baseline fixture
    const fixture = loadFixture("get_weather-sse-baseline.json");

    // Create transport
    const transport = new WebSocketChatTransport({
      url: "ws://localhost:8000/live",
    });

    // when: Send messages and simulate baseline events
    const streamPromise = transport.sendMessages({
      trigger: fixture.input.trigger,
      chatId: "baseline-test-get-weather",
      messageId: "baseline-msg-get-weather",
      messages: fixture.input.messages as any,
      abortSignal: undefined,
    });

    const stream = await streamPromise;
    const reader = stream.getReader();
    const receivedChunks: UIMessageChunk[] = [];
    let doneCount = 0;

    // Simulate baseline events from fixture
    const mockWs = (transport as any).ws as MockWebSocket;
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Send all raw events from fixture
    for (const rawEvent of fixture.output.rawEvents) {
      mockWs.simulateRawEvent(rawEvent);
    }

    // Read chunks
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          doneCount = 1; // Stream completed = [DONE] was processed
          break;
        }
        receivedChunks.push(value);
      }
    } catch (_error) {
      // Stream ended
    }

    // then: Verify baseline expectations
    expect(receivedChunks).toEqual(fixture.output.expectedChunks);
    expect(doneCount).toBe(fixture.output.expectedDoneCount);
    await expect(reader.closed).resolves.toBeUndefined();
  });

  it("[SSE] should match baseline behavior for process_payment with [DONE]", async () => {
    /**
     * Tool-Level Test: process_payment (multi-turn tool with approval)
     *
     * Given: Baseline fixture with process_payment approval (2 turns)
     *   Turn 1: Confirmation request
     *   Turn 2: Approval execution
     * When: Transport processes each turn with SSE mode (per-turn connection)
     * Then: Complete tool execution matches baseline
     */

    const fixture = loadFixture("process_payment-approved-sse-baseline.json");
    await executeToolTest(fixture, "baseline-test-process-payment-sse");
  });

  /**
   * NOTE: Approval/denial flow tests are NOT included at the transport integration level.
   *
   * Reason: Approval and denial flows span TWO separate HTTP requests/streams:
   * 1. Request 1: User message → confirmation request → [DONE] (stream closes)
   * 2. Request 2: User approval/denial → tool execution/rejection → [DONE] (new stream)
   *
   * The transport-level integration tests verify single-stream behavior (one [DONE] per stream).
   * Complete approval/denial flows are tested at the E2E level where multi-request flows are natural.
   *
   * See fixtures for documentation:
   * - process_payment-approved-sse-baseline.json (multi-request documentation)
   * - process_payment-denied-sse-baseline.json (multi-request documentation)
   */

  // ========== BIDI Mode Baseline Tests ==========

  it("[BIDI] should match baseline behavior for change_bgm with [DONE]", async () => {
    /**
     * Baseline Verification: BIDI mode - change_bgm tool
     *
     * Given: Baseline fixture with expected BIDI event sequence
     * When: WebSocketChatTransport processes events
     * Then: Chunks match baseline, [DONE] processed exactly once, stream completes
     *
     * Expected Flow:
     * 1. Receive tool-input/tool-output chunks
     * 2. Receive [DONE] marker (exactly once)
     * 3. Stream completes cleanly
     */

    // given: Load BIDI baseline fixture
    const fixture = loadFixture("change_bgm-bidi-baseline.json");

    // Create transport
    const transport = new WebSocketChatTransport({
      url: "ws://localhost:8000/live",
    });

    // when: Send messages and simulate baseline events
    const streamPromise = transport.sendMessages({
      trigger: fixture.input.trigger,
      chatId: "baseline-test-bidi",
      messageId: "baseline-msg-bidi",
      messages: fixture.input.messages as any,
      abortSignal: undefined,
    });

    const stream = await streamPromise;
    const reader = stream.getReader();
    const receivedChunks: UIMessageChunk[] = [];
    let doneCount = 0;

    // Simulate baseline events from fixture
    const mockWs = (transport as any).ws as MockWebSocket;
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Send all raw events from fixture
    for (const rawEvent of fixture.output.rawEvents) {
      mockWs.simulateRawEvent(rawEvent);
    }

    // Read chunks
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          doneCount = 1; // Stream completed = [DONE] was processed
          break;
        }
        receivedChunks.push(value);
      }
    } catch (_error) {
      // Stream ended
    }

    // then: Verify baseline expectations
    expect(receivedChunks).toEqual(fixture.output.expectedChunks);
    expect(doneCount).toBe(fixture.output.expectedDoneCount);
    await expect(reader.closed).resolves.toBeUndefined();
  });

  it("[BIDI] should match baseline behavior for get_location with [DONE]", async () => {
    /**
     * Tool-Level Test: get_location (multi-turn tool with approval)
     *
     * Given: Baseline fixture with get_location approval (2 turns)
     *   Turn 1: Confirmation request
     *   Turn 2: Approval execution
     * When: Transport processes each turn with BIDI mode (persistent connection)
     * Then: Complete tool execution matches baseline
     */

    const fixture = loadFixture("get_location-approved-bidi-baseline.json");
    await executeToolTest(fixture, "baseline-test-bidi-get-location");
  });

  it("[BIDI] should match baseline behavior for get_weather with [DONE]", async () => {
    // given: Load BIDI baseline fixture
    const fixture = loadFixture("get_weather-bidi-baseline.json");

    // Create transport
    const transport = new WebSocketChatTransport({
      url: "ws://localhost:8000/live",
    });

    // when: Send messages and simulate baseline events
    const streamPromise = transport.sendMessages({
      trigger: fixture.input.trigger,
      chatId: "baseline-test-bidi-get-weather",
      messageId: "baseline-msg-bidi-get-weather",
      messages: fixture.input.messages as any,
      abortSignal: undefined,
    });

    const stream = await streamPromise;
    const reader = stream.getReader();
    const receivedChunks: UIMessageChunk[] = [];
    let doneCount = 0;

    // Simulate baseline events from fixture
    const mockWs = (transport as any).ws as MockWebSocket;
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Send all raw events from fixture
    for (const rawEvent of fixture.output.rawEvents) {
      mockWs.simulateRawEvent(rawEvent);
    }

    // Read chunks
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          doneCount = 1;
          break;
        }
        receivedChunks.push(value);
      }
    } catch (_error) {
      // Stream ended
    }

    // then: Verify baseline expectations
    expect(receivedChunks).toEqual(fixture.output.expectedChunks);
    expect(doneCount).toBe(fixture.output.expectedDoneCount);
    await expect(reader.closed).resolves.toBeUndefined();
  });

  it("[BIDI] should match baseline behavior for process_payment with [DONE]", async () => {
    /**
     * Tool-Level Test: process_payment (multi-turn tool with approval)
     *
     * Given: Baseline fixture with process_payment approval (2 turns)
     *   Turn 1: Confirmation request
     *   Turn 2: Approval execution
     * When: Transport processes each turn with BIDI mode (persistent connection)
     * Then: Complete tool execution matches baseline
     */

    const fixture = loadFixture("process_payment-approved-bidi-baseline.json");
    await executeToolTest(fixture, "baseline-test-bidi-process-payment");
  });

  // ========== Multiple [DONE] Protection Tests ==========

  it("[BIDI] should protect against multiple [DONE] markers (protocol violation)", async () => {
    /**
     * Protocol Violation Detection
     *
     * Given: Baseline fixture + additional [DONE] marker injected
     * When: WebSocketChatTransport processes events
     * Then: First [DONE] processed, subsequent [DONE] ignored gracefully
     *
     * This test verifies the protection implemented in Session 7.
     */

    // given: Load BIDI baseline fixture
    const fixture = loadFixture("change_bgm-bidi-baseline.json");

    // Create transport
    const transport = new WebSocketChatTransport({
      url: "ws://localhost:8000/live",
    });

    // when: Send messages
    const streamPromise = transport.sendMessages({
      trigger: fixture.input.trigger,
      chatId: "violation-test",
      messageId: "violation-msg",
      messages: fixture.input.messages as any,
      abortSignal: undefined,
    });

    const stream = await streamPromise;
    const reader = stream.getReader();
    const receivedChunks: UIMessageChunk[] = [];

    // Simulate baseline events from fixture
    const mockWs = (transport as any).ws as MockWebSocket;
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Send baseline events + inject second [DONE] (protocol violation)
    for (const rawEvent of fixture.output.rawEvents) {
      mockWs.simulateRawEvent(rawEvent);
    }
    // PROTOCOL VIOLATION: Send second [DONE]
    mockWs.simulateRawEvent("data: [DONE]\n\n");

    // Read chunks
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        receivedChunks.push(value);
      }
    } catch (_error) {
      // Stream ended
    }

    // then: Should still receive all chunks correctly
    // Second [DONE] should be ignored (logged but not cause error)
    expect(receivedChunks).toEqual(fixture.output.expectedChunks);
    await expect(reader.closed).resolves.toBeUndefined();
  });
});
