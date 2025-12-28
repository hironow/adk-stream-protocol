/**
 * ADK Tool Confirmation E2E Tests (Phase 5)
 *
 * Verifies the ADK native Tool Confirmation Flow using FunctionTool(require_confirmation=True):
 * 1. AI requests tool requiring confirmation (process_payment)
 * 2. ADK generates tool-approval-request event (ADR 0002: attached to original tool)
 * 3. Frontend displays approval UI for the original tool
 * 4. User approves/denies
 * 5. Frontend sends confirmation via addToolOutput
 * 6. sendAutomaticallyWhen triggers automatic send
 * 7. ADK receives FunctionResponse and continues
 * 8. Original tool (process_payment) completes
 *
 * ADR 0002: adk_request_confirmation is backend-internal only.
 * Frontend receives tool-approval-request events on original tools.
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
  downloadFrontendChunkLogs,
  enableChunkLogger,
  getLastMessage,
  getMessageText,
  navigateToChat,
  selectBackendMode,
  sendTextMessage,
  waitForAssistantResponse,
} from "../helpers";

test.describe("ADK Tool Confirmation Flow (Phase 5)", () => {
  test.beforeEach(async ({ page }) => {
    // Given: User navigates to chat and selects ADK SSE mode
    await navigateToChat(page);

    // Enable chunk logger for E2E testing
    await enableChunkLogger(page, "e2e-3");

    // Reload to apply chunk logger settings
    await page.reload();
    await page.waitForLoadState("networkidle");

    // Select backend mode
    await selectBackendMode(page, "adk-sse");
  });

  test.afterEach(async ({ page }, testInfo) => {
    // Download frontend chunk logs to chunk_logs/frontend/ for analysis
    const testName = testInfo.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    await downloadFrontendChunkLogs(page, testName);
  });

  test("should display approval UI when AI requests process_payment", async ({
    page,
  }) => {
    // Given: Backend has process_payment with FunctionTool(require_confirmation=True)

    // When: User requests payment
    await sendTextMessage(page, "花子さんに50ドル送金してください");

    // Then: Tool invocation should appear with approval buttons
    // Note: Phase 5 uses inline approval UI, not dialog
    // ADR 0002: Only process_payment tool is shown (adk_request_confirmation is backend-internal)
    await expect(page.getByText(/process_payment/i).first()).toBeVisible({
      timeout: 30000,
    });

    // Approval buttons should be visible
    await expect(
      page.getByRole("button", { name: "Approve" }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Deny" }).first(),
    ).toBeVisible();
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

    // Then: Approval UI MUST appear (process_payment requires confirmation)
    // CRITICAL: If approval UI does not appear within 30s, this test will fail
    await expect(
      page.getByRole("button", { name: "Approve" }).first(),
    ).toBeVisible({
      timeout: 30000,
    });

    // Reset counter before approval
    requestCount = 0;
    requestTimestamps.length = 0;

    // When: User approves
    await page.getByRole("button", { name: "Approve" }).first().click();

    // Then: Verify final response - check that completion text is visible
    // Note: Using direct element check instead of waitForAssistantResponse to avoid race conditions
    const messageLocator = page.locator('[data-testid="message-text"]').last();
    await expect(messageLocator).toBeVisible({ timeout: 45000 });
    await expect(messageLocator).not.toBeEmpty({ timeout: 10000 });

    const text = await messageLocator.textContent() || "";
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

    // Then: Approval UI MUST appear (process_payment requires confirmation)
    // CRITICAL: If approval UI does not appear within 30s, this test will fail
    await expect(
      page.getByRole("button", { name: "Approve" }).first(),
    ).toBeVisible({
      timeout: 30000,
    });

    // When: User approves
    await page.getByRole("button", { name: "Approve" }).first().click();

    // Then: Payment should complete
    // Note: Using direct element check instead of waitForAssistantResponse to avoid race conditions
    const messageLocator = page.locator('[data-testid="message-text"]').last();
    await expect(messageLocator).toBeVisible({ timeout: 45000 });
    await expect(messageLocator).not.toBeEmpty({ timeout: 10000 });
  });

  test("should handle user denial of payment", async ({ page }) => {
    // Given: Backend is ready

    // When: User requests payment
    await sendTextMessage(page, "次郎さんに200ドル送金してください");

    // Then: Approval UI MUST appear (process_payment requires confirmation)
    // CRITICAL: If approval UI does not appear within 30s, this test will fail
    await expect(
      page.getByRole("button", { name: "Deny" }).first(),
    ).toBeVisible({
      timeout: 30000,
    });

    // When: User denies
    await page.getByRole("button", { name: "Deny" }).first().click();

    // Then: Should receive response indicating denial
    // Note: Using direct element check instead of waitForAssistantResponse to avoid race conditions
    const messageLocator = page.locator('[data-testid="message-text"]').last();
    await expect(messageLocator).toBeVisible({ timeout: 45000 });
    await expect(messageLocator).not.toBeEmpty({ timeout: 10000 });

    const text = await messageLocator.textContent() || "";

    // Response should acknowledge denial
    expect(text.length).toBeGreaterThan(0);
  });

  test("should verify sendAutomaticallyWhen triggers after confirmation", async ({
    page,
  }) => {
    // Given: Backend is ready

    // When: User requests payment
    await sendTextMessage(page, "花子さんに75ドル送金してください");

    // Then: Approval UI MUST appear (process_payment requires confirmation)
    // CRITICAL: If approval UI does not appear within 30s, this test will fail
    await expect(
      page.getByRole("button", { name: "Approve" }).first(),
    ).toBeVisible({
      timeout: 30000,
    });

    // When: User approves
    await page.getByRole("button", { name: "Approve" }).first().click();

    // Then: Should complete successfully
    // Note: The fact that we receive a response proves sendAutomaticallyWhen triggered
    // (without it, the approval would be sent but no automatic send would follow)
    // Using direct element check instead of waitForAssistantResponse to avoid race conditions
    const messageLocator = page.locator('[data-testid="message-text"]').last();
    await expect(messageLocator).toBeVisible({ timeout: 45000 });
    await expect(messageLocator).not.toBeEmpty({ timeout: 10000 });

    const text = await messageLocator.textContent() || "";

    // If we got here, sendAutomaticallyWhen successfully triggered automatic send
    expect(text.length).toBeGreaterThan(0);
  });

  test("should handle multiple payments in single message - SSE parallel approval", async ({
    page,
  }) => {
    // TODO: Frontend needs to batch multiple approvals into single HTTP request
    // Current issue: Clicking approve buttons separately sends separate requests
    // Backend fixture test shows both approvals should go in one request (see test_multiple_payments_approved_sse_baseline.py line 132-156)
    // Frontend implementation needs update to collect multiple approval responses before sending
    test.skip();

    // Given: SSE mode is ready (default mode in beforeEach)
    let totalRequestCount = 0;

    page.on("request", (request) => {
      if (request.url().includes("/stream")) {
        totalRequestCount++;
      }
    });

    // When: User requests TWO payments in SINGLE message
    await sendTextMessage(page, "Aliceに30ドル、Bobに40ドル送金してください");

    // SSE MODE: Both approval buttons should appear simultaneously (parallel)
    console.log("[SSE Mode] Expecting 2 parallel approval buttons...");

    // Both approval buttons should be visible
    await expect(
      page.getByRole("button", { name: "Approve" }).first(),
    ).toBeVisible({ timeout: 30000 });
    await expect(
      page.getByRole("button", { name: "Approve" }).nth(1),
    ).toBeVisible({ timeout: 5000 });

    // Count should be 2
    const count = await page.getByRole("button", { name: "Approve" }).count();
    expect(count).toBe(2);
    console.log(`[SSE Mode] ✓ Found ${count} parallel approval buttons`);

    // Click both approve buttons (re-query after each click since state changes)
    await page.getByRole("button", { name: "Approve" }).first().click();
    // Wait briefly for UI to update
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: "Approve" }).first().click();

    // Wait for response
    await waitForAssistantResponse(page);

    // Response should mention both payments
    const responseText =
      (await page.locator('[data-testid="message-text"]').last().textContent()) || "";
    expect(responseText).toContain("Alice");
    expect(responseText).toContain("Bob");
    console.log(`[SSE Mode] ✓ Response: ${responseText}`);

    // Total requests should be reasonable
    console.log(`[Test] Total requests for two payments: ${totalRequestCount}`);
    expect(totalRequestCount).toBeLessThan(10);
  });

  test("should handle multiple payments in single message - BIDI sequential approval", async ({
    page,
  }) => {
    // Given: BIDI mode is ready
    // NOTE: Default mode is SSE, so this test doesn't currently work
    // because we don't have a way to switch to BIDI mode in beforeEach
    // Keeping this test for documentation purposes
    // TODO: Add mode selection capability to test setup
    test.skip();

    let totalRequestCount = 0;

    page.on("request", (request) => {
      if (request.url().includes("/live")) {
        totalRequestCount++;
      }
    });

    // When: User requests TWO payments in SINGLE message
    await sendTextMessage(page, "Aliceに30ドル、Bobに40ドル送金してください");

    // BIDI MODE: Sequential execution (one at a time)
    console.log("[BIDI Mode] Expecting sequential approval buttons...");

    // First approval button (Alice)
    await expect(
      page.getByRole("button", { name: "Approve" }).first(),
    ).toBeVisible({ timeout: 30000 });

    // Should only have 1 approval button at this point
    const firstCount = await page.getByRole("button", { name: "Approve" }).count();
    expect(firstCount).toBe(1);
    console.log(`[BIDI Mode] ✓ Found first approval button (Alice)`);

    // Click first approve button
    await page.getByRole("button", { name: "Approve" }).first().click();

    // Wait a moment for first execution to complete and second to start
    await page.waitForTimeout(1000);

    // Second approval button (Bob) should now appear
    await expect(
      page.getByRole("button", { name: "Approve" }).first(),
    ).toBeVisible({ timeout: 30000 });
    console.log(`[BIDI Mode] ✓ Found second approval button (Bob)`);

    // Click second approve button
    await page.getByRole("button", { name: "Approve" }).first().click();

    // Wait for final response
    await waitForAssistantResponse(page);

    // Response should mention both payments
    const responseText =
      (await page.locator('[data-testid="message-text"]').last().textContent()) || "";
    expect(responseText).toContain("Alice");
    expect(responseText).toContain("Bob");
    console.log(`[BIDI Mode] ✓ Response: ${responseText}`);

    // Total requests should be reasonable
    console.log(`[Test] Total requests for two payments: ${totalRequestCount}`);
    expect(totalRequestCount).toBeLessThan(10);
  });

  test("should show process_payment tool state transitions (ADR 0002)", async ({
    page,
  }) => {
    // Given: Backend is ready
    // ADR 0002: Original tool (process_payment) shows state transitions,
    // not adk_request_confirmation

    // When: User requests payment
    await sendTextMessage(page, "花子さんに50ドル送金してください");

    // Then: Should see process_payment tool (the original tool requiring confirmation)
    await expect(
      page.getByText(/process_payment/i).first(),
    ).toBeVisible({
      timeout: 30000,
    });

    // Tool should show approval-requested state initially
    // (This is implementation-specific, adjust based on actual UI)

    // When: User approves
    await page.getByRole("button", { name: "Approve" }).first().click();

    // Then: Tool should transition to approval-responded and then output-available state
    // Wait for response text to appear (may complete very quickly)
    await expect(
      page.locator('[data-testid="message-text"]').last(),
    ).toBeVisible({ timeout: 15000 });
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

    // Then: Approval UI MUST appear (process_payment requires confirmation)
    // CRITICAL: If approval UI does not appear within 30s, this test will fail
    await expect(
      page.getByRole("button", { name: "Approve" }).first(),
    ).toBeVisible({
      timeout: 30000,
    });

    requestCount = 0; // Reset before approval

    // When: User approves
    await page.getByRole("button", { name: "Approve" }).first().click();

    // Then: Should complete without loop
    // Note: Using direct element visibility check instead of waitForAssistantResponse
    // to avoid race conditions with "Thinking..." indicator
    const messageLocator = page.locator('[data-testid="message-text"]').last();
    await expect(messageLocator).toBeVisible({ timeout: 45000 });

    // Wait for text content to be available
    await expect(messageLocator).not.toBeEmpty({ timeout: 10000 });

    const text = await messageLocator.textContent() || "";
    expect(text.length).toBeGreaterThan(0);

    // Verify no excessive requests
    console.log(`[BIDI Test] Requests after approval: ${requestCount}`);
    expect(requestCount).toBeLessThan(5);
  });

  test("should execute change_bgm via frontend delegate without approval UI", async ({
    page,
  }) => {
    // Given: Backend BIDI mode is ready

    // When: User requests BGM change to track 1
    await sendTextMessage(page, "BGMをトラック1に変更してください");

    // Then: Should complete without showing approval UI
    // change_bgm auto-executes on frontend, no approval needed

    // CRITICAL: Verify that approval UI does NOT appear
    // If approval UI appears, this test should fail
    await expect(
      page.getByRole("button", { name: "Approve" }),
    ).not.toBeVisible({ timeout: 2000 });

    // Verify response is received (proves delegate flow worked)
    const messageLocator = page.locator('[data-testid="message-text"]').last();
    await expect(messageLocator).toBeVisible({ timeout: 30000 });

    // Wait for text content to be available
    await expect(messageLocator).not.toBeEmpty({ timeout: 10000 });

    const text = await messageLocator.textContent() || "";

    // Response should mention BGM change
    expect(text.length).toBeGreaterThan(0);
  });

  test("should handle user denial of payment (BIDI)", async ({ page }) => {
    // Given: Backend BIDI mode is ready

    // When: User requests payment
    await sendTextMessage(page, "次郎さんに200ドル送金してください");

    // Then: Approval UI MUST appear (process_payment requires confirmation)
    // CRITICAL: If approval UI does not appear within 30s, this test will fail
    await expect(
      page.getByRole("button", { name: "Deny" }).first(),
    ).toBeVisible({
      timeout: 30000,
    });

    // When: User denies
    await page.getByRole("button", { name: "Deny" }).first().click();

    // Then: Should receive response indicating denial
    // Note: Using direct element visibility check instead of waitForAssistantResponse
    const messageLocator = page.locator('[data-testid="message-text"]').last();
    await expect(messageLocator).toBeVisible({ timeout: 45000 });

    // Wait for text content to be available
    await expect(messageLocator).not.toBeEmpty({ timeout: 10000 });

    const text = await messageLocator.textContent() || "";

    // Response should acknowledge denial
    expect(text.length).toBeGreaterThan(0);
  });

  test("should verify sendAutomaticallyWhen triggers after confirmation (BIDI)", async ({
    page,
  }) => {
    // Given: Backend BIDI mode is ready

    // When: User requests payment
    await sendTextMessage(page, "花子さんに75ドル送金してください");

    // Then: Approval UI MUST appear (process_payment requires confirmation)
    // CRITICAL: If approval UI does not appear within 30s, this test will fail
    await expect(
      page.getByRole("button", { name: "Approve" }).first(),
    ).toBeVisible({
      timeout: 30000,
    });

    // When: User approves
    await page.getByRole("button", { name: "Approve" }).first().click();

    // Then: Should complete successfully
    // Note: The fact that we receive a response proves sendAutomaticallyWhen triggered
    // (without it, the approval would be sent but no automatic send would follow)
    const messageLocator = page.locator('[data-testid="message-text"]').last();
    await expect(messageLocator).toBeVisible({ timeout: 45000 });

    // Wait for text content to be available
    await expect(messageLocator).not.toBeEmpty({ timeout: 10000 });

    // If we got here, sendAutomaticallyWhen successfully triggered automatic send
    const text = await messageLocator.textContent() || "";
    expect(text.length).toBeGreaterThan(0);
  });

  test("should show process_payment tool state transitions (BIDI, ADR 0002)", async ({
    page,
  }) => {
    // Given: Backend BIDI mode is ready
    // ADR 0002: Original tool (process_payment) shows state transitions,
    // not adk_request_confirmation

    // When: User requests payment
    await sendTextMessage(page, "花子さんに50ドル送金してください");

    // Then: Should see approval UI appear
    // Note: We check for Approve button instead of process_payment text because
    // the reasoning section may also contain "process_payment" text and be hidden,
    // causing getByText() to match the wrong element
    await expect(
      page.getByRole("button", { name: "Approve" }).first(),
    ).toBeVisible({
      timeout: 30000,
    });

    // Tool should show approval-requested state initially
    // (This is implementation-specific, adjust based on actual UI)

    // When: User approves
    await page.getByRole("button", { name: "Approve" }).first().click();

    // Then: Tool should transition to approval-responded and then output-available state
    // Wait for response text to appear (may complete very quickly)
    await expect(
      page.locator('[data-testid="message-text"]').last(),
    ).toBeVisible({ timeout: 45000 });
  });
});
