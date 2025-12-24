import { test, expect } from '@playwright/test';
import { ChatPage } from '../../helpers/page-objects';

/**
 * Setup Verification Test
 *
 * This test verifies that the E2E test infrastructure is correctly set up.
 * It should be the first test to run to ensure:
 * - Playwright configuration is correct
 * - Test helpers (page objects) work
 * - Basic navigation works
 */
test.describe('Setup Verification', () => {
  test('should load the chat page successfully', async ({ page }) => {
    // Given: Navigate to the chat page
    await page.goto('/');

    // Then: Page should load without errors
    await expect(page).toHaveTitle(/AI SDK v6/i);

    // Then: Chat input should be visible
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await expect(chatInput).toBeVisible({ timeout: 10000 });
  });

  test('should use ChatPage page object successfully', async ({ page }) => {
    // Given: Create ChatPage instance
    const chatPage = new ChatPage(page);

    // When: Navigate using page object
    await chatPage.goto();

    // Then: Page should load
    await expect(page).toHaveURL('/');
  });

  test.skip('should have test-id attributes on key elements', async ({ page }) => {
    // Given: Navigate to chat page
    await page.goto('/');

    // Then: Key elements should have data-testid attributes
    // Note: This test is skipped until we add data-testid attributes to components
    await expect(page.getByTestId('mode-selector')).toBeVisible();
    await expect(page.getByTestId('chat-input')).toBeVisible();
    await expect(page.getByTestId('send-button')).toBeVisible();
  });
});
