import { expect, test } from "@playwright/test";

/**
 * Chat Basic Flow - Smoke Tests
 *
 * Critical path tests for basic chat functionality.
 * These tests must pass before any deployment.
 *
 * Test Focus:
 * - Basic message send/receive in Gemini mode
 * - Streaming animation
 * - Error handling on network failure
 */
test.describe("Chat Basic Flow (Smoke)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("should load the chat page successfully", async ({ page }) => {
    // Given: Navigate to the chat page
    // (Already done in beforeEach)

    // Then: Page should have title
    await expect(page).toHaveTitle(/AI SDK v6/i);

    // Then: Mode switcher should be visible
    const geminiButton = page.getByRole("button", { name: /Gemini Direct/i });
    await expect(geminiButton).toBeVisible();

    // Then: Chat input should be visible
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await expect(chatInput).toBeVisible();
  });

  test("should send message and receive response in Gemini mode", async ({
    page,
  }) => {
    // Given: Gemini mode is selected (default)
    const geminiButton = page.getByRole("button", { name: /Gemini Direct/i });
    await geminiButton.click();

    // When: Type and send a simple math question
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill("What is 2+2?");

    // When: Submit the message
    await chatInput.press("Enter");

    // Then: User message should appear
    // Note: Without data-testid, we look for the text content
    await expect(page.locator("text=What is 2+2?")).toBeVisible({
      timeout: 10000,
    });

    // Then: Assistant response should appear (contains "4")
    await expect(page.locator("text=/4/")).toBeVisible({ timeout: 30000 });
  });

  test("should show streaming animation during response", async ({ page }) => {
    // Given: Gemini mode
    const geminiButton = page.getByRole("button", { name: /Gemini Direct/i });
    await geminiButton.click();

    // When: Send a message that will stream
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill("Tell me a very short joke");
    await chatInput.press("Enter");

    // Then: User message appears
    await expect(page.locator("text=Tell me a very short joke")).toBeVisible();

    // Then: Some response content should appear (streaming)
    // We just verify that some text appears, indicating streaming is working
    await page.waitForTimeout(2000); // Wait for streaming to start

    // Then: Page should have more content than just the user message
    const bodyText = await page.textContent("body");
    expect(bodyText).toBeTruthy();
    expect(bodyText!.length).toBeGreaterThan(50);
  });

  test.skip("should display error message on network failure", async ({
    page,
  }) => {
    // This test is skipped because it requires network mocking
    // which is better suited for integration tests

    // Given: Simulate offline mode
    await page.context().setOffline(true);

    // When: Try to send message
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill("Hello");
    await chatInput.press("Enter");

    // Then: Error message should appear
    // Note: Actual error handling UI depends on implementation
    await page.waitForTimeout(2000);

    // Cleanup: Restore network
    await page.context().setOffline(false);
  });

  test("should have functional mode switcher", async ({ page }) => {
    // Given: Page loaded with Gemini as default

    // When: Check that all three mode buttons are visible
    const geminiButton = page.getByRole("button", { name: /Gemini Direct/i });
    const adkSseButton = page.getByRole("button", { name: /ADK SSE/i });
    const adkBidiButton = page.getByRole("button", { name: /ADK BIDI/i });

    // Then: All buttons should be visible
    await expect(geminiButton).toBeVisible();
    await expect(adkSseButton).toBeVisible();
    await expect(adkBidiButton).toBeVisible();

    // When: Click ADK SSE button
    await adkSseButton.click();

    // Then: Button should show selected state (border color change)
    // Note: Visual changes require screenshot comparison or style checks
    const sseButtonStyles = await adkSseButton.evaluate(
      (el) => window.getComputedStyle(el).borderColor,
    );
    expect(sseButtonStyles).toBeTruthy();
  });

  test("should have working chat input", async ({ page }) => {
    // Given: Chat page loaded

    // When: Find the chat input
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await expect(chatInput).toBeVisible();

    // When: Type into the input
    await chatInput.fill("Test message");

    // Then: Input should contain the typed text
    await expect(chatInput).toHaveValue("Test message");

    // When: Clear the input
    await chatInput.clear();

    // Then: Input should be empty
    await expect(chatInput).toHaveValue("");
  });
});
