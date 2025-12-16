/**
 * E2E Test Helpers
 *
 * Common utilities for Playwright E2E tests.
 * These helpers interact with real UI elements (no mocks).
 */

import path from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";

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
export async function waitForAssistantResponse(
  page: Page,
  options?: { timeout?: number }
) {
  const timeout = options?.timeout ?? 120000; // Default 2 minutes

  // Wait for "Thinking..." to appear (increased timeout for slower LLM responses)
  await expect(page.getByText("Thinking...")).toBeVisible({ timeout: 10000 });

  // Wait for "Thinking..." to disappear (response complete)
  // Increased to 2 minutes to accommodate image processing and slower LLM responses
  await expect(page.getByText("Thinking...")).not.toBeVisible({
    timeout,
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
export async function getMessageText(messageLocator: Locator): Promise<string> {
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
export async function isUserMessage(messageLocator: Locator): Promise<boolean> {
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
 * Cleanup all chat state: storage, cookies, and conversation history
 */
export async function cleanupChatState(page: Page) {
  // Clear all browser storage
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.context().clearCookies();
}

/**
 * Clear conversation history using the UI button AND backend sessions
 *
 * This clears both:
 * 1. Frontend React state (via Clear History button)
 * 2. Backend session storage (via /clear-sessions endpoint)
 *
 * Essential for E2E test isolation to prevent conversation history
 * from leaking between tests.
 */
export async function clearHistory(page: Page) {
  // Clear frontend UI state
  const clearButton = page.getByRole("button", { name: "Clear History" });
  const count = await clearButton.count();
  if (count > 0) {
    await clearButton.click();
    await page.waitForTimeout(500);
  }

  // Clear backend sessions to prevent conversation history persistence
  // Use page.request API instead of page.evaluate to avoid browser security restrictions
  try {
    await page.request.post("http://localhost:8000/clear-sessions");
  } catch (error) {
    console.warn("Failed to clear backend sessions:", error);
    // Don't fail the test if backend clear fails
  }

  // Wait for state to settle
  await page.waitForTimeout(500);
}

/**
 * Wait for tool approval dialog to appear
 */
export async function waitForToolApproval(
  page: Page,
  options: { timeout?: number } = {},
) {
  const timeout = options.timeout ?? 30000;
  await expect(page.getByText("Approval Required")).toBeVisible({
    timeout,
  });
}

/**
 * Approve the tool call in the approval dialog
 */
export async function approveToolCall(page: Page) {
  await page.getByRole("button", { name: "Approve" }).click();
  // Wait for dialog to close
  await expect(page.getByText("Approval Required")).not.toBeVisible({
    timeout: 5000,
  });
}

/**
 * Reject/Deny the tool call in the approval dialog
 */
export async function rejectToolCall(page: Page) {
  await page.getByRole("button", { name: "Deny" }).click();
  // Wait for dialog to close
  await expect(page.getByText("Approval Required")).not.toBeVisible({
    timeout: 5000,
  });
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

/**
 * Enable chunk player mode for E2E testing
 * This makes the UI use ChunkPlayerTransport to replay pre-recorded chunks
 */
export async function enableChunkPlayerMode(page: Page, fixturePath: string) {
  await page.evaluate(
    ({ path }) => {
      localStorage.setItem("E2E_CHUNK_PLAYER_MODE", "true");
      localStorage.setItem("E2E_CHUNK_PLAYER_FIXTURE", path);
    },
    { path: fixturePath },
  );
}

/**
 * Disable chunk player mode
 */
export async function disableChunkPlayerMode(page: Page) {
  await page.evaluate(() => {
    localStorage.removeItem("E2E_CHUNK_PLAYER_MODE");
    localStorage.removeItem("E2E_CHUNK_PLAYER_FIXTURE");
  });
}

/**
 * Get fixture path for chunk player tests
 */
export function getChunkPlayerFixturePath(patternName: string): string {
  return `/fixtures/e2e-chunks/${patternName}/frontend-chunks.jsonl`;
}

/**
 * Setup chunk player mode for E2E testing.
 *
 * This helper combines all the necessary steps:
 * 1. Navigate to chat page
 * 2. Enable chunk player mode with fixture
 * 3. Reload page to apply settings
 * 4. Wait for page to be ready
 *
 * Use this instead of manually calling enableChunkPlayerMode + reload.
 *
 * @param page - Playwright page object
 * @param patternName - Pattern name (e.g., "pattern1-gemini-only")
 *
 * @example
 * await setupChunkPlayerMode(page, "pattern1-gemini-only");
 * // Now page is ready with chunk player mode enabled
 */
export async function setupChunkPlayerMode(page: Page, patternName: string) {
  // Step 1: Navigate to page first (required for localStorage access)
  await navigateToChat(page);

  // Step 2: Enable chunk player mode
  const fixturePath = getChunkPlayerFixturePath(patternName);
  await enableChunkPlayerMode(page, fixturePath);

  // Step 3: Reload to apply chunk player mode settings
  await page.reload();
  await page.waitForLoadState("networkidle");

  // Note: At this point, buildUseChatOptions will detect E2E mode
  // and create ChunkPlayerTransport instead of real transport
}
