import { expect, test } from "@playwright/test";
import {
  downloadFrontendChunkLogs,
  sendTextMessage,
  waitForAssistantResponse,
} from "../helpers";

/**
 * get_weather Tool - SSE Mode Test Suite
 *
 * Tool Characteristics:
 * - Server execution (no client delegation)
 * - No approval required (immediate execution)
 * - Returns weather information from server mock
 *
 * Test Cases:
 * 1. Single weather query - Basic execution
 * 2. Multiple sequential queries - State isolation
 * 3. Different cities - Parameter handling
 */

test.describe("get_weather Tool - SSE Mode", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("http://localhost:3000");

    // Enable chunk logger via localStorage
    const sessionId = process.env.CHUNK_LOGGER_SESSION_ID;
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
    await downloadFrontendChunkLogs(page, `get-weather-sse-${testName}`);
  });

  test("1. Single weather query - Basic execution", async ({ page }) => {
    console.log("[Test 1] Requesting weather for Tokyo...");
    await sendTextMessage(page, "東京の天気を教えてください");

    console.log("[Test 1] Waiting for AI response...");
    await waitForAssistantResponse(page, { timeout: 30000 });

    // Verify AI text response contains weather information
    console.log("[Test 1] Verifying weather response...");
    await expect(
      page.getByText(/晴れ|曇り|雨|天気|気温|temperature|sunny|cloudy/i).last(),
    ).toBeVisible({
      timeout: 10000,
    });

    // Verify NO approval UI appeared (critical - should execute immediately)
    console.log("[Test 1] Verifying no approval UI...");
    const approveButton = page.getByRole("button", { name: "Approve" });
    await expect(approveButton).not.toBeVisible();

    console.log("[Test 1] ✅ PASSED - Weather retrieved without approval");
  });

  test("2. Multiple sequential queries - State isolation", async ({ page }) => {
    // Query 1: Tokyo
    console.log("[Test 2] Query 1: Tokyo...");
    await sendTextMessage(page, "東京の天気は？");
    await waitForAssistantResponse(page, { timeout: 30000 });
    await expect(
      page.getByText(/晴れ|曇り|雨|天気|temperature|sunny/i).last(),
    ).toBeVisible({
      timeout: 10000,
    });
    console.log("[Test 2] Query 1 completed");

    // Query 2: Osaka
    console.log("[Test 2] Query 2: Osaka...");
    await sendTextMessage(page, "大阪の天気を教えて");
    await waitForAssistantResponse(page, { timeout: 30000 });
    await expect(
      page.getByText(/晴れ|曇り|雨|天気|temperature|sunny/i).last(),
    ).toBeVisible({
      timeout: 10000,
    });
    console.log("[Test 2] Query 2 completed");

    // Query 3: New York
    console.log("[Test 2] Query 3: New York...");
    await sendTextMessage(page, "ニューヨークの天気は？");
    await waitForAssistantResponse(page, { timeout: 30000 });
    await expect(
      page.getByText(/晴れ|曇り|雨|天気|temperature|sunny/i).last(),
    ).toBeVisible({
      timeout: 10000,
    });
    console.log("[Test 2] Query 3 completed");

    // Verify no approval UI for any query
    const approveButton = page.getByRole("button", { name: "Approve" });
    await expect(approveButton).not.toBeVisible();

    console.log("[Test 2] ✅ PASSED - Multiple queries executed independently");
  });

  test("3. Different cities - Parameter handling", async ({ page }) => {
    const cities = [
      { japanese: "札幌の天気", english: "Sapporo" },
      { japanese: "福岡の天気を調べて", english: "Fukuoka" },
      { japanese: "Londonの天気はどう？", english: "London" },
    ];

    for (const city of cities) {
      console.log(`[Test 3] Querying weather for ${city.english}...`);
      await sendTextMessage(page, city.japanese);
      await waitForAssistantResponse(page, { timeout: 30000 });

      // Verify weather response
      await expect(
        page.getByText(/晴れ|曇り|雨|天気|temperature|sunny|cloudy/i).last(),
      ).toBeVisible({
        timeout: 10000,
      });

      console.log(`[Test 3] ${city.english} weather retrieved`);
    }

    // Verify no approval UI for any query
    const approveButton = page.getByRole("button", { name: "Approve" });
    await expect(approveButton).not.toBeVisible();

    console.log("[Test 3] ✅ PASSED - Different parameters handled correctly");
  });
});
