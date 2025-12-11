/**
 * E2E Test Helpers
 *
 * Common utilities for Playwright E2E tests.
 * These helpers interact with real UI elements (no mocks).
 */

import { Page, expect } from '@playwright/test';
import path from 'path';

export type BackendMode = 'gemini' | 'adk-sse' | 'adk-bidi';

/**
 * Navigate to the chat application
 */
export async function navigateToChat(page: Page) {
  await page.goto('/');
  await expect(page.locator('h1')).toContainText('AI SDK v6 + ADK Integration');
}

/**
 * Select backend mode
 */
export async function selectBackendMode(page: Page, mode: BackendMode) {
  const buttonMap = {
    gemini: 'Gemini Direct',
    'adk-sse': 'ADK SSE',
    'adk-bidi': 'ADK BIDI ⚡',
  };

  await page.getByRole('button', { name: buttonMap[mode] }).click();

  // Wait for mode to be visually selected
  await expect(
    page.getByRole('button', { name: buttonMap[mode] })
  ).toHaveCSS('font-weight', '600');
}

/**
 * Send a text message
 */
export async function sendTextMessage(page: Page, text: string) {
  const input = page.getByPlaceholder('Type your message...');
  await input.fill(text);
  await page.getByRole('button', { name: 'Send' }).click();
}

/**
 * Upload and send an image with optional text
 */
export async function sendImageMessage(
  page: Page,
  imagePath: string,
  text?: string
) {
  // Upload image
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles(imagePath);

  // Wait for image preview to appear
  await expect(page.locator('img[alt="Preview"]')).toBeVisible();

  // Optionally add text
  if (text) {
    const textInput = page.getByPlaceholder('Type your message...');
    await textInput.fill(text);
  }

  // Send message
  await page.getByRole('button', { name: 'Send' }).click();
}

/**
 * Wait for assistant response to complete
 */
export async function waitForAssistantResponse(page: Page) {
  // Wait for "Thinking..." to appear
  await expect(page.getByText('Thinking...')).toBeVisible({ timeout: 5000 });

  // Wait for "Thinking..." to disappear (response complete)
  await expect(page.getByText('Thinking...')).not.toBeVisible({ timeout: 60000 });
}

/**
 * Get all messages in the chat
 */
export async function getMessages(page: Page) {
  // Messages are divs with specific styling that contain user/assistant headers
  return page.locator('div[style*="marginBottom"][style*="borderRadius: 8px"]').all();
}

/**
 * Get the last message in the chat
 */
export async function getLastMessage(page: Page) {
  const messages = await getMessages(page);
  return messages[messages.length - 1];
}

/**
 * Get message text content
 */
export async function getMessageText(messageLocator: any): Promise<string> {
  return await messageLocator.locator('[style*="whiteSpace"]').first().textContent() || '';
}

/**
 * Check if message is from user or assistant
 */
export async function isUserMessage(messageLocator: any): Promise<boolean> {
  const header = await messageLocator.locator('[style*="fontWeight: bold"]').textContent();
  return header?.includes('You') || false;
}

/**
 * Clear chat history by reloading page
 */
export async function clearChatHistory(page: Page) {
  await page.reload();
  await expect(page.locator('h1')).toContainText('AI SDK v6 + ADK Integration');
}

/**
 * Get test image path
 */
export function getTestImagePath(filename: string = 'test-image.png'): string {
  return path.join(__dirname, 'fixtures', filename);
}

/**
 * Create a test image fixture (green "OK" logo)
 */
export async function createTestImageFixture() {
  // This would typically be done in test setup
  // For now, we'll assume the image exists in tests/e2e/fixtures/
  const fixturesDir = path.join(__dirname, 'fixtures');
  const fs = await import('fs');
  if (!fs.existsSync(fixturesDir)) {
    fs.mkdirSync(fixturesDir, { recursive: true });
  }
  // Image should be created manually or copied from test assets
}
