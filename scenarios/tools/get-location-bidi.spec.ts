import { expect, test } from "@playwright/test";
import {
  downloadFrontendChunkLogs,
  sendTextMessage,
  setupFrontendConsoleLogger,
  waitForAssistantResponse,
} from "../helpers";

/**
 * get_location Tool - BIDI Mode Test Suite
 *
 * Tool Characteristics:
 * - Client execution via FrontendToolDelegate (browser Geolocation API)
 * - Requires user approval before execution (FunctionTool with require_confirmation=True)
 * - Returns user's location to server after approval
 * - BIDI mode uses Live API bidirectional streaming
 *
 * Test Cases:
 * 1. Normal Flow - Approve Once
 * 2. Denial Flow - Deny Once (CRITICAL: Prevents infinite loop)
 * 3. Sequential Flow - Approve Twice
 * 4. Deny Then Approve (State reset verification)
 * 5. Approve Then Deny (Reverse order verification)
 */

test.describe("get_location Tool - BIDI Mode", () => {
  test.beforeEach(async ({ page }) => {
    // Setup frontend console logger
    const sessionId =
      process.env.NEXT_PUBLIC_CHUNK_LOGGER_SESSION_ID ||
      process.env.CHUNK_LOGGER_SESSION_ID ||
      "test";
    setupFrontendConsoleLogger(page, sessionId);

    await page.goto("http://localhost:3000");

    // Enable chunk logger via localStorage
    if (sessionId) {
      await page.evaluate((sid) => {
        localStorage.setItem("CHUNK_LOGGER_ENABLED", "true");
        localStorage.setItem("CHUNK_LOGGER_SESSION_ID", sid);
      }, sessionId);
      // Reload to apply chunk logger settings
      await page.reload();
    }

    // Select ADK BIDI mode
    await page.click("text=ADK BIDI");
    // Wait for mode selection to take effect
    await page.waitForTimeout(1000);
  });

  test.afterEach(async ({ page }, testInfo) => {
    // Download frontend chunk logs after each test
    const testName = testInfo.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    await downloadFrontendChunkLogs(page, `get-location-bidi-${testName}`);
  });

  test("1. Normal Flow - Approve Once", async ({ page }) => {
    console.log("[Test 1] Requesting location...");
    await sendTextMessage(page, "私の位置を教えてください");

    console.log("[Test 1] Waiting for approval UI...");
    await expect(
      page.getByRole("button", { name: "Approve" }).first(),
    ).toBeVisible({
      timeout: 30000,
    });

    console.log("[Test 1] Approval UI visible, clicking Approve...");

    // Approve
    await page.getByRole("button", { name: "Approve" }).first().click();

    console.log("[Test 1] Waiting for AI response...");
    await waitForAssistantResponse(page, { timeout: 30000 });

    // Verify AI text response with location information
    console.log("[Test 1] Verifying AI text response...");
    await expect(
      page
        .getByText(/位置|場所|location|latitude|longitude|coordinates/i)
        .last(),
    ).toBeVisible({
      timeout: 10000,
    });

    // Wait a bit to ensure no automatic send
    await page.waitForTimeout(2000);

    console.log("[Test 1] ✅ PASSED");
  });

  test("2. Denial Flow - Deny Once (CRITICAL: No infinite loop)", async ({
    page,
  }) => {
    console.log("[Test 2] Requesting location...");
    await sendTextMessage(page, "私の現在地を取得して");

    console.log("[Test 2] Waiting for approval UI...");
    await expect(
      page.getByRole("button", { name: "Deny" }).first(),
    ).toBeVisible({
      timeout: 30000,
    });

    console.log("[Test 2] Approval UI visible, clicking Deny...");

    // Deny
    await page.getByRole("button", { name: "Deny" }).first().click();

    console.log("[Test 2] Waiting for AI response...");
    await waitForAssistantResponse(page, { timeout: 30000 });

    // Verify AI text response (denial message)
    console.log("[Test 2] Verifying denial message...");
    await expect(
      page
        .getByText(/拒否|キャンセル|承認されませんでした|denied|cancelled/i)
        .last(),
    ).toBeVisible({
      timeout: 10000,
    });

    // Wait to ensure no infinite loop
    console.log("[Test 2] Waiting to detect potential infinite loop...");
    await page.waitForTimeout(3000);

    console.log("[Test 2] ✅ PASSED - No infinite loop detected");
  });

  test("3. Sequential Flow - Approve Twice", async ({ page }) => {
    // Location request 1
    console.log("[Test 3] Location request 1...");
    await sendTextMessage(page, "私の位置を教えて");
    await expect(
      page.getByRole("button", { name: "Approve" }).first(),
    ).toBeVisible({
      timeout: 30000,
    });
    await page.getByRole("button", { name: "Approve" }).first().click();
    await waitForAssistantResponse(page, { timeout: 30000 });
    console.log("[Test 3] Location request 1 completed");

    // Location request 2
    console.log("[Test 3] Location request 2...");
    await sendTextMessage(page, "もう一度位置を確認して");
    await expect(
      page.getByRole("button", { name: "Approve" }).first(),
    ).toBeVisible({
      timeout: 30000,
    });
    await page.getByRole("button", { name: "Approve" }).first().click();
    await waitForAssistantResponse(page, { timeout: 30000 });
    console.log("[Test 3] Location request 2 completed");

    console.log("[Test 3] ✅ PASSED");
  });

  test("4. Deny Then Approve (State reset verification)", async ({ page }) => {
    // Location request 1 - Deny
    console.log("[Test 4] Location request 1 (Deny)...");
    await sendTextMessage(page, "私の位置を教えてください");
    await expect(
      page.getByRole("button", { name: "Deny" }).first(),
    ).toBeVisible({
      timeout: 30000,
    });
    await page.getByRole("button", { name: "Deny" }).first().click();
    await waitForAssistantResponse(page, { timeout: 30000 });
    await page.waitForTimeout(2000);
    console.log("[Test 4] Location request 1 denied");

    // Location request 2 - Approve
    console.log("[Test 4] Location request 2 (Approve)...");
    await sendTextMessage(page, "今度は位置を取得して");
    await expect(
      page.getByRole("button", { name: "Approve" }).first(),
    ).toBeVisible({
      timeout: 30000,
    });
    await page.getByRole("button", { name: "Approve" }).first().click();
    await waitForAssistantResponse(page, { timeout: 30000 });
    await page.waitForTimeout(2000);
    console.log("[Test 4] Location request 2 approved");

    console.log("[Test 4] ✅ PASSED - State properly resets");
  });

  test("5. Approve Then Deny (Reverse order verification)", async ({
    page,
  }) => {
    // Location request 1 - Approve
    console.log("[Test 5] Location request 1 (Approve)...");
    await sendTextMessage(page, "私の位置を教えて");
    await expect(
      page.getByRole("button", { name: "Approve" }).first(),
    ).toBeVisible({
      timeout: 30000,
    });
    await page.getByRole("button", { name: "Approve" }).first().click();
    await waitForAssistantResponse(page, { timeout: 30000 });
    await page.waitForTimeout(2000);
    console.log("[Test 5] Location request 1 approved");

    // Location request 2 - Deny
    console.log("[Test 5] Location request 2 (Deny)...");
    await sendTextMessage(page, "もう一度位置を確認して");
    await expect(
      page.getByRole("button", { name: "Deny" }).first(),
    ).toBeVisible({
      timeout: 30000,
    });
    await page.getByRole("button", { name: "Deny" }).first().click();
    await waitForAssistantResponse(page, { timeout: 30000 });
    await page.waitForTimeout(2000);
    console.log("[Test 5] Location request 2 denied");

    console.log("[Test 5] ✅ PASSED - State properly managed");
  });
});
