/**
 * E2E Test Helpers
 *
 * Common utilities for Playwright E2E tests.
 * These helpers interact with real UI elements (no mocks).
 */

import path from "node:path";
import { expect, type Page } from "@playwright/test";

export type BackendMode = "gemini" | "adk-sse" | "adk-bidi";

/**
 * Navigate to the chat application
 */
export async function navigateToChat(page: Page) {
  await page.goto("/");
  // Wait for page to load by checking for Backend Mode switcher
  await expect(page.getByText("Backend Mode")).toBeVisible();
}

/**
 * Select backend mode
 */
export async function selectBackendMode(page: Page, mode: BackendMode) {
  const buttonMap = {
    gemini: "Gemini Direct",
    "adk-sse": "ADK SSE",
    "adk-bidi": "ADK BIDI ⚡",
  };

  await page.getByRole("button", { name: buttonMap[mode] }).click();

  // Wait for mode to be visually selected
  await expect(page.getByRole("button", { name: buttonMap[mode] })).toHaveCSS(
    "font-weight",
    "600",
  );
}

/**
 * Send a text message
 */
export async function sendTextMessage(page: Page, text: string) {
  const input = page.getByPlaceholder("Type your message...");
  await input.fill(text);
  await page.getByRole("button", { name: "Send" }).click();
}

/**
 * Upload and send an image with optional text
 */
export async function sendImageMessage(
  page: Page,
  imagePath: string,
  text?: string,
) {
  // Upload image
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles(imagePath);

  // Wait for image preview to appear
  await expect(page.locator('img[alt="Preview"]')).toBeVisible();

  // Optionally add text
  if (text) {
    const textInput = page.getByPlaceholder("Type your message...");
    await textInput.fill(text);
  }

  // Send message
  await page.getByRole("button", { name: "Send" }).click();
}

/**
 * Wait for assistant response to complete
 */
export async function waitForAssistantResponse(page: Page) {
  // Wait for "Thinking..." to appear (increased timeout for slower LLM responses)
  await expect(page.getByText("Thinking...")).toBeVisible({ timeout: 10000 });

  // Wait for "Thinking..." to disappear (response complete)
  // Increased to 2 minutes to accommodate image processing and slower LLM responses
  await expect(page.getByText("Thinking...")).not.toBeVisible({
    timeout: 120000,
  });
}

/**
 * Get all messages in the chat
 */
export async function getMessages(page: Page) {
  // Use data-testid for reliable selection
  return page.locator('[data-testid^="message-"]').all();
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
  return (
    (await messageLocator
      .locator('[data-testid="message-text"]')
      .first()
      .textContent()) || ""
  );
}

/**
 * Check if message is from user or assistant
 */
export async function isUserMessage(messageLocator: any): Promise<boolean> {
  const sender = await messageLocator
    .locator('[data-testid="message-sender"]')
    .textContent();
  return sender?.includes("You") || false;
}

/**
 * Clear chat history by reloading page
 */
export async function clearChatHistory(page: Page) {
  await page.reload();
  await expect(page.getByText("Backend Mode")).toBeVisible();
}

/**
 * Get test image path
 */
export function getTestImagePath(filename: string = "test-image.png"): string {
  return path.join(__dirname, "fixtures", filename);
}

/**
 * Create a test image fixture (green "OK" logo)
 */
export async function createTestImageFixture() {
  // This would typically be done in test setup
  // For now, we'll assume the image exists in tests/e2e/fixtures/
  const fixturesDir = path.join(__dirname, "fixtures");
  const fs = await import("node:fs");
  if (!fs.existsSync(fixturesDir)) {
    fs.mkdirSync(fixturesDir, { recursive: true });
  }
  // Image should be created manually or copied from test assets
}
