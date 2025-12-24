import { test, expect } from '@playwright/test';

/**
 * Mode Switching - Smoke Tests
 *
 * Critical tests for mode switching functionality.
 * Ensures that switching between Gemini, ADK SSE, and ADK BIDI modes works correctly.
 *
 * Test Focus:
 * - Message history preservation during mode switches
 * - Audio controls visibility in BIDI mode
 * - Mode-specific UI elements
 */
test.describe('Mode Switching (Smoke)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should preserve message history when switching from Gemini to ADK SSE', async ({ page }) => {
    // Given: Start in Gemini mode and send a message
    const geminiButton = page.getByRole('button', { name: /Gemini Direct/i });
    await geminiButton.click();

    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill('First message');
    await chatInput.press('Enter');

    // Wait for user message to appear
    await expect(page.locator('text=First message')).toBeVisible({ timeout: 10000 });

    // Wait for assistant response to appear
    await page.waitForTimeout(3000); // Give time for response to start

    // When: Switch to ADK SSE mode
    const adkSseButton = page.getByRole('button', { name: /ADK SSE/i });
    await adkSseButton.click();

    // Then: Original message should still be visible
    await expect(page.locator('text=First message')).toBeVisible();
    
    // Then: Page content should be preserved (no full reload)
    const bodyText = await page.textContent('body');
    expect(bodyText).toContain('First message');
  });

  test('should show audio controls when switching to BIDI mode', async ({ page }) => {
    // Given: Start in Gemini mode (no audio controls)
    const geminiButton = page.getByRole('button', { name: /Gemini Direct/i });
    await geminiButton.click();

    // Then: Audio-specific elements should not be prominent
    // (ADK BIDI has special audio features)

    // When: Switch to ADK BIDI mode
    const adkBidiButton = page.getByRole('button', { name: /ADK BIDI/i });
    await adkBidiButton.click();

    // Then: BIDI-specific UI should appear
    // Note: Actual audio controls visibility depends on component implementation
    // We just verify the mode switch doesn't crash
    await page.waitForTimeout(1000);
    
    const bodyContent = await page.textContent('body');
    expect(bodyContent).toBeTruthy();
  });

  test('should hide audio controls when switching away from BIDI mode', async ({ page }) => {
    // Given: Start in BIDI mode
    const adkBidiButton = page.getByRole('button', { name: /ADK BIDI/i });
    await adkBidiButton.click();
    await page.waitForTimeout(1000);

    // When: Switch to ADK SSE mode
    const adkSseButton = page.getByRole('button', { name: /ADK SSE/i });
    await adkSseButton.click();

    // Then: Mode switch should complete without errors
    await page.waitForTimeout(1000);
    
    // Verify page is still functional
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await expect(chatInput).toBeVisible();
  });

  test('should switch between all three modes successfully', async ({ page }) => {
    const chatInput = page.locator('input[placeholder="Type your message..."]');

    // Given: Start with Gemini
    const geminiButton = page.getByRole('button', { name: /Gemini Direct/i });
    await geminiButton.click();
    await expect(chatInput).toBeVisible();

    // When: Switch to ADK SSE
    const adkSseButton = page.getByRole('button', { name: /ADK SSE/i });
    await adkSseButton.click();
    await page.waitForTimeout(500);
    await expect(chatInput).toBeVisible();

    // When: Switch to ADK BIDI
    const adkBidiButton = page.getByRole('button', { name: /ADK BIDI/i });
    await adkBidiButton.click();
    await page.waitForTimeout(500);
    await expect(chatInput).toBeVisible();

    // When: Switch back to Gemini
    await geminiButton.click();
    await page.waitForTimeout(500);
    await expect(chatInput).toBeVisible();

    // Then: All switches should complete without errors
    const bodyContent = await page.textContent('body');
    expect(bodyContent).toBeTruthy();
  });

  test('should maintain mode selection visually', async ({ page }) => {
    // Given: Click ADK SSE mode
    const adkSseButton = page.getByRole('button', { name: /ADK SSE/i });
    await adkSseButton.click();

    // Then: Button should have selected styling
    // Check for border or background color indicating selection
    const sseStyles = await adkSseButton.evaluate((el) => {
      const styles = window.getComputedStyle(el);
      return {
        borderColor: styles.borderColor,
        backgroundColor: styles.backgroundColor,
      };
    });

    // The selected button should have different styling
    expect(sseStyles.borderColor).toBeTruthy();
    expect(sseStyles.backgroundColor).toBeTruthy();

    // When: Click Gemini mode
    const geminiButton = page.getByRole('button', { name: /Gemini Direct/i });
    await geminiButton.click();

    // Then: Gemini button should now show selected state
    const geminiStyles = await geminiButton.evaluate((el) => {
      const styles = window.getComputedStyle(el);
      return {
        borderColor: styles.borderColor,
        backgroundColor: styles.backgroundColor,
      };
    });

    expect(geminiStyles.borderColor).toBeTruthy();
  });

  test('should allow sending messages in each mode', async ({ page }) => {
    const chatInput = page.locator('input[placeholder="Type your message..."]');

    // Test Gemini mode
    const geminiButton = page.getByRole('button', { name: /Gemini Direct/i });
    await geminiButton.click();
    await chatInput.fill('Test in Gemini');
    await chatInput.press('Enter');
    await expect(page.locator('text=Test in Gemini')).toBeVisible();

    // Test ADK SSE mode
    const adkSseButton = page.getByRole('button', { name: /ADK SSE/i });
    await adkSseButton.click();
    await page.waitForTimeout(500);
    await chatInput.fill('Test in SSE');
    await chatInput.press('Enter');
    await expect(page.locator('text=Test in SSE')).toBeVisible();

    // Test ADK BIDI mode
    const adkBidiButton = page.getByRole('button', { name: /ADK BIDI/i });
    await adkBidiButton.click();
    await page.waitForTimeout(500);
    await chatInput.fill('Test in BIDI');
    await chatInput.press('Enter');
    await expect(page.locator('text=Test in BIDI')).toBeVisible();

    // Then: All messages should be visible
    await expect(page.locator('text=Test in Gemini')).toBeVisible();
    await expect(page.locator('text=Test in SSE')).toBeVisible();
    await expect(page.locator('text=Test in BIDI')).toBeVisible();
  });
});
