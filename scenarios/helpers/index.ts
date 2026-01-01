/**
 * E2E Test Helpers
 *
 * Common utilities for Playwright E2E tests.
 * These helpers interact with real UI elements (no mocks).
 */

import fs from "node:fs";
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
 * Dismiss the "Enable Audio" modal if it appears
 * This modal can block UI interactions in E2E tests
 */
export async function dismissAudioModalIfPresent(page: Page) {
  try {
    const enableAudioButton = page.getByRole("button", {
      name: /Enable Audio/i,
    });
    const isVisible = await enableAudioButton
      .isVisible({ timeout: 1000 })
      .catch(() => false);

    if (isVisible) {
      await enableAudioButton.click();
      await page.waitForTimeout(500);
    }
  } catch {
    // Modal not present, continue
  }
}

/**
 * Select backend mode
 */
export async function selectBackendMode(page: Page, mode: BackendMode) {
  // Dismiss audio modal if it's blocking interactions
  await dismissAudioModalIfPresent(page);

  const buttonMap = {
    gemini: "Gemini Direct",
    "adk-sse": "ADK SSE",
    "adk-bidi": "ADK BIDI ⚡",
  };

  // Use more specific text matching since buttons have multi-line text
  const button = page.getByRole("button").filter({ hasText: buttonMap[mode] });
  await button.click();

  // Wait for mode to be visually selected (selected button has font-weight: 600)
  await expect(button).toHaveCSS("font-weight", "600");
}

/**
 * Send a text message
 */
export async function sendTextMessage(page: Page, text: string) {
  const input = page.getByPlaceholder("Type your message...");
  await input.fill(text);
  await page.getByRole("button", { name: "Send" }).click();

  // Wait for the user message to appear on screen
  // This ensures the Chat component is properly mounted and functional
  // Use message-sender selector since data-testid="message-text" doesn't reliably exist in DOM
  await page
    .locator('main [data-testid="message-sender"]')
    .filter({ hasText: "You" })
    .first()
    .waitFor({ state: "visible", timeout: 5000 });
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
 * Uses data-testid for i18n compatibility
 */
export async function waitForAssistantResponse(
  page: Page,
  options?: { timeout?: number },
) {
  const timeout = options?.timeout ?? 120000; // Default 2 minutes

  // Count assistant messages before sending (look for elements with "Assistant" text)
  const assistantMessages = page
    .locator('main [data-testid="message-sender"]')
    .filter({ hasText: "Assistant" });
  const messagesBefore = await assistantMessages.count();

  // Try to wait for thinking indicator to appear, but don't fail if it's too fast
  const thinkingIndicator = page.getByTestId("thinking-indicator");

  try {
    // Short timeout since response might be instant
    await expect(thinkingIndicator).toBeVisible({ timeout: 2000 });

    // If it appeared, wait for it to disappear (response complete)
    await expect(thinkingIndicator).not.toBeVisible({
      timeout,
    });
  } catch {
    // the indicator didn't appear (response was instant)
    // Wait for a new assistant message to appear instead
    await expect(assistantMessages).toHaveCount(messagesBefore + 1, {
      timeout,
    });
  }
}

/**
 * Get all messages in the chat
 */
export async function getMessages(page: Page) {
  // Find messages by looking for message containers
  // Note: message-sender is nested inside message-header, which is inside the message container
  // So we need to go up TWO levels: sender -> header -> container
  return page
    .locator('main [data-testid="message-sender"]')
    .locator("../..")
    .all();
}

/**
 * Get the last message in the chat
 * Uses .last() for more reliable selection instead of array indexing
 */
export async function getLastMessage(page: Page) {
  // Find the last message by looking for the last message sender element's grandparent (container)
  // DOM structure: message-sender -> message-header -> message container
  return page
    .locator('main [data-testid="message-sender"]')
    .locator("../..")
    .last();
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
 *
 * Note: Only clears storage if page is still on app URL to avoid SecurityError
 */
export async function cleanupChatState(page: Page) {
  // Clear all browser storage only if page is on valid app URL
  const currentUrl = page.url();
  if (
    currentUrl.startsWith("http://localhost:3000") ||
    currentUrl.startsWith("http://localhost")
  ) {
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
  }
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

    // Wait for the empty state message to appear
    // This is more reliable than waiting for message elements to disappear
    try {
      await expect(page.getByText("Start a conversation...")).toBeVisible({
        timeout: 10000,
      });
    } catch (_error) {
      console.warn(
        'Empty state message "Start a conversation..." not found after clearing history. This may be expected if the UI changed.',
      );
      // Wait a bit for any UI updates to settle
      await page.waitForTimeout(1000);
    }
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
 * Clear backend chunk log files for a specific session
 * This ensures tests start with clean backend logs
 */
export function clearBackendChunkLogs(sessionId: string) {
  // Clear backend logs in chunk_logs/{sessionId}/
  const backendLogDir = path.join(process.cwd(), "chunk_logs", sessionId);

  if (fs.existsSync(backendLogDir)) {
    // Delete all .jsonl files in the session directory
    const files = fs.readdirSync(backendLogDir);
    for (const file of files) {
      if (file.endsWith(".jsonl")) {
        const filePath = path.join(backendLogDir, file);
        fs.unlinkSync(filePath);
      }
    }
  }

  // Clear frontend logs in chunk_logs/frontend/ that match this session ID
  const frontendLogDir = path.join(process.cwd(), "chunk_logs", "frontend");

  if (fs.existsSync(frontendLogDir)) {
    const files = fs.readdirSync(frontendLogDir);
    for (const file of files) {
      // Match pattern: *-{sessionId}.jsonl (e.g., approve-small-payment-e2e-3.jsonl)
      if (file.endsWith(`-${sessionId}.jsonl`)) {
        const filePath = path.join(frontendLogDir, file);
        fs.unlinkSync(filePath);
      }
    }
  }
}

/**
 * Clean up frontend and backend state for chunk logger tests
 * This resets sessions and frontend state without deleting log files
 * (log files are cleaned in beforeEach to preserve them for consistency checks)
 */
export async function cleanupChunkLoggerState(page: Page) {
  // 1. Clear frontend history and backend sessions
  await clearHistory(page);

  // 2. Reload page to ensure clean state
  // Note: Chunk logger config comes from environment variables, not localStorage
  await page.reload();
  await page.waitForLoadState("networkidle");

  // 3. Give backend time to fully reset
  await page.waitForTimeout(1000);
}

/**
 * Wait for tool approval dialog to appear
 * Uses data-testid for i18n compatibility
 * Note: When multiple tool calls are on page, filters for "Approval Required" state
 */
export async function waitForToolApproval(
  page: Page,
  options: { timeout?: number } = {},
) {
  const timeout = options.timeout ?? 30000;
  // Wait for tool state to show "Approval Required"
  // Use filter to handle cases with multiple tool-state elements (e.g., after mode switching)
  const toolState = page
    .getByTestId("tool-state")
    .filter({ hasText: "Approval Required" });
  await expect(toolState.first()).toBeVisible({ timeout });
}

/**
 * Approve the tool call in the approval dialog
 * Uses data-testid for i18n compatibility
 * Note: Uses .first() to handle multiple tool-state elements
 */
export async function approveToolCall(page: Page) {
  await page.getByTestId("tool-approve-button").first().click();
  // Wait for approval state to change - use first visible tool-state
  const toolState = page.getByTestId("tool-state").first();
  await expect(toolState).not.toHaveText("Approval Required", {
    timeout: 5000,
  });
}

/**
 * Reject/Deny the tool call in the approval dialog
 * Uses data-testid for i18n compatibility
 * Note: Uses .first() to handle multiple tool-state elements
 */
export async function rejectToolCall(page: Page) {
  await page.getByTestId("tool-deny-button").first().click();
  // Wait for tool state to change - use first visible tool-state
  const toolState = page.getByTestId("tool-state").first();
  await expect(toolState).not.toHaveText("Approval Required", {
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
 * @deprecated This function no longer works. The ChunkLogger reads session ID
 * from NEXT_PUBLIC_CHUNK_LOGGER_SESSION_ID environment variable at module load time,
 * not from localStorage. Set the environment variable in .env.local instead.
 *
 * This function is kept for backwards compatibility but does nothing.
 */
export async function enableChunkLogger(
  _page: Page,
  _sessionId: string = "e2e-test",
) {
  // No-op: ChunkLogger reads from process.env.NEXT_PUBLIC_CHUNK_LOGGER_SESSION_ID
  // at module load time, not from localStorage.
}

/**
 * Enable chunk player mode for E2E testing
 * This makes the UI use ChunkPlayerTransport to replay pre-recorded chunks
 *
 * Prerequisites: Page must be navigated to app URL before calling this function
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
 *
 * Note: Only attempts to clear localStorage if page is still on app URL
 * to avoid SecurityError when page context is invalid
 */
export async function disableChunkPlayerMode(page: Page) {
  const currentUrl = page.url();
  if (
    currentUrl.startsWith("http://localhost:3000") ||
    currentUrl.startsWith("http://localhost")
  ) {
    await page.evaluate(() => {
      localStorage.removeItem("E2E_CHUNK_PLAYER_MODE");
      localStorage.removeItem("E2E_CHUNK_PLAYER_FIXTURE");
    });
  }
}

/**
 * Get fixture path for chunk player tests
 */
export function getChunkPlayerFixturePath(patternName: string): string {
  return `/fixtures/${patternName}-frontend.jsonl`;
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
 * @param patternName - Pattern name (e.g., "pattern1")
 *
 * @example
 * await setupChunkPlayerMode(page, "pattern1");
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

/**
 * Download frontend chunk logs organized by session ID
 *
 * This helper clicks the "Download Chunks" button and saves the downloaded
 * chunk log file organized by session ID for post-test analysis.
 * Requires CHUNK_LOGGER_SESSION_ID environment variable to be set.
 *
 * @param page - Playwright page object
 * @param testName - Test name to use in filename (required)
 * @returns The path to the saved file, or null if download failed
 *
 * @example
 * const logPath = await downloadFrontendChunkLogs(page, "normal-flow-approve-once");
 * // Saves to: chunk_logs/{CHUNK_LOGGER_SESSION_ID}/frontend/{testName}.jsonl
 * // Example: chunk_logs/e2e-session-1/frontend/normal-flow-approve-once.jsonl
 */
export async function downloadFrontendChunkLogs(
  page: Page,
  testName: string,
): Promise<string | null> {
  const fs = await import("node:fs");

  // Get session ID from environment variable
  const sessionId = process.env.CHUNK_LOGGER_SESSION_ID;
  if (!sessionId) {
    console.warn(
      "CHUNK_LOGGER_SESSION_ID not set - skipping frontend chunk log download",
    );
    return null;
  }

  // Save to chunk_logs/{session_id}/frontend/
  const frontendDir = path.join(
    process.cwd(),
    "chunk_logs",
    sessionId,
    "frontend",
  );

  // Ensure directory exists
  if (!fs.existsSync(frontendDir)) {
    fs.mkdirSync(frontendDir, { recursive: true });
  }

  // Click download button
  const downloadButton = page.getByRole("button", { name: /Download Chunks/i });
  const count = await downloadButton.count();

  if (count === 0) {
    // Silently skip if button not found (chunk logger not enabled)
    return null;
  }

  // Setup download handler
  const downloadPromise = page.waitForEvent("download");
  await downloadButton.click();

  // Wait for download and save with test name
  try {
    const download = await downloadPromise;

    // Use test name as filename
    const filename = `${testName}.jsonl`;
    const savePath = path.join(frontendDir, filename);
    await download.saveAs(savePath);

    console.log(`✅ Frontend chunk log saved to: ${savePath}`);
    return savePath;
  } catch (error) {
    console.warn("Failed to download frontend chunk logs:", error);
    return null;
  }
}

/**
 * Setup frontend console logger for E2E tests
 *
 * Captures all browser console output (log, info, warn, error, debug)
 * and saves to logs/frontend_{sessionId}.log
 *
 * Call this in beforeEach to automatically capture logs for each test.
 *
 * @param page - Playwright page object
 * @param sessionId - Session ID from NEXT_PUBLIC_CHUNK_LOGGER_SESSION_ID or custom ID
 *
 * @example
 * beforeEach(async ({ page }) => {
 *   const sessionId = process.env.NEXT_PUBLIC_CHUNK_LOGGER_SESSION_ID || 'test';
 *   setupFrontendConsoleLogger(page, sessionId);
 * });
 */
export function setupFrontendConsoleLogger(
  page: Page,
  sessionId: string,
): void {
  // Ensure logs directory exists
  const logsDir = path.join(process.cwd(), "logs");
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  const logFilePath = path.join(logsDir, `frontend_${sessionId}.log`);

  // Create write stream (append mode)
  const logStream = fs.createWriteStream(logFilePath, { flags: "a" });

  // Listen to all console events
  page.on("console", (msg) => {
    const timestamp = new Date().toISOString();
    const type = msg.type();
    const text = msg.text();

    // Format: [timestamp] [TYPE] message
    const logLine = `[${timestamp}] [${type.toUpperCase()}] ${text}\n`;
    logStream.write(logLine);
  });

  // Listen to page errors (uncaught exceptions)
  page.on("pageerror", (error) => {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] [PAGE_ERROR] ${error.message}\n${error.stack}\n`;
    logStream.write(logLine);
  });

  // Close stream when page closes
  page.on("close", () => {
    logStream.end();
  });

  console.log(`📝 Frontend console logger enabled: ${logFilePath}`);
}

/**
 * Parse JSONL chunk log file
 *
 * @param filePath - Path to JSONL file
 * @param options - Options for parsing
 * @param options.required - If false, returns empty array when file doesn't exist
 * @returns Array of parsed log entries
 */
export async function parseChunkLog(
  filePath: string,
  options: { required?: boolean } = { required: true },
): Promise<unknown[]> {
  const fs = await import("node:fs");

  if (!fs.existsSync(filePath)) {
    if (options.required) {
      throw new Error(`Chunk log file not found: ${filePath}`);
    }
    return [];
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.trim().split("\n");

  return lines
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

/**
 * Analyze chunk logs for consistency across backend and frontend
 *
 * @param sessionId - Session ID to analyze
 * @param frontendLogPath - Path to frontend log file
 * @returns Analysis results
 */
export async function analyzeChunkLogConsistency(
  sessionId: string,
  frontendLogPath: string,
): Promise<{
  backendAdkEvents: number;
  backendSseEvents: number;
  frontendEvents: number;
  backendAdkExists: boolean;
  backendSseExists: boolean;
  frontendExists: boolean;
  toolCalls: Array<{
    toolCallId: string;
    toolName: string;
    foundInBackendAdk: boolean;
    foundInBackendSse: boolean;
    foundInFrontend: boolean;
  }>;
  isConsistent: boolean;
  errors: string[];
}> {
  const fs = await import("node:fs");
  const backendAdkPath = path.join(
    process.cwd(),
    "chunk_logs",
    sessionId,
    "backend-adk-event.jsonl",
  );
  const backendSsePath = path.join(
    process.cwd(),
    "chunk_logs",
    sessionId,
    "backend-sse-event.jsonl",
  );

  const backendAdkExists = fs.existsSync(backendAdkPath);
  const backendSseExists = fs.existsSync(backendSsePath);

  const backendAdkEvents = await parseChunkLog(backendAdkPath, {
    required: false,
  });
  const backendSseEvents = await parseChunkLog(backendSsePath, {
    required: false,
  });
  const frontendEvents = await parseChunkLog(frontendLogPath);

  const errors: string[] = [];

  // Extract tool calls from each log
  const extractToolCallIds = (events: unknown[], source: string) => {
    const toolCalls = new Map<string, string>();

    for (const event of events) {
      const e = event as Record<string, unknown>;

      // Backend ADK events - look in chunk string
      // Note: A single chunk may contain multiple FunctionCall blocks (e.g., multi-recipient payments)
      // Each FunctionCall has id='adk-...',\n        name='...' pattern
      // Use matchAll to capture all occurrences, not just the first
      if (source === "backend-adk" && typeof e.chunk === "string") {
        // Pattern matches FunctionCall id and name that appear consecutively
        // The id= and name= patterns (without quotes before them) only appear at FunctionCall parameter level
        // NOT inside args dict which uses 'id': and 'name': patterns
        const pattern = /id='(adk-[^']+)',\s*\n\s*name='([^']+)'/g;
        const matches = e.chunk.matchAll(pattern);
        for (const match of matches) {
          const [, toolCallId, toolName] = match;
          toolCalls.set(toolCallId, toolName);
        }
      }

      // Backend SSE events - look in chunk JSON
      if (source === "backend-sse" && typeof e.chunk === "string") {
        try {
          const chunkMatch = e.chunk.match(/data: ({.*})/);
          if (chunkMatch) {
            const chunkData = JSON.parse(chunkMatch[1]);
            if (chunkData.toolCallId && chunkData.toolName) {
              toolCalls.set(chunkData.toolCallId, chunkData.toolName);
            }
          }
        } catch {
          // Ignore parse errors
        }
      }

      // Frontend events - look in chunk object
      if (source === "frontend" && typeof e.chunk === "object") {
        const chunk = e.chunk as Record<string, unknown>;
        // Frontend chunks use types like "tool-input-start", "tool-input-available", etc.
        // They all contain toolCallId and toolName when present
        if (
          typeof chunk.toolCallId === "string" &&
          typeof chunk.toolName === "string"
        ) {
          toolCalls.set(chunk.toolCallId, chunk.toolName);
        }
      }
    }

    return toolCalls;
  };

  const backendAdkToolCalls = extractToolCallIds(
    backendAdkEvents,
    "backend-adk",
  );
  const backendSseToolCalls = extractToolCallIds(
    backendSseEvents,
    "backend-sse",
  );
  const frontendToolCalls = extractToolCallIds(frontendEvents, "frontend");

  // Combine all unique tool call IDs
  const allToolCallIds = new Set([
    ...backendAdkToolCalls.keys(),
    ...backendSseToolCalls.keys(),
    ...frontendToolCalls.keys(),
  ]);

  const toolCalls = Array.from(allToolCallIds).map((toolCallId) => ({
    toolCallId,
    toolName:
      backendAdkToolCalls.get(toolCallId) ||
      backendSseToolCalls.get(toolCallId) ||
      frontendToolCalls.get(toolCallId) ||
      "unknown",
    foundInBackendAdk: backendAdkToolCalls.has(toolCallId),
    foundInBackendSse: backendSseToolCalls.has(toolCallId),
    foundInFrontend: frontendToolCalls.has(toolCallId),
  }));

  // Check consistency
  // Skip adk_request_confirmation - it's an internal tool intentionally filtered from SSE/Frontend
  // Per ADR 0002: adk_request_confirmation only appears in Backend ADK events,
  // but is converted to tool-approval-request in SSE (not tool-input-*)
  for (const toolCall of toolCalls) {
    // Skip internal tools that are intentionally not exposed to SSE/Frontend
    if (toolCall.toolName === "adk_request_confirmation") {
      continue;
    }

    if (!toolCall.foundInBackendAdk) {
      errors.push(
        `Tool call ${toolCall.toolCallId} (${toolCall.toolName}) missing in backend ADK events`,
      );
    }
    if (!toolCall.foundInBackendSse) {
      errors.push(
        `Tool call ${toolCall.toolCallId} (${toolCall.toolName}) missing in backend SSE events`,
      );
    }
    if (!toolCall.foundInFrontend) {
      errors.push(
        `Tool call ${toolCall.toolCallId} (${toolCall.toolName}) missing in frontend events`,
      );
    }
  }

  const frontendExists = fs.existsSync(frontendLogPath);

  return {
    backendAdkEvents: backendAdkEvents.length,
    backendSseEvents: backendSseEvents.length,
    frontendEvents: frontendEvents.length,
    backendAdkExists,
    backendSseExists,
    frontendExists,
    toolCalls,
    isConsistent: errors.length === 0,
    errors,
  };
}
