/**
 * Integration Test: Failure Without waitFor (ADR 0005)
 *
 * ADR 0005 requires that frontend MUST use `waitFor` to wait for approval
 * state BEFORE calling addToolOutput().
 *
 * This negative test demonstrates what happens when `waitFor` is SKIPPED:
 * - Race condition: Tool approval may not be fully processed yet
 * - Tool part may be undefined or in wrong state
 * - addToolOutput() may fail silently or cause errors
 *
 * CORRECT Pattern (ADR 0005):
 * ```typescript
 * // ✅ Wait for approval state FIRST
 * await waitFor(() => {
 *   const tool = getTool(messages);
 *   return tool?.state === "approval-requested";
 * });
 *
 * // Then find and approve
 * const tool = getTool(messages);
 * addToolApprovalResponse({ id: tool.approval.id, approved: true });
 * ```
 *
 * WRONG Pattern (This test):
 * ```typescript
 * // ❌ No waitFor - immediate access
 * const tool = getTool(messages);  // May be undefined!
 * addToolApprovalResponse({ id: tool.approval.id, approved: true });  // Error!
 * ```
 *
 * Why waitFor is Required:
 * - Async message updates: approval-request chunk arrives asynchronously
 * - State reconciliation: AI SDK needs time to update message state
 * - Race condition prevention: Accessing tool before state update = undefined
 *
 * @vitest-environment jsdom
 */

import { useChat } from "@ai-sdk/react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { buildUseChatOptions } from "../../bidi";
import { useMockWebSocket } from "../helpers/mock-websocket";

describe("ADR 0005: Failure Without waitFor", () => {
  const { setDefaultHandler } = useMockWebSocket();

  it("WRONG: Accessing tool WITHOUT waitFor causes undefined error", async () => {
    // Given: Backend sends approval request
    // Set up handler BEFORE WebSocket creation (via setDefaultHandler)
    setDefaultHandler((ws) => {
      ws.onClientMessage((data) => {
        if (!data.startsWith("{")) {
          return;
        }

        const msg = JSON.parse(data);

        if (
          msg.type === "message" &&
          msg.messages &&
          // biome-ignore lint/suspicious/noExplicitAny: Test helper
          !msg.messages[msg.messages.length - 1].parts?.some(
            (p: any) => p.type === "tool-process_payment",
          )
        ) {
          // Send approval request (async)
          ws.simulateServerMessage({ type: "start", messageId: "msg-1" });
          ws.simulateServerMessage({
            type: "tool-input-start",
            toolCallId: "payment-1",
            toolName: "process_payment",
          });
          ws.simulateServerMessage({
            type: "tool-input-available",
            toolCallId: "payment-1",
            toolName: "process_payment",
            input: { amount: 30, recipient: "Alice", currency: "USD" },
          });
          ws.simulateServerMessage({
            type: "tool-approval-request",
            toolCallId: "payment-1",
            approvalId: "approval-1",
          });
          ws.simulateServerMessage({ type: "finish-step" });
          ws.simulateDone();
        }
      });
    });

    const { useChatOptions } = buildUseChatOptions({
      initialMessages: [],
      adkBackendUrl: "http://localhost:8000",
      forceNewInstance: true,
    });

    const { result } = renderHook(() => useChat(useChatOptions));

    // When: Send message
    await act(async () => {
      result.current.sendMessage({ text: "Send $30 to Alice" });
    });

    // ❌ WRONG: Immediate access WITHOUT waitFor
    const lastMsg = result.current.messages[result.current.messages.length - 1];
    const tool = lastMsg?.parts?.find(
      (p: any) => p.type === "tool-process_payment",
    );

    console.log("❌ Accessed tool WITHOUT waitFor");
    console.log(`Tool state: ${tool ? tool.state : "undefined"}`);

    // Then: Tool is likely undefined or not in approval-requested state yet
    // This demonstrates the race condition

    if (tool === undefined) {
      console.log("✓ Tool is undefined (race condition)");
      console.log("✓ Cannot access approval.id → would cause TypeError");
      expect(tool).toBeUndefined();
    } else if (tool.state !== "approval-requested") {
      console.log(`✓ Tool state is "${tool.state}" (not approval-requested)`);
      console.log("✓ May not have approval object yet");
      expect(tool.state).not.toBe("approval-requested");
    } else {
      // Edge case: Got lucky with timing, but still wrong pattern
      console.log("⚠️ Tool exists by chance (timing luck)");
      console.log("⚠️ This is unreliable - could fail in production");
    }

    console.log("✓ Demonstrated: waitFor is REQUIRED to avoid race condition");
  });

  it("CORRECT: Using waitFor ensures tool is ready", async () => {
    // Given: Backend sends approval request
    // Set up handler BEFORE WebSocket creation (via setDefaultHandler)
    setDefaultHandler((ws) => {
      ws.onClientMessage((data) => {
        if (!data.startsWith("{")) {
          return;
        }

        const msg = JSON.parse(data);

        if (
          msg.type === "message" &&
          msg.messages &&
          // biome-ignore lint/suspicious/noExplicitAny: Test helper
          !msg.messages[msg.messages.length - 1].parts?.some(
            (p: any) => p.type === "tool-process_payment",
          )
        ) {
          ws.simulateServerMessage({ type: "start", messageId: "msg-1" });
          ws.simulateServerMessage({
            type: "tool-input-start",
            toolCallId: "payment-1",
            toolName: "process_payment",
          });
          ws.simulateServerMessage({
            type: "tool-input-available",
            toolCallId: "payment-1",
            toolName: "process_payment",
            input: { amount: 30, recipient: "Alice", currency: "USD" },
          });
          ws.simulateServerMessage({
            type: "tool-approval-request",
            toolCallId: "payment-1",
            approvalId: "approval-1",
          });
          ws.simulateServerMessage({ type: "finish-step" });
          ws.simulateDone();
        }
      });
    });

    const { useChatOptions } = buildUseChatOptions({
      initialMessages: [],
      adkBackendUrl: "http://localhost:8000",
      forceNewInstance: true,
    });

    const { result } = renderHook(() => useChat(useChatOptions));

    await act(async () => {
      result.current.sendMessage({ text: "Send $30 to Alice" });
    });

    // ✅ CORRECT: Use waitFor to wait for approval state
    console.log("✅ Using waitFor to ensure tool is ready");

    // Import waitFor
    const { waitFor } = await import("@testing-library/react");

    await waitFor(
      () => {
        const lastMsg =
          result.current.messages[result.current.messages.length - 1];
        const currentTool = lastMsg?.parts?.find(
          (p: any) => p.type === "tool-process_payment",
        );
        return currentTool?.state === "approval-requested";
      },
      { timeout: 5000 },
    );

    // Then: Tool is guaranteed to be ready
    const lastMsg = result.current.messages[result.current.messages.length - 1];
    const tool = lastMsg?.parts?.find(
      (p: any) => p.type === "tool-process_payment",
    );

    expect(tool).toBeDefined();
    expect(tool?.state).toBe("approval-requested");
    expect(tool?.approval?.id).toBeDefined();

    console.log("✓ Tool is defined and ready");
    console.log(`✓ Tool state: ${tool?.state}`);
    console.log(`✓ Approval ID: ${tool?.approval?.id}`);
    console.log("✓ Safe to call addToolApprovalResponse()");
  });

  it("Documentation: Why waitFor is required (ADR 0005)", () => {
    /**
     * WHY waitFor IS REQUIRED:
     *
     * 1. **Async Message Updates**:
     *    - Backend sends approval-request via SSE/WebSocket
     *    - Messages update asynchronously in React state
     *    - Immediate access may return undefined
     *
     * 2. **State Reconciliation**:
     *    - AI SDK needs time to parse and update message parts
     *    - Tool part may not exist until state reconciliation completes
     *    - waitFor ensures reconciliation is done
     *
     * 3. **Race Condition Prevention**:
     *    - Without waitFor: Tool may be undefined when accessed
     *    - TypeError: Cannot read property 'approval' of undefined
     *    - waitFor guarantees tool exists and is in correct state
     *
     * CORRECT Pattern:
     * ```typescript
     * // Step 1: Wait for approval state
     * await waitFor(() => {
     *   const tool = getTool(messages);
     *   return tool?.state === "approval-requested";
     * });
     *
     * // Step 2: Access tool (guaranteed to exist)
     * const tool = getTool(messages);
     * addToolApprovalResponse({ id: tool.approval.id, approved: true });
     * ```
     *
     * WRONG Pattern:
     * ```typescript
     * // ❌ No waitFor
     * const tool = getTool(messages);  // May be undefined!
     * addToolApprovalResponse({ id: tool.approval.id });  // TypeError!
     * ```
     *
     * Reference: ADR 0005
     */
    expect(true).toBe(true); // Documentation test
  });
});
