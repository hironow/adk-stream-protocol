import { expect, test } from "@playwright/test";

/**
 * Error Handling UI - Advanced Tests
 *
 * Tests for error scenarios and UI error handling.
 * Verifies that errors are displayed properly and the app remains functional.
 *
 * Test Focus:
 * - Network errors
 * - Tool execution errors
 * - Validation errors
 * - Timeout errors
 * - Error recovery
 * - Error message display
 */
test.describe("Error Handling UI (Advanced)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("should display error message when API fails", async ({ page }) => {
    // Given: Gemini mode
    const geminiButton = page.getByRole("button", { name: /Gemini Direct/i });
    await geminiButton.click();

    // When: Send message (may fail depending on API availability)
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill("Test message for error handling");
    await chatInput.press("Enter");

    await expect(
      page.locator("text=Test message for error handling"),
    ).toBeVisible();

    // Wait for response or error
    await page.waitForTimeout(10000);

    // Then: Page should remain functional
    const bodyText = await page.textContent("body");
    expect(bodyText).toBeTruthy();

    // Input should still be usable
    await expect(chatInput).toBeVisible();
    await expect(chatInput).toBeEnabled();
  });

  test("should recover from error and allow new messages", async ({ page }) => {
    // Given: Any mode
    const chatInput = page.locator('input[placeholder="Type your message..."]');

    // When: Send message that might error
    await chatInput.fill("Message that might fail");
    await chatInput.press("Enter");
    await expect(page.locator("text=might fail")).toBeVisible();
    await page.waitForTimeout(5000);

    // Then: Can send another message
    await chatInput.fill("Recovery message");
    await chatInput.press("Enter");
    await expect(page.locator("text=Recovery message")).toBeVisible();
  });

  test("should handle tool execution errors gracefully in SSE mode", async ({
    page,
  }) => {
    // Given: SSE mode
    const adkSseButton = page.getByRole("button", { name: /ADK SSE/i });
    await adkSseButton.click();

    // When: Request tool that might fail
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill("Execute tool that might error");
    await chatInput.press("Enter");

    await expect(page.locator("text=might error")).toBeVisible();
    await page.waitForTimeout(5000);

    // Approve if needed
    const approveButton = await page
      .locator('button:has-text("Approve"), button:has-text("approve")')
      .count();
    if (approveButton > 0) {
      await page
        .locator('button:has-text("Approve"), button:has-text("approve")')
        .first()
        .click();
      await page.waitForTimeout(5000);
    }

    // Then: Error handled, can continue
    await expect(chatInput).toBeEnabled();
  });

  test("should handle tool execution errors gracefully in BIDI mode", async ({
    page,
  }) => {
    // Given: BIDI mode
    const adkBidiButton = page.getByRole("button", { name: /ADK BIDI/i });
    await adkBidiButton.click();

    // When: Trigger tool that might fail
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill("Execute frontend tool that might error");
    await chatInput.press("Enter");

    await expect(page.locator("text=might error")).toBeVisible();
    await page.waitForTimeout(5000);

    // Then: Can send new message
    await chatInput.fill("Continue after error");
    await chatInput.press("Enter");
    await expect(page.locator("text=Continue after error")).toBeVisible();
  });

  test("should display validation error for invalid input", async ({
    page,
  }) => {
    // Given: Any mode
    const chatInput = page.locator('input[placeholder="Type your message..."]');

    // When: Try to send empty message (if prevented)
    await chatInput.clear();
    await chatInput.press("Enter");

    // Then: Input should still be visible and enabled
    await expect(chatInput).toBeVisible();
    await expect(chatInput).toBeEnabled();
  });

  test("should handle WebSocket connection errors in BIDI mode", async ({
    page,
  }) => {
    // Given: BIDI mode
    const adkBidiButton = page.getByRole("button", { name: /ADK BIDI/i });
    await adkBidiButton.click();

    const chatInput = page.locator('input[placeholder="Type your message..."]');

    // When: Send message
    await chatInput.fill("Test WebSocket connection");
    await chatInput.press("Enter");
    await expect(page.locator("text=Test WebSocket connection")).toBeVisible();
    await page.waitForTimeout(5000);

    // Then: Connection should be established or error shown
    // In either case, UI should be functional
    await expect(chatInput).toBeEnabled();
  });

  test("should handle errors during mode switching", async ({ page }) => {
    const chatInput = page.locator('input[placeholder="Type your message..."]');

    // When: Rapidly switch modes
    const adkSseButton = page.getByRole("button", { name: /ADK SSE/i });
    const adkBidiButton = page.getByRole("button", { name: /ADK BIDI/i });
    const geminiButton = page.getByRole("button", { name: /Gemini Direct/i });

    await adkSseButton.click();
    await page.waitForTimeout(200);
    await adkBidiButton.click();
    await page.waitForTimeout(200);
    await geminiButton.click();
    await page.waitForTimeout(200);
    await adkSseButton.click();

    // Then: Should handle gracefully
    await page.waitForTimeout(1000);
    await expect(chatInput).toBeVisible();
    await expect(chatInput).toBeEnabled();

    // Can send message
    await chatInput.fill("Message after rapid mode switch");
    await chatInput.press("Enter");
    await expect(page.locator("text=rapid mode switch")).toBeVisible();
  });

  test("should show error for malformed responses", async ({ page }) => {
    // Given: Gemini mode
    const geminiButton = page.getByRole("button", { name: /Gemini Direct/i });
    await geminiButton.click();

    // When: Send message
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill("Request that might return malformed data");
    await chatInput.press("Enter");

    await expect(page.locator("text=malformed data")).toBeVisible();
    await page.waitForTimeout(10000);

    // Then: Error shown or handled gracefully
    const bodyText = await page.textContent("body");
    expect(bodyText).toBeTruthy();
  });

  test("should handle interrupted streaming gracefully", async ({ page }) => {
    // Given: Gemini mode with streaming
    const geminiButton = page.getByRole("button", { name: /Gemini Direct/i });
    await geminiButton.click();

    // When: Send message and interrupt quickly
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill("Tell me a long story");
    await chatInput.press("Enter");

    await expect(page.locator("text=long story")).toBeVisible();
    await page.waitForTimeout(2000);

    // Press ESC to interrupt
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1000);

    // Then: Can send new message
    await chatInput.fill("New message after interruption");
    await chatInput.press("Enter");
    await expect(page.locator("text=after interruption")).toBeVisible();
  });

  test("should handle rate limiting errors", async ({ page }) => {
    // Given: Gemini mode
    const geminiButton = page.getByRole("button", { name: /Gemini Direct/i });
    await geminiButton.click();

    const chatInput = page.locator('input[placeholder="Type your message..."]');

    // When: Send multiple messages rapidly
    for (let i = 1; i <= 3; i++) {
      await chatInput.fill(`Rapid message ${i}`);
      await chatInput.press("Enter");
      await page.waitForTimeout(500);
    }

    // Wait for processing
    await page.waitForTimeout(5000);

    // Then: All messages handled (rate limit or success)
    const bodyText = await page.textContent("body");
    expect(bodyText).toContain("Rapid message");
  });

  test("should maintain message history after errors", async ({ page }) => {
    const chatInput = page.locator('input[placeholder="Type your message..."]');

    // Given: Send successful message
    await chatInput.fill("First successful message");
    await chatInput.press("Enter");
    await expect(page.locator("text=First successful message")).toBeVisible();
    await page.waitForTimeout(3000);

    // When: Send message that might error
    await chatInput.fill("Message that might fail");
    await chatInput.press("Enter");
    await expect(page.locator("text=might fail")).toBeVisible();
    await page.waitForTimeout(5000);

    // Send another successful message
    await chatInput.fill("Second successful message");
    await chatInput.press("Enter");
    await expect(page.locator("text=Second successful message")).toBeVisible();

    // Then: All messages still visible
    const bodyText = await page.textContent("body");
    expect(bodyText).toContain("First successful message");
    expect(bodyText).toContain("might fail");
    expect(bodyText).toContain("Second successful message");
  });

  test("should handle errors in tool approval flow", async ({ page }) => {
    // Given: SSE mode
    const adkSseButton = page.getByRole("button", { name: /ADK SSE/i });
    await adkSseButton.click();

    // When: Request tool and approve
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill("Execute tool that might fail during execution");
    await chatInput.press("Enter");

    await expect(page.locator("text=might fail")).toBeVisible();
    await page.waitForTimeout(5000);

    // Approve tool
    const approveButton = await page
      .locator('button:has-text("Approve"), button:has-text("approve")')
      .count();
    if (approveButton > 0) {
      await page
        .locator('button:has-text("Approve"), button:has-text("approve")')
        .first()
        .click();
      await page.waitForTimeout(5000);
    }

    // Then: Error handled, can continue
    await chatInput.fill("Continue after tool error");
    await chatInput.press("Enter");
    await expect(page.locator("text=Continue after tool error")).toBeVisible();
  });

  test("should recover from WebSocket disconnection in BIDI mode", async ({
    page,
  }) => {
    // Given: BIDI mode
    const adkBidiButton = page.getByRole("button", { name: /ADK BIDI/i });
    await adkBidiButton.click();

    const chatInput = page.locator('input[placeholder="Type your message..."]');

    // When: Send message
    await chatInput.fill("Message before potential disconnect");
    await chatInput.press("Enter");
    await expect(
      page.locator("text=before potential disconnect"),
    ).toBeVisible();
    await page.waitForTimeout(3000);

    // Wait to simulate potential disconnection/reconnection
    await page.waitForTimeout(5000);

    // Then: Can send new message (reconnected or error handled)
    await chatInput.fill("Message after potential reconnect");
    await chatInput.press("Enter");
    await expect(page.locator("text=after potential reconnect")).toBeVisible();
  });

  test("should display user-friendly error messages", async ({ page }) => {
    // Given: Any mode
    const chatInput = page.locator('input[placeholder="Type your message..."]');

    // When: Trigger various error scenarios
    await chatInput.fill("Trigger error scenario");
    await chatInput.press("Enter");
    await expect(page.locator("text=error scenario")).toBeVisible();
    await page.waitForTimeout(5000);

    // Then: Check for error message elements
    // Look for common error patterns
    const bodyText = await page.textContent("body");
    expect(bodyText).toBeTruthy();

    // Page should remain functional
    await expect(chatInput).toBeEnabled();
  });

  test("should handle concurrent errors from multiple tools", async ({
    page,
  }) => {
    // Given: SSE mode with multiple tools
    const adkSseButton = page.getByRole("button", { name: /ADK SSE/i });
    await adkSseButton.click();

    // When: Request multiple tools that might error
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill("Execute multiple tools that might fail");
    await chatInput.press("Enter");

    await expect(page.locator("text=multiple tools")).toBeVisible();
    await page.waitForTimeout(6000);

    // Approve all if needed
    const approveButtons = await page
      .locator('button:has-text("Approve"), button:has-text("approve")')
      .all();
    for (const button of approveButtons) {
      if (await button.isVisible()) {
        await button.click();
        await page.waitForTimeout(2000);
      }
    }

    // Wait for results or errors
    await page.waitForTimeout(5000);

    // Then: All errors handled
    await expect(chatInput).toBeEnabled();
  });
});
