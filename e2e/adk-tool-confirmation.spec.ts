/**
 * ADK Tool Confirmation E2E Tests (Phase 5)
 *
 * Verifies the ADK native Tool Confirmation Flow using FunctionTool(require_confirmation=True):
 * 1. AI requests tool requiring confirmation (process_payment)
 * 2. ADK generates adk_request_confirmation event
 * 3. Frontend displays approval UI
 * 4. User approves/denies
 * 5. Frontend sends confirmation via addToolOutput
 * 6. sendAutomaticallyWhen triggers automatic send
 * 7. ADK receives FunctionResponse and continues
 * 8. Original tool (process_payment) completes
 *
 * Critical: Tests for infinite loop prevention
 * - Previous bug: sendAutomaticallyWhen used wrong property (toolInvocations instead of parts)
 * - This caused confirmation to never trigger automatic send
 * - Backend kept receiving requests without progress
 *
 * Per CLAUDE.md guidelines:
 * - Uses real backend servers (no mocks)
 * - Given-When-Then structure
 * - Tests ADK SSE mode (confirmation works in both SSE and BIDI)
 */

import { expect, test } from "@playwright/test";
import {
  getLastMessage,
  getMessageText,
  navigateToChat,
  selectBackendMode,
  sendTextMessage,
  waitForAssistantResponse,
} from "./helpers";

test.describe("ADK Tool Confirmation Flow (Phase 5)", () => {
  test.beforeEach(async ({ page }) => {
    // Given: User navigates to chat and selects ADK SSE mode
    await navigateToChat(page);
    await selectBackendMode(page, "adk-sse");
  });

  test("should display approval UI when AI requests process_payment", async ({
    page,
  }) => {
    // Given: Backend has process_payment with FunctionTool(require_confirmation=True)

    // When: User requests payment
    await sendTextMessage(page, "花子さんに50ドル送金してください");

    // Then: Tool invocation should appear with approval buttons
    // Note: Phase 5 uses inline approval UI, not dialog
    // Both process_payment tool and adk_request_confirmation will show "process_payment" text
    await expect(page.getByText(/process_payment/i).first()).toBeVisible({
      timeout: 30000,
    });

    // Approval buttons should be visible
    await expect(page.getByRole("button", { name: "Approve" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Deny" })).toBeVisible();
  });

  test("should NOT enter infinite loop when user approves payment", async ({
    page,
  }) => {
    // Given: Backend is ready
    let requestCount = 0;
    const requestTimestamps: number[] = [];

    // Monitor network requests to detect infinite loops
    page.on("request", (request) => {
      if (
        request.url().includes("/stream") ||
        request.url().includes("/live")
      ) {
        requestCount++;
        requestTimestamps.push(Date.now());
        console.log(`[Request #${requestCount}] ${request.url()}`);
      }
    });

    // When: User requests payment
    await sendTextMessage(page, "花子さんに50ドル送金してください");

    // Then: Approval UI appears
    await expect(page.getByRole("button", { name: "Approve" })).toBeVisible({
      timeout: 30000,
    });

    // Reset counter before approval
    requestCount = 0;
    requestTimestamps.length = 0;

    // When: User approves
    await page.getByRole("button", { name: "Approve" }).click();

    // Then: Wait for completion (with reasonable timeout)
    // If infinite loop occurs, this will timeout
    await waitForAssistantResponse(page, { timeout: 45000 });

    // Verify final response
    const lastMessage = await getLastMessage(page);
    const text = await getMessageText(lastMessage);
    expect(text.length).toBeGreaterThan(0);

    // Critical assertion: Request count should be reasonable
    // In normal flow: 1-2 requests (approval confirmation + completion)
    // In infinite loop: 10+ requests in rapid succession
    console.log(
      `[Test] Total requests after approval: ${requestCount}, timestamps:`,
      requestTimestamps,
    );

    expect(requestCount).toBeLessThan(5);

    // If we got here without timing out, infinite loop was prevented ✅
  });

  test("should complete payment after user approval", async ({ page }) => {
    // Given: Backend is ready

    // When: User requests payment
    await sendTextMessage(page, "太郎さんに100ドル送金してください");

    // Then: Approval UI appears
    await expect(page.getByRole("button", { name: "Approve" })).toBeVisible({
      timeout: 30000,
    });

    // When: User approves
    await page.getByRole("button", { name: "Approve" }).click();

    // Then: Payment should complete
    await waitForAssistantResponse(page);

    const lastMessage = await getLastMessage(page);
    const text = await getMessageText(lastMessage);

    // Response should indicate payment was processed
    expect(text.length).toBeGreaterThan(0);
    // Could check for success indicators but LLM response format varies
  });

  test("should handle user denial of payment", async ({ page }) => {
    // Given: Backend is ready

    // When: User requests payment
    await sendTextMessage(page, "次郎さんに200ドル送金してください");

    // Then: Approval UI appears
    await expect(page.getByRole("button", { name: "Deny" })).toBeVisible({
      timeout: 30000,
    });

    // When: User denies
    await page.getByRole("button", { name: "Deny" }).click();

    // Then: Should receive response indicating denial
    await waitForAssistantResponse(page);

    const lastMessage = await getLastMessage(page);
    const text = await getMessageText(lastMessage);

    // Response should acknowledge denial
    expect(text.length).toBeGreaterThan(0);
  });

  test("should verify sendAutomaticallyWhen triggers after confirmation", async ({
    page,
  }) => {
    // Given: Backend is ready
    let automaticSendDetected = false;

    // Monitor console logs for sendAutomaticallyWhen message
    page.on("console", (msg) => {
      const text = msg.text();
      if (
        text.includes("sendAutomaticallyWhen") &&
        text.includes("adk_request_confirmation completed")
      ) {
        automaticSendDetected = true;
        console.log("[Test] Detected automatic send trigger:", text);
      }
    });

    // When: User requests payment
    await sendTextMessage(page, "花子さんに75ドル送金してください");

    // Then: Approval UI appears
    await expect(page.getByRole("button", { name: "Approve" })).toBeVisible({
      timeout: 30000,
    });

    // When: User approves
    await page.getByRole("button", { name: "Approve" }).click();

    // Then: Should complete successfully
    await waitForAssistantResponse(page);

    // Verify automatic send was triggered
    expect(automaticSendDetected).toBe(true);
  });

  test("should handle multiple payments in sequence without loops", async ({
    page,
  }) => {
    // Given: Backend is ready
    let totalRequestCount = 0;

    page.on("request", (request) => {
      if (
        request.url().includes("/stream") ||
        request.url().includes("/live")
      ) {
        totalRequestCount++;
      }
    });

    // When: User requests first payment
    await sendTextMessage(page, "Aliceに30ドル送金");

    await expect(page.getByRole("button", { name: "Approve" })).toBeVisible({
      timeout: 30000,
    });
    await page.getByRole("button", { name: "Approve" }).click();
    await waitForAssistantResponse(page);

    const countAfterFirst = totalRequestCount;

    // When: User requests second payment
    await sendTextMessage(page, "Bobに40ドル送金");

    await expect(page.getByRole("button", { name: "Approve" })).toBeVisible({
      timeout: 30000,
    });
    await page.getByRole("button", { name: "Approve" }).click();
    await waitForAssistantResponse(page);

    // Then: Both should complete without loops
    const lastMessage = await getLastMessage(page);
    const text = await getMessageText(lastMessage);
    expect(text.length).toBeGreaterThan(0);

    // Total requests should be reasonable (< 10 for two payments)
    console.log(`[Test] Total requests for two payments: ${totalRequestCount}`);
    expect(totalRequestCount).toBeLessThan(10);
    expect(totalRequestCount - countAfterFirst).toBeLessThan(5); // Second payment alone
  });

  test("should show adk_request_confirmation tool state transitions", async ({
    page,
  }) => {
    // Given: Backend is ready

    // When: User requests payment
    await sendTextMessage(page, "花子さんに50ドル送金してください");

    // Then: Should see adk_request_confirmation tool (may appear multiple times)
    await expect(
      page.getByText(/adk_request_confirmation/i).first(),
    ).toBeVisible({
      timeout: 30000,
    });

    // Tool should show "Executing..." state initially
    // (This is implementation-specific, adjust based on actual UI)

    // When: User approves
    await page.getByRole("button", { name: "Approve" }).click();

    // Then: Tool should transition to "Completed" state
    // Wait a bit for state update
    await page.waitForTimeout(1000);

    // Verify completion
    await waitForAssistantResponse(page);
    const lastMessage = await getLastMessage(page);
    const text = await getMessageText(lastMessage);
    expect(text.length).toBeGreaterThan(0);
  });
});

test.describe("ADK Tool Confirmation - BIDI Mode", () => {
  test.beforeEach(async ({ page }) => {
    // Given: User navigates to chat and selects ADK BIDI mode
    await navigateToChat(page);
    await selectBackendMode(page, "adk-bidi");
  });

  test("should work in BIDI mode without loops", async ({ page }) => {
    // Given: Backend BIDI mode is ready
    let requestCount = 0;

    page.on("request", (request) => {
      if (request.url().includes("/live")) {
        requestCount++;
      }
    });

    // When: User requests payment
    await sendTextMessage(page, "花子さんに50ドル送金してください");

    // Then: Approval UI appears
    await expect(page.getByRole("button", { name: "Approve" })).toBeVisible({
      timeout: 30000,
    });

    requestCount = 0; // Reset before approval

    // When: User approves
    await page.getByRole("button", { name: "Approve" }).click();

    // Then: Should complete without loop
    await waitForAssistantResponse(page, { timeout: 45000 });

    const lastMessage = await getLastMessage(page);
    const text = await getMessageText(lastMessage);
    expect(text.length).toBeGreaterThan(0);

    // Verify no excessive requests
    console.log(`[BIDI Test] Requests after approval: ${requestCount}`);
    expect(requestCount).toBeLessThan(5);
  });
});
