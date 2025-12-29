import type { Locator, Page } from "@playwright/test";

/**
 * Wait strategies for reliable E2E testing
 *
 * Provides better alternatives to arbitrary timeouts.
 * Always wait for specific conditions, not fixed time periods.
 */

/**
 * Wait for tool approval UI to appear
 * @param page - Playwright page object
 * @param index - Tool index (default: 0)
 */
export async function waitForToolApprovalUI(
  page: Page,
  index: number = 0,
): Promise<Locator> {
  const approvalUI = page.getByTestId(`tool-approval-ui-${index}`);
  await approvalUI.waitFor({ state: "visible" });
  return approvalUI;
}

/**
 * Wait for tool result to appear
 * @param page - Playwright page object
 * @param index - Tool result index
 */
export async function waitForToolResult(
  page: Page,
  index: number,
): Promise<Locator> {
  const toolResult = page.getByTestId(`tool-result-${index}`);
  await toolResult.waitFor({ state: "visible" });
  return toolResult;
}

/**
 * Wait for message with specific index
 * @param page - Playwright page object
 * @param role - Message role ('user' or 'assistant')
 * @param index - Message index
 */
export async function waitForMessage(
  page: Page,
  role: "user" | "assistant",
  index: number,
): Promise<Locator> {
  const message = page.getByTestId(`message-${role}-${index}`);
  await message.waitFor({ state: "visible" });
  return message;
}

/**
 * Wait for streaming to complete
 * @param page - Playwright page object
 */
export async function waitForStreamingComplete(page: Page): Promise<void> {
  const streamingIndicator = page.getByTestId("streaming-indicator");

  // Wait for indicator to appear (streaming started)
  await streamingIndicator.waitFor({ state: "visible", timeout: 5000 });

  // Wait for indicator to disappear (streaming complete)
  await streamingIndicator.waitFor({ state: "hidden", timeout: 30000 });
}

/**
 * Wait for auto-send to trigger
 * @param page - Playwright page object
 */
export async function waitForAutoSend(page: Page): Promise<void> {
  const autoSendIndicator = page.getByTestId("auto-send-indicator");
  await autoSendIndicator.waitFor({ state: "visible", timeout: 5000 });
}

/**
 * Wait for connection status
 * @param page - Playwright page object
 * @param status - Expected status ('Connected' or 'Disconnected')
 */
export async function waitForConnectionStatus(
  page: Page,
  status: "Connected" | "Disconnected",
): Promise<void> {
  const statusElement = page.getByTestId("connection-status");
  await statusElement.waitFor({ state: "visible" });
  await page.waitForFunction(
    (expectedStatus) => {
      const element = document.querySelector(
        '[data-testid="connection-status"]',
      );
      return element?.textContent?.includes(expectedStatus);
    },
    status,
    { timeout: 10000 },
  );
}

/**
 * Wait for audio player state
 * @param page - Playwright page object
 * @param state - Expected state ('playing' or 'paused')
 */
export async function waitForAudioPlayerState(
  page: Page,
  state: "playing" | "paused",
): Promise<void> {
  const _audioPlayer = page.getByTestId("audio-player");
  await page.waitForFunction(
    (expectedState) => {
      const player = document.querySelector('[data-testid="audio-player"]');
      return player?.classList.contains(expectedState);
    },
    state,
    { timeout: 5000 },
  );
}

/**
 * Wait for network idle (useful after mode switching)
 * @param page - Playwright page object
 * @param timeout - Timeout in milliseconds (default: 5000)
 */
export async function waitForNetworkIdle(
  page: Page,
  timeout: number = 5000,
): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout });
}
