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
} from "./helpers";

test.describe("Chunk Player UI Verification", () => {
  test.afterEach(async ({ page }) => {
    // Clean up: disable chunk player mode after each test
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

    // Then: UI should show 2 messages (user + assistant)
    await page.waitForTimeout(1000); // Wait for chunk replay to complete
    let messages = await getMessages(page);
    expect(messages.length).toBeGreaterThanOrEqual(2);

    // When: User sends second message (weather tool)
    await sendTextMessage(page, "東京の天気を教えて");
    await page.waitForTimeout(1000);

    // Then: Should show tool invocation UI
    messages = await getMessages(page);
    expect(messages.length).toBeGreaterThanOrEqual(4);
    // Verify tool call is visible
    await expect(page.getByText(/weather|天気/i)).toBeVisible();

    // When: User sends third message (calculator tool)
    await sendTextMessage(page, "123 + 456は？");
    await page.waitForTimeout(1000);

    // Then: Should show calculator tool invocation
    messages = await getMessages(page);
    expect(messages.length).toBeGreaterThanOrEqual(6);
    await expect(page.getByText(/calculator|計算|579/i)).toBeVisible();

    // When: User sends final message
    await sendTextMessage(page, "ありがとう");
    await page.waitForTimeout(1000);

    // Then: All 8 messages should be visible (4 user + 4 assistant)
    messages = await getMessages(page);
    expect(messages.length).toBeGreaterThanOrEqual(8);

    // Verify mode indicator shows Gemini Direct
    await expect(
      page.getByRole("button", { name: /Gemini Direct/i }),
    ).toHaveCSS("font-weight", "600");
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
    await expect(page.getByText(/tokens|トークン/i)).toBeVisible();

    // And: Model name should be displayed
    await expect(page.getByText(/gemini-2\.5-flash/i)).toBeVisible();

    // Verify mode is ADK SSE
    await expect(page.getByRole("button", { name: /ADK SSE/i })).toHaveCSS(
      "font-weight",
      "600",
    );
  });

  test("Pattern 3: ADK BIDI only - should show audio players", async ({
    page,
  }) => {
    // Given: Chunk player mode with Pattern 3 fixture
    await setupChunkPlayerMode(page, "pattern3-adk-bidi-only");

    // When: Replay chunks through all 4 steps
    await sendTextMessage(page, "こんにちは");
    await page.waitForTimeout(1000);

    // Then: Audio player should be visible for first response
    await expect(page.getByText(/Audio/i)).toBeVisible();

    await sendTextMessage(page, "東京の天気を教えて");
    await page.waitForTimeout(1000);

    await sendTextMessage(page, "123 + 456は？");
    await page.waitForTimeout(1000);

    await sendTextMessage(page, "ありがとう");
    await page.waitForTimeout(1000);

    // Then: All 8 messages should be visible
    const messages = await getMessages(page);
    expect(messages.length).toBeGreaterThanOrEqual(8);

    // And: Multiple audio players should be present (one per assistant message)
    const audioPlayers = await page.getByText(/Audio/i).all();
    expect(audioPlayers.length).toBeGreaterThanOrEqual(4);

    // And: WebSocket latency should be displayed
    await expect(page.getByText(/latency|レイテンシ/i)).toBeVisible();

    // Verify mode is ADK BIDI
    await expect(page.getByRole("button", { name: /ADK BIDI/i })).toHaveCSS(
      "font-weight",
      "600",
    );
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

  test("Pattern 4 Critical: Message count should be exactly 10 after all steps", async ({
    page,
  }) => {
    // This test specifically validates the critical requirement:
    // "モードの行き来で過去のログが消えない状態のUIであることが正解とします"

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

    for (const step of steps) {
      await sendTextMessage(page, step);
      await page.waitForTimeout(1000);
    }

    // Then: Exactly 10 messages should exist (5 user + 5 assistant)
    const messages = await getMessages(page);
    expect(messages.length).toBe(10);

    // And: No messages should be duplicated or missing
    // Verify by checking unique message content
    const messageTexts = await Promise.all(
      messages.map((msg) => msg.textContent()),
    );
    const uniqueMessages = new Set(messageTexts);
    expect(uniqueMessages.size).toBe(10); // All messages should be unique
  });
});
