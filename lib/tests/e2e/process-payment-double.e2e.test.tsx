/**
 * E2E Test: Process Payment Double Execution Pattern
 *
 * Tests the common scenario where two sequential process_payment tool calls occur.
 * This pattern is NOT exceptional - it happens frequently and is prone to bugs.
 *
 * Scenario:
 * 1. User: "Send $30 to Alice and $40 to Bob"
 * 2. Backend: Alice process_payment approval request
 * 3. User: Approves Alice payment
 * 4. Backend: Alice execution result + Bob process_payment approval request
 * 5. User: Approves Bob payment
 * 6. Backend: Bob execution result + final response
 *
 * Critical Requirements:
 * - sendAutomaticallyWhen must handle approval state correctly
 * - Must prevent infinite loops by tracking sent approval states
 * - Must distinguish between old output (Alice) and new approval (Bob)
 *
 * @vitest-environment jsdom
 */

import { useChat } from "@ai-sdk/react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { buildUseChatOptions } from "../../bidi";
import { useMockWebSocket } from "../helpers/mock-websocket";

// Helper to extract text from message
function getMessageText(message: any): string {
  if (!message?.parts) return "";
  return message.parts
    .filter((part: any) => part.type === "text")
    .map((part: any) => part.text)
    .join("");
}

describe("Process Payment Double Execution - BIDI Mode", () => {
  const { setDefaultHandler } = useMockWebSocket();

  it("should handle two sequential process_payment approvals (Alice → Bob)", async () => {
    // Given: Backend sends two approval requests sequentially
    let aliceApprovalReceived = false;
    let bobApprovalReceived = false;
    let finalResponseReceived = false;

    setDefaultHandler((ws) => {
      ws.onClientMessage((data) => {
        if (!data.startsWith("{")) {
          return;
        }

        const msg = JSON.parse(data);
        console.log("[Test Mock Server] Received:", msg.type);

        // Turn 1: Initial message → Alice approval request
        if (msg.type === "message" && msg.messages) {
          const lastMsg = msg.messages[msg.messages.length - 1];

          if (
            !aliceApprovalReceived &&
            lastMsg.role === "user" &&
            !lastMsg.parts?.some((p: any) => p.type === "tool-process_payment")
          ) {
            console.log(
              "[Test Mock Server] Turn 1: Sending Alice approval request",
            );

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
            ws.simulateDone();

            aliceApprovalReceived = true;
            return;
          }

          // Turn 2: Alice approval → Alice execution + Bob approval request
          if (
            aliceApprovalReceived &&
            !bobApprovalReceived &&
            lastMsg.parts?.some(
              (p: any) =>
                p.type === "tool-process_payment" &&
                p.state === "approval-responded" &&
                p.approval?.id === "approval-alice",
            )
          ) {
            console.log(
              "[Test Mock Server] Turn 2: Sending Alice result + Bob approval",
            );

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
            ws.simulateDone();

            bobApprovalReceived = true;
            return;
          }

          // Turn 3: Bob approval → Bob execution + final response
          if (
            bobApprovalReceived &&
            !finalResponseReceived &&
            lastMsg.parts?.some(
              (p: any) =>
                p.type === "tool-process_payment" &&
                p.state === "approval-responded" &&
                p.approval?.id === "approval-bob",
            )
          ) {
            console.log(
              "[Test Mock Server] Turn 3: Sending Bob result + final response",
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
              delta:
                "Both payments completed successfully. Alice received $30 and Bob received $40.",
            });
            ws.simulateServerMessage({ type: "text-end", id: "text-1" });
            ws.simulateServerMessage({ type: "finish", finishReason: "stop" });
            ws.simulateDone();

            finalResponseReceived = true;
            return;
          }
        }
      });
    });

    const { useChatOptions } = buildUseChatOptions({
      initialMessages: [],
      adkBackendUrl: "http://localhost:8000",
      forceNewInstance: true,
    });

    const { result } = renderHook(() => useChat(useChatOptions));

    // When: User sends initial message
    await act(async () => {
      result.current.sendMessage({
        text: "Send $30 to Alice and $40 to Bob",
      });
    });

    // Then: Wait for Alice approval request
    await waitFor(
      () => {
        const lastMsg =
          result.current.messages[result.current.messages.length - 1];
        const aliceTool = lastMsg?.parts?.find(
          (p: any) =>
            p.type === "tool-process_payment" && p.input?.recipient === "Alice",
        );
        return aliceTool?.state === "approval-requested";
      },
      { timeout: 5000 },
    );

    console.log("[Test] ✓ Alice approval request received");
    const aliceTool = result.current.messages[
      result.current.messages.length - 1
    ]?.parts?.find(
      (p: any) =>
        p.type === "tool-process_payment" && p.input?.recipient === "Alice",
    );
    expect(aliceTool).toBeDefined();
    expect(aliceTool?.state).toBe("approval-requested");

    // When: User approves Alice payment
    await act(async () => {
      result.current.addToolApprovalResponse({
        id: aliceTool?.approval?.id,
        approved: true,
      });
    });

    // Then: Wait for Bob approval request
    await waitFor(
      () => {
        const lastMsg =
          result.current.messages[result.current.messages.length - 1];
        const bobTool = lastMsg?.parts?.find(
          (p: any) =>
            p.type === "tool-process_payment" && p.input?.recipient === "Bob",
        );
        return bobTool?.state === "approval-requested";
      },
      { timeout: 5000 },
    );

    console.log("[Test] ✓ Bob approval request received");
    const bobTool = result.current.messages[
      result.current.messages.length - 1
    ]?.parts?.find(
      (p: any) =>
        p.type === "tool-process_payment" && p.input?.recipient === "Bob",
    );
    expect(bobTool).toBeDefined();
    expect(bobTool?.state).toBe("approval-requested");

    // When: User approves Bob payment
    await act(async () => {
      result.current.addToolApprovalResponse({
        id: bobTool?.approval?.id,
        approved: true,
      });
    });

    // Then: Wait for final response
    await waitFor(
      () => {
        const text = getMessageText(
          result.current.messages[result.current.messages.length - 1],
        );
        return text.includes("Both payments completed");
      },
      { timeout: 5000 },
    );

    console.log("[Test] ✓ Final response received");
    const finalText = getMessageText(
      result.current.messages[result.current.messages.length - 1],
    );
    expect(finalText).toContain("Both payments completed");
    expect(finalText).toContain("Alice received $30");
    expect(finalText).toContain("Bob received $40");

    // Verify Alice tool has output
    const finalAliceTool = result.current.messages[
      result.current.messages.length - 1
    ]?.parts?.find(
      (p: any) =>
        p.type === "tool-process_payment" && p.input?.recipient === "Alice",
    );
    expect(finalAliceTool?.state).toBe("output-available");
    expect(finalAliceTool?.output).toBeDefined();

    // Verify Bob tool has output
    const finalBobTool = result.current.messages[
      result.current.messages.length - 1
    ]?.parts?.find(
      (p: any) =>
        p.type === "tool-process_payment" && p.input?.recipient === "Bob",
    );
    expect(finalBobTool?.state).toBe("output-available");
    expect(finalBobTool?.output).toBeDefined();
  });
});
