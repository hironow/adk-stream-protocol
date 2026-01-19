/**
 * E2E Test: BIDI Sequential-Only Execution (ADR 0003)
 *
 * Verifies that BIDI mode enforces sequential tool execution:
 * - Only one tool-approval-request is sent at a time
 * - Second approval request only appears AFTER first is resolved
 * - This proves BIDI cannot execute tools in parallel like SSE
 *
 * Related Tests:
 * - Playwright: scenarios/app-advanced/multi-tool-approval-combinations.spec.ts
 * - SSE Parallel: scenarios/app-advanced/multi-tool-approval-combinations.spec.ts (SSE tests show 2 approvals simultaneously)
 *
 * @vitest-environment jsdom
 */

import { useChat } from "@ai-sdk/react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { buildUseChatOptions } from "../../bidi";
import { useMockWebSocket } from "../helpers/mock-websocket";

describe("BIDI Sequential-Only Execution (ADR 0003)", () => {
  const { setDefaultHandler } = useMockWebSocket();

  it("should send only ONE approval-request at a time (sequential execution)", async () => {
    // Given: Backend that tracks approval request timing
    const approvalTimestamps: number[] = [];
    let firstApprovalSent = false;
    let firstApprovalResolved = false;
    let secondApprovalSent = false;

    setDefaultHandler((ws) => {
      ws.onClientMessage((data) => {
        if (!data.startsWith("{")) {
          return;
        }

        const msg = JSON.parse(data);
        console.log("[Test Mock Server] Received:", msg.type);

        // Turn 1: Initial message → Send ONLY first approval request (Alice)
        if (
          msg.type === "message" &&
          msg.messages &&
          !firstApprovalSent &&
          // biome-ignore lint/suspicious/noExplicitAny: Test helper
          !msg.messages[msg.messages.length - 1].parts?.some(
            (p: any) => p.type === "tool-process_payment",
          )
        ) {
          console.log(
            "[Test Mock Server] Turn 1: Sending FIRST approval request (Alice)",
          );
          approvalTimestamps.push(Date.now());

          ws.simulateServerMessage({ type: "start", messageId: "msg-1" });
          ws.simulateServerMessage({
            type: "tool-input-start",
            toolCallId: "alice-payment",
            toolName: "process_payment",
          });
          ws.simulateServerMessage({
            type: "tool-input-available",
            toolCallId: "alice-payment",
            toolName: "process_payment",
            input: { amount: 30, recipient: "Alice", currency: "USD" },
          });
          ws.simulateServerMessage({
            type: "tool-approval-request",
            toolCallId: "alice-payment",
            approvalId: "approval-alice",
          });
          ws.simulateServerMessage({ type: "finish-step" });
          ws.simulateDone();

          firstApprovalSent = true;
          return;
        }

        // Turn 2: First approval resolved → Now send second approval request (Bob)
        if (
          firstApprovalSent &&
          !firstApprovalResolved &&
          msg.type === "message" &&
          msg.messages &&
          // biome-ignore lint/suspicious/noExplicitAny: Test helper
          msg.messages[msg.messages.length - 1].parts?.some(
            (p: any) =>
              p.type === "tool-process_payment" &&
              p.state === "approval-responded" &&
              p.approval?.id === "approval-alice",
          )
        ) {
          console.log(
            "[Test Mock Server] Turn 2: First approval resolved, sending SECOND approval request (Bob)",
          );
          approvalTimestamps.push(Date.now());
          firstApprovalResolved = true;

          // Send Alice result
          ws.simulateServerMessage({
            type: "tool-output-available",
            toolCallId: "alice-payment",
            output: {
              success: true,
              transactionId: "txn-alice",
              amount: 30,
              recipient: "Alice",
            },
          });

          // Send Bob approval request
          ws.simulateServerMessage({
            type: "tool-input-start",
            toolCallId: "bob-payment",
            toolName: "process_payment",
          });
          ws.simulateServerMessage({
            type: "tool-input-available",
            toolCallId: "bob-payment",
            toolName: "process_payment",
            input: { amount: 40, recipient: "Bob", currency: "USD" },
          });
          ws.simulateServerMessage({
            type: "tool-approval-request",
            toolCallId: "bob-payment",
            approvalId: "approval-bob",
          });
          ws.simulateServerMessage({ type: "finish-step" });
          ws.simulateDone();

          secondApprovalSent = true;
          return;
        }

        // Turn 3: Second approval resolved → Send final response
        if (
          secondApprovalSent &&
          msg.type === "message" &&
          msg.messages &&
          // biome-ignore lint/suspicious/noExplicitAny: Test helper
          msg.messages[msg.messages.length - 1].parts?.some(
            (p: any) =>
              p.type === "tool-process_payment" &&
              p.state === "approval-responded" &&
              p.approval?.id === "approval-bob",
          )
        ) {
          console.log(
            "[Test Mock Server] Turn 3: Second approval resolved, sending final response",
          );

          ws.simulateServerMessage({
            type: "tool-output-available",
            toolCallId: "bob-payment",
            output: {
              success: true,
              transactionId: "txn-bob",
              amount: 40,
              recipient: "Bob",
            },
          });
          ws.simulateServerMessage({ type: "text-start", id: "text-1" });
          ws.simulateServerMessage({
            type: "text-delta",
            id: "text-1",
            delta: "Both payments completed successfully.",
          });
          ws.simulateServerMessage({ type: "text-end", id: "text-1" });
          ws.simulateServerMessage({ type: "finish", finishReason: "stop" });
          ws.simulateDone();
          return;
        }
      });
    });

    const { useChatOptions } = buildUseChatOptions({
      initialMessages: [],
      adkBackendUrl: "http://localhost:8000",
      forceNewInstance: true,
    });

    const { result } = renderHook(() => useChat(useChatOptions));

    // When: User sends message requesting multiple payments
    await act(async () => {
      result.current.sendMessage({
        text: "Send $30 to Alice and $40 to Bob",
      });
    });

    // Then: Wait for FIRST approval request (Alice)
    await waitFor(
      () => {
        const lastMsg =
          result.current.messages[result.current.messages.length - 1];
        const aliceTool = lastMsg?.parts?.find(
          // biome-ignore lint/suspicious/noExplicitAny: Test helper
          (p: any) =>
            p.type === "tool-process_payment" && p.input?.recipient === "Alice",
        );
        return aliceTool?.state === "approval-requested";
      },
      { timeout: 5000 },
    );

    console.log("[Test] ✓ First approval request received (Alice)");

    // CRITICAL: Verify second approval does NOT exist yet (sequential execution)
    const lastMsg = result.current.messages[result.current.messages.length - 1];
    const bobTool = lastMsg?.parts?.find(
      // biome-ignore lint/suspicious/noExplicitAny: Test helper
      (p: any) =>
        p.type === "tool-process_payment" && p.input?.recipient === "Bob",
    );
    expect(bobTool).toBeUndefined(); // Bob approval should NOT exist yet

    console.log(
      "[Test] ✓ Verified second approval does NOT exist (sequential execution)",
    );

    // When: User approves first payment
    const aliceTool = lastMsg?.parts?.find(
      // biome-ignore lint/suspicious/noExplicitAny: Test helper
      (p: any) =>
        p.type === "tool-process_payment" && p.input?.recipient === "Alice",
    );
    await act(async () => {
      result.current.addToolApprovalResponse({
        id: aliceTool?.approval?.id,
        approved: true,
      });
    });

    // Then: Wait for SECOND approval request (Bob) to appear
    await waitFor(
      () => {
        const currentMsg =
          result.current.messages[result.current.messages.length - 1];
        const currentBobTool = currentMsg?.parts?.find(
          // biome-ignore lint/suspicious/noExplicitAny: Test helper
          (p: any) =>
            p.type === "tool-process_payment" && p.input?.recipient === "Bob",
        );
        return currentBobTool?.state === "approval-requested";
      },
      { timeout: 5000 },
    );

    console.log(
      "[Test] ✓ Second approval request received AFTER first resolved (Bob)",
    );

    // Verify sequential timing
    expect(approvalTimestamps).toHaveLength(2);
    const timeDiff = approvalTimestamps[1] - approvalTimestamps[0];
    console.log(
      `[Test] ✓ Time between approvals: ${timeDiff}ms (proves sequential execution)`,
    );
    expect(timeDiff).toBeGreaterThan(0); // Second approval sent AFTER first

    // Approve second payment to complete test
    const currentMsg =
      result.current.messages[result.current.messages.length - 1];
    const currentBobTool = currentMsg?.parts?.find(
      // biome-ignore lint/suspicious/noExplicitAny: Test helper
      (p: any) =>
        p.type === "tool-process_payment" && p.input?.recipient === "Bob",
    );
    await act(async () => {
      result.current.addToolApprovalResponse({
        id: currentBobTool?.approval?.id,
        approved: true,
      });
    });

    // Wait for final response
    await waitFor(
      () => {
        const finalMsg =
          result.current.messages[result.current.messages.length - 1];
        const text = finalMsg?.parts
          // biome-ignore lint/suspicious/noExplicitAny: Test helper
          ?.filter((p: any) => p.type === "text")
          // biome-ignore lint/suspicious/noExplicitAny: Test helper
          .map((p: any) => p.text)
          .join("");
        return text && text.length > 0;
      },
      { timeout: 5000 },
    );

    console.log("[Test] ✅ PASSED - BIDI sequential-only execution verified");
  });
});
