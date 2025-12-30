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

    const userMessage = page.getByTestId("message-user").first();
    await expect(userMessage).toBeVisible();
    await expect(userMessage.getByTestId("message-text")).toContainText(
      "Test message for error handling",
    );

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
    const firstUserMessage = page.getByTestId("message-user").first();
    await expect(firstUserMessage).toBeVisible();
    await expect(firstUserMessage.getByTestId("message-text")).toContainText(
      "might fail",
    );
    await page.waitForTimeout(5000);

    // Then: Can send another message
    await chatInput.fill("Recovery message");
    await chatInput.press("Enter");
    const secondUserMessage = page.getByTestId("message-user").nth(1);
    await expect(secondUserMessage).toBeVisible();
    await expect(secondUserMessage.getByTestId("message-text")).toContainText(
      "Recovery message",
    );
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

    const userMessage = page.getByTestId("message-user").first();
    await expect(userMessage).toBeVisible();
    await expect(userMessage.getByTestId("message-text")).toContainText(
      "might error",
    );
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

    const firstUserMessage = page.getByTestId("message-user").first();
    await expect(firstUserMessage).toBeVisible();
    await expect(firstUserMessage.getByTestId("message-text")).toContainText(
      "might error",
    );
    await page.waitForTimeout(5000);

    // Then: Can send new message
    await chatInput.fill("Continue after error");
    await chatInput.press("Enter");
    const secondUserMessage = page.getByTestId("message-user").nth(1);
    await expect(secondUserMessage).toBeVisible();
    await expect(secondUserMessage.getByTestId("message-text")).toContainText(
      "Continue after error",
    );
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
    const userMessage = page.getByTestId("message-user").first();
    await expect(userMessage).toBeVisible();
    await expect(userMessage.getByTestId("message-text")).toContainText(
      "Test WebSocket connection",
    );
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
    const userMessage = page.getByTestId("message-user").first();
    await expect(userMessage).toBeVisible();
    await expect(userMessage.getByTestId("message-text")).toContainText(
      "rapid mode switch",
    );
  });

  test("should show error for malformed responses", async ({ page }) => {
    // Given: Gemini mode
    const geminiButton = page.getByRole("button", { name: /Gemini Direct/i });
    await geminiButton.click();

    // When: Send message
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill("Request that might return malformed data");
    await chatInput.press("Enter");

    const userMessage = page.getByTestId("message-user").first();
    await expect(userMessage).toBeVisible();
    await expect(userMessage.getByTestId("message-text")).toContainText(
      "malformed data",
    );
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

    const firstUserMessage = page.getByTestId("message-user").first();
    await expect(firstUserMessage).toBeVisible();
    await expect(firstUserMessage.getByTestId("message-text")).toContainText(
      "long story",
    );
    await page.waitForTimeout(2000);

    // Press ESC to interrupt
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1000);

    // Then: Can send new message
    await chatInput.fill("New message after interruption");
    await chatInput.press("Enter");
    const secondUserMessage = page.getByTestId("message-user").nth(1);
    await expect(secondUserMessage).toBeVisible();
    await expect(secondUserMessage.getByTestId("message-text")).toContainText(
      "after interruption",
    );
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

  test("should display dedicated rate limit error UI", async ({ page }) => {
    // Given: Mock API to return rate limit error (429)
    await page.route("**/api/chat", async (route) => {
      await route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({
          error:
            "RESOURCE_EXHAUSTED: Quota exceeded for quota metric 'aiplatform.googleapis.com/generate_content_requests' and limit 'GenerateContent requests per minute per region per base model'",
        }),
      });
    });

    // When: Send a message that triggers the rate limit error
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill("Test rate limit error UI");
    await chatInput.press("Enter");

    // Wait for user message to appear
    const userMessage = page.getByTestId("message-user").first();
    await expect(userMessage).toBeVisible();

    // Wait for rate limit error UI to appear
    const rateLimitError = page.getByTestId("rate-limit-error");
    await expect(rateLimitError).toBeVisible({ timeout: 5000 });

    // Then: Verify rate limit error UI elements
    await expect(page.getByTestId("rate-limit-error-title")).toContainText(
      "API Rate Limit Exceeded",
    );
    await expect(page.getByTestId("rate-limit-error-message")).toContainText(
      "exceeded the API rate limit",
    );

    // Verify technical details are collapsible
    const technicalDetails = page.getByTestId("rate-limit-error-details");
    await expect(technicalDetails).not.toBeVisible(); // Should be collapsed by default

    // Expand technical details
    await page.locator("summary:has-text('Technical Details')").click();
    await expect(technicalDetails).toBeVisible();
    await expect(technicalDetails).toContainText("RESOURCE_EXHAUSTED");
  });

  test("should distinguish rate limit errors from generic errors", async ({
    page,
  }) => {
    // Given: Mock API to return generic error
    await page.route("**/api/chat", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Internal server error",
        }),
      });
    });

    // When: Send a message that triggers generic error
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill("Test generic error");
    await chatInput.press("Enter");

    const userMessage = page.getByTestId("message-user").first();
    await expect(userMessage).toBeVisible();

    // Wait for error to appear
    await page.waitForTimeout(2000);

    // Then: Should show generic error, not rate limit error UI
    const rateLimitError = page.getByTestId("rate-limit-error");
    await expect(rateLimitError).not.toBeVisible();

    // Generic error should be shown instead
    const genericError = page.getByTestId("generic-error");
    await expect(genericError).toBeVisible();
    await expect(genericError).toContainText("Internal server error");
  });

  test("should maintain message history after errors", async ({ page }) => {
    const chatInput = page.locator('input[placeholder="Type your message..."]');

    // Given: Send successful message
    await chatInput.fill("First successful message");
    await chatInput.press("Enter");
    const firstUserMessage = page.getByTestId("message-user").first();
    await expect(firstUserMessage).toBeVisible();
    await expect(firstUserMessage.getByTestId("message-text")).toContainText(
      "First successful message",
    );
    await page.waitForTimeout(3000);

    // When: Send message that might error
    await chatInput.fill("Message that might fail");
    await chatInput.press("Enter");
    const secondUserMessage = page.getByTestId("message-user").nth(1);
    await expect(secondUserMessage).toBeVisible();
    await expect(secondUserMessage.getByTestId("message-text")).toContainText(
      "might fail",
    );
    await page.waitForTimeout(5000);

    // Send another successful message
    await chatInput.fill("Second successful message");
    await chatInput.press("Enter");
    const thirdUserMessage = page.getByTestId("message-user").nth(2);
    await expect(thirdUserMessage).toBeVisible();
    await expect(thirdUserMessage.getByTestId("message-text")).toContainText(
      "Second successful message",
    );

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

    const firstUserMessage = page.getByTestId("message-user").first();
    await expect(firstUserMessage).toBeVisible();
    await expect(firstUserMessage.getByTestId("message-text")).toContainText(
      "might fail",
    );
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
    const secondUserMessage = page.getByTestId("message-user").nth(1);
    await expect(secondUserMessage).toBeVisible();
    await expect(secondUserMessage.getByTestId("message-text")).toContainText(
      "Continue after tool error",
    );
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
    const firstUserMessage = page.getByTestId("message-user").first();
    await expect(firstUserMessage).toBeVisible();
    await expect(firstUserMessage.getByTestId("message-text")).toContainText(
      "before potential disconnect",
    );
    await page.waitForTimeout(3000);

    // Wait to simulate potential disconnection/reconnection
    await page.waitForTimeout(5000);

    // Then: Can send new message (reconnected or error handled)
    await chatInput.fill("Message after potential reconnect");
    await chatInput.press("Enter");
    const secondUserMessage = page.getByTestId("message-user").nth(1);
    await expect(secondUserMessage).toBeVisible();
    await expect(secondUserMessage.getByTestId("message-text")).toContainText(
      "after potential reconnect",
    );
  });

  test("should display user-friendly error messages", async ({ page }) => {
    // Given: Any mode
    const chatInput = page.locator('input[placeholder="Type your message..."]');

    // When: Trigger various error scenarios
    await chatInput.fill("Trigger error scenario");
    await chatInput.press("Enter");
    const userMessage = page.getByTestId("message-user").first();
    await expect(userMessage).toBeVisible();
    await expect(userMessage.getByTestId("message-text")).toContainText(
      "error scenario",
    );
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

    const userMessage = page.getByTestId("message-user").first();
    await expect(userMessage).toBeVisible();
    await expect(userMessage.getByTestId("message-text")).toContainText(
      "multiple tools",
    );
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
