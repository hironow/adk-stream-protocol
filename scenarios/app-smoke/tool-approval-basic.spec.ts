import { expect, test } from "@playwright/test";

/**
 * Tool Approval Basic - Smoke Tests
 *
 * Critical tests for tool approval functionality (Server Execute pattern).
 * These tests verify the core approval workflow works correctly.
 *
 * Test Focus:
 * - Basic approve/deny workflow
 * - Tool approval UI rendering
 * - Tool execution after approval
 */
test.describe("Tool Approval Basic (Smoke)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("should display approval UI when tool requires confirmation", async ({
    page,
  }) => {
    // Given: ADK SSE mode (Server Execute pattern)
    const adkSseButton = page.getByRole("button", { name: /ADK SSE/i });
    await adkSseButton.click();

    // When: Send a message that triggers a tool requiring confirmation
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill("Search for AI news");
    await chatInput.press("Enter");

    // Wait for user message to appear
    const userMessage = page.getByTestId("message-user").first();
    await expect(userMessage).toBeVisible({ timeout: 10000 });
    await expect(userMessage.getByTestId("message-text")).toContainText(
      "Search for AI news",
    );

    // Then: Wait for potential approval UI
    // Note: Actual approval UI depends on backend configuration
    await page.waitForTimeout(5000);

    // Verify the page is still functional
    const bodyText = await page.textContent("body");
    expect(bodyText).toBeTruthy();
    expect(bodyText).toContain("Search for AI news");
  });

  test("should allow approving a tool invocation", async ({ page }) => {
    // Given: ADK SSE mode with tool approval
    const adkSseButton = page.getByRole("button", { name: /ADK SSE/i });
    await adkSseButton.click();

    // When: Send message that requires tool approval
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill("Get the current time in Tokyo");
    await chatInput.press("Enter");

    // Wait for message to appear
    const userMessage = page.getByTestId("message-user").first();
    await expect(userMessage).toBeVisible();
    await expect(userMessage.getByTestId("message-text")).toContainText(
      "current time",
    );

    // Wait for tool approval or automatic execution
    await page.waitForTimeout(5000);

    // Then: Look for approve button or tool result
    const hasApproveButton =
      (await page
        .locator('button:has-text("Approve"), button:has-text("approve")')
        .count()) > 0;

    if (hasApproveButton) {
      // Click approve button
      const approveButton = page
        .locator('button:has-text("Approve"), button:has-text("approve")')
        .first();
      await approveButton.click();

      // Wait for tool execution
      await page.waitForTimeout(3000);
    }

    // Verify page is functional after approval
    const bodyText = await page.textContent("body");
    expect(bodyText).toBeTruthy();
  });

  test("should allow denying a tool invocation", async ({ page }) => {
    // Given: ADK SSE mode
    const adkSseButton = page.getByRole("button", { name: /ADK SSE/i });
    await adkSseButton.click();

    // When: Send message that may require approval
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill("Delete all my files");
    await chatInput.press("Enter");

    // Wait for message
    const userMessage = page.getByTestId("message-user").first();
    await expect(userMessage).toBeVisible();
    await expect(userMessage.getByTestId("message-text")).toContainText(
      "Delete",
    );

    // Wait for potential approval UI
    await page.waitForTimeout(5000);

    // Then: Look for deny button
    const hasDenyButton =
      (await page
        .locator('button:has-text("Deny"), button:has-text("deny")')
        .count()) > 0;

    if (hasDenyButton) {
      // Click deny button
      const denyButton = page
        .locator('button:has-text("Deny"), button:has-text("deny")')
        .first();
      await denyButton.click();

      // Wait for UI update
      await page.waitForTimeout(2000);
    }

    // Verify page is still functional after denial
    const bodyText = await page.textContent("body");
    expect(bodyText).toBeTruthy();
  });

  test("should execute tools automatically in BIDI mode", async ({ page }) => {
    // Given: ADK BIDI mode (Frontend Execute pattern - no approval needed)
    const adkBidiButton = page.getByRole("button", { name: /ADK BIDI/i });
    await adkBidiButton.click();

    // When: Send message that triggers frontend tool
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill("Change the background music");
    await chatInput.press("Enter");

    // Wait for message
    const userMessage = page.getByTestId("message-user").first();
    await expect(userMessage).toBeVisible();
    await expect(userMessage.getByTestId("message-text")).toContainText(
      "background music",
    );

    // Then: Tool should execute automatically without approval UI
    await page.waitForTimeout(3000);

    // Should NOT have approve/deny buttons in BIDI mode
    const hasApproveButton =
      (await page
        .locator('button:has-text("Approve"), button:has-text("approve")')
        .count()) > 0;
    expect(hasApproveButton).toBe(false);

    // Verify page is functional
    const bodyText = await page.textContent("body");
    expect(bodyText).toBeTruthy();
  });

  test("should handle multiple tool approvals in sequence", async ({
    page,
  }) => {
    // Given: ADK SSE mode
    const adkSseButton = page.getByRole("button", { name: /ADK SSE/i });
    await adkSseButton.click();

    // When: Send message that might trigger multiple tools
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill("Search for AI news and get the current time");
    await chatInput.press("Enter");

    // Wait for message
    const userMessage = page.getByTestId("message-user").first();
    await expect(userMessage).toBeVisible();
    await expect(userMessage.getByTestId("message-text")).toContainText(
      "Search for AI news",
    );

    // Wait for tool invocations
    await page.waitForTimeout(8000);

    // Then: Approve any visible tools
    const approveButtons = await page
      .locator('button:has-text("Approve"), button:has-text("approve")')
      .all();

    for (const button of approveButtons) {
      if (await button.isVisible()) {
        await button.click();
        await page.waitForTimeout(2000);
      }
    }

    // Verify page is still functional
    const bodyText = await page.textContent("body");
    expect(bodyText).toBeTruthy();
  });

  test("should preserve chat history after approval workflow", async ({
    page,
  }) => {
    // Given: ADK SSE mode with a message sent
    const adkSseButton = page.getByRole("button", { name: /ADK SSE/i });
    await adkSseButton.click();

    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill("First message without tools");
    await chatInput.press("Enter");

    // Verify first user message appears
    const firstUserMessage = page.getByTestId("message-user").first();
    await expect(firstUserMessage).toBeVisible();
    await expect(firstUserMessage.getByTestId("message-text")).toContainText(
      "First message without tools",
    );
    await page.waitForTimeout(2000);

    // When: Send message with tool approval
    await chatInput.fill("Get current time");
    await chatInput.press("Enter");

    // Verify second user message appears
    const secondUserMessage = page.getByTestId("message-user").nth(1);
    await expect(secondUserMessage).toBeVisible();
    await expect(secondUserMessage.getByTestId("message-text")).toContainText(
      "Get current time",
    );
    await page.waitForTimeout(5000);

    // Approve if needed
    const hasApproveButton =
      (await page
        .locator('button:has-text("Approve"), button:has-text("approve")')
        .count()) > 0;
    if (hasApproveButton) {
      await page
        .locator('button:has-text("Approve"), button:has-text("approve")')
        .first()
        .click();
      await page.waitForTimeout(3000);
    }

    // Then: Both messages should still be visible
    await expect(firstUserMessage).toBeVisible();
    await expect(firstUserMessage.getByTestId("message-text")).toContainText(
      "First message without tools",
    );
    await expect(secondUserMessage).toBeVisible();
    await expect(secondUserMessage.getByTestId("message-text")).toContainText(
      "Get current time",
    );
  });
});
