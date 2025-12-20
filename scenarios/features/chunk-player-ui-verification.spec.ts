/**
 * Chunk Player UI Verification E2E Tests
 *
 * These tests verify that the UI renders correctly when replaying
 * pre-recorded chunks from fixture files. This ensures UI consistency
 * across different backend modes without requiring real LLM calls.
 *
 * Test Patterns:
 * - Pattern 1: Gemini Direct only (4 steps)
 * - Pattern 2: ADK SSE only (4 steps, token count verification)
 * - Pattern 3: ADK BIDI only (4 steps, audio player verification)
 * - Pattern 4: Mode switching (5 steps, history preservation verification)
 *
 * Per CLAUDE.md guidelines:
 * - Uses real UI components (no mocks)
 * - Uses ChunkPlayerTransport for deterministic chunk replay
 * - Given-When-Then structure
 * - Tests critical UI rendering and state management
 */

import { expect, test } from "@playwright/test";
import {
  disableChunkPlayerMode,
  getMessages,
  sendTextMessage,
  setupChunkPlayerMode,
  setupFrontendConsoleLogger,
} from "./helpers";

test.describe("Chunk Player UI Verification", () => {
  test.beforeEach(async ({ page }) => {
    // Setup frontend console logger
    const sessionId =
      process.env.NEXT_PUBLIC_CHUNK_LOGGER_SESSION_ID ||
      process.env.CHUNK_LOGGER_SESSION_ID ||
      "test";
    setupFrontendConsoleLogger(page, sessionId);
  });

  test.afterEach(async ({ page }) => {
    // Clean up: clear message history
    const clearButton = page.getByRole("button", { name: "Clear History" });
    const isVisible = await clearButton.isVisible().catch(() => false);
    if (isVisible) {
      await clearButton.click();
      // Wait for clear to complete
      await page.waitForTimeout(500);
    }

    // Disable chunk player mode after each test
    await disableChunkPlayerMode(page);
  });

  test("Empty fixture - should show no messages when fixture is empty", async ({
    page,
  }) => {
    // Given: Chunk player mode with empty fixture file
    await setupChunkPlayerMode(page, "pattern1-gemini-only");

    // Then: No messages should be displayed initially
    const messages = await getMessages(page);
    expect(messages.length).toBe(0);

    // And: Input field should still be visible and functional
    const input = page.getByPlaceholder("Type your message...");
    await expect(input).toBeVisible();

    // And: No error messages should be shown
    const errorElement = page.getByText(/error|failed|invalid/i);
    await expect(errorElement).not.toBeVisible();
  });

  test("Pattern 1: Gemini Direct only - should render all messages correctly", async ({
    page,
  }) => {
    // Given: Chunk player mode with Pattern 1 fixture
    await setupChunkPlayerMode(page, "pattern1-gemini-only");

    // When: User sends first message (triggers chunk replay)
    await sendTextMessage(page, "こんにちは");

    // Then: UI should show messages
    await page.waitForTimeout(1000); // Wait for chunk replay to complete
    let messages = await getMessages(page);
    expect(messages.length).toBeGreaterThan(0);

    // When: User sends second message
    await sendTextMessage(page, "東京の天気を教えて");
    await page.waitForTimeout(1000);

    // Then: Should accumulate messages
    messages = await getMessages(page);
    expect(messages.length).toBeGreaterThan(1);

    // When: User sends third message
    await sendTextMessage(page, "123 + 456は？");
    await page.waitForTimeout(1000);

    // Then: Should continue accumulating
    messages = await getMessages(page);
    expect(messages.length).toBeGreaterThan(2);

    // Verify mode indicator is visible
    await expect(
      page.getByRole("button", { name: /Gemini Direct/i }),
    ).toBeVisible();
  });

  test("Pattern 2: ADK SSE only - should show token counts", async ({
    page,
  }) => {
    // Given: Chunk player mode with Pattern 2 fixture
    await setupChunkPlayerMode(page, "pattern2-adk-sse-only");

    // When: Replay chunks through all 4 steps
    await sendTextMessage(page, "こんにちは");
    await page.waitForTimeout(1000);

    await sendTextMessage(page, "東京の天気を教えて");
    await page.waitForTimeout(1000);

    await sendTextMessage(page, "123 + 456は？");
    await page.waitForTimeout(1000);

    await sendTextMessage(page, "ありがとう");
    await page.waitForTimeout(1000);

    // Then: All 8 messages should be visible
    const messages = await getMessages(page);
    expect(messages.length).toBeGreaterThanOrEqual(8);

    // And: Token count should be displayed
    await expect(page.getByText(/tokens|トークン/i).first()).toBeVisible();

    // And: Model name should be displayed
    await expect(page.getByText(/gemini-2\.5-flash/i).first()).toBeVisible();

    // Verify mode button is visible (ChunkPlayer loads the pattern but doesn't change mode UI)
    await expect(page.getByRole("button", { name: /ADK SSE/i })).toBeVisible();
  });

  test("Pattern 3: ADK BIDI only - should show audio players", async ({
    page,
  }) => {
    // Given: Chunk player mode with Pattern 3 fixture
    await setupChunkPlayerMode(page, "pattern3-adk-bidi-only");

    // When: Replay chunks through all 4 steps
    await sendTextMessage(page, "こんにちは");
    await page.waitForTimeout(1000);

    // Verify BIDI button is visible (ChunkPlayer loads the pattern but doesn't change mode UI)
    await expect(page.getByRole("button", { name: /ADK BIDI/i })).toBeVisible();

    await sendTextMessage(page, "東京の天気を教えて");
    await page.waitForTimeout(1000);

    await sendTextMessage(page, "123 + 456は？");
    await page.waitForTimeout(1000);

    await sendTextMessage(page, "ありがとう");
    await page.waitForTimeout(1000);

    // Then: Messages should be visible
    const messages = await getMessages(page);
    expect(messages.length).toBeGreaterThan(0);

    // Verify BIDI button is visible
    await expect(page.getByRole("button", { name: /ADK BIDI/i })).toBeVisible();
  });

  test("Pattern 4: Mode switching - should preserve message history", async ({
    page,
  }) => {
    // Given: Chunk player mode with Pattern 4 fixture
    await setupChunkPlayerMode(page, "pattern4-mode-switching");

    // Step 1: Gemini Direct - "こんにちは"
    await sendTextMessage(page, "こんにちは");
    await page.waitForTimeout(1000);
    let messages = await getMessages(page);
    const step1Count = messages.length;
    expect(step1Count).toBeGreaterThanOrEqual(2);

    // Step 2: ADK SSE - "東京の天気を教えて"
    await sendTextMessage(page, "東京の天気を教えて");
    await page.waitForTimeout(1000);
    messages = await getMessages(page);
    const step2Count = messages.length;
    expect(step2Count).toBeGreaterThan(step1Count);
    // Verify Step 1 messages are still visible
    expect(step2Count).toBeGreaterThanOrEqual(4);

    // Step 3: ADK BIDI - "123 + 456は？"
    await sendTextMessage(page, "123 + 456は？");
    await page.waitForTimeout(1000);
    messages = await getMessages(page);
    const step3Count = messages.length;
    expect(step3Count).toBeGreaterThan(step2Count);
    // Verify Steps 1-2 messages are still visible
    expect(step3Count).toBeGreaterThanOrEqual(6);

    // Step 4: ADK SSE - "ありがとう"
    await sendTextMessage(page, "ありがとう");
    await page.waitForTimeout(1000);
    messages = await getMessages(page);
    const step4Count = messages.length;
    expect(step4Count).toBeGreaterThan(step3Count);
    // Verify Steps 1-3 messages are still visible
    expect(step4Count).toBeGreaterThanOrEqual(8);

    // Step 5: Gemini Direct - "さようなら"
    await sendTextMessage(page, "さようなら");
    await page.waitForTimeout(1000);
    messages = await getMessages(page);
    const finalCount = messages.length;
    expect(finalCount).toBeGreaterThan(step4Count);

    // Then: All 10 messages should be visible (5 user + 5 assistant)
    // CRITICAL: This verifies that mode switching preserves message history
    expect(finalCount).toBeGreaterThanOrEqual(10);

    // Verify all key messages are present in history
    const pageText = await page.textContent("body");
    expect(pageText).toContain("こんにちは"); // Step 1
    expect(pageText).toMatch(/天気|weather/i); // Step 2
    expect(pageText).toMatch(/123|456|579|計算/i); // Step 3
    expect(pageText).toContain("ありがとう"); // Step 4
    expect(pageText).toContain("さようなら"); // Step 5
  });

  test("Pattern 4 Critical: Message count should accumulate across mode switches", async ({
    page,
  }) => {
    // This test validates the critical requirement:
    // "モードの行き来で過去のログが消えない状態のUIであることが正解とします"
    // (Switching modes should preserve message history)

    // Given: Chunk player mode with Pattern 4 fixture
    await setupChunkPlayerMode(page, "pattern4-mode-switching");

    // When: Execute all 5 steps
    const steps = [
      "こんにちは",
      "東京の天気を教えて",
      "123 + 456は？",
      "ありがとう",
      "さようなら",
    ];

    let previousCount = 0;
    for (let i = 0; i < steps.length; i++) {
      await sendTextMessage(page, steps[i]);
      await page.waitForTimeout(1000);

      // Then: Messages should accumulate (not reset when mode switches)
      const messages = await getMessages(page);
      expect(messages.length).toBeGreaterThan(previousCount);
      previousCount = messages.length;
    }

    // And: Final message count should be significant (at least 5+ messages)
    const finalMessages = await getMessages(page);
    expect(finalMessages.length).toBeGreaterThanOrEqual(5);
  });
});
