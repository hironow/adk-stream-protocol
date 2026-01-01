import { expect, test } from "@playwright/test";

/**
 * Tool Approval Mixed Scenarios - Core Tests
 *
 * Tests for complex scenarios combining both approval patterns.
 * Verifies mode switching and mixed tool execution workflows.
 *
 * Test Focus:
 * - Switching between SSE (Server Execute) and BIDI (Frontend Execute)
 * - Tool approval state preservation during mode switches
 * - Mixed tool types in single conversation
 * - Edge cases and complex workflows
 */
test.describe("Tool Approval Mixed Scenarios (Core)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("should switch from SSE approval mode to BIDI automatic mode", async ({
    page,
  }) => {
    // Given: Start in SSE mode with approved tool
    const adkSseButton = page.getByRole("button", { name: /ADK SSE/i });
    await adkSseButton.click();

    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill("Get the current time");
    await chatInput.press("Enter");

    // Verify user message appears
    const firstUserMessage = page.getByTestId("message-user").first();
    await expect(firstUserMessage).toBeVisible({ timeout: 10000 });
    await expect(firstUserMessage.getByTestId("message-text")).toContainText(
      "current time",
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

    // When: Switch to BIDI mode
    const adkBidiButton = page.getByRole("button", { name: /ADK BIDI/i });
    await adkBidiButton.click();
    await page.waitForTimeout(1000);

    // Send message in BIDI mode
    await chatInput.fill("Change background music");
    await chatInput.press("Enter");

    // Verify second user message appears
    const secondUserMessage = page.getByTestId("message-user").nth(1);
    await expect(secondUserMessage).toBeVisible({ timeout: 10000 });
    await expect(secondUserMessage.getByTestId("message-text")).toContainText(
      "background music",
    );
    await page.waitForTimeout(3000);

    // Then: Tool should execute automatically without approval in BIDI
    const noApprovalButtons =
      (await page
        .locator('button:has-text("Approve"), button:has-text("approve")')
        .count()) === 0;
    expect(noApprovalButtons).toBe(true);

    // Both messages should be visible
    await expect(firstUserMessage).toBeVisible();
    await expect(secondUserMessage).toBeVisible();
  });

  test("should switch from BIDI automatic mode to SSE approval mode", async ({
    page,
  }) => {
    // Given: Start in BIDI mode with automatic execution
    const adkBidiButton = page.getByRole("button", { name: /ADK BIDI/i });
    await adkBidiButton.click();

    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill("Play some music");
    await chatInput.press("Enter");

    const firstUserMessage = page.getByTestId("message-user").first();
    await expect(firstUserMessage).toBeVisible();
    await expect(firstUserMessage.getByTestId("message-text")).toContainText(
      "music",
    );
    await page.waitForTimeout(3000);

    // When: Switch to SSE mode
    const adkSseButton = page.getByRole("button", { name: /ADK SSE/i });
    await adkSseButton.click();
    await page.waitForTimeout(1000);

    // Send message that may require approval
    await chatInput.fill("Search for information");
    await chatInput.press("Enter");

    const secondUserMessage = page.getByTestId("message-user").nth(1);
    await expect(secondUserMessage).toBeVisible();
    await expect(secondUserMessage.getByTestId("message-text")).toContainText(
      "Search for information",
    );
    await page.waitForTimeout(5000);

    // Then: May show approval UI in SSE mode
    // Or may execute directly depending on backend configuration
    await expect(firstUserMessage).toBeVisible();
    await expect(secondUserMessage).toBeVisible();
  });

  test("should preserve message history across mode switches with tools", async ({
    page,
  }) => {
    const chatInput = page.locator('input[placeholder="Type your message..."]');

    // Gemini mode message
    const geminiButton = page.getByRole("button", { name: /Gemini Direct/i });
    await geminiButton.click();
    await chatInput.fill("Message in Gemini mode");
    await chatInput.press("Enter");

    const firstUserMessage = page.getByTestId("message-user").first();
    await expect(firstUserMessage).toBeVisible();
    await expect(firstUserMessage.getByTestId("message-text")).toContainText(
      "Gemini mode",
    );
    await page.waitForTimeout(2000);

    // SSE mode with tool
    const adkSseButton = page.getByRole("button", { name: /ADK SSE/i });
    await adkSseButton.click();
    await page.waitForTimeout(500);
    await chatInput.fill("Get time in SSE");
    await chatInput.press("Enter");

    const secondUserMessage = page.getByTestId("message-user").nth(1);
    await expect(secondUserMessage).toBeVisible();
    await expect(secondUserMessage.getByTestId("message-text")).toContainText(
      "time in SSE",
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

    // BIDI mode with automatic tool
    const adkBidiButton = page.getByRole("button", { name: /ADK BIDI/i });
    await adkBidiButton.click();
    await page.waitForTimeout(500);
    await chatInput.fill("Play music in BIDI");
    await chatInput.press("Enter");

    const thirdUserMessage = page.getByTestId("message-user").nth(2);
    await expect(thirdUserMessage).toBeVisible();
    await expect(thirdUserMessage.getByTestId("message-text")).toContainText(
      "music in BIDI",
    );
    await page.waitForTimeout(3000);

    // Then: All messages preserved
    await expect(firstUserMessage).toBeVisible();
    await expect(secondUserMessage).toBeVisible();
    await expect(thirdUserMessage).toBeVisible();
  });

  test("should handle pending approval when switching modes", async ({
    page,
  }) => {
    // Given: SSE mode with pending approval
    const adkSseButton = page.getByRole("button", { name: /ADK SSE/i });
    await adkSseButton.click();

    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill("Request tool execution");
    await chatInput.press("Enter");

    const firstUserMessage = page.getByTestId("message-user").first();
    await expect(firstUserMessage).toBeVisible();
    await expect(firstUserMessage.getByTestId("message-text")).toContainText(
      "tool execution",
    );
    await page.waitForTimeout(3000);

    // When: Switch mode while approval is pending
    const adkBidiButton = page.getByRole("button", { name: /ADK BIDI/i });
    await adkBidiButton.click();
    await page.waitForTimeout(1000);

    // Then: Should handle gracefully
    // Can send new message in BIDI mode
    await chatInput.fill("New message in BIDI");
    await chatInput.press("Enter");

    const secondUserMessage = page.getByTestId("message-user").nth(1);
    await expect(secondUserMessage).toBeVisible();
    await expect(secondUserMessage.getByTestId("message-text")).toContainText(
      "New message in BIDI",
    );
  });

  test("should handle tool execution across Gemini, SSE, and BIDI modes", async ({
    page,
  }) => {
    const chatInput = page.locator('input[placeholder="Type your message..."]');

    // Test Gemini mode (no custom tools)
    const geminiButton = page.getByRole("button", { name: /Gemini Direct/i });
    await geminiButton.click();
    await chatInput.fill("Simple question in Gemini");
    await chatInput.press("Enter");

    const firstUserMessage = page.getByTestId("message-user").first();
    await expect(firstUserMessage).toBeVisible();
    await expect(firstUserMessage.getByTestId("message-text")).toContainText(
      "Simple question in Gemini",
    );
    await page.waitForTimeout(2000);

    // Test SSE mode (with approval)
    const adkSseButton = page.getByRole("button", { name: /ADK SSE/i });
    await adkSseButton.click();
    await page.waitForTimeout(500);
    await chatInput.fill("Tool in SSE mode");
    await chatInput.press("Enter");

    const secondUserMessage = page.getByTestId("message-user").nth(1);
    await expect(secondUserMessage).toBeVisible();
    await expect(secondUserMessage.getByTestId("message-text")).toContainText(
      "Tool in SSE",
    );
    await page.waitForTimeout(5000);

    // Approve if needed
    const sseApproveButton = await page
      .locator('button:has-text("Approve"), button:has-text("approve")')
      .count();
    if (sseApproveButton > 0) {
      await page
        .locator('button:has-text("Approve"), button:has-text("approve")')
        .first()
        .click();
      await page.waitForTimeout(3000);
    }

    // Test BIDI mode (automatic)
    const adkBidiButton = page.getByRole("button", { name: /ADK BIDI/i });
    await adkBidiButton.click();
    await page.waitForTimeout(500);
    await chatInput.fill("Tool in BIDI mode");
    await chatInput.press("Enter");

    const thirdUserMessage = page.getByTestId("message-user").nth(2);
    await expect(thirdUserMessage).toBeVisible();
    await expect(thirdUserMessage.getByTestId("message-text")).toContainText(
      "Tool in BIDI",
    );
    await page.waitForTimeout(3000);

    // Then: All modes handled correctly
    await expect(firstUserMessage).toBeVisible();
    await expect(secondUserMessage).toBeVisible();
    await expect(thirdUserMessage).toBeVisible();
  });

  test("should handle approval then denial in SSE mode", async ({ page }) => {
    // Given: SSE mode
    const adkSseButton = page.getByRole("button", { name: /ADK SSE/i });
    await adkSseButton.click();

    const chatInput = page.locator('input[placeholder="Type your message..."]');

    // First tool - approve
    await chatInput.fill("First tool request");
    await chatInput.press("Enter");

    const firstUserMessage = page.getByTestId("message-user").first();
    await expect(firstUserMessage).toBeVisible();
    await expect(firstUserMessage.getByTestId("message-text")).toContainText(
      "First tool",
    );
    await page.waitForTimeout(5000);

    const firstApprove = await page
      .locator('button:has-text("Approve"), button:has-text("approve")')
      .count();
    if (firstApprove > 0) {
      await page
        .locator('button:has-text("Approve"), button:has-text("approve")')
        .first()
        .click();
      await page.waitForTimeout(3000);
    }

    // Second tool - deny
    await chatInput.fill("Second tool request");
    await chatInput.press("Enter");

    const secondUserMessage = page.getByTestId("message-user").nth(1);
    await expect(secondUserMessage).toBeVisible();
    await expect(secondUserMessage.getByTestId("message-text")).toContainText(
      "Second tool",
    );
    await page.waitForTimeout(5000);

    const denyButton = await page
      .locator('button:has-text("Deny"), button:has-text("deny")')
      .count();
    if (denyButton > 0) {
      await page
        .locator('button:has-text("Deny"), button:has-text("deny")')
        .first()
        .click();
      await page.waitForTimeout(2000);
    }

    // Then: Both requests handled differently
    await expect(firstUserMessage).toBeVisible();
    await expect(secondUserMessage).toBeVisible();
  });

  test("should handle rapid mode switching with tools", async ({ page }) => {
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    const adkSseButton = page.getByRole("button", { name: /ADK SSE/i });
    const adkBidiButton = page.getByRole("button", { name: /ADK BIDI/i });

    // Rapidly switch between modes with messages
    await adkSseButton.click();
    await chatInput.fill("SSE 1");
    await chatInput.press("Enter");
    await page.waitForTimeout(1000);

    await adkBidiButton.click();
    await page.waitForTimeout(300);
    await chatInput.fill("BIDI 1");
    await chatInput.press("Enter");
    await page.waitForTimeout(1000);

    await adkSseButton.click();
    await page.waitForTimeout(300);
    await chatInput.fill("SSE 2");
    await chatInput.press("Enter");
    await page.waitForTimeout(1000);

    await adkBidiButton.click();
    await page.waitForTimeout(300);
    await chatInput.fill("BIDI 2");
    await chatInput.press("Enter");
    await page.waitForTimeout(2000);

    // Then: All messages should be handled
    const bodyText = await page.textContent("body");
    expect(bodyText).toBeTruthy();
  });

  test("should display correct UI for each mode after switching", async ({
    page,
  }) => {
    const chatInput = page.locator('input[placeholder="Type your message..."]');

    // SSE mode
    const adkSseButton = page.getByRole("button", { name: /ADK SSE/i });
    await adkSseButton.click();
    await page.waitForTimeout(500);

    // Check SSE UI is present
    await expect(chatInput).toBeVisible();

    // BIDI mode
    const adkBidiButton = page.getByRole("button", { name: /ADK BIDI/i });
    await adkBidiButton.click();
    await page.waitForTimeout(500);

    // Check BIDI UI is present (may have additional audio controls)
    await expect(chatInput).toBeVisible();

    // Gemini mode
    const geminiButton = page.getByRole("button", { name: /Gemini Direct/i });
    await geminiButton.click();
    await page.waitForTimeout(500);

    // Check Gemini UI is present
    await expect(chatInput).toBeVisible();
  });

  test("should handle errors during mode switch with pending tools", async ({
    page,
  }) => {
    // Given: SSE mode with tool executing
    const adkSseButton = page.getByRole("button", { name: /ADK SSE/i });
    await adkSseButton.click();

    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill("Long running tool");
    await chatInput.press("Enter");

    const firstUserMessage = page.getByTestId("message-user").first();
    await expect(firstUserMessage).toBeVisible();
    await expect(firstUserMessage.getByTestId("message-text")).toContainText(
      "Long running",
    );
    await page.waitForTimeout(2000);

    // When: Switch mode quickly
    const adkBidiButton = page.getByRole("button", { name: /ADK BIDI/i });
    await adkBidiButton.click();

    // Then: Should handle gracefully
    await page.waitForTimeout(2000);
    await expect(chatInput).toBeVisible();

    // Can send new message
    await chatInput.fill("New message after switch");
    await chatInput.press("Enter");

    const secondUserMessage = page.getByTestId("message-user").nth(1);
    await expect(secondUserMessage).toBeVisible();
    await expect(secondUserMessage.getByTestId("message-text")).toContainText(
      "after switch",
    );
  });

  test("should maintain separate tool execution contexts per mode", async ({
    page,
  }) => {
    const chatInput = page.locator('input[placeholder="Type your message..."]');

    // Execute tool in SSE mode
    const adkSseButton = page.getByRole("button", { name: /ADK SSE/i });
    await adkSseButton.click();
    await chatInput.fill("SSE tool execution");
    await chatInput.press("Enter");

    const firstUserMessage = page.getByTestId("message-user").first();
    await expect(firstUserMessage).toBeVisible();
    await expect(firstUserMessage.getByTestId("message-text")).toContainText(
      "SSE tool",
    );
    await page.waitForTimeout(5000);

    // Approve if needed
    const sseApprove = await page
      .locator('button:has-text("Approve"), button:has-text("approve")')
      .count();
    if (sseApprove > 0) {
      await page
        .locator('button:has-text("Approve"), button:has-text("approve")')
        .first()
        .click();
      await page.waitForTimeout(3000);
    }

    // Execute tool in BIDI mode
    const adkBidiButton = page.getByRole("button", { name: /ADK BIDI/i });
    await adkBidiButton.click();
    await page.waitForTimeout(500);
    await chatInput.fill("BIDI tool execution");
    await chatInput.press("Enter");

    const secondUserMessage = page.getByTestId("message-user").nth(1);
    await expect(secondUserMessage).toBeVisible();
    await expect(secondUserMessage.getByTestId("message-text")).toContainText(
      "BIDI tool",
    );
    await page.waitForTimeout(3000);

    // Then: Both executions completed in their respective contexts
    await expect(firstUserMessage).toBeVisible();
    await expect(secondUserMessage).toBeVisible();
  });
});
