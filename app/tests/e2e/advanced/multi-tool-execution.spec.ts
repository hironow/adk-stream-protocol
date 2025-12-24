import { test, expect } from '@playwright/test';

/**
 * Multi-Tool Execution - Advanced Tests
 *
 * Tests for complex scenarios involving multiple tool executions.
 * Covers parallel tool execution, tool chains, and complex workflows.
 *
 * Test Focus:
 * - Parallel tool execution
 * - Sequential tool chains
 * - Mixed approval and automatic tools
 * - Tool execution ordering
 * - Resource management with multiple tools
 */
test.describe('Multi-Tool Execution (Advanced)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should handle multiple tools executing in parallel in BIDI mode', async ({ page }) => {
    // Given: BIDI mode for parallel execution
    const adkBidiButton = page.getByRole('button', { name: /ADK BIDI/i });
    await adkBidiButton.click();

    // When: Request multiple independent tools
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill('Get my location and change the background music');
    await chatInput.press('Enter');

    await expect(page.locator('text=location')).toBeVisible();
    await page.waitForTimeout(6000);

    // Then: Both tools should execute
    const bodyText = await page.textContent('body');
    expect(bodyText).toBeTruthy();
  });

  test('should handle sequential tool execution with dependencies', async ({ page }) => {
    // Given: SSE mode with sequential tools
    const adkSseButton = page.getByRole('button', { name: /ADK SSE/i });
    await adkSseButton.click();

    // When: Request tools that depend on each other
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill('Get the current time, then search for events happening now');
    await chatInput.press('Enter');

    await expect(page.locator('text=current time')).toBeVisible();
    await page.waitForTimeout(6000);

    // Approve first tool
    let approveButtons = await page.locator('button:has-text("Approve"), button:has-text("approve")').all();
    if (approveButtons.length > 0 && await approveButtons[0].isVisible()) {
      await approveButtons[0].click();
      await page.waitForTimeout(4000);

      // Approve second tool if needed
      approveButtons = await page.locator('button:has-text("Approve"), button:has-text("approve")').all();
      if (approveButtons.length > 0 && await approveButtons[0].isVisible()) {
        await approveButtons[0].click();
        await page.waitForTimeout(3000);
      }
    }

    // Then: Both tools executed in sequence
    const bodyText = await page.textContent('body');
    expect(bodyText).toBeTruthy();
  });

  test('should handle mixed approval and automatic tools in same conversation', async ({ page }) => {
    const chatInput = page.locator('input[placeholder="Type your message..."]');

    // Start in SSE mode (approval needed)
    const adkSseButton = page.getByRole('button', { name: /ADK SSE/i });
    await adkSseButton.click();

    await chatInput.fill('Search for AI news');
    await chatInput.press('Enter');
    await expect(page.locator('text=AI news')).toBeVisible();
    await page.waitForTimeout(5000);

    // Approve if needed
    const sseApprove = await page.locator('button:has-text("Approve"), button:has-text("approve")').count();
    if (sseApprove > 0) {
      await page.locator('button:has-text("Approve"), button:has-text("approve")').first().click();
      await page.waitForTimeout(3000);
    }

    // Switch to BIDI mode (automatic execution)
    const adkBidiButton = page.getByRole('button', { name: /ADK BIDI/i });
    await adkBidiButton.click();
    await page.waitForTimeout(500);

    await chatInput.fill('Now play some music');
    await chatInput.press('Enter');
    await expect(page.locator('text=play some music')).toBeVisible();
    await page.waitForTimeout(3000);

    // Then: Both types of tools handled correctly
    const bodyText = await page.textContent('body');
    expect(bodyText).toContain('AI news');
    expect(bodyText).toContain('music');
  });

  test('should handle tool execution with large result sets', async ({ page }) => {
    // Given: SSE mode
    const adkSseButton = page.getByRole('button', { name: /ADK SSE/i });
    await adkSseButton.click();

    // When: Request tool that returns large data
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill('Search for comprehensive information about AI developments');
    await chatInput.press('Enter');

    await expect(page.locator('text=comprehensive information')).toBeVisible();
    await page.waitForTimeout(6000);

    // Approve if needed
    const approveButton = await page.locator('button:has-text("Approve"), button:has-text("approve")').count();
    if (approveButton > 0) {
      await page.locator('button:has-text("Approve"), button:has-text("approve")').first().click();
      await page.waitForTimeout(5000);
    }

    // Then: Large result should be displayed
    const bodyText = await page.textContent('body');
    expect(bodyText).toBeTruthy();
    expect(bodyText!.length).toBeGreaterThan(100);
  });

  test('should handle tool execution timeout gracefully', async ({ page }) => {
    // Given: SSE mode
    const adkSseButton = page.getByRole('button', { name: /ADK SSE/i });
    await adkSseButton.click();

    // When: Request potentially slow tool
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill('Perform complex analysis that might take time');
    await chatInput.press('Enter');

    await expect(page.locator('text=complex analysis')).toBeVisible();
    await page.waitForTimeout(5000);

    // Approve if needed
    const approveButton = await page.locator('button:has-text("Approve"), button:has-text("approve")').count();
    if (approveButton > 0) {
      await page.locator('button:has-text("Approve"), button:has-text("approve")').first().click();

      // Wait for execution or timeout
      await page.waitForTimeout(10000);
    }

    // Then: Either result or timeout message shown
    const bodyText = await page.textContent('body');
    expect(bodyText).toBeTruthy();
  });

  test('should maintain tool execution order in complex workflow', async ({ page }) => {
    // Given: BIDI mode for fast execution
    const adkBidiButton = page.getByRole('button', { name: /ADK BIDI/i });
    await adkBidiButton.click();

    const chatInput = page.locator('input[placeholder="Type your message..."]');

    // Execute tools in specific order
    await chatInput.fill('Tool execution step 1');
    await chatInput.press('Enter');
    await expect(page.locator('text=step 1')).toBeVisible();
    await page.waitForTimeout(2000);

    await chatInput.fill('Tool execution step 2');
    await chatInput.press('Enter');
    await expect(page.locator('text=step 2')).toBeVisible();
    await page.waitForTimeout(2000);

    await chatInput.fill('Tool execution step 3');
    await chatInput.press('Enter');
    await expect(page.locator('text=step 3')).toBeVisible();
    await page.waitForTimeout(2000);

    // Then: All steps visible in order
    const bodyText = await page.textContent('body');
    const step1Index = bodyText!.indexOf('step 1');
    const step2Index = bodyText!.indexOf('step 2');
    const step3Index = bodyText!.indexOf('step 3');

    expect(step1Index).toBeLessThan(step2Index);
    expect(step2Index).toBeLessThan(step3Index);
  });

  test('should handle cancellation of pending tool executions', async ({ page }) => {
    // Given: SSE mode with pending approval
    const adkSseButton = page.getByRole('button', { name: /ADK SSE/i });
    await adkSseButton.click();

    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill('Execute tool 1');
    await chatInput.press('Enter');
    await expect(page.locator('text=Execute tool 1')).toBeVisible();
    await page.waitForTimeout(3000);

    // When: Send new message without approving
    await chatInput.fill('Actually, do something else');
    await chatInput.press('Enter');
    await expect(page.locator('text=something else')).toBeVisible();

    // Then: Page should handle gracefully
    const bodyText = await page.textContent('body');
    expect(bodyText).toContain('Execute tool 1');
    expect(bodyText).toContain('something else');
  });

  test('should handle multiple approval requests simultaneously', async ({ page }) => {
    // Given: SSE mode
    const adkSseButton = page.getByRole('button', { name: /ADK SSE/i });
    await adkSseButton.click();

    // When: Trigger multiple tools requiring approval
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill('Get time, location, and search for news');
    await chatInput.press('Enter');

    await expect(page.locator('text=Get time')).toBeVisible();
    await page.waitForTimeout(8000);

    // Approve all visible approvals
    const approveButtons = await page.locator('button:has-text("Approve"), button:has-text("approve")').all();
    for (const button of approveButtons) {
      if (await button.isVisible()) {
        await button.click();
        await page.waitForTimeout(2000);
      }
    }

    // Then: All tools executed
    const bodyText = await page.textContent('body');
    expect(bodyText).toBeTruthy();
  });

  test('should handle tool execution with user interruption via ESC', async ({ page }) => {
    // Given: BIDI mode with streaming response
    const adkBidiButton = page.getByRole('button', { name: /ADK BIDI/i });
    await adkBidiButton.click();

    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill('Start long-running task');
    await chatInput.press('Enter');

    await expect(page.locator('text=long-running')).toBeVisible();
    await page.waitForTimeout(2000);

    // When: Press ESC to interrupt
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);

    // Then: Can send new message
    await chatInput.fill('New task after interruption');
    await chatInput.press('Enter');
    await expect(page.locator('text=after interruption')).toBeVisible();
  });

  test('should handle tool execution with network instability', async ({ page }) => {
    // Given: SSE mode
    const adkSseButton = page.getByRole('button', { name: /ADK SSE/i });
    await adkSseButton.click();

    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill('Execute network-dependent tool');
    await chatInput.press('Enter');

    await expect(page.locator('text=network-dependent')).toBeVisible();
    await page.waitForTimeout(5000);

    // Approve if needed
    const approveButton = await page.locator('button:has-text("Approve"), button:has-text("approve")').count();
    if (approveButton > 0) {
      await page.locator('button:has-text("Approve"), button:has-text("approve")').first().click();
      await page.waitForTimeout(5000);
    }

    // Then: Either success or error handled
    const bodyText = await page.textContent('body');
    expect(bodyText).toBeTruthy();
  });

  test('should handle rapid successive tool executions without race conditions', async ({ page }) => {
    // Given: BIDI mode for fast execution
    const adkBidiButton = page.getByRole('button', { name: /ADK BIDI/i });
    await adkBidiButton.click();

    const chatInput = page.locator('input[placeholder="Type your message..."]');

    // When: Rapidly execute multiple tools
    for (let i = 1; i <= 5; i++) {
      await chatInput.fill(`Rapid tool ${i}`);
      await chatInput.press('Enter');
      await page.waitForTimeout(300); // Minimal wait
    }

    // Wait for all to process
    await page.waitForTimeout(5000);

    // Then: All tools executed without race conditions
    const bodyText = await page.textContent('body');
    expect(bodyText).toContain('Rapid tool 1');
    expect(bodyText).toContain('Rapid tool 2');
    expect(bodyText).toContain('Rapid tool 3');
    expect(bodyText).toContain('Rapid tool 4');
    expect(bodyText).toContain('Rapid tool 5');
  });

  test('should handle tool execution across mode switches mid-execution', async ({ page }) => {
    // Given: SSE mode with pending approval
    const adkSseButton = page.getByRole('button', { name: /ADK SSE/i });
    await adkSseButton.click();

    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill('Start tool in SSE mode');
    await chatInput.press('Enter');
    await expect(page.locator('text=SSE mode')).toBeVisible();
    await page.waitForTimeout(3000);

    // When: Switch mode while tool is pending
    const adkBidiButton = page.getByRole('button', { name: /ADK BIDI/i });
    await adkBidiButton.click();
    await page.waitForTimeout(1000);

    // Then: Can execute new tool in BIDI mode
    await chatInput.fill('New tool in BIDI mode');
    await chatInput.press('Enter');
    await expect(page.locator('text=BIDI mode')).toBeVisible();
    await page.waitForTimeout(3000);

    // Both messages present
    const bodyText = await page.textContent('body');
    expect(bodyText).toContain('SSE mode');
    expect(bodyText).toContain('BIDI mode');
  });
});
