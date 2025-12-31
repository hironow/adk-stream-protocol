/**
 * Integration Test: Verify onToolCall is NOT Used (ADR 0002)
 *
 * ADR 0002 establishes the Tool Approval Architecture with Backend Delegation:
 * - Tool execution happens on the BACKEND (Server Execute pattern)
 * - Frontend uses addToolOutput() and addToolApprovalResponse() for approval UI
 * - Frontend does NOT use onToolCall callback (that would be Frontend Execute pattern)
 *
 * This negative test verifies that our useChat configuration does NOT include
 * onToolCall, ensuring we follow the Server Execute pattern.
 *
 * Why onToolCall is NOT used:
 * - onToolCall executes tools in the frontend (Frontend Execute pattern)
 * - Our architecture requires backend execution for security and control
 * - Approval requests come from backend, frontend only handles UI
 *
 * Related:
 * - ADR 0002: Tool Approval Architecture with Backend Delegation
 * - lib/sse/index.ts: buildUseChatOptions (SSE)
 * - lib/bidi/index.ts: buildUseChatOptions (BIDI)
 *
 * @vitest-environment jsdom
 */

import { describe, expect, it } from "vitest";
import { buildUseChatOptions as buildBidiOptions } from "../../bidi";
import { buildUseChatOptions as buildSseOptions } from "../../sse";

describe("ADR 0002: Verify onToolCall is NOT Used", () => {
  it("SSE mode: useChatOptions does NOT include onToolCall", () => {
    // Given: SSE mode configuration
    const { useChatOptions } = buildSseOptions({
      initialMessages: [],
      adkBackendUrl: "http://localhost:8000",
      forceNewInstance: true,
    });

    // Then: Verify onToolCall is NOT configured
    expect(useChatOptions.onToolCall).toBeUndefined();

    console.log(
      "[SSE Mode] ✓ onToolCall is undefined (Server Execute pattern)",
    );
    console.log(
      "[SSE Mode] ✓ Tool execution handled by backend, not frontend",
    );
  });

  it("BIDI mode: useChatOptions does NOT include onToolCall", () => {
    // Given: BIDI mode configuration
    const { useChatOptions } = buildBidiOptions({
      initialMessages: [],
      adkBackendUrl: "http://localhost:8000",
      forceNewInstance: true,
    });

    // Then: Verify onToolCall is NOT configured
    expect(useChatOptions.onToolCall).toBeUndefined();

    console.log(
      "[BIDI Mode] ✓ onToolCall is undefined (Server Execute pattern)",
    );
    console.log(
      "[BIDI Mode] ✓ Tool execution handled by backend, not frontend",
    );
  });

  it("Architecture validation: Frontend uses approval APIs, not execution callbacks", () => {
    /**
     * This test documents the architectural decision (ADR 0002):
     *
     * Frontend Execute Pattern (NOT used):
     * ❌ onToolCall: async (call) => { ... execute tool locally ... }
     * ❌ Frontend executes tools and returns results directly
     *
     * Server Execute Pattern (USED):
     * ✅ Backend sends tool-approval-request via SSE/BIDI
     * ✅ Frontend calls addToolApprovalResponse({ id, approved })
     * ✅ Backend executes tool and returns tool-output-available
     *
     * Benefits of Server Execute:
     * - Security: Tools execute in controlled backend environment
     * - Consistency: Same tool logic for all clients
     * - Approval flow: Backend can enforce approval requirements
     * - Audit trail: Backend logs all tool executions
     */

    const { useChatOptions: sseOptions } = buildSseOptions({
      initialMessages: [],
      adkBackendUrl: "http://localhost:8000",
      forceNewInstance: true,
    });

    const { useChatOptions: bidiOptions } = buildBidiOptions({
      initialMessages: [],
      adkBackendUrl: "http://localhost:8000",
      forceNewInstance: true,
    });

    // Verify neither mode uses onToolCall
    expect(sseOptions.onToolCall).toBeUndefined();
    expect(bidiOptions.onToolCall).toBeUndefined();

    console.log("✓ Both SSE and BIDI modes use Server Execute pattern");
    console.log("✓ onToolCall callback is not configured in either mode");
    console.log("✓ Tools execute on backend with approval flow");
  });

  it("Negative test: If onToolCall were present, it would break approval flow", () => {
    /**
     * This test documents what would happen if onToolCall were mistakenly added.
     *
     * If onToolCall exists:
     * - AI SDK would execute tools locally in frontend
     * - tool-approval-request from backend would be ignored
     * - addToolApprovalResponse() would have no effect
     * - Backend approval flow would be bypassed
     *
     * This is why we verify onToolCall is NOT present.
     */

    const { useChatOptions: sseOptions } = buildSseOptions({
      initialMessages: [],
      adkBackendUrl: "http://localhost:8000",
      forceNewInstance: true,
    });

    const { useChatOptions: bidiOptions } = buildBidiOptions({
      initialMessages: [],
      adkBackendUrl: "http://localhost:8000",
      forceNewInstance: true,
    });

    // CRITICAL: onToolCall must be undefined to preserve approval flow
    expect(sseOptions.onToolCall).toBeUndefined();
    expect(bidiOptions.onToolCall).toBeUndefined();

    console.log(
      "✓ Verified: onToolCall absence preserves backend approval flow",
    );
    console.log("✓ Frontend cannot bypass backend tool execution");
    console.log("✓ All tool calls go through backend approval process");
  });
});
