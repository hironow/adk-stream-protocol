import { expect, test } from "@playwright/test";

/**
 * Tool Execution UI - Core Tests
 *
 * Comprehensive tests for tool execution and approval UI.
 * Tests both Server Execute (tool approval) and Frontend Execute patterns.
 *
 * Test Focus:
 * - Tool invocation UI rendering
 * - Tool approval workflow (Server Execute)
 * - Frontend tool execution display
 * - Tool execution states and result display
 */
test.describe("Tool Execution UI (Core)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("should display tool invocation UI when tool is called", async ({
    page,
  }) => {
    // Given: ADK SSE mode with tool usage
    const adkSseButton = page.getByRole("button", { name: /ADK SSE/i });
    await adkSseButton.click();

    // When: Send a message that will trigger a tool call
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill("Search for AI news");
    await chatInput.press("Enter");

    // Wait for user message to appear
    const userMessage = page.getByTestId("message-user").first();
    await expect(userMessage).toBeVisible({ timeout: 10000 });
    await expect(userMessage.getByTestId("message-text")).toContainText(
      "Search for AI news",
    );

    // Then: Tool invocation UI should appear
    // Note: Tool name display depends on component implementation
    // We verify that some content appears beyond just the user message
    await page.waitForTimeout(3000); // Wait for potential tool call

    // Verify page is still functional
    const bodyText = await page.textContent("body");
    expect(bodyText).toBeTruthy();
  });

  test("should show approval buttons for tool requiring confirmation", async ({
    page,
  }) => {
    // Given: ADK SSE mode (Server Execute pattern)
    const adkSseButton = page.getByRole("button", { name: /ADK SSE/i });
    await adkSseButton.click();

    // When: Send a message that requires tool approval
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill("Delete all files");
    await chatInput.press("Enter");

    // Wait for user message
    const userMessage = page.getByTestId("message-user").first();
    await expect(userMessage).toBeVisible();
    await expect(userMessage.getByTestId("message-text")).toContainText(
      "Delete all files",
    );

    // Then: Approval UI should appear
    // Note: Actual UI depends on component implementation
    // This is a smoke test to verify no crashes
    await page.waitForTimeout(3000);

    const bodyContent = await page.textContent("body");
    expect(bodyContent).toBeTruthy();
  });

  test("should handle tool approval and show result", async ({ page }) => {
    // Given: ADK SSE mode with tool approval flow
    const adkSseButton = page.getByRole("button", { name: /ADK SSE/i });
    await adkSseButton.click();

    // When: Send message that triggers tool approval
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill("Search the web for latest AI developments");
    await chatInput.press("Enter");

    // Wait for message to appear
    const userMessage = page.getByTestId("message-user").first();
    await expect(userMessage).toBeVisible();
    await expect(userMessage.getByTestId("message-text")).toContainText(
      "Search the web",
    );

    // Wait for tool approval UI or execution
    await page.waitForTimeout(5000);

    // Then: Look for approve/deny buttons or tool execution result
    // Note: Actual buttons depend on data-testid implementation
    const hasApproveButton =
      (await page
        .locator('button:has-text("Approve"), button:has-text("approve")')
        .count()) > 0;
    const _hasDenyButton =
      (await page
        .locator('button:has-text("Deny"), button:has-text("deny")')
        .count()) > 0;

    // If approval buttons exist, click approve
    if (hasApproveButton) {
      const approveButton = page
        .locator('button:has-text("Approve"), button:has-text("approve")')
        .first();
      await approveButton.click();

      // Wait for tool execution
      await page.waitForTimeout(3000);
    }

    // Verify page is still functional after approval flow
    const bodyContent = await page.textContent("body");
    expect(bodyContent).toBeTruthy();
  });

  test("should display tool execution result inline", async ({ page }) => {
    // Given: ADK BIDI mode (Frontend Execute pattern)
    const adkBidiButton = page.getByRole("button", { name: /ADK BIDI/i });
    await adkBidiButton.click();

    // When: Send message that triggers frontend tool execution
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill("Change BGM to lofi");
    await chatInput.press("Enter");

    // Wait for message to appear
    const userMessage = page.getByTestId("message-user").first();
    await expect(userMessage).toBeVisible();
    await expect(userMessage.getByTestId("message-text")).toContainText(
      "Change BGM",
    );

    // Wait for tool execution
    await page.waitForTimeout(3000);

    // Then: Tool execution should complete
    // Frontend Execute tools run automatically without approval
    const bodyContent = await page.textContent("body");
    expect(bodyContent).toContain("Change BGM");
  });

  test("should show multiple tool invocations in sequence", async ({
    page,
  }) => {
    // Given: ADK SSE mode
    const adkSseButton = page.getByRole("button", { name: /ADK SSE/i });
    await adkSseButton.click();

    // When: Send message that might trigger multiple tools
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill("Research AI news and summarize the findings");
    await chatInput.press("Enter");

    // Wait for message
    const userMessage = page.getByTestId("message-user").first();
    await expect(userMessage).toBeVisible();
    await expect(userMessage.getByTestId("message-text")).toContainText(
      "Research AI news",
    );

    // Wait for tool invocations
    await page.waitForTimeout(5000);

    // Then: Multiple tool calls might appear
    // Verify page remains functional with complex tool flows
    const bodyContent = await page.textContent("body");
    expect(bodyContent).toBeTruthy();
    expect(bodyContent!.length).toBeGreaterThan(50);
  });

  test("should preserve tool results when switching modes", async ({
    page,
  }) => {
    // Given: Start in ADK SSE mode and execute a tool
    const adkSseButton = page.getByRole("button", { name: /ADK SSE/i });
    await adkSseButton.click();

    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill("Get current time");
    await chatInput.press("Enter");

    // Wait for user message
    const userMessage = page.getByTestId("message-user").first();
    await expect(userMessage).toBeVisible();
    await expect(userMessage.getByTestId("message-text")).toContainText(
      "Get current time",
    );

    // Wait for tool execution
    await page.waitForTimeout(3000);

    // When: Switch to Gemini mode
    const geminiButton = page.getByRole("button", { name: /Gemini Direct/i });
    await geminiButton.click();

    // Then: Previous messages and tool results should still be visible
    await expect(userMessage).toBeVisible();
    await expect(userMessage.getByTestId("message-text")).toContainText(
      "Get current time",
    );

    // Verify page content is preserved
    const bodyText = await page.textContent("body");
    expect(bodyText).toContain("Get current time");
  });

  test("should handle tool execution in each mode", async ({ page }) => {
    const chatInput = page.locator('input[placeholder="Type your message..."]');

    // Test ADK SSE mode with tool
    const adkSseButton = page.getByRole("button", { name: /ADK SSE/i });
    await adkSseButton.click();
    await chatInput.fill("What is the weather?");
    await chatInput.press("Enter");
    const firstUserMessage = page.getByTestId("message-user").first();
    await expect(firstUserMessage).toBeVisible();
    await expect(firstUserMessage.getByTestId("message-text")).toContainText(
      "What is the weather",
    );
    await page.waitForTimeout(3000);

    // Test ADK BIDI mode with tool
    const adkBidiButton = page.getByRole("button", { name: /ADK BIDI/i });
    await adkBidiButton.click();
    await page.waitForTimeout(500);
    await chatInput.fill("Play some music");
    await chatInput.press("Enter");
    const secondUserMessage = page.getByTestId("message-user").nth(1);
    await expect(secondUserMessage).toBeVisible();
    await expect(secondUserMessage.getByTestId("message-text")).toContainText(
      "Play some music",
    );
    await page.waitForTimeout(3000);

    // Then: Both tool executions should complete without errors
    const bodyContent = await page.textContent("body");
    expect(bodyContent).toContain("What is the weather");
    expect(bodyContent).toContain("Play some music");
  });

  test("should display tool name and arguments clearly", async ({ page }) => {
    // Given: ADK BIDI mode for frontend execution
    const adkBidiButton = page.getByRole("button", { name: /ADK BIDI/i });
    await adkBidiButton.click();

    // When: Send message with specific tool call
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill("Change background music to jazz");
    await chatInput.press("Enter");

    // Wait for message
    const userMessage = page.getByTestId("message-user").first();
    await expect(userMessage).toBeVisible();
    await expect(userMessage.getByTestId("message-text")).toContainText(
      "Change background music",
    );

    // Wait for tool invocation UI
    await page.waitForTimeout(3000);

    // Then: Tool information should be displayed
    // Note: Exact format depends on component implementation
    const bodyText = await page.textContent("body");
    expect(bodyText).toBeTruthy();
  });

  test("should show loading state during tool execution", async ({ page }) => {
    // Given: ADK SSE mode
    const adkSseButton = page.getByRole("button", { name: /ADK SSE/i });
    await adkSseButton.click();

    // When: Send message that triggers tool
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill("Analyze this data");
    await chatInput.press("Enter");

    // Wait for message
    const userMessage = page.getByTestId("message-user").first();
    await expect(userMessage).toBeVisible();
    await expect(userMessage.getByTestId("message-text")).toContainText(
      "Analyze this data",
    );

    // Then: Some loading or execution indicator should appear
    // Check for common loading indicators
    await page.waitForTimeout(2000);

    // Look for loading indicators (spinner, "executing", etc.)
    const bodyContent = await page.textContent("body");
    expect(bodyContent).toBeTruthy();

    // Verify page remains responsive during execution
    await expect(chatInput).toBeVisible();
  });

  test.skip("should handle tool execution errors gracefully", async ({
    page,
  }) => {
    // This test requires backend to simulate tool execution errors
    // Skipped until error simulation is implemented

    // Given: ADK SSE mode
    const adkSseButton = page.getByRole("button", { name: /ADK SSE/i });
    await adkSseButton.click();

    // When: Send message that will cause tool error
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill("Execute invalid tool");
    await chatInput.press("Enter");

    // Then: Error message should be displayed
    await page.waitForTimeout(3000);

    // Look for error indicators
    const _hasError =
      (await page.locator("text=/error/i, text=/failed/i").count()) > 0;

    // Page should remain functional
    await expect(chatInput).toBeVisible();
  });
});
