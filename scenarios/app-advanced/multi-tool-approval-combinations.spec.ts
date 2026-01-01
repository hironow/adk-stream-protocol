import { expect, test } from "@playwright/test";
import {
  downloadFrontendChunkLogs,
  sendTextMessage,
  setupFrontendConsoleLogger,
  waitForAssistantResponse,
} from "../helpers";

/**
 * Multi-Tool Approval Combinations - Advanced Tests
 *
 * Tests all 2×2 combinations of approve/deny for multiple simultaneous tool calls.
 * Verifies that the frontend correctly handles mixed approval responses when
 * multiple tools are requested in a single message.
 *
 * Test Coverage:
 * - Approve×Approve: Both payments approved
 * - Approve×Deny: First approved, second denied
 * - Deny×Approve: First denied, second approved (SSE only)
 * - Deny×Deny: Both payments denied (SSE only)
 *
 * Note: Deny×Approve and Deny×Deny are SSE-only due to BIDI mode's sequential
 * execution blocking on first denial. SSE mode executes tools in parallel.
 *
 * Related Tests:
 * - Backend E2E: tests/e2e/backend_fixture/test_multiple_payments_*
 * - Frontend E2E (vitest): lib/tests/e2e/process-payment-double-*.e2e.test.tsx
 */
test.describe("Multi-Tool Approval Combinations (Advanced)", () => {
  test.beforeEach(async ({ page }) => {
    // Setup frontend console logger
    const sessionId =
      process.env.NEXT_PUBLIC_CHUNK_LOGGER_SESSION_ID ||
      process.env.CHUNK_LOGGER_SESSION_ID ||
      "multi-approval";
    setupFrontendConsoleLogger(page, sessionId);

    await page.goto("http://localhost:3000");

    // Note: Chunk logger reads session ID from NEXT_PUBLIC_CHUNK_LOGGER_SESSION_ID
    // environment variable at module load time, not from localStorage
  });

  test.afterEach(async ({ page }, testInfo) => {
    // Download frontend chunk logs after each test
    const testName = testInfo.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    await downloadFrontendChunkLogs(page, `multi-tool-approval-${testName}`);
  });

  test("SSE Mode: Approve×Approve - Both payments approved", async ({
    page,
  }) => {
    // Given: SSE mode for parallel tool execution
    await page.click("text=ADK SSE");
    await page.waitForTimeout(1000);

    let requestCount = 0;
    page.on("request", (request) => {
      if (request.url().includes("/stream")) {
        requestCount++;
        console.log(`[Approve×Approve SSE] Request #${requestCount}`);
      }
    });

    // When: Request multiple payments in one message
    console.log(
      "[Approve×Approve SSE] Requesting payments to Alice and Bob...",
    );
    await sendTextMessage(
      page,
      "Aliceさんに30ドル、Bobさんに40ドル送金してください",
    );

    // Then: Wait for approval UI for both payments
    console.log("[Approve×Approve SSE] Waiting for approval buttons...");
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(2, {
      timeout: 10000,
    });

    // Approve both payments (click .first() twice, as DOM updates after first click)
    requestCount = 0;
    console.log("[Approve×Approve SSE] Approving first payment...");
    await page.getByRole("button", { name: "Approve" }).first().click();
    await page.waitForTimeout(500);

    console.log("[Approve×Approve SSE] Approving second payment...");
    await page.getByRole("button", { name: "Approve" }).first().click();

    // Wait for AI response
    console.log("[Approve×Approve SSE] Waiting for AI response...");
    await waitForAssistantResponse(page, { timeout: 30000 });

    // Verify both payments succeeded in assistant message
    console.log("[Approve×Approve SSE] Verifying success messages...");
    await expect(page.getByText(/完了|completed|success/i).last()).toBeVisible({
      timeout: 5000,
    });

    // Verify no infinite loop
    await page.waitForTimeout(2000);
    console.log(`[Approve×Approve SSE] Request count: ${requestCount}`);
    expect(requestCount).toBeLessThanOrEqual(1);

    console.log("[Approve×Approve SSE] ✅ PASSED");
  });

  test("SSE Mode: Approve×Deny - First approved, second denied", async ({
    page,
  }) => {
    // Given: SSE mode for parallel tool execution
    await page.click("text=ADK SSE");
    await page.waitForTimeout(1000);

    let requestCount = 0;
    page.on("request", (request) => {
      if (request.url().includes("/stream")) {
        requestCount++;
        console.log(`[Approve×Deny SSE] Request #${requestCount}`);
      }
    });

    // When: Request multiple payments
    console.log("[Approve×Deny SSE] Requesting payments to Alice and Bob...");
    await sendTextMessage(
      page,
      "Aliceさんに30ドル、Bobさんに40ドル送金してください",
    );

    // Then: Wait for approval UI
    console.log("[Approve×Deny SSE] Waiting for approval/deny buttons...");
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(2, {
      timeout: 10000,
    });
    await expect(page.getByRole("button", { name: "Deny" })).toHaveCount(2, {
      timeout: 10000,
    });

    // Approve first, deny second (DOM updates after first click)
    requestCount = 0;
    console.log("[Approve×Deny SSE] Approving first payment...");
    await page.getByRole("button", { name: "Approve" }).first().click();
    await page.waitForTimeout(500);

    console.log("[Approve×Deny SSE] Denying second payment...");
    await page.getByRole("button", { name: "Deny" }).first().click();

    // Wait for AI response
    console.log("[Approve×Deny SSE] Waiting for AI response...");
    await waitForAssistantResponse(page, { timeout: 30000 });

    // Verify mixed results in assistant response
    console.log("[Approve×Deny SSE] Verifying mixed results...");
    await expect(page.getByTestId("message-assistant").last()).toContainText(
      /成功|success/i,
      { timeout: 5000 },
    );
    await expect(page.getByTestId("message-assistant").last()).toContainText(
      /拒否|denied|rejected/i,
      { timeout: 5000 },
    );

    // Verify no infinite loop
    await page.waitForTimeout(2000);
    console.log(`[Approve×Deny SSE] Request count: ${requestCount}`);
    expect(requestCount).toBeLessThanOrEqual(1);

    console.log("[Approve×Deny SSE] ✅ PASSED");
  });

  test("SSE Mode: Deny×Approve - First denied, second approved", async ({
    page,
  }) => {
    // Given: SSE mode for parallel tool execution
    await page.click("text=ADK SSE");
    await page.waitForTimeout(1000);

    let requestCount = 0;
    page.on("request", (request) => {
      if (request.url().includes("/stream")) {
        requestCount++;
        console.log(`[Deny×Approve SSE] Request #${requestCount}`);
      }
    });

    // When: Request multiple payments
    console.log("[Deny×Approve SSE] Requesting payments to Alice and Bob...");
    await sendTextMessage(
      page,
      "Aliceさんに30ドル、Bobさんに40ドル送金してください",
    );

    // Then: Wait for approval UI
    console.log("[Deny×Approve SSE] Waiting for approval/deny buttons...");
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(2, {
      timeout: 10000,
    });
    await expect(page.getByRole("button", { name: "Deny" })).toHaveCount(2, {
      timeout: 10000,
    });

    // Deny first, approve second (DOM updates after first click)
    requestCount = 0;
    console.log("[Deny×Approve SSE] Denying first payment...");
    await page.getByRole("button", { name: "Deny" }).first().click();
    await page.waitForTimeout(500);

    console.log("[Deny×Approve SSE] Approving second payment...");
    await page.getByRole("button", { name: "Approve" }).first().click();

    // Wait for AI response
    console.log("[Deny×Approve SSE] Waiting for AI response...");
    await waitForAssistantResponse(page, { timeout: 30000 });

    // Verify mixed results in assistant response
    console.log("[Deny×Approve SSE] Verifying mixed results...");
    await expect(page.getByTestId("message-assistant").last()).toContainText(
      /拒否|denied|rejected/i,
      { timeout: 5000 },
    );
    await expect(page.getByTestId("message-assistant").last()).toContainText(
      /成功|success/i,
      { timeout: 5000 },
    );

    // Verify no infinite loop
    await page.waitForTimeout(2000);
    console.log(`[Deny×Approve SSE] Request count: ${requestCount}`);
    expect(requestCount).toBeLessThanOrEqual(1);

    console.log("[Deny×Approve SSE] ✅ PASSED");
  });

  test("SSE Mode: Deny×Deny - Both payments denied", async ({ page }) => {
    // Given: SSE mode for parallel tool execution
    await page.click("text=ADK SSE");
    await page.waitForTimeout(1000);

    let requestCount = 0;
    const requestTimestamps: number[] = [];

    page.on("request", (request) => {
      if (request.url().includes("/stream")) {
        requestCount++;
        requestTimestamps.push(Date.now());
        console.log(`[Deny×Deny SSE] Request #${requestCount}`);

        // Safety: Detect infinite loop
        if (requestCount > 10) {
          throw new Error(
            `INFINITE LOOP DETECTED: ${requestCount} requests in ${
              (Date.now() - requestTimestamps[0]) / 1000
            }s`,
          );
        }
      }
    });

    // When: Request multiple payments
    console.log("[Deny×Deny SSE] Requesting payments to Alice and Bob...");
    await sendTextMessage(
      page,
      "Aliceさんに30ドル、Bobさんに40ドル送金してください",
    );

    // Then: Wait for approval UI
    console.log("[Deny×Deny SSE] Waiting for deny buttons...");
    await expect(page.getByRole("button", { name: "Deny" })).toHaveCount(2, {
      timeout: 10000,
    });

    // Deny both payments (DOM updates after first click)
    requestCount = 0;
    requestTimestamps.length = 0;

    console.log("[Deny×Deny SSE] Denying first payment...");
    await page.getByRole("button", { name: "Deny" }).first().click();
    await page.waitForTimeout(500);

    console.log("[Deny×Deny SSE] Denying second payment...");
    await page.getByRole("button", { name: "Deny" }).first().click();

    // Wait for AI response
    console.log("[Deny×Deny SSE] Waiting for AI response...");
    await waitForAssistantResponse(page, { timeout: 30000 });

    // Verify both payments denied in assistant response
    console.log("[Deny×Deny SSE] Verifying denial messages...");
    await expect(page.getByTestId("message-assistant").last()).toContainText(
      /拒否|denied|rejected/i,
      { timeout: 5000 },
    );

    // CRITICAL: Verify no infinite loop
    await page.waitForTimeout(3000);
    console.log(
      `[Deny×Deny SSE] Request count: ${requestCount}, timestamps: ${requestTimestamps.join(", ")}`,
    );
    expect(requestCount).toBeLessThanOrEqual(1);

    console.log("[Deny×Deny SSE] ✅ PASSED - No infinite loop");
  });

  test("BIDI Mode: Approve×Approve - Sequential execution", async ({
    page,
  }) => {
    // Given: BIDI mode for sequential tool execution
    await page.click("text=ADK BIDI");
    await page.waitForTimeout(1000);

    let requestCount = 0;
    page.on("request", (request) => {
      if (request.url().includes("/live")) {
        requestCount++;
        console.log(`[Approve×Approve BIDI] Request #${requestCount}`);
      }
    });

    // When: Request multiple payments
    console.log(
      "[Approve×Approve BIDI] Requesting payments to Alice and Bob...",
    );
    await sendTextMessage(
      page,
      "Aliceさんに30ドル、Bobさんに40ドル送金してください",
    );

    // Then: Wait for first approval (Alice)
    console.log("[Approve×Approve BIDI] Waiting for Alice approval...");
    await expect(
      page.getByRole("button", { name: "Approve" }).first(),
    ).toBeVisible({ timeout: 30000 });

    requestCount = 0;
    console.log("[Approve×Approve BIDI] Approving Alice payment...");
    await page.getByRole("button", { name: "Approve" }).first().click();

    // Wait for second approval (Bob)
    console.log("[Approve×Approve BIDI] Waiting for Bob approval...");
    await page.waitForTimeout(3000);
    await expect(
      page.getByRole("button", { name: "Approve" }).first(),
    ).toBeVisible({ timeout: 30000 });

    console.log("[Approve×Approve BIDI] Approving Bob payment...");
    await page.getByRole("button", { name: "Approve" }).first().click();

    // Wait for final response
    console.log("[Approve×Approve BIDI] Waiting for final response...");
    await waitForAssistantResponse(page, { timeout: 30000 });

    // Verify both payments succeeded in assistant response
    console.log("[Approve×Approve BIDI] Verifying success messages...");
    await expect(page.getByTestId("message-assistant").last()).toContainText(
      /送金|completed/i,
      { timeout: 5000 },
    );

    // Verify no infinite loop
    await page.waitForTimeout(2000);
    console.log(`[Approve×Approve BIDI] Request count: ${requestCount}`);
    expect(requestCount).toBeLessThanOrEqual(2);

    console.log("[Approve×Approve BIDI] ✅ PASSED");
  });

  test("BIDI Mode: Approve×Deny - Alice approved, Bob denied", async ({
    page,
  }) => {
    // Given: BIDI mode for sequential tool execution
    await page.click("text=ADK BIDI");
    await page.waitForTimeout(1000);

    let requestCount = 0;
    page.on("request", (request) => {
      if (request.url().includes("/live")) {
        requestCount++;
        console.log(`[Approve×Deny BIDI] Request #${requestCount}`);
      }
    });

    // When: Request multiple payments
    console.log("[Approve×Deny BIDI] Requesting payments to Alice and Bob...");
    await sendTextMessage(
      page,
      "Aliceさんに30ドル、Bobさんに40ドル送金してください",
    );

    // Then: Wait for first approval (Alice)
    console.log("[Approve×Deny BIDI] Waiting for Alice approval...");
    await expect(
      page.getByRole("button", { name: "Approve" }).first(),
    ).toBeVisible({ timeout: 30000 });

    requestCount = 0;
    console.log("[Approve×Deny BIDI] Approving Alice payment...");
    await page.getByRole("button", { name: "Approve" }).first().click();

    // Wait for second approval (Bob)
    console.log("[Approve×Deny BIDI] Waiting for Bob approval...");
    await page.waitForTimeout(3000);
    await expect(
      page.getByRole("button", { name: "Deny" }).first(),
    ).toBeVisible({ timeout: 30000 });

    console.log("[Approve×Deny BIDI] Denying Bob payment...");
    await page.getByRole("button", { name: "Deny" }).first().click();

    // Wait for final response
    console.log("[Approve×Deny BIDI] Waiting for final response...");
    await waitForAssistantResponse(page, { timeout: 30000 });

    // Verify mixed results in assistant response
    console.log("[Approve×Deny BIDI] Verifying mixed results...");
    await expect(page.getByTestId("message-assistant").last()).toContainText(
      /送金|success/i,
      { timeout: 5000 },
    );
    await expect(page.getByTestId("message-assistant").last()).toContainText(
      /拒否|denied|rejected/i,
      { timeout: 5000 },
    );

    // Verify no infinite loop
    await page.waitForTimeout(2000);
    console.log(`[Approve×Deny BIDI] Request count: ${requestCount}`);
    expect(requestCount).toBeLessThanOrEqual(2);

    console.log("[Approve×Deny BIDI] ✅ PASSED");
  });

  test("BIDI Mode: Sequential-Only Execution - Only one approval at a time (ADR 0003)", async ({
    page,
  }) => {
    // Given: BIDI mode enforces sequential tool execution
    await page.click("text=ADK BIDI");
    await page.waitForTimeout(1000);

    console.log(
      "[BIDI Sequential-Only] Requesting payments to Alice and Bob...",
    );
    await sendTextMessage(
      page,
      "Aliceさんに30ドル、Bobさんに40ドル送金してください",
    );

    // Then: Verify ONLY ONE approval button appears initially
    console.log(
      "[BIDI Sequential-Only] Verifying only 1 approval button appears...",
    );
    await expect(
      page.getByRole("button", { name: "Approve" }).first(),
    ).toBeVisible({ timeout: 30000 });

    // CRITICAL: Verify second approval button does NOT exist yet (sequential execution)
    const approvalCount = await page
      .getByRole("button", { name: "Approve" })
      .count();
    console.log(
      `[BIDI Sequential-Only] Approval button count: ${approvalCount}`,
    );
    expect(approvalCount).toBe(1); // Only 1 approval at a time

    // When: Approve first payment
    console.log("[BIDI Sequential-Only] Approving first payment...");
    await page.getByRole("button", { name: "Approve" }).first().click();

    // Then: Wait for second approval to appear (sequential execution)
    console.log(
      "[BIDI Sequential-Only] Waiting for second approval to appear...",
    );
    await page.waitForTimeout(3000);
    await expect(
      page.getByRole("button", { name: "Approve" }).first(),
    ).toBeVisible({ timeout: 30000 });

    // Verify still only 1 approval button (second payment, first completed)
    const secondApprovalCount = await page
      .getByRole("button", { name: "Approve" })
      .count();
    console.log(
      `[BIDI Sequential-Only] Second approval button count: ${secondApprovalCount}`,
    );
    expect(secondApprovalCount).toBe(1); // Still only 1 approval at a time

    // Approve second payment to complete the test
    console.log("[BIDI Sequential-Only] Approving second payment...");
    await page.getByRole("button", { name: "Approve" }).first().click();

    // Wait for final response
    console.log("[BIDI Sequential-Only] Waiting for final response...");
    await waitForAssistantResponse(page, { timeout: 30000 });

    console.log(
      "[BIDI Sequential-Only] ✅ PASSED - Verified sequential execution",
    );
  });
});
