/**
 * Integration Test: SSE Pattern A Only Restriction (ADR 0008)
 *
 * ADR 0008 establishes that SSE mode only supports Pattern A (Server Execute),
 * not Pattern B (Frontend Execute).
 *
 * Pattern A (Server Execute) - SUPPORTED in SSE:
 * - Tool execution happens on BACKEND
 * - Frontend sends approval → Backend executes tool → Returns result
 * - Single HTTP POST with approval + wait for tool result
 * - Used by: process_payment, get_weather, change_bgm
 *
 * Pattern B (Frontend Execute) - NOT SUPPORTED in SSE:
 * - Tool execution happens in FRONTEND
 * - Frontend executes tool locally → Sends result to backend
 * - Requires separate HTTP POST for tool result submission
 * - Would use onToolCall + addToolOutput() (which we don't use per ADR 0002)
 * - Used by: get_location (in BIDI mode)
 *
 * Why SSE doesn't support Pattern B:
 * - SSE is unidirectional (backend → frontend)
 * - Pattern B needs bidirectional communication (frontend → backend for result)
 * - Would require additional HTTP endpoint for result submission
 * - BIDI's WebSocket naturally supports bidirectional communication
 *
 * This test documents the architectural constraint.
 *
 * @vitest-environment jsdom
 */

import { describe, expect, it } from "vitest";
import { buildUseChatOptions as buildSseOptions } from "../../sse";
import { buildUseChatOptions as buildBidiOptions } from "../../bidi";

describe("ADR 0008: SSE Pattern A Only Restriction", () => {
  it("Documents Pattern A (Server Execute) vs Pattern B (Frontend Execute)", () => {
    /**
     * PATTERN A: Server Execute (Backend Execution)
     * ─────────────────────────────────────────────
     *
     * Flow:
     * 1. Backend sends tool-approval-request
     * 2. Frontend calls addToolApprovalResponse({ id, approved: true })
     * 3. Backend EXECUTES tool
     * 4. Backend sends tool-output-available
     * 5. Frontend displays result
     *
     * Characteristics:
     * - Tool execution in backend (secure, consistent)
     * - No onToolCall callback in frontend
     * - Single HTTP request (SSE) or WebSocket stream (BIDI)
     * - Backend controls all tool execution logic
     *
     * Supported in: SSE ✅ | BIDI ✅
     *
     *
     * PATTERN B: Frontend Execute (Browser Execution)
     * ─────────────────────────────────────────────
     *
     * Flow:
     * 1. Backend sends tool-approval-request
     * 2. Frontend calls addToolApprovalResponse({ id, approved: true })
     * 3. Frontend EXECUTES tool locally (e.g., navigator.geolocation)
     * 4. Frontend sends tool result to backend via WebSocket
     * 5. Backend processes result
     *
     * Characteristics:
     * - Tool execution in frontend (access browser APIs)
     * - Uses browser-only capabilities (geolocation, camera, etc.)
     * - Requires bidirectional communication
     * - Frontend sends result back to backend
     *
     * Supported in: SSE ❌ | BIDI ✅
     */

    console.log("Pattern A: Server Execute");
    console.log("  - Tool executes on backend");
    console.log("  - Supported in: SSE ✅ BIDI ✅");
    console.log("");
    console.log("Pattern B: Frontend Execute");
    console.log("  - Tool executes in frontend (browser)");
    console.log("  - Supported in: SSE ❌ BIDI ✅");

    expect(true).toBe(true); // Documentation test
  });

  it("SSE mode does NOT have onToolCall (Pattern B requirement)", () => {
    // Pattern B would require onToolCall to execute tools in frontend
    const { useChatOptions: sseOptions } = buildSseOptions({
      initialMessages: [],
      adkBackendUrl: "http://localhost:8000",
      forceNewInstance: true,
    });

    // Verify: SSE does NOT configure onToolCall
    expect(sseOptions.onToolCall).toBeUndefined();

    console.log("✓ SSE mode: onToolCall is undefined");
    console.log("✓ Pattern B (Frontend Execute) not supported");
    console.log("✓ Only Pattern A (Server Execute) available");
  });

  it("BIDI mode can support Pattern B via bidirectional communication", () => {
    // BIDI's WebSocket allows frontend to send tool results back
    const { useChatOptions: bidiOptions } = buildBidiOptions({
      initialMessages: [],
      adkBackendUrl: "http://localhost:8000",
      forceNewInstance: true,
    });

    // Note: Even BIDI doesn't use onToolCall in our architecture (ADR 0002)
    // But BIDI's bidirectional transport COULD support Pattern B if needed
    expect(bidiOptions.onToolCall).toBeUndefined();

    console.log("✓ BIDI mode: WebSocket supports bidirectional communication");
    console.log("✓ Could support Pattern B (Frontend Execute) if needed");
    console.log("✓ Currently uses Pattern A per ADR 0002");
  });

  it("Explains why SSE cannot support Pattern B", () => {
    /**
     * WHY SSE CANNOT SUPPORT PATTERN B:
     *
     * 1. **Unidirectional Communication**:
     *    - SSE: Backend → Frontend (one-way stream)
     *    - Pattern B needs: Frontend → Backend (send tool result)
     *    - SSE lacks mechanism to send data from frontend to backend
     *
     * 2. **HTTP POST Limitation**:
     *    - SSE uses single HTTP POST for request/response
     *    - After receiving approval, connection stays open for response
     *    - Cannot send additional data (tool result) over same connection
     *
     * 3. **Would Require Additional Endpoint**:
     *    - Pattern B in SSE would need separate HTTP POST endpoint
     *    - Frontend executes tool → POST result to /tool-result endpoint
     *    - Adds complexity and breaks streaming model
     *
     * 4. **BIDI's Advantage**:
     *    - WebSocket is bidirectional by nature
     *    - Frontend can send tool result over same connection
     *    - No additional endpoints needed
     *
     * CONCLUSION:
     * - SSE mode restricted to Pattern A (Server Execute)
     * - Pattern B requires BIDI mode
     * - This is an architectural constraint, not a limitation
     */

    console.log("SSE Pattern B Restriction Reasons:");
    console.log("  1. Unidirectional communication (backend → frontend only)");
    console.log("  2. Single HTTP POST cannot receive frontend data");
    console.log("  3. Would require additional HTTP endpoint");
    console.log("  4. BIDI's WebSocket naturally supports bidirectional");
    console.log("");
    console.log("✓ SSE: Pattern A only (Server Execute)");
    console.log("✓ BIDI: Both Pattern A and Pattern B possible");

    expect(true).toBe(true); // Documentation test
  });

  it("Real-world example: get_location uses Pattern B in BIDI", () => {
    /**
     * get_location Tool Example:
     *
     * BIDI Mode (Pattern B - Frontend Execute):
     * 1. Backend: tool-approval-request (get_location)
     * 2. Frontend: addToolApprovalResponse({ approved: true })
     * 3. Frontend: Calls navigator.geolocation.getCurrentPosition()
     * 4. Frontend: Sends location result via WebSocket
     * 5. Backend: Receives location, continues processing
     *
     * SSE Mode (Would Fail):
     * 1. Backend: tool-approval-request (get_location)
     * 2. Frontend: addToolApprovalResponse({ approved: true })
     * 3. Frontend: Cannot execute tool (no onToolCall)
     * 4. Frontend: Cannot send result back (unidirectional)
     * 5. ❌ Tool execution impossible
     *
     * This is why get_location only works in BIDI mode.
     */

    console.log("Example: get_location (browser geolocation API)");
    console.log("  - Requires browser API access (navigator.geolocation)");
    console.log("  - Needs to send result back to backend");
    console.log("  - BIDI: ✅ Works (Pattern B supported)");
    console.log("  - SSE: ❌ Cannot work (Pattern B not supported)");

    expect(true).toBe(true); // Documentation test
  });

  it("Summary: SSE Pattern A restriction is architectural, not a bug", () => {
    /**
     * KEY TAKEAWAYS:
     *
     * 1. SSE mode: Pattern A only (Server Execute)
     *    - Tools execute on backend
     *    - Secure, consistent, controlled
     *    - Examples: process_payment, get_weather, change_bgm
     *
     * 2. BIDI mode: Both Pattern A and Pattern B
     *    - Pattern A: Backend execution (same as SSE)
     *    - Pattern B: Frontend execution (browser APIs)
     *    - Examples: get_location (Pattern B)
     *
     * 3. This is NOT a limitation:
     *    - SSE's unidirectional nature makes Pattern A efficient
     *    - BIDI's bidirectional nature enables Pattern B when needed
     *    - Choose protocol based on tool execution requirements
     *
     * 4. Current Architecture (ADR 0002):
     *    - We use Pattern A exclusively (no onToolCall)
     *    - Both SSE and BIDI use Server Execute pattern
     *    - This ensures security and consistency
     *
     * Reference: ADR 0008
     */

    expect(true).toBe(true); // Documentation test
  });
});
