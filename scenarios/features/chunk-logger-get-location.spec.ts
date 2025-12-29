/**
 * Chunk Logger Integration Tests - get_location Tool
 *
 * Verifies consistency across all 3 chunk log sources:
 * 1. Backend ADK events (chunk_logs/{session_id}/backend-adk-event.jsonl)
 * 2. Backend SSE events (chunk_logs/{session_id}/backend-sse-event.jsonl)
 * 3. Frontend events (chunk_logs/frontend/{test-name}-{session_id}.jsonl)
 *
 * Tests get_location tool with approval flow (Approve/Deny) = 2 test cases
 *
 * Per CLAUDE.md guidelines:
 * - Uses real backend servers (no mocks)
 * - Given-When-Then structure
 * - Tests ADK SSE mode
 */

import { expect, test } from "@playwright/test";
import { config } from "dotenv";
import {
  analyzeChunkLogConsistency,
  cleanupChunkLoggerState,
  clearBackendChunkLogs,
  downloadFrontendChunkLogs,
  enableChunkLogger,
  navigateToChat,
  selectBackendMode,
  sendTextMessage,
  setupFrontendConsoleLogger,
  waitForAssistantResponse,
} from "../helpers";

// Load environment variables from .env.local
config({ path: ".env.local" });

// Read session ID from environment variable to match backend
const SESSION_ID =
  process.env.NEXT_PUBLIC_CHUNK_LOGGER_SESSION_ID || "e2e-get-location";

test.describe
  .serial("Chunk Logger Integration - get_location", () => {
    test.beforeEach(async ({ page }) => {
      // Clear backend chunk logs from previous runs
      clearBackendChunkLogs(SESSION_ID);

      // Setup frontend console logger
      const sessionId =
        process.env.NEXT_PUBLIC_CHUNK_LOGGER_SESSION_ID ||
        process.env.CHUNK_LOGGER_SESSION_ID ||
        "test";
      setupFrontendConsoleLogger(page, sessionId);

      // Given: User navigates to chat and enables chunk logger
      await navigateToChat(page);

      // Enable chunk logger with dedicated session ID
      await enableChunkLogger(page, SESSION_ID);

      // Reload to apply chunk logger settings
      await page.reload();
      await page.waitForLoadState("networkidle");

      // Select ADK SSE mode
      await selectBackendMode(page, "adk-sse");
    });

    test.afterEach(async ({ page }) => {
      // Clean up frontend and backend state for next test
      await cleanupChunkLoggerState(page);
    });

    /**
     * Test 1: get_location - APPROVE
     */
    test("should maintain log consistency when approving location request", async ({
      page,
    }) => {
      // Given: Backend is ready with chunk logger enabled

      // When: User requests location
      await sendTextMessage(page, "私の位置を教えて");

      // Then: Approval UI appears
      await expect(
        page.getByRole("button", { name: "Approve" }).first(),
      ).toBeVisible({
        timeout: 30000,
      });

      // When: User approves
      await page.getByRole("button", { name: "Approve" }).first().click();

      // Then: Wait for completion
      await waitForAssistantResponse(page, { timeout: 45000 });

      // Download frontend chunk logs
      const frontendLogPath = await downloadFrontendChunkLogs(
        page,
        "approve-location",
      );
      expect(frontendLogPath).not.toBeNull();

      // Analyze consistency across all 3 log files
      const analysis = await analyzeChunkLogConsistency(
        SESSION_ID,
        frontendLogPath!,
      );

      // Then: All 3 logs should be consistent
      expect(analysis.backendAdkExists).toBe(true);
      expect(analysis.backendSseExists).toBe(true);
      expect(analysis.frontendExists).toBe(true);
      expect(analysis.isConsistent).toBe(true);
    });

    /**
     * Test 2: get_location - DENY
     */
    test("should maintain log consistency when denying location request", async ({
      page,
    }) => {
      // Given: Backend is ready with chunk logger enabled

      // When: User requests location
      await sendTextMessage(page, "私の現在地は？");

      // Then: Approval UI appears
      await expect(
        page.getByRole("button", { name: "Deny" }).first(),
      ).toBeVisible({
        timeout: 30000,
      });

      // When: User denies
      await page.getByRole("button", { name: "Deny" }).first().click();

      // Then: Wait for completion
      await waitForAssistantResponse(page, { timeout: 45000 });

      // Download frontend chunk logs
      const frontendLogPath = await downloadFrontendChunkLogs(
        page,
        "deny-location",
      );
      expect(frontendLogPath).not.toBeNull();

      // Analyze consistency across all 3 log files
      const analysis = await analyzeChunkLogConsistency(
        SESSION_ID,
        frontendLogPath!,
      );

      // Then: All 3 logs should be consistent
      expect(analysis.backendAdkExists).toBe(true);
      expect(analysis.backendSseExists).toBe(true);
      expect(analysis.frontendExists).toBe(true);
      expect(analysis.isConsistent).toBe(true);
    });
  });
