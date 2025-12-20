import { expect, test } from "@playwright/test";
import {
  downloadFrontendChunkLogs,
  sendTextMessage,
  setupFrontendConsoleLogger,
  waitForAssistantResponse,
} from "../helpers";

/**
 * get_location Tool - SSE Mode Test Suite
 *
 * Tool Characteristics:
 * - Client execution via FrontendToolDelegate (browser Geolocation API)
 * - Requires user approval before execution (FunctionTool with require_confirmation=True)
 * - Returns user's location to server after approval
 *
 * Test Cases:
 * 1. Normal Flow - Approve Once
 * 2. Denial Flow - Deny Once (CRITICAL: Prevents infinite loop)
 * 3. Sequential Flow - Approve Twice
 * 4. Deny Then Approve (State reset verification)
 * 5. Approve Then Deny (Reverse order verification)
 * 6. Error Handling - Browser geolocation permission denied
 */

test.describe("get_location Tool - SSE Mode", () => {
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

    // Select ADK SSE mode
    await page.click("text=ADK SSE");
    // Wait for mode selection to take effect
    await page.waitForTimeout(1000);
  });

  test.afterEach(async ({ page }, testInfo) => {
    // Download frontend chunk logs after each test
    const testName = testInfo.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    await downloadFrontendChunkLogs(page, `get-location-sse-${testName}`);
  });

  test("1. Normal Flow - Approve Once", async ({ page }) => {
    let requestCount = 0;
    page.on("request", (request) => {
      if (request.url().includes("/stream")) {
        requestCount++;
        console.log(`[Test 1] Request #${requestCount}: ${request.url()}`);
      }
    });

    console.log("[Test 1] Requesting location...");
    await sendTextMessage(page, "私の位置を教えてください");

    console.log("[Test 1] Waiting for approval UI...");
    await expect(
      page.getByRole("button", { name: "Approve" }).first(),
    ).toBeVisible({
      timeout: 30000,
    });

    // Reset counter before approval
    requestCount = 0;
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

    // Verify no infinite loop
    console.log(`[Test 1] Request count after approval: ${requestCount}`);
    expect(requestCount).toBeLessThanOrEqual(1);

    console.log("[Test 1] ✅ PASSED");
  });

  test("2. Denial Flow - Deny Once (CRITICAL: No infinite loop)", async ({
    page,
  }) => {
    let requestCount = 0;
    const requestTimestamps: number[] = [];

    page.on("request", (request) => {
      if (request.url().includes("/stream")) {
        requestCount++;
        requestTimestamps.push(Date.now());
        console.log(`[Test 2] Request #${requestCount}: ${request.url()}`);

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

    console.log("[Test 2] Requesting location...");
    await sendTextMessage(page, "私の現在地を取得して");

    console.log("[Test 2] Waiting for approval UI...");
    await expect(
      page.getByRole("button", { name: "Deny" }).first(),
    ).toBeVisible({
      timeout: 30000,
    });

    // Reset counter before denial
    requestCount = 0;
    requestTimestamps.length = 0;
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

    // Critical assertion: NO infinite loop
    console.log(
      `[Test 2] Request count after denial: ${requestCount}, timestamps: ${requestTimestamps.join(", ")}`,
    );
    expect(requestCount).toBeLessThanOrEqual(1);

    console.log("[Test 2] ✅ PASSED - No infinite loop detected");
  });

  test("3. Sequential Flow - Approve Twice", async ({ page }) => {
    let totalRequestCount = 0;

    page.on("request", (request) => {
      if (request.url().includes("/stream")) {
        totalRequestCount++;
        console.log(`[Test 3] Request #${totalRequestCount}: ${request.url()}`);
      }
    });

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

    // Verify total requests
    console.log(`[Test 3] Total requests: ${totalRequestCount}`);
    expect(totalRequestCount).toBeLessThanOrEqual(4);

    console.log("[Test 3] ✅ PASSED");
  });

  test("4. Deny Then Approve (State reset verification)", async ({ page }) => {
    let requestCount = 0;

    page.on("request", (request) => {
      if (request.url().includes("/stream")) {
        requestCount++;
        console.log(`[Test 4] Request #${requestCount}: ${request.url()}`);
      }
    });

    // Location request 1 - Deny
    console.log("[Test 4] Location request 1 (Deny)...");
    await sendTextMessage(page, "私の位置を教えてください");
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
    console.log(`[Test 4] Deny requests: ${denyRequests}`);
    expect(denyRequests).toBeLessThanOrEqual(1);

    // Location request 2 - Approve
    console.log("[Test 4] Location request 2 (Approve)...");
    await sendTextMessage(page, "今度は位置を取得して");
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
    console.log(`[Test 4] Approve requests: ${approveRequests}`);
    expect(approveRequests).toBeLessThanOrEqual(1);

    console.log("[Test 4] ✅ PASSED - State properly resets");
  });

  test("5. Approve Then Deny (Reverse order verification)", async ({
    page,
  }) => {
    let requestCount = 0;

    page.on("request", (request) => {
      if (request.url().includes("/stream")) {
        requestCount++;
        console.log(`[Test 5] Request #${requestCount}: ${request.url()}`);
      }
    });

    // Location request 1 - Approve
    console.log("[Test 5] Location request 1 (Approve)...");
    await sendTextMessage(page, "私の位置を教えて");
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
    console.log(`[Test 5] Approve requests: ${approveRequests}`);
    expect(approveRequests).toBeLessThanOrEqual(1);

    // Location request 2 - Deny
    console.log("[Test 5] Location request 2 (Deny)...");
    await sendTextMessage(page, "もう一度位置を確認して");
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
    console.log(`[Test 5] Deny requests: ${denyRequests}`);
    expect(denyRequests).toBeLessThanOrEqual(1);

    console.log("[Test 5] ✅ PASSED - State properly managed");
  });

  test("6. Error Handling - Browser geolocation permission denied", async ({
    page,
    context,
  }) => {
    // Deny geolocation permission at browser level
    await context.grantPermissions([], { origin: "http://localhost:3000" });
    // Alternatively, explicitly deny:
    // await context.setGeolocation(null);

    let requestCount = 0;

    page.on("request", (request) => {
      if (request.url().includes("/stream")) {
        requestCount++;
        console.log(`[Test 6] Request #${requestCount}: ${request.url()}`);
      }
    });

    console.log(
      "[Test 6] Requesting location with geolocation permission denied...",
    );
    await sendTextMessage(page, "現在地を取得してください");

    console.log("[Test 6] Waiting for approval UI...");
    await expect(
      page.getByRole("button", { name: "Approve" }).first(),
    ).toBeVisible({
      timeout: 30000,
    });

    // Reset counter before approval
    requestCount = 0;
    console.log("[Test 6] Approval UI visible, clicking Approve...");

    // Approve (should trigger geolocation error)
    await page.getByRole("button", { name: "Approve" }).first().click();

    console.log("[Test 6] Waiting for AI response...");
    await waitForAssistantResponse(page, { timeout: 30000 });

    // Verify AI text response contains error message about geolocation failure
    console.log("[Test 6] Verifying error message...");
    await expect(
      page
        .getByText(
          /位置情報|geolocation|permission|denied|取得できません|エラー/i,
        )
        .last(),
    ).toBeVisible({
      timeout: 10000,
    });

    // Wait to ensure no infinite loop
    await page.waitForTimeout(2000);

    // Verify no infinite loop after error
    console.log(`[Test 6] Request count after error: ${requestCount}`);
    expect(requestCount).toBeLessThanOrEqual(1);

    console.log("[Test 6] ✅ PASSED - Error handled correctly");
  });
});
