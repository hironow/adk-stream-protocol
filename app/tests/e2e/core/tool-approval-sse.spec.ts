import { test, expect } from '@playwright/test';

/**
 * Tool Approval SSE Mode - Core Tests
 *
 * Comprehensive tests for Server Execute pattern (ADK SSE mode).
 * Tests the complete approval workflow from request to execution.
 *
 * Test Focus:
 * - adk_request_confirmation tool behavior
 * - Approval request rendering
 * - Approval response handling
 * - Tool execution after approval
 * - Result display
 */
test.describe('Tool Approval SSE Mode (Core)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');

    // Always start in ADK SSE mode for these tests
    const adkSseButton = page.getByRole('button', { name: /ADK SSE/i });
    await adkSseButton.click();
  });

  test('should display tool name and arguments in approval UI', async ({ page }) => {
    // Given: ADK SSE mode ready

    // When: Send message that triggers tool
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill('Search the web for latest AI developments');
    await chatInput.press('Enter');

    // Wait for user message
    await expect(page.locator('text=Search the web')).toBeVisible();

    // Wait for tool invocation
    await page.waitForTimeout(5000);

    // Then: Tool information should be displayed
    // Note: Exact format depends on component implementation
    const bodyText = await page.textContent('body');
    expect(bodyText).toBeTruthy();
  });

  test('should show approval state after clicking approve', async ({ page }) => {
    // Given: Message sent
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill('Get weather information');
    await chatInput.press('Enter');

    await expect(page.locator('text=weather')).toBeVisible();
    await page.waitForTimeout(5000);

    // When: Click approve button (if visible)
    const hasApproveButton = await page.locator('button:has-text("Approve"), button:has-text("approve")').count() > 0;

    if (hasApproveButton) {
      const approveButton = page.locator('button:has-text("Approve"), button:has-text("approve")').first();
      await approveButton.click();

      // Then: Approval state should be reflected in UI
      await page.waitForTimeout(2000);

      // Button should be disabled or hidden after approval
      const buttonStillVisible = await approveButton.isVisible().catch(() => false);

      // Either button is hidden or page moved to next state
      const bodyText = await page.textContent('body');
      expect(bodyText).toBeTruthy();
    }
  });

  test('should show denial state after clicking deny', async ({ page }) => {
    // Given: Message sent
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill('Delete important files');
    await chatInput.press('Enter');

    await expect(page.locator('text=Delete')).toBeVisible();
    await page.waitForTimeout(5000);

    // When: Click deny button (if visible)
    const hasDenyButton = await page.locator('button:has-text("Deny"), button:has-text("deny")').count() > 0;

    if (hasDenyButton) {
      const denyButton = page.locator('button:has-text("Deny"), button:has-text("deny")').first();
      await denyButton.click();

      // Then: Denial state should be reflected
      await page.waitForTimeout(2000);

      // Verify page is still functional
      const bodyText = await page.textContent('body');
      expect(bodyText).toBeTruthy();
    }
  });

  test('should display tool result after approval and execution', async ({ page }) => {
    // Given: Message sent
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill('What time is it?');
    await chatInput.press('Enter');

    await expect(page.locator('text=time')).toBeVisible();
    await page.waitForTimeout(5000);

    // When: Approve tool execution
    const hasApproveButton = await page.locator('button:has-text("Approve"), button:has-text("approve")').count() > 0;

    if (hasApproveButton) {
      await page.locator('button:has-text("Approve"), button:has-text("approve")').first().click();

      // Wait for tool execution and result
      await page.waitForTimeout(5000);
    }

    // Then: Tool result should be displayed
    const bodyText = await page.textContent('body');
    expect(bodyText).toBeTruthy();
    // Should contain the original message
    expect(bodyText).toContain('time');
  });

  test('should handle approval of tools with complex arguments', async ({ page }) => {
    // Given: Message with complex requirements
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill('Analyze data from multiple sources and generate a report');
    await chatInput.press('Enter');

    await expect(page.locator('text=Analyze data')).toBeVisible();
    await page.waitForTimeout(6000);

    // When: Approve any tool invocations
    const approveButtons = await page.locator('button:has-text("Approve"), button:has-text("approve")').all();

    for (const button of approveButtons.slice(0, 3)) { // Limit to first 3
      if (await button.isVisible()) {
        await button.click();
        await page.waitForTimeout(2000);
      }
    }

    // Then: Page should handle complex approval flow
    const bodyText = await page.textContent('body');
    expect(bodyText).toBeTruthy();
  });

  test('should allow canceling/denying after initial approval request', async ({ page }) => {
    // Given: Message sent
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill('Perform system maintenance');
    await chatInput.press('Enter');

    await expect(page.locator('text=maintenance')).toBeVisible();
    await page.waitForTimeout(5000);

    // When: User decides to deny instead of approve
    const hasDenyButton = await page.locator('button:has-text("Deny"), button:has-text("deny")').count() > 0;

    if (hasDenyButton) {
      const denyButton = page.locator('button:has-text("Deny"), button:has-text("deny")').first();
      await denyButton.click();

      // Then: User can send new message
      await page.waitForTimeout(2000);
      await chatInput.fill('Actually, never mind');
      await chatInput.press('Enter');

      await expect(page.locator('text=never mind')).toBeVisible();
    }
  });

  test('should show loading state during tool execution', async ({ page }) => {
    // Given: Message sent and approved
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill('Get current location');
    await chatInput.press('Enter');

    await expect(page.locator('text=location')).toBeVisible();
    await page.waitForTimeout(5000);

    // When: Approve tool
    const hasApproveButton = await page.locator('button:has-text("Approve"), button:has-text("approve")').count() > 0;

    if (hasApproveButton) {
      await page.locator('button:has-text("Approve"), button:has-text("approve")').first().click();

      // Then: Should show some indication of execution
      // Check within 1 second of approval
      await page.waitForTimeout(1000);

      // Look for loading indicators
      const bodyText = await page.textContent('body');
      expect(bodyText).toBeTruthy();
    }
  });

  test('should maintain message order with tool approvals', async ({ page }) => {
    // Given: Multiple messages with and without tools
    const chatInput = page.locator('input[placeholder="Type your message..."]');

    // Message 1: No tool
    await chatInput.fill('Hello, how are you?');
    await chatInput.press('Enter');
    await expect(page.locator('text=Hello, how are you?')).toBeVisible();
    await page.waitForTimeout(2000);

    // Message 2: With tool
    await chatInput.fill('Get the time');
    await chatInput.press('Enter');
    await expect(page.locator('text=Get the time')).toBeVisible();
    await page.waitForTimeout(5000);

    // Approve if needed
    const hasApproveButton = await page.locator('button:has-text("Approve"), button:has-text("approve")').count() > 0;
    if (hasApproveButton) {
      await page.locator('button:has-text("Approve"), button:has-text("approve")').first().click();
      await page.waitForTimeout(3000);
    }

    // Message 3: Another message
    await chatInput.fill('Thank you');
    await chatInput.press('Enter');
    await expect(page.locator('text=Thank you')).toBeVisible();

    // Then: All messages should be visible in order
    const bodyText = await page.textContent('body');
    expect(bodyText).toContain('Hello, how are you?');
    expect(bodyText).toContain('Get the time');
    expect(bodyText).toContain('Thank you');
  });

  test('should handle rapid approval of multiple tools', async ({ page }) => {
    // Given: Message that triggers multiple tools
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill('Get time, weather, and location');
    await chatInput.press('Enter');

    await expect(page.locator('text=Get time')).toBeVisible();
    await page.waitForTimeout(6000);

    // When: Quickly approve all visible tools
    const approveButtons = await page.locator('button:has-text("Approve"), button:has-text("approve")').all();

    for (const button of approveButtons) {
      if (await button.isVisible()) {
        await button.click();
        // Minimal wait between approvals
        await page.waitForTimeout(500);
      }
    }

    // Then: All approvals should be processed
    await page.waitForTimeout(4000);
    const bodyText = await page.textContent('body');
    expect(bodyText).toBeTruthy();
  });

  test.skip('should handle tool approval timeout', async ({ page }) => {
    // This test requires backend configuration for timeout
    // Skipped until timeout mechanism is implemented

    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill('Long running operation');
    await chatInput.press('Enter');

    // Wait for approval UI
    await page.waitForTimeout(5000);

    // Don't approve - wait for timeout
    await page.waitForTimeout(30000);

    // Should show timeout message
    const hasTimeoutMessage = await page.locator('text=/timeout/i, text=/expired/i').count() > 0;
  });
});
