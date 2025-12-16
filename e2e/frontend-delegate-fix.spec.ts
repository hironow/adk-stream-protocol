/**
 * Frontend Delegate Fix E2E Tests
 *
 * Tests the critical bug fix: SSE and BIDI endpoints must process tool outputs
 * from incoming messages before running the agent, otherwise delegate futures
 * hang forever waiting for results that never arrive.
 *
 * Related: experiments/2025-12-16_frontend_delegate_fix.md
 *
 * Test Coverage:
 * - SSE mode: Tool approval → execution → conversation continuation
 * - BIDI mode: Tool approval → execution → conversation continuation
 *
 * Per CLAUDE.md guidelines:
 * - Uses real backend servers (no mocks)
 * - Given-When-Then structure
 * - Tests complete user-facing flow
 */

import { expect, test } from "@playwright/test";
import {
  approveToolCall,
  clearHistory,
  getLastMessage,
  getMessageText,
  navigateToChat,
  rejectToolCall,
  selectBackendMode,
  sendTextMessage,
  waitForAssistantResponse,
  waitForToolApproval,
} from "./helpers";

test.describe
  .serial("Frontend Delegate Fix - SSE Mode", () => {
    test.beforeEach(async ({ page }) => {
      await navigateToChat(page);
      await selectBackendMode(page, "adk-sse");
      await clearHistory(page);
    });

    test("should process tool output and continue conversation in SSE mode", async ({
      page,
    }) => {
      // When: User asks AI to change BGM
      await sendTextMessage(page, "Please change the BGM to track 1");

      // Then: Approval dialog appears
      await waitForToolApproval(page);

      // When: User approves the tool call
      await approveToolCall(page);

      // Then: Conversation continues without hanging (the bug we fixed)
      await waitForAssistantResponse(page);
      await page.waitForTimeout(1000);

      const lastMessage = await getLastMessage(page);
      const text = await getMessageText(lastMessage);
      expect(text.length).toBeGreaterThan(0);
    });

    test("should handle tool rejection in SSE mode", async ({ page }) => {
      // When: User requests BGM change
      await sendTextMessage(page, "Please change the BGM to track 0");

      // Then: Approval dialog appears
      await waitForToolApproval(page);

      // When: User rejects the tool call
      await rejectToolCall(page);

      // Then: Conversation continues with error handling
      await waitForAssistantResponse(page);
      await page.waitForTimeout(1000);

      const lastMessage = await getLastMessage(page);
      const text = await getMessageText(lastMessage);
      expect(text.length).toBeGreaterThan(0);
    });

    test("should not hang when processing tool output in SSE mode", async ({
      page,
    }) => {
      // This verifies the exact bug we fixed:
      // SSE mode was not processing tool outputs, causing futures to hang forever

      // When: User requests BGM change
      await sendTextMessage(page, "Please change the BGM to track 1");
      await waitForToolApproval(page);
      await approveToolCall(page);

      // Then: Response completes within reasonable time (not hang forever)
      await waitForAssistantResponse(page);
      await page.waitForTimeout(1000);

      const lastMessage = await getLastMessage(page);
      const text = await getMessageText(lastMessage);
      expect(text.length).toBeGreaterThan(0);
    });
  });

test.describe
  .serial("Frontend Delegate Fix - BIDI Mode", () => {
    test.beforeEach(async ({ page }) => {
      await navigateToChat(page);
      await selectBackendMode(page, "adk-bidi");
      await clearHistory(page);
    });

    test("should process tool output and continue conversation in BIDI mode", async ({
      page,
    }) => {
      // BIDI mode already worked, but this test ensures no regression

      // When: User asks AI to change BGM
      await sendTextMessage(page, "Please change the BGM to track 0");
      await waitForToolApproval(page);
      await approveToolCall(page);

      // Then: Conversation continues
      await waitForAssistantResponse(page);
      await page.waitForTimeout(1000);

      const lastMessage = await getLastMessage(page);
      const text = await getMessageText(lastMessage);
      expect(text.length).toBeGreaterThan(0);
    });

    test("should handle tool rejection in BIDI mode", async ({ page }) => {
      // When: User requests BGM change
      await sendTextMessage(page, "Please change the BGM to track 1");
      await waitForToolApproval(page);
      await rejectToolCall(page);

      // Then: Conversation continues with error handling
      await waitForAssistantResponse(page);
      await page.waitForTimeout(1000);

      const lastMessage = await getLastMessage(page);
      const text = await getMessageText(lastMessage);
      expect(text.length).toBeGreaterThan(0);
    });

    test("should continue to work correctly in BIDI mode (regression test)", async ({
      page,
    }) => {
      // This ensures BIDI mode still works after our SSE fix

      await sendTextMessage(page, "Please change the BGM to track 0");
      await waitForToolApproval(page);
      await approveToolCall(page);

      // Should complete without hanging
      await waitForAssistantResponse(page);
      await page.waitForTimeout(1000);

      const lastMessage = await getLastMessage(page);
      const text = await getMessageText(lastMessage);
      expect(text.length).toBeGreaterThan(0);
    });
  });

test.describe
  .serial("Frontend Delegate Fix - Mode Switching", () => {
    test("should handle tool approval correctly after switching from SSE to BIDI", async ({
      page,
    }) => {
      await navigateToChat(page);

      // Given: User starts in SSE mode
      await selectBackendMode(page, "adk-sse");
      await clearHistory(page);

      // When: User requests BGM change in SSE mode
      await sendTextMessage(page, "Please change the BGM to track 1");
      await waitForToolApproval(page);
      await approveToolCall(page);
      await waitForAssistantResponse(page);
      await page.waitForTimeout(1000);

      // Then: Switch to BIDI mode
      await selectBackendMode(page, "adk-bidi");
      await clearHistory(page);

      // And: Request another tool action
      await sendTextMessage(page, "Please change the BGM to track 0");
      await waitForToolApproval(page);
      await approveToolCall(page);

      // Should complete successfully in BIDI mode too
      await waitForAssistantResponse(page);
      await page.waitForTimeout(1000);

      const lastMessage = await getLastMessage(page);
      const text = await getMessageText(lastMessage);
      expect(text.length).toBeGreaterThan(0);
    });
  });
