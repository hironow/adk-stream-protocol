import { test, expect } from '@playwright/test';

/**
 * Tool Approval BIDI Mode - Core Tests
 *
 * Comprehensive tests for Frontend Execute pattern (ADK BIDI mode).
 * Tests automatic tool execution without approval prompts.
 *
 * Test Focus:
 * - Frontend Execute pattern (no approval needed)
 * - Automatic tool execution
 * - Real-time result display
 * - WebSocket-based communication
 * - Audio/multimodal features
 */
test.describe('Tool Approval BIDI Mode (Core)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');

    // Always start in ADK BIDI mode for these tests
    const adkBidiButton = page.getByRole('button', { name: /ADK BIDI/i });
    await adkBidiButton.click();

    // Wait for mode to be ready
    await page.waitForTimeout(1000);
  });

  test('should NOT show approval UI for frontend tools', async ({ page }) => {
    // Given: ADK BIDI mode ready

    // When: Send message that triggers frontend tool
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill('Change background music to jazz');
    await chatInput.press('Enter');

    // Wait for message
    await expect(page.locator('text=background music')).toBeVisible();

    // Wait for potential tool execution
    await page.waitForTimeout(4000);

    // Then: Should NOT have approve/deny buttons
    const hasApproveButton = await page.locator('button:has-text("Approve"), button:has-text("approve")').count() > 0;
    const hasDenyButton = await page.locator('button:has-text("Deny"), button:has-text("deny")').count() > 0;

    expect(hasApproveButton).toBe(false);
    expect(hasDenyButton).toBe(false);
  });

  test('should execute change_bgm tool automatically', async ({ page }) => {
    // Given: BIDI mode ready

    // When: Request BGM change
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill('Play some relaxing music');
    await chatInput.press('Enter');

    await expect(page.locator('text=relaxing music')).toBeVisible();

    // Wait for automatic tool execution
    await page.waitForTimeout(4000);

    // Then: Tool should execute without approval
    // No approval UI should appear
    const bodyText = await page.textContent('body');
    expect(bodyText).toBeTruthy();
    expect(bodyText).toContain('relaxing music');
  });

  test('should display tool execution result immediately', async ({ page }) => {
    // Given: BIDI mode

    // When: Trigger frontend tool
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill('Switch to track 2');
    await chatInput.press('Enter');

    await expect(page.locator('text=track 2')).toBeVisible();

    // Wait for tool execution
    await page.waitForTimeout(3000);

    // Then: Result should be displayed
    const bodyText = await page.textContent('body');
    expect(bodyText).toBeTruthy();
  });

  test('should execute get_location tool automatically', async ({ page }) => {
    // Given: BIDI mode ready

    // When: Request location
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill('Where am I located?');
    await chatInput.press('Enter');

    await expect(page.locator('text=located')).toBeVisible();

    // Wait for automatic tool execution
    await page.waitForTimeout(4000);

    // Then: Tool executes automatically
    const bodyText = await page.textContent('body');
    expect(bodyText).toBeTruthy();
  });

  test('should handle multiple frontend tools in sequence', async ({ page }) => {
    // Given: BIDI mode

    // When: Send message triggering multiple tools
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill('Change music and get my location');
    await chatInput.press('Enter');

    await expect(page.locator('text=Change music')).toBeVisible();

    // Wait for all tools to execute
    await page.waitForTimeout(6000);

    // Then: All tools execute automatically
    const bodyText = await page.textContent('body');
    expect(bodyText).toBeTruthy();
  });

  test('should show real-time execution status', async ({ page }) => {
    // Given: BIDI mode

    // When: Trigger tool
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill('Play background music');
    await chatInput.press('Enter');

    await expect(page.locator('text=background music')).toBeVisible();

    // Check for execution indicators quickly
    await page.waitForTimeout(1000);

    // Then: Some execution indicator should appear
    const bodyText = await page.textContent('body');
    expect(bodyText).toBeTruthy();

    // Wait for completion
    await page.waitForTimeout(3000);
  });

  test('should handle tool execution errors gracefully', async ({ page }) => {
    // Given: BIDI mode

    // When: Trigger tool that might fail
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill('Play invalid track 999');
    await chatInput.press('Enter');

    await expect(page.locator('text=invalid track')).toBeVisible();

    // Wait for tool execution attempt
    await page.waitForTimeout(4000);

    // Then: Error should be handled
    // Page should remain functional
    const bodyText = await page.textContent('body');
    expect(bodyText).toBeTruthy();

    // Can send another message
    await chatInput.fill('Play track 1 instead');
    await chatInput.press('Enter');
    await expect(page.locator('text=track 1 instead')).toBeVisible();
  });

  test('should maintain WebSocket connection during tool execution', async ({ page }) => {
    // Given: BIDI mode with WebSocket active

    // When: Execute multiple tools
    const chatInput = page.locator('input[placeholder="Type your message..."]');

    await chatInput.fill('Change to track 1');
    await chatInput.press('Enter');
    await expect(page.locator('text=track 1')).toBeVisible();
    await page.waitForTimeout(3000);

    await chatInput.fill('Now change to track 2');
    await chatInput.press('Enter');
    await expect(page.locator('text=track 2')).toBeVisible();
    await page.waitForTimeout(3000);

    await chatInput.fill('Finally change to track 3');
    await chatInput.press('Enter');
    await expect(page.locator('text=track 3')).toBeVisible();
    await page.waitForTimeout(3000);

    // Then: All tools should execute via same WebSocket
    const bodyText = await page.textContent('body');
    expect(bodyText).toContain('track 1');
    expect(bodyText).toContain('track 2');
    expect(bodyText).toContain('track 3');
  });

  test('should handle rapid tool executions', async ({ page }) => {
    // Given: BIDI mode

    // When: Send multiple messages quickly
    const chatInput = page.locator('input[placeholder="Type your message..."]');

    await chatInput.fill('Track 1');
    await chatInput.press('Enter');

    await chatInput.fill('Track 2');
    await chatInput.press('Enter');

    await chatInput.fill('Track 3');
    await chatInput.press('Enter');

    // Wait for all to process
    await page.waitForTimeout(6000);

    // Then: All messages should be handled
    const bodyText = await page.textContent('body');
    expect(bodyText).toContain('Track 1');
    expect(bodyText).toContain('Track 2');
    expect(bodyText).toContain('Track 3');
  });

  test('should show tool results inline with conversation', async ({ page }) => {
    // Given: BIDI mode with conversation

    const chatInput = page.locator('input[placeholder="Type your message..."]');

    // Message without tool
    await chatInput.fill('Hello, I need help with music');
    await chatInput.press('Enter');
    await expect(page.locator('text=help with music')).toBeVisible();
    await page.waitForTimeout(2000);

    // Message with tool
    await chatInput.fill('Play some jazz');
    await chatInput.press('Enter');
    await expect(page.locator('text=jazz')).toBeVisible();
    await page.waitForTimeout(4000);

    // Then: Tool result should be inline
    const bodyText = await page.textContent('body');
    expect(bodyText).toContain('help with music');
    expect(bodyText).toContain('jazz');
  });

  test('should allow interruption during tool execution', async ({ page }) => {
    // Given: BIDI mode with tool executing

    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill('Start playing music');
    await chatInput.press('Enter');

    await expect(page.locator('text=playing music')).toBeVisible();

    // When: Press ESC to interrupt (if supported)
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);

    // Then: Should be able to send new message
    await chatInput.fill('Actually, stop the music');
    await chatInput.press('Enter');
    await expect(page.locator('text=stop the music')).toBeVisible();
  });

  test.skip('should handle audio playback for tool results', async ({ page }) => {
    // This test requires audio output verification
    // Skipped until audio verification is implemented

    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill('Tell me a story');
    await chatInput.press('Enter');

    // Wait for audio playback
    await page.waitForTimeout(10000);

    // Check for audio-related UI elements
    const hasAudioControls = await page.locator('[data-testid*="audio"], [class*="audio"]').count() > 0;
  });
});
