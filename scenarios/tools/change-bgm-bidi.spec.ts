import { expect, test } from "@playwright/test";
import {
  downloadFrontendChunkLogs,
  sendTextMessage,
  setupFrontendConsoleLogger,
  waitForAssistantResponse,
} from "../helpers";

/**
 * change_bgm Tool - BIDI Mode Test Suite
 *
 * Tool Characteristics:
 * - Client execution via FrontendToolDelegate
 * - No approval required (immediate execution)
 * - Changes background music track (1 or 2)
 *
 * Test Cases:
 * 1. Change to track 1 - Basic execution
 * 2. Change to track 2 - Parameter variation
 * 3. Sequential changes - State management
 */

test.describe("change_bgm Tool - BIDI Mode", () => {
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
    await downloadFrontendChunkLogs(page, `change-bgm-bidi-${testName}`);
  });

  test("1. Change to track 1 - Basic execution", async ({ page }) => {
    console.log("[Test 1] Requesting BGM change to track 1...");
    await sendTextMessage(page, "トラック1に変更してください");

    console.log("[Test 1] Waiting for AI response...");
    await waitForAssistantResponse(page, { timeout: 30000 });

    // Verify AI text response confirms BGM change
    console.log("[Test 1] Verifying BGM change response...");
    await expect(
      page.getByText(/変更しました|トラック1|BGM|音楽|changed|track/i).last(),
    ).toBeVisible({
      timeout: 10000,
    });

    // Verify NO approval UI appeared (critical - should execute immediately)
    console.log("[Test 1] Verifying no approval UI...");
    const approveButton = page.getByRole("button", { name: "Approve" });
    await expect(approveButton).not.toBeVisible();

    console.log("[Test 1] ✅ PASSED - BGM changed without approval");
  });

  test("2. Change to track 2 - Parameter variation", async ({ page }) => {
    console.log("[Test 2] Requesting BGM change to track 2...");
    await sendTextMessage(page, "トラック2に変えて");

    console.log("[Test 2] Waiting for AI response...");
    await waitForAssistantResponse(page, { timeout: 30000 });

    // Verify AI text response confirms BGM change
    console.log("[Test 2] Verifying BGM change response...");
    await expect(
      page.getByText(/変更しました|トラック2|BGM|音楽|changed|track/i).last(),
    ).toBeVisible({
      timeout: 10000,
    });

    // Verify NO approval UI appeared
    const approveButton = page.getByRole("button", { name: "Approve" });
    await expect(approveButton).not.toBeVisible();

    console.log("[Test 2] ✅ PASSED - Track 2 selected without approval");
  });

  test("3. Sequential changes - State management", async ({ page }) => {
    // Extend timeout for sequential API calls (3 calls × ~20s each + waits)
    test.setTimeout(90000);
    // Change 1: Track 1
    console.log("[Test 3] Change 1: Track 1...");
    await sendTextMessage(page, "BGMをトラック1に変更");
    await waitForAssistantResponse(page, { timeout: 30000 });
    await expect(
      page.getByText(/変更しました|トラック1|BGM|changed|track/i).last(),
    ).toBeVisible({
      timeout: 10000,
    });
    console.log("[Test 3] Change 1 completed");

    // Wait between calls to avoid rate limiting and connection issues
    await page.waitForTimeout(1500);

    // Change 2: Track 2
    console.log("[Test 3] Change 2: Track 2...");
    await sendTextMessage(page, "トラック2に変えて");
    await waitForAssistantResponse(page, { timeout: 30000 });
    await expect(
      page.getByText(/変更しました|トラック2|BGM|changed|track/i).last(),
    ).toBeVisible({
      timeout: 10000,
    });
    console.log("[Test 3] Change 2 completed");

    // Wait between calls to avoid rate limiting and connection issues
    await page.waitForTimeout(1500);

    // Change 3: Back to Track 1
    console.log("[Test 3] Change 3: Back to Track 1...");
    await sendTextMessage(page, "トラック1に戻して");
    await waitForAssistantResponse(page, { timeout: 30000 });
    await expect(
      page.getByText(/変更しました|トラック1|BGM|changed|track/i).last(),
    ).toBeVisible({
      timeout: 10000,
    });
    console.log("[Test 3] Change 3 completed");

    // Verify no approval UI for any change
    const approveButton = page.getByRole("button", { name: "Approve" });
    await expect(approveButton).not.toBeVisible();

    console.log(
      "[Test 3] ✅ PASSED - Sequential changes executed independently",
    );
  });
});
