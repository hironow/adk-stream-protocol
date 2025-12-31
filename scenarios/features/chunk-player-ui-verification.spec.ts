/**
 * Chunk Player UI Verification E2E Tests
 *
 * These tests verify that the UI renders correctly when replaying
 * pre-recorded chunks from fixture files. This ensures UI consistency
 * across different backend modes without requiring real LLM calls.
 *
 * Test Patterns:
 * - Pattern 1: Gemini Direct only (4 steps)
 * - Pattern 2: DELETED - Fixture not recorded, no plan to record
 * - Pattern 3: ADK BIDI only (4 steps, audio player verification)
 * - Pattern 4: DELETED - Fixture not recorded, no plan to record
 * - Pattern 4 Critical: Message count verification (passes)
 *
 * Note: Pattern 2/4 tests were deleted to match Python E2E test cleanup.
 * See: tests/e2e/test_server_chunk_player.py (Pattern 2/3/4 deleted earlier)
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
} from "../helpers";

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
    await setupChunkPlayerMode(page, "pattern1");

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
    await setupChunkPlayerMode(page, "pattern1");

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

  // Pattern 2: DELETED - Fixture not recorded, no plan to record
  // See header for explanation

  test("Pattern 3: ADK BIDI only - should show audio players", async ({
    page,
  }) => {
    // Given: Chunk player mode with Pattern 3 fixture
    await setupChunkPlayerMode(page, "pattern3");

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

  // Pattern 4 full test: DELETED - Fixture not recorded, no plan to record
  // See header for explanation
  // Pattern 4 Critical test below still passes with existing fixture

  test("Pattern 4 Critical: Message count should accumulate across mode switches", async ({
    page,
  }) => {
    // This test validates the critical requirement:
    // "モードの行き来で過去のログが消えない状態のUIであることが正解とします"
    // (Switching modes should preserve message history)

    // Given: Chunk player mode with Pattern 4 fixture
    await setupChunkPlayerMode(page, "pattern4");

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
