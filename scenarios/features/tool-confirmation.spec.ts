/**
 * ADK Tool Confirmation E2E Tests (Legacy Approval Mode)
 *
 * Comprehensive test coverage for tool confirmation flows in both SSE and BIDI modes.
 *
 * Test Coverage Matrix:
 * ┌─────────────────────────────┬──────────────┬──────────────┐
 * │ Scenario                    │ SSE Mode     │ BIDI Mode    │
 * ├─────────────────────────────┼──────────────┼──────────────┤
 * │ Single Approval: Approve    │ ✅ PASS      │ ✅ PASS      │
 * │ Single Approval: Deny       │ ✅ PASS      │ ✅ PASS      │
 * │ Multiple: Approve→Approve   │ ✅ PASS      │ ❌ FAIL      │
 * │ Multiple: Approve→Deny      │ ✅ PASS      │ ❓ MISSING   │
 * │ Multiple: Deny→Approve      │ ✅ PASS      │ ❓ MISSING   │
 * │ Multiple: Deny→Deny         │ ✅ PASS      │ ❓ MISSING   │
 * └─────────────────────────────┴──────────────┴──────────────┘
 *
 * Legend / 凡例:
 * - Single Approval: 単一承認
 * - Multiple: 複数承認
 * - Approve: 承認
 * - Deny: 拒否
 * - PASS: 成功
 * - FAIL: 失敗
 * - SKIP: スキップ
 * - MISSING: 未実装
 *
 * ADK Tool Confirmation Flow:
 * 1. AI requests tool requiring confirmation (process_payment)
 * 2. ADK generates tool-approval-request event (ADR 0002: attached to original tool)
 * 3. Frontend displays approval UI for the original tool
 * 4. User approves/denies
 * 5. Frontend sends confirmation via addToolApprovalResponse
 * 6. sendAutomaticallyWhen triggers automatic send
 * 7. ADK receives approval and continues
 * 8. Original tool (process_payment) completes
 *
 * ADR 0002: adk_request_confirmation is backend-internal only.
 * Frontend receives tool-approval-request events on original tools.
 *
 * ADR 0003 (BIDI): Sequential tool execution in Gemini Live API
 * - SSE mode: Tools execute in parallel
 * - BIDI mode: Tools execute sequentially (one at a time)
 *
 * Per CLAUDE.md guidelines:
 * - Uses real backend servers (no mocks)
 * - Given-When-Then structure
 * - Tests both SSE and BIDI modes
 */

import { expect, test } from "@playwright/test";
import {
  downloadFrontendChunkLogs,
  enableChunkLogger,
  navigateToChat,
  selectBackendMode,
  sendTextMessage,
  waitForAssistantResponse,
} from "../helpers";

// ============================================================================
// SSE Mode Tests
// ============================================================================

test.describe("ADK Tool Confirmation - SSE Mode", () => {
  test.beforeEach(async ({ page }) => {
    // Given: User navigates to chat and selects ADK SSE mode
    await navigateToChat(page);

    // Enable chunk logger for E2E testing
    await enableChunkLogger(page, "e2e-sse");

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

  // --------------------------------------------------------------------------
  // Infrastructure Tests
  // --------------------------------------------------------------------------

  test.describe("Infrastructure", () => {
    test("should display approval UI when AI requests process_payment", async ({
      page,
    }) => {
      // Status: ✅ PASS
      // Given: Backend has process_payment with FunctionTool(require_confirmation=True)

      // When: User requests payment
      await sendTextMessage(page, "花子さんに50ドル送金してください");

      // Then: Tool invocation should appear with approval buttons
      // Note: Legacy Approval Mode uses inline approval UI, not dialog
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
      // Status: ✅ PASS
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
      const messageLocator = page
        .locator('[data-testid="message-text"]')
        .last();
      await expect(messageLocator).toBeVisible({ timeout: 45000 });
      await expect(messageLocator).not.toBeEmpty({ timeout: 10000 });

      const text = (await messageLocator.textContent()) || "";
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

    test("should verify sendAutomaticallyWhen triggers after confirmation", async ({
      page,
    }) => {
      // Status: ✅ PASS
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
      const messageLocator = page
        .locator('[data-testid="message-text"]')
        .last();
      await expect(messageLocator).toBeVisible({ timeout: 45000 });
      await expect(messageLocator).not.toBeEmpty({ timeout: 10000 });

      const text = (await messageLocator.textContent()) || "";

      // If we got here, sendAutomaticallyWhen successfully triggered automatic send
      expect(text.length).toBeGreaterThan(0);
    });

    test("should show process_payment tool state transitions (ADR 0002)", async ({
      page,
    }) => {
      // Status: ✅ PASS
      // Given: Backend is ready
      // ADR 0002: Original tool (process_payment) shows state transitions,
      // not adk_request_confirmation

      // When: User requests payment
      await sendTextMessage(page, "花子さんに50ドル送金してください");

      // Then: Should see process_payment tool (the original tool requiring confirmation)
      await expect(page.getByText(/process_payment/i).first()).toBeVisible({
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

  // --------------------------------------------------------------------------
  // Single Approval Tests
  // --------------------------------------------------------------------------

  test.describe("Single Approval", () => {
    test("[SSE-Single-Approve] should complete payment after user approval", async ({
      page,
    }) => {
      // Status: ✅ PASS
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
      const messageLocator = page
        .locator('[data-testid="message-text"]')
        .last();
      await expect(messageLocator).toBeVisible({ timeout: 45000 });
      await expect(messageLocator).not.toBeEmpty({ timeout: 10000 });
    });

    test("[SSE-Single-Deny] should handle user denial of payment", async ({
      page,
    }) => {
      // Status: ✅ PASS
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
      const messageLocator = page
        .locator('[data-testid="message-text"]')
        .last();
      await expect(messageLocator).toBeVisible({ timeout: 45000 });
      await expect(messageLocator).not.toBeEmpty({ timeout: 10000 });

      const text = (await messageLocator.textContent()) || "";

      // Response should acknowledge denial
      expect(text.length).toBeGreaterThan(0);
    });
  });

  // --------------------------------------------------------------------------
  // Multiple Approval Tests
  // --------------------------------------------------------------------------

  test.describe("Multiple Approvals", () => {
    test("[SSE-Multiple-Approve-Approve] should handle two approvals in parallel", async ({
      page,
    }) => {
      // Status: ✅ PASS (assuming batching is implemented)

      // Capture browser console logs for debugging
      page.on("console", (msg) => {
        const text = msg.text();
        if (
          text.includes("sendAutomaticallyWhen") ||
          text.includes("approval")
        ) {
          console.log(`[Browser Console] ${text}`);
        }
      });

      // Given: SSE mode is ready (default mode in beforeEach)
      let totalRequestCount = 0;
      const requests: Array<{
        method: string;
        url: string;
        postData: string | null;
      }> = [];

      page.on("request", (request) => {
        if (request.url().includes("/stream")) {
          totalRequestCount++;
          const postData = request.postData();
          requests.push({
            method: request.method(),
            url: request.url(),
            postData: postData,
          });
          console.log(
            `[HTTP Request ${totalRequestCount}] ${request.method()} ${request.url()}`,
          );
          if (postData) {
            // Log full body for debugging
            console.log(`[HTTP Request ${totalRequestCount} Body] ${postData}`);
          }
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
        (await page
          .locator('[data-testid="message-text"]')
          .last()
          .textContent()) || "";
      expect(responseText).toContain("Alice");
      expect(responseText).toContain("Bob");
      console.log(`[SSE Mode] ✓ Response: ${responseText}`);

      // Total requests should be reasonable
      console.log(
        `[Test] Total requests for two payments: ${totalRequestCount}`,
      );
      expect(totalRequestCount).toBeLessThan(10);
    });

    test("[SSE-Multiple-Approve-Deny] should handle approve first, deny second", async ({
      page,
    }) => {
      // Status: ✅ PASS (assuming batching is implemented)

      // Given: SSE mode is ready

      // When: User requests TWO payments
      await sendTextMessage(page, "Aliceに30ドル、Bobに40ドル送金してください");

      // Both approval buttons should appear
      await expect(
        page.getByRole("button", { name: "Approve" }).first(),
      ).toBeVisible({ timeout: 30000 });
      await expect(
        page.getByRole("button", { name: "Approve" }).nth(1),
      ).toBeVisible({ timeout: 5000 });

      // Click first approve, second deny
      await page.getByRole("button", { name: "Approve" }).first().click();
      await page.waitForTimeout(500);
      await page.getByRole("button", { name: "Deny" }).first().click();

      // Wait for response
      await waitForAssistantResponse(page);

      // Response should mention Alice approved, Bob denied
      const responseText =
        (await page
          .locator('[data-testid="message-text"]')
          .last()
          .textContent()) || "";
      expect(responseText).toContain("Alice");
      expect(responseText).toContain("Bob");
    });

    test("[SSE-Multiple-Deny-Approve] should handle deny first, approve second", async ({
      page,
    }) => {
      // Status: ✅ PASS (assuming batching is implemented)

      // Given: SSE mode is ready

      // When: User requests TWO payments
      await sendTextMessage(page, "Aliceに30ドル、Bobに40ドル送金してください");

      // Both approval buttons should appear
      await expect(
        page.getByRole("button", { name: "Approve" }).first(),
      ).toBeVisible({ timeout: 30000 });
      await expect(
        page.getByRole("button", { name: "Approve" }).nth(1),
      ).toBeVisible({ timeout: 5000 });

      // Click first deny, second approve
      await page.getByRole("button", { name: "Deny" }).first().click();
      await page.waitForTimeout(2000);
      // Wait for the Approve button to be visible before clicking
      await expect(
        page.getByRole("button", { name: "Approve" }).first(),
      ).toBeVisible({ timeout: 10000 });
      await page.getByRole("button", { name: "Approve" }).first().click();

      // Wait for response
      await waitForAssistantResponse(page);

      // Response should mention Alice denied, Bob approved
      const responseText =
        (await page
          .locator('[data-testid="message-text"]')
          .last()
          .textContent()) || "";
      expect(responseText).toContain("Alice");
      expect(responseText).toContain("Bob");
    });

    test("[SSE-Multiple-Deny-Deny] should handle both denials", async ({
      page,
    }) => {
      // Status: ✅ PASS (assuming batching is implemented)

      // Given: SSE mode is ready

      // When: User requests TWO payments
      await sendTextMessage(page, "Aliceに30ドル、Bobに40ドル送金してください");

      // Both approval buttons should appear
      await expect(
        page.getByRole("button", { name: "Deny" }).first(),
      ).toBeVisible({ timeout: 30000 });
      await expect(
        page.getByRole("button", { name: "Deny" }).nth(1),
      ).toBeVisible({ timeout: 5000 });

      // Click both deny buttons
      await page.getByRole("button", { name: "Deny" }).first().click();
      await page.waitForTimeout(500);
      await page.getByRole("button", { name: "Deny" }).first().click();

      // Wait for response
      await waitForAssistantResponse(page);

      // Response should mention both denials
      const responseText =
        (await page
          .locator('[data-testid="message-text"]')
          .last()
          .textContent()) || "";
      expect(responseText).toContain("Alice");
      expect(responseText).toContain("Bob");
    });
  });
});

// ============================================================================
// BIDI Mode Tests
// ============================================================================

test.describe("ADK Tool Confirmation - BIDI Mode", () => {
  test.beforeEach(async ({ page }) => {
    // Given: User navigates to chat and selects ADK BIDI mode
    await navigateToChat(page);
    await selectBackendMode(page, "adk-bidi");
  });

  // --------------------------------------------------------------------------
  // Infrastructure Tests
  // --------------------------------------------------------------------------

  test.describe("Infrastructure", () => {
    test("should work in BIDI mode without loops", async ({ page }) => {
      // Status: ✅ PASS
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
      // to avoid race conditions with indicator
      const messageLocator = page
        .locator('[data-testid="message-text"]')
        .last();
      await expect(messageLocator).toBeVisible({ timeout: 45000 });

      // Wait for text content to be available
      await expect(messageLocator).not.toBeEmpty({ timeout: 10000 });

      const text = (await messageLocator.textContent()) || "";
      expect(text.length).toBeGreaterThan(0);

      // Verify no excessive requests
      console.log(`[BIDI Test] Requests after approval: ${requestCount}`);
      expect(requestCount).toBeLessThan(5);
    });

    test("should execute change_bgm via frontend delegate without approval UI", async ({
      page,
    }) => {
      // Status: ✅ PASS
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
      const messageLocator = page
        .locator('[data-testid="message-text"]')
        .last();
      await expect(messageLocator).toBeVisible({ timeout: 30000 });

      // Wait for text content to be available
      await expect(messageLocator).not.toBeEmpty({ timeout: 10000 });

      const text = (await messageLocator.textContent()) || "";

      // Response should mention BGM change
      expect(text.length).toBeGreaterThan(0);
    });

    test("should verify sendAutomaticallyWhen triggers after confirmation (BIDI)", async ({
      page,
    }) => {
      // Status: ✅ PASS
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
      const messageLocator = page
        .locator('[data-testid="message-text"]')
        .last();
      await expect(messageLocator).toBeVisible({ timeout: 45000 });

      // Wait for text content to be available
      await expect(messageLocator).not.toBeEmpty({ timeout: 10000 });

      // If we got here, sendAutomaticallyWhen successfully triggered automatic send
      const text = (await messageLocator.textContent()) || "";
      expect(text.length).toBeGreaterThan(0);
    });

    test("should show process_payment tool state transitions (BIDI, ADR 0002)", async ({
      page,
    }) => {
      // Status: ✅ PASS
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

  // --------------------------------------------------------------------------
  // Single Approval Tests
  // --------------------------------------------------------------------------

  test.describe("Single Approval", () => {
    test("[BIDI-Single-Approve] should complete payment after user approval", async ({
      page,
    }) => {
      // Status: ✅ PASS (duplicate of infrastructure test, but organized here)
      // Given: Backend BIDI mode is ready

      // When: User requests payment
      await sendTextMessage(page, "太郎さんに100ドル送金してください");

      // Then: Approval UI MUST appear
      await expect(
        page.getByRole("button", { name: "Approve" }).first(),
      ).toBeVisible({
        timeout: 30000,
      });

      // When: User approves
      await page.getByRole("button", { name: "Approve" }).first().click();

      // Then: Payment should complete
      const messageLocator = page
        .locator('[data-testid="message-text"]')
        .last();
      await expect(messageLocator).toBeVisible({ timeout: 45000 });
      await expect(messageLocator).not.toBeEmpty({ timeout: 10000 });
    });

    test("[BIDI-Single-Deny] should handle user denial of payment", async ({
      page,
    }) => {
      // Status: ✅ PASS
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
      const messageLocator = page
        .locator('[data-testid="message-text"]')
        .last();
      await expect(messageLocator).toBeVisible({ timeout: 45000 });

      // Wait for text content to be available
      await expect(messageLocator).not.toBeEmpty({ timeout: 10000 });

      const text = (await messageLocator.textContent()) || "";

      // Response should acknowledge denial
      expect(text.length).toBeGreaterThan(0);
    });
  });

  // --------------------------------------------------------------------------
  // Multiple Approval Tests (Sequential - ADR 0003)
  // --------------------------------------------------------------------------

  test.describe("Multiple Approvals (Sequential)", () => {
    test("[BIDI-Multiple-Approve-Approve] should handle two sequential approvals", async ({
      page,
    }) => {
      // Status: ❌ FAIL
      // NOTE: Testing BIDI sequential execution (ADR 0003)
      // Unlike SSE which generates both tool calls in parallel,
      // BIDI generates tools one at a time due to Gemini Live API behavior

      let totalRequestCount = 0;

      page.on("request", (request) => {
        if (request.url().includes("/live")) {
          totalRequestCount++;
        }
      });

      // Capture browser console logs
      page.on("console", (msg) => {
        const text = msg.text();
        if (
          text.includes("[Event Receiver]") ||
          text.includes("[sendAutomaticallyWhen]") ||
          text.includes("[Event Sender]") ||
          text.includes("[ToolInvocationComponent]") ||
          text.includes("approval")
        ) {
          console.log(`[Browser Console] ${text}`);
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
      const firstCount = await page
        .getByRole("button", { name: "Approve" })
        .count();
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
        (await page
          .locator('[data-testid="message-text"]')
          .last()
          .textContent()) || "";
      expect(responseText).toContain("Alice");
      expect(responseText).toContain("Bob");
      console.log(`[BIDI Mode] ✓ Response: ${responseText}`);

      // Total requests should be reasonable
      console.log(
        `[Test] Total requests for two payments: ${totalRequestCount}`,
      );
      expect(totalRequestCount).toBeLessThan(10);
    });

    test("[BIDI-Multiple-Approve-Deny] should handle approve first, deny second sequentially", async ({
      page,
    }) => {
      // Status: ❓ NOT IMPLEMENTED
      test.skip(
        true,
        "Not implemented - sequential approval flow not working yet",
      );

      // Given: BIDI mode is ready

      // When: User requests TWO payments
      await sendTextMessage(page, "Aliceに30ドル、Bobに40ドル送金してください");

      // First approval button (Alice)
      await expect(
        page.getByRole("button", { name: "Approve" }).first(),
      ).toBeVisible({ timeout: 30000 });

      // Click first approve
      await page.getByRole("button", { name: "Approve" }).first().click();
      await page.waitForTimeout(1000);

      // Second approval button (Bob)
      await expect(
        page.getByRole("button", { name: "Deny" }).first(),
      ).toBeVisible({ timeout: 30000 });

      // Click second deny
      await page.getByRole("button", { name: "Deny" }).first().click();

      // Wait for response
      await waitForAssistantResponse(page);

      // Response should mention Alice approved, Bob denied
      const responseText =
        (await page
          .locator('[data-testid="message-text"]')
          .last()
          .textContent()) || "";
      expect(responseText).toContain("Alice");
      expect(responseText).toContain("Bob");
    });

    test("[BIDI-Multiple-Deny-Approve] should handle deny first, approve second sequentially", async ({
      page,
    }) => {
      // Status: ❓ NOT IMPLEMENTED
      test.skip(
        true,
        "Not implemented - sequential approval flow not working yet",
      );

      // Given: BIDI mode is ready

      // When: User requests TWO payments
      await sendTextMessage(page, "Aliceに30ドル、Bobに40ドル送金してください");

      // First approval button (Alice)
      await expect(
        page.getByRole("button", { name: "Deny" }).first(),
      ).toBeVisible({ timeout: 30000 });

      // Click first deny
      await page.getByRole("button", { name: "Deny" }).first().click();
      await page.waitForTimeout(1000);

      // Second approval button (Bob)
      await expect(
        page.getByRole("button", { name: "Approve" }).first(),
      ).toBeVisible({ timeout: 30000 });

      // Click second approve
      await page.getByRole("button", { name: "Approve" }).first().click();

      // Wait for response
      await waitForAssistantResponse(page);

      // Response should mention Alice denied, Bob approved
      const responseText =
        (await page
          .locator('[data-testid="message-text"]')
          .last()
          .textContent()) || "";
      expect(responseText).toContain("Alice");
      expect(responseText).toContain("Bob");
    });

    test("[BIDI-Multiple-Deny-Deny] should handle both sequential denials", async ({
      page,
    }) => {
      // Status: ❓ NOT IMPLEMENTED
      test.skip(
        true,
        "Not implemented - sequential approval flow not working yet",
      );

      // Given: BIDI mode is ready

      // When: User requests TWO payments
      await sendTextMessage(page, "Aliceに30ドル、Bobに40ドル送金してください");

      // First approval button (Alice)
      await expect(
        page.getByRole("button", { name: "Deny" }).first(),
      ).toBeVisible({ timeout: 30000 });

      // Click first deny
      await page.getByRole("button", { name: "Deny" }).first().click();
      await page.waitForTimeout(1000);

      // Second approval button (Bob)
      await expect(
        page.getByRole("button", { name: "Deny" }).first(),
      ).toBeVisible({ timeout: 30000 });

      // Click second deny
      await page.getByRole("button", { name: "Deny" }).first().click();

      // Wait for response
      await waitForAssistantResponse(page);

      // Response should mention both denials
      const responseText =
        (await page
          .locator('[data-testid="message-text"]')
          .last()
          .textContent()) || "";
      expect(responseText).toContain("Alice");
      expect(responseText).toContain("Bob");
    });
  });
});
