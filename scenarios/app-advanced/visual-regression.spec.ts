import { expect, test } from "@playwright/test";

/**
 * Visual Regression - Advanced Tests
 *
 * Tests for visual consistency and UI regression detection.
 * Uses screenshot comparison to detect unintended visual changes.
 *
 * Test Focus:
 * - Page layout consistency
 * - Component rendering consistency
 * - Mode switcher visual state
 * - Message display formatting
 * - Tool UI rendering
 */
test.describe("Visual Regression (Advanced)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // Wait for page to be fully loaded
    await page.waitForTimeout(2000);
  });

  test("should maintain consistent initial page layout", async ({ page }) => {
    // Given: Initial page load
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await expect(chatInput).toBeVisible();

    // When: Take screenshot of initial state
    // Then: Visual should match baseline
    await expect(page).toHaveScreenshot("initial-page-layout.png", {
      fullPage: true,
      maxDiffPixels: 100, // Allow small differences
    });
  });

  test("should maintain consistent mode switcher appearance", async ({
    page,
  }) => {
    // Given: Mode switcher is visible
    const geminiButton = page.getByRole("button", { name: /Gemini Direct/i });
    const adkSseButton = page.getByRole("button", { name: /ADK SSE/i });
    const adkBidiButton = page.getByRole("button", { name: /ADK BIDI/i });

    await expect(geminiButton).toBeVisible();
    await expect(adkSseButton).toBeVisible();
    await expect(adkBidiButton).toBeVisible();

    // When: Take screenshot of mode switcher area
    const modeSwitcher = page
      .locator("div")
      .filter({ has: geminiButton })
      .first();

    // Then: Visual should match baseline
    await expect(modeSwitcher).toHaveScreenshot("mode-switcher.png", {
      maxDiffPixels: 50,
    });
  });

  test("should maintain consistent chat input styling", async ({ page }) => {
    // Given: Chat input and send button
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    const _sendButton = page.getByRole("button", { name: /Send/i });

    await expect(chatInput).toBeVisible();

    // When: Take screenshot of input area
    const inputArea = page.locator("form").first();

    // Then: Visual should match baseline
    await expect(inputArea).toHaveScreenshot("chat-input-area.png", {
      maxDiffPixels: 50,
    });
  });

  test("should maintain consistent message display", async ({ page }) => {
    // Given: Send a message
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill("Test message for visual regression");
    await chatInput.press("Enter");

    const userMessage = page.getByTestId("message-user").first();
    await expect(userMessage).toBeVisible();
    await expect(userMessage.getByTestId("message-text")).toContainText(
      "Test message for visual regression",
    );
    await page.waitForTimeout(3000);

    // When: Take screenshot of message area
    // Then: Message display should be consistent
    await expect(page).toHaveScreenshot("message-display.png", {
      fullPage: true,
      maxDiffPixels: 200, // Allow for dynamic content
    });
  });

  test("should maintain consistent mode selection visual state", async ({
    page,
  }) => {
    // Given: Select ADK SSE mode
    const adkSseButton = page.getByRole("button", { name: /ADK SSE/i });
    await adkSseButton.click();
    await page.waitForTimeout(500);

    // When: Take screenshot of selected state
    const modeSwitcher = page
      .locator("div")
      .filter({ has: adkSseButton })
      .first();

    // Then: Selected state should be visually consistent
    await expect(modeSwitcher).toHaveScreenshot("mode-sse-selected.png", {
      maxDiffPixels: 50,
    });
  });

  test("should maintain consistent BIDI mode UI", async ({ page }) => {
    // Given: Switch to BIDI mode
    const adkBidiButton = page.getByRole("button", { name: /ADK BIDI/i });
    await adkBidiButton.click();
    await page.waitForTimeout(1000);

    // When: Take screenshot of BIDI mode
    // Then: BIDI-specific UI should be consistent
    await expect(page).toHaveScreenshot("bidi-mode-ui.png", {
      fullPage: true,
      maxDiffPixels: 150,
    });
  });

  test("should maintain consistent empty state", async ({ page }) => {
    // Given: Fresh page with no messages
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await expect(chatInput).toBeVisible();

    // When: Take screenshot of empty state
    // Then: Empty state should be visually consistent
    await expect(page).toHaveScreenshot("empty-state.png", {
      fullPage: true,
      maxDiffPixels: 100,
    });
  });

  test("should maintain consistent file upload button", async ({ page }) => {
    // Given: File upload button is visible
    const uploadLabel = page.locator('label:has-text("Attach Image")').first();

    if (await uploadLabel.isVisible()) {
      // When: Take screenshot of upload button
      // Then: Visual should be consistent
      await expect(uploadLabel).toHaveScreenshot("file-upload-button.png", {
        maxDiffPixels: 30,
      });
    }
  });

  test("should maintain consistent button states", async ({ page }) => {
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    const sendButton = page.getByRole("button", { name: /Send/i });

    // Empty input state
    await chatInput.clear();
    await page.waitForTimeout(300);
    await expect(sendButton).toHaveScreenshot("send-button-empty.png", {
      maxDiffPixels: 20,
    });

    // With text state
    await chatInput.fill("Test");
    await page.waitForTimeout(300);
    await expect(sendButton).toHaveScreenshot("send-button-filled.png", {
      maxDiffPixels: 20,
    });
  });

  test.skip("should maintain consistent streaming animation", async ({
    page,
  }) => {
    // This test is challenging due to animation timing
    // Skipped for now, but could be implemented with video comparison

    const geminiButton = page.getByRole("button", { name: /Gemini Direct/i });
    await geminiButton.click();

    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill("Tell me a story");
    await chatInput.press("Enter");

    await expect(page.locator("text=Tell me a story")).toBeVisible();
    await page.waitForTimeout(2000);

    // Screenshot during streaming
    await expect(page).toHaveScreenshot("streaming-state.png", {
      fullPage: true,
      maxDiffPixels: 500,
    });
  });

  test("should maintain consistent error message styling", async ({ page }) => {
    // Note: This test may not trigger actual errors
    // It's here for completeness and future error injection

    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill("Test error scenario");
    await chatInput.press("Enter");

    await page.waitForTimeout(5000);

    // Check for error elements
    const errorElements = await page
      .locator('[class*="error"], [data-testid*="error"]')
      .count();

    if (errorElements > 0) {
      const errorElement = page
        .locator('[class*="error"], [data-testid*="error"]')
        .first();
      await expect(errorElement).toHaveScreenshot("error-message.png", {
        maxDiffPixels: 50,
      });
    }
  });

  test("should maintain consistent rate limit error UI", async ({ page }) => {
    // Given: Mock API to return rate limit error (429)
    await page.route("**/api/chat", async (route) => {
      await route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({
          error: "RESOURCE_EXHAUSTED: Quota exceeded for quota metric 'aiplatform.googleapis.com/generate_content_requests' and limit 'GenerateContent requests per minute per region per base model'",
        }),
      });
    });

    // When: Send a message that triggers the rate limit error
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill("Test rate limit");
    await chatInput.press("Enter");

    // Wait for error UI to appear
    const rateLimitError = page.getByTestId("rate-limit-error");
    await expect(rateLimitError).toBeVisible({ timeout: 5000 });

    // Then: Rate limit error UI should be visually consistent
    await expect(rateLimitError).toHaveScreenshot("rate-limit-error.png", {
      maxDiffPixels: 100,
    });

    // Verify error has expected elements
    await expect(page.getByTestId("rate-limit-error-title")).toContainText(
      "API Rate Limit Exceeded",
    );
    await expect(page.getByTestId("rate-limit-error-message")).toBeVisible();
  });

  test("should maintain consistent spacing and typography", async ({
    page,
  }) => {
    // Given: Multiple messages
    const chatInput = page.locator('input[placeholder="Type your message..."]');

    await chatInput.fill("First message");
    await chatInput.press("Enter");
    const firstUserMessage = page.getByTestId("message-user").first();
    await expect(firstUserMessage).toBeVisible();
    await expect(firstUserMessage.getByTestId("message-text")).toContainText(
      "First message",
    );
    await page.waitForTimeout(2000);

    await chatInput.fill("Second message");
    await chatInput.press("Enter");
    const secondUserMessage = page.getByTestId("message-user").nth(1);
    await expect(secondUserMessage).toBeVisible();
    await expect(secondUserMessage.getByTestId("message-text")).toContainText(
      "Second message",
    );
    await page.waitForTimeout(2000);

    // When: Take full page screenshot
    // Then: Spacing and typography should be consistent
    await expect(page).toHaveScreenshot("typography-spacing.png", {
      fullPage: true,
      maxDiffPixels: 200,
    });
  });
});
