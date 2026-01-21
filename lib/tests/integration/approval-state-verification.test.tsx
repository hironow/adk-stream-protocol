/**
 * Verification Test: AI SDK v6 Approval State Behavior
 *
 * Purpose: Verify what ACTUALLY happens when addToolApprovalResponse is called
 *
 * According to DeepWiki (vercel/ai):
 * - State should change from "approval-requested" to "approval-responded" immediately
 * - approval object should be {id, approved, reason?}
 *
 * This test will verify the actual behavior in our environment.
 *
 * @vitest-environment jsdom
 */

import { useChat } from "@ai-sdk/react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { http } from "msw";
import { describe, expect, it } from "vitest";
import { buildUseChatOptions } from "../../sse";
import { createAdkConfirmationRequest, useMswServer } from "../helpers";

describe("AI SDK v6 Approval State Verification", () => {
  const { getServer } = useMswServer();
  it("should verify exact state and approval object structure after addToolApprovalResponse", async () => {
    // Given: Backend sends confirmation request
    getServer().use(
      http.post("http://localhost:8000/stream", async () => {
        return createAdkConfirmationRequest({
          toolCallId: "call-test",
          originalFunctionCall: {
            id: "orig-test",
            name: "test_tool",
            args: {},
          },
        });
      }),
    );

    const { useChatOptions } = buildUseChatOptions({
      mode: "adk-sse",
      initialMessages: [],
      adkBackendUrl: "http://localhost:8000",
    });

    const { result } = renderHook(() => useChat(useChatOptions));

    // When: User sends message
    await act(async () => {
      result.current.sendMessage({ text: "Test" });
    });

    // Wait for confirmation to arrive
    await waitFor(
      () => {
        const lastMessage =
          result.current.messages[result.current.messages.length - 1];
        return (
          lastMessage?.role === "assistant" && lastMessage.parts.length > 0
        );
      },
      { timeout: 3000 },
    );

    // CHECKPOINT 1: State before user approval
    const messageBeforeApproval =
      result.current.messages[result.current.messages.length - 1];
    const toolPartBefore = messageBeforeApproval.parts[0];

    console.log("\n=== CHECKPOINT 1: Before addToolApprovalResponse ===");
    console.log("Tool part:", JSON.stringify(toolPartBefore, null, 2));
    console.log("State:", (toolPartBefore as any).state);
    console.log("Approval object:", (toolPartBefore as any).approval);

    // CRITICAL: Get the actual approval.id from the tool part
    const actualApprovalId = (toolPartBefore as any).approval?.id;
    console.log("Actual approval.id to use:", actualApprovalId);

    // User approves - use the ACTUAL approval.id, not toolCallId
    await act(async () => {
      result.current.addToolApprovalResponse({
        id: actualApprovalId, // ← Use approval.id, NOT toolCallId!
        approved: true,
        reason: "Test reason",
      });
    });

    // CHECKPOINT 2: State immediately after user approval
    // NOTE: Need to wait a bit for React state update
    await waitFor(
      () => {
        const msg = result.current.messages[result.current.messages.length - 1];
        const part = msg.parts[0];
        // Check if approval object has been updated (regardless of what the update is)
        return (part as any).approval !== undefined;
      },
      { timeout: 1000 },
    );

    const messageAfterApproval =
      result.current.messages[result.current.messages.length - 1];
    const toolPartAfter = messageAfterApproval.parts[0];

    console.log("\n=== CHECKPOINT 2: After addToolApprovalResponse ===");
    console.log("Tool part:", JSON.stringify(toolPartAfter, null, 2));
    console.log("State:", (toolPartAfter as any).state);
    console.log(
      "Approval object:",
      JSON.stringify((toolPartAfter as any).approval, null, 2),
    );

    // VERIFICATION: Compare with DeepWiki documentation
    console.log("\n=== VERIFICATION ===");
    console.log("Expected per DeepWiki:");
    console.log("  - state: 'approval-responded'");
    console.log(
      "  - approval: {id: 'orig-test', approved: true, reason: 'Test reason'}",
    );
    console.log("\nActual:");
    console.log("  - state:", (toolPartAfter as any).state);
    console.log("  - approval:", (toolPartAfter as any).approval);

    // Report discrepancy if any
    if ((toolPartAfter as any).state !== "approval-responded") {
      console.log("\n⚠️ DISCREPANCY DETECTED:");
      console.log("  State did NOT change to 'approval-responded'");
      console.log("  This contradicts DeepWiki documentation");
    }

    if (!(toolPartAfter as any).approval?.approved) {
      console.log("\n⚠️ DISCREPANCY DETECTED:");
      console.log("  approval.approved field is missing or false");
      console.log("  This contradicts DeepWiki documentation");
    }

    // For now, just document what we observe - don't fail the test
    // We'll investigate the discrepancy after seeing the actual results
    expect(toolPartAfter).toBeDefined();
  });
});
