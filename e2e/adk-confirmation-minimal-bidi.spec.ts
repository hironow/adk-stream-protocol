import { expect, test } from "@playwright/test";
import { sendTextMessage, waitForAssistantResponse } from "./helpers";

/**
 * ADK Tool Confirmation - Minimal Test Suite (BIDI Mode)
 *
 * Purpose: Cover all critical scenarios with minimal test cases in BIDI mode
 * Approach: Test-Driven Development (RED → GREEN → REFACTOR)
 *
 * BIDI Mode Differences:
 * - Uses WebSocket bidirectional communication (/live endpoint)
 * - Frontend can delegate tool execution (change_bgm auto-executes)
 * - Confirmation flow should work the same as SSE mode
 *
 * Test Cases:
 * 1. Normal Flow - Approve Once
 * 2. Denial Flow - Deny Once (CRITICAL: Prevents infinite loop)
 * 3. Sequential Flow - Approve Twice
 * 4. Deny Then Approve (State reset verification)
 * 5. Approve Then Deny (Reverse order verification)
 */

test.describe("ADK Tool Confirmation - Minimal Test Suite (BIDI)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("http://localhost:3000");
    // Select ADK BIDI mode
    await page.click("text=ADK BIDI");
    // Wait for mode selection to take effect
    await page.waitForTimeout(1000);
  });

  test("1. Normal Flow - Approve Once", async ({ page }) => {
    let requestCount = 0;
    page.on("request", (request) => {
      if (request.url().includes("/live")) {
        requestCount++;
        console.log(`[BIDI Test 1] Request #${requestCount}: ${request.url()}`);
      }
    });

    console.log("[BIDI Test 1] Requesting payment...");
    await sendTextMessage(page, "花子さんに50ドル送金してください");

    console.log("[BIDI Test 1] Waiting for approval UI...");
    await expect(
      page.getByRole("button", { name: "Approve" }).first(),
    ).toBeVisible({
      timeout: 30000,
    });

    // Reset counter before approval
    requestCount = 0;
    console.log("[BIDI Test 1] Approval UI visible, clicking Approve...");

    // Approve
    await page.getByRole("button", { name: "Approve" }).first().click();

    console.log("[BIDI Test 1] Waiting for AI response...");
    await waitForAssistantResponse(page, { timeout: 30000 });

    // Verify AI text response
    console.log("[BIDI Test 1] Verifying AI text response...");
    await expect(
      page.getByText(/送金しました|送金が完了|送金しました/),
    ).toBeVisible({
      timeout: 5000,
    });

    // Wait a bit to ensure no automatic send
    await page.waitForTimeout(2000);

    // Verify no infinite loop
    console.log(
      `[BIDI Test 1] Request count after approval: ${requestCount}`,
    );
    expect(requestCount).toBeLessThanOrEqual(1);

    console.log("[BIDI Test 1] ✅ PASSED");
  });

  test("2. Denial Flow - Deny Once (CRITICAL: No infinite loop)", async ({
    page,
  }) => {
    let requestCount = 0;
    const requestTimestamps: number[] = [];

    page.on("request", (request) => {
      if (request.url().includes("/live")) {
        requestCount++;
        requestTimestamps.push(Date.now());
        console.log(
          `[BIDI Test 2] Request #${requestCount}: ${request.url()}`,
        );

        // Safety: Fail fast if infinite loop detected
        if (requestCount > 10) {
          throw new Error(
            `INFINITE LOOP DETECTED: ${requestCount} requests in ${
              (Date.now() - requestTimestamps[0]) / 1000
            }s`,
          );
        }
      }
    });

    console.log("[BIDI Test 2] Requesting payment...");
    await sendTextMessage(page, "次郎さんに200ドル送金してください");

    console.log("[BIDI Test 2] Waiting for approval UI...");
    await expect(
      page.getByRole("button", { name: "Deny" }).first(),
    ).toBeVisible({
      timeout: 30000,
    });

    // Reset counter before denial
    requestCount = 0;
    requestTimestamps.length = 0;
    console.log("[BIDI Test 2] Approval UI visible, clicking Deny...");

    // Deny
    await page.getByRole("button", { name: "Deny" }).first().click();

    console.log("[BIDI Test 2] Waiting for AI response...");
    await waitForAssistantResponse(page, { timeout: 30000 });

    // Verify AI text response (denial message)
    console.log("[BIDI Test 2] Verifying denial message...");
    await expect(
      page.getByText(/拒否|キャンセル|承認されませんでした/),
    ).toBeVisible({
      timeout: 5000,
    });

    // Wait to ensure no infinite loop
    console.log("[BIDI Test 2] Waiting to detect potential infinite loop...");
    await page.waitForTimeout(3000);

    // Critical assertion: NO infinite loop
    console.log(
      `[BIDI Test 2] Request count after denial: ${requestCount}, timestamps: ${requestTimestamps.join(", ")}`,
    );
    expect(requestCount).toBeLessThanOrEqual(1);

    console.log("[BIDI Test 2] ✅ PASSED - No infinite loop detected");
  });

  test("3. Sequential Flow - Approve Twice", async ({ page }) => {
    let totalRequestCount = 0;

    page.on("request", (request) => {
      if (request.url().includes("/live")) {
        totalRequestCount++;
        console.log(
          `[BIDI Test 3] Request #${totalRequestCount}: ${request.url()}`,
        );
      }
    });

    // Payment 1
    console.log("[BIDI Test 3] Payment 1: Alice...");
    await sendTextMessage(page, "Aliceさんに30ドル送金してください");
    await expect(
      page.getByRole("button", { name: "Approve" }).first(),
    ).toBeVisible({
      timeout: 30000,
    });
    await page.getByRole("button", { name: "Approve" }).first().click();
    await waitForAssistantResponse(page, { timeout: 30000 });
    console.log("[BIDI Test 3] Payment 1 completed");

    // Payment 2
    console.log("[BIDI Test 3] Payment 2: Bob...");
    await sendTextMessage(page, "Bobさんに40ドル送金してください");
    await expect(
      page.getByRole("button", { name: "Approve" }).first(),
    ).toBeVisible({
      timeout: 30000,
    });
    await page.getByRole("button", { name: "Approve" }).first().click();
    await waitForAssistantResponse(page, { timeout: 30000 });
    console.log("[BIDI Test 3] Payment 2 completed");

    // Verify total requests
    console.log(`[BIDI Test 3] Total requests: ${totalRequestCount}`);
    expect(totalRequestCount).toBeLessThanOrEqual(4);

    console.log("[BIDI Test 3] ✅ PASSED");
  });

  test("4. Deny Then Approve (State reset verification)", async ({ page }) => {
    let requestCount = 0;

    page.on("request", (request) => {
      if (request.url().includes("/live")) {
        requestCount++;
        console.log(
          `[BIDI Test 4] Request #${requestCount}: ${request.url()}`,
        );
      }
    });

    // Payment 1 - Deny
    console.log("[BIDI Test 4] Payment 1 (Deny): Charlie...");
    await sendTextMessage(page, "Charlieさんに100ドル送金してください");
    await expect(
      page.getByRole("button", { name: "Deny" }).first(),
    ).toBeVisible({
      timeout: 30000,
    });
    requestCount = 0;
    await page.getByRole("button", { name: "Deny" }).first().click();
    await waitForAssistantResponse(page, { timeout: 30000 });
    await page.waitForTimeout(2000);

    const denyRequests = requestCount;
    console.log(`[BIDI Test 4] Deny requests: ${denyRequests}`);
    expect(denyRequests).toBeLessThanOrEqual(1);

    // Payment 2 - Approve
    console.log("[BIDI Test 4] Payment 2 (Approve): Diana...");
    await sendTextMessage(page, "Dianaさんに50ドル送金してください");
    await expect(
      page.getByRole("button", { name: "Approve" }).first(),
    ).toBeVisible({
      timeout: 30000,
    });
    requestCount = 0;
    await page.getByRole("button", { name: "Approve" }).first().click();
    await waitForAssistantResponse(page, { timeout: 30000 });
    await page.waitForTimeout(2000);

    const approveRequests = requestCount;
    console.log(`[BIDI Test 4] Approve requests: ${approveRequests}`);
    expect(approveRequests).toBeLessThanOrEqual(1);

    console.log("[BIDI Test 4] ✅ PASSED - State properly resets");
  });

  test("5. Approve Then Deny (Reverse order verification)", async ({
    page,
  }) => {
    let requestCount = 0;

    page.on("request", (request) => {
      if (request.url().includes("/live")) {
        requestCount++;
        console.log(
          `[BIDI Test 5] Request #${requestCount}: ${request.url()}`,
        );
      }
    });

    // Payment 1 - Approve
    console.log("[BIDI Test 5] Payment 1 (Approve): Eve...");
    await sendTextMessage(page, "Eveさんに60ドル送金してください");
    await expect(
      page.getByRole("button", { name: "Approve" }).first(),
    ).toBeVisible({
      timeout: 30000,
    });
    requestCount = 0;
    await page.getByRole("button", { name: "Approve" }).first().click();
    await waitForAssistantResponse(page, { timeout: 30000 });
    await page.waitForTimeout(2000);

    const approveRequests = requestCount;
    console.log(`[BIDI Test 5] Approve requests: ${approveRequests}`);
    expect(approveRequests).toBeLessThanOrEqual(1);

    // Payment 2 - Deny
    console.log("[BIDI Test 5] Payment 2 (Deny): Frank...");
    await sendTextMessage(page, "Frankさんに70ドル送金してください");
    await expect(
      page.getByRole("button", { name: "Deny" }).first(),
    ).toBeVisible({
      timeout: 30000,
    });
    requestCount = 0;
    await page.getByRole("button", { name: "Deny" }).first().click();
    await waitForAssistantResponse(page, { timeout: 30000 });
    await page.waitForTimeout(2000);

    const denyRequests = requestCount;
    console.log(`[BIDI Test 5] Deny requests: ${denyRequests}`);
    expect(denyRequests).toBeLessThanOrEqual(1);

    console.log("[BIDI Test 5] ✅ PASSED - State properly managed");
  });
});
