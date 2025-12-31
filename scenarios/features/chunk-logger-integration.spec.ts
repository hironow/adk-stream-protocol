/**
 * Chunk Logger Integration Tests
 *
 * Verifies consistency across all 3 chunk log sources:
 * 1. Backend ADK events (chunk_logs/{session_id}/backend-adk-event.jsonl)
 * 2. Backend SSE events (chunk_logs/{session_id}/backend-sse-event.jsonl)
 * 3. Frontend events (chunk_logs/frontend/{test-name}-{session_id}.jsonl)
 *
 * Tests 4 tools with various scenarios:
 * - process_payment: 8 test cases (approval required - various patterns)
 * - get_location: 2 test cases (APPROVE + DENY)
 * - get_weather: 1 test case (no approval required)
 * - change_bgm: 1 test case (no approval required)
 * Total: 12 test cases
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
  process.env.NEXT_PUBLIC_CHUNK_LOGGER_SESSION_ID || "e2e-default";

test.describe
  .serial("Chunk Logger Integration Tests", () => {
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
      // (backend logs are preserved and cleared in beforeEach)
      await cleanupChunkLoggerState(page);
    });

    /**
     * Tool Scenario 1: Small payment (50 USD) - APPROVE
     */
    test("should maintain log consistency when approving small payment", async ({
      page,
    }) => {
      // Given: Backend is ready with chunk logger enabled

      // When: User requests payment
      await sendTextMessage(page, "花子さんに50ドル送金してください");

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
        "approve-small-payment",
      );
      expect(frontendLogPath).not.toBeNull();

      // Analyze consistency across all 3 log files
      const analysis = await analyzeChunkLogConsistency(
        SESSION_ID,
        frontendLogPath!,
      );

      console.log("\n📊 Chunk Log Analysis (Approve Small Payment):");
      console.log(`  Backend ADK events: ${analysis.backendAdkEvents}`);
      console.log(`  Backend SSE events: ${analysis.backendSseEvents}`);
      console.log(`  Frontend events: ${analysis.frontendEvents}`);
      console.log(`  Tool calls found: ${analysis.toolCalls.length}`);

      for (const toolCall of analysis.toolCalls) {
        console.log(
          `\n  🔧 Tool: ${toolCall.toolName} (${toolCall.toolCallId})`,
        );
        console.log(
          `    Backend ADK: ${toolCall.foundInBackendAdk ? "✅" : "❌"}`,
        );
        console.log(
          `    Backend SSE: ${toolCall.foundInBackendSse ? "✅" : "❌"}`,
        );
        console.log(`    Frontend: ${toolCall.foundInFrontend ? "✅" : "❌"}`);
      }

      if (analysis.errors.length > 0) {
        console.log("\n❌ Consistency Errors:");
        for (const error of analysis.errors) {
          console.log(`  - ${error}`);
        }
      } else {
        console.log("\n✅ All logs are consistent!");
      }

      // Assert consistency
      expect(analysis.isConsistent).toBe(true);
      expect(analysis.errors).toHaveLength(0);

      // Verify process_payment was called
      const processPaymentCall = analysis.toolCalls.find(
        (tc) => tc.toolName === "process_payment",
      );
      expect(processPaymentCall).toBeDefined();
      expect(processPaymentCall?.foundInBackendAdk).toBe(true);
      expect(processPaymentCall?.foundInBackendSse).toBe(true);
      expect(processPaymentCall?.foundInFrontend).toBe(true);
    });

    /**
     * Tool Scenario 2: Large payment (500 USD) - APPROVE
     */
    test("should maintain log consistency when approving large payment", async ({
      page,
    }) => {
      // Given: Backend is ready

      // When: User requests large payment
      await sendTextMessage(page, "太郎さんに500ドル送金してください");

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

      // Download and analyze
      const frontendLogPath = await downloadFrontendChunkLogs(
        page,
        "approve-large-payment",
      );
      expect(frontendLogPath).not.toBeNull();

      const analysis = await analyzeChunkLogConsistency(
        SESSION_ID,
        frontendLogPath!,
      );

      console.log("\n📊 Chunk Log Analysis (Approve Large Payment):");
      console.log(`  Consistent: ${analysis.isConsistent ? "✅" : "❌"}`);
      console.log(`  Tool calls: ${analysis.toolCalls.length}`);

      expect(analysis.isConsistent).toBe(true);
      expect(analysis.errors).toHaveLength(0);
    });

    /**
     * Tool Scenario 3: International payment (JPY) - DENY
     */
    test("should maintain log consistency when denying international payment", async ({
      page,
    }) => {
      // Given: Backend is ready

      // When: User requests international payment
      await sendTextMessage(page, "山田さんに10000円送金してください");

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

      // Download and analyze
      const frontendLogPath = await downloadFrontendChunkLogs(
        page,
        "deny-international-payment",
      );
      expect(frontendLogPath).not.toBeNull();

      const analysis = await analyzeChunkLogConsistency(
        SESSION_ID,
        frontendLogPath!,
      );

      console.log("\n📊 Chunk Log Analysis (Deny International Payment):");
      console.log(`  Consistent: ${analysis.isConsistent ? "✅" : "❌"}`);
      console.log(`  Tool calls: ${analysis.toolCalls.length}`);

      // Verify denial scenario
      expect(analysis.isConsistent).toBe(true);
      expect(analysis.errors).toHaveLength(0);

      // Verify the payment request was logged (even though denied)
      const processPaymentCall = analysis.toolCalls.find(
        (tc) => tc.toolName === "process_payment",
      );
      expect(processPaymentCall).toBeDefined();
    });

    /**
     * Tool Scenario 4: Multiple recipients payment - DENY
     */
    test("should maintain log consistency when denying payment to multiple recipients", async ({
      page,
    }) => {
      // Given: Backend is ready

      // When: User requests payment to multiple recipients
      await sendTextMessage(
        page,
        "花子さんと太郎さんにそれぞれ100ドル送金してください",
      );

      // Then: Approval UI appears (may show first one or combined)
      // Note: Multiple payment requests may show multiple Deny buttons
      await expect(
        page.getByRole("button", { name: "Deny" }).first(),
      ).toBeVisible({
        timeout: 30000,
      });

      // When: User denies (click first button if multiple)
      await page.getByRole("button", { name: "Deny" }).first().click();

      // Then: Wait for completion
      await waitForAssistantResponse(page, { timeout: 45000 });

      // Download and analyze
      const frontendLogPath = await downloadFrontendChunkLogs(
        page,
        "deny-multiple-payment",
      );
      expect(frontendLogPath).not.toBeNull();

      const analysis = await analyzeChunkLogConsistency(
        SESSION_ID,
        frontendLogPath!,
      );

      console.log("\n📊 Chunk Log Analysis (Deny Multiple Payment):");
      console.log(`  Consistent: ${analysis.isConsistent ? "✅" : "❌"}`);
      console.log(`  Tool calls: ${analysis.toolCalls.length}`);

      expect(analysis.isConsistent).toBe(true);
      expect(analysis.errors).toHaveLength(0);
    });

    /**
     * Combined Scenario 1: Approve then Deny
     */
    test("should maintain log consistency across approve then deny sequence", async ({
      page,
    }) => {
      // Given: Backend is ready

      // When: User requests first payment (approve)
      await sendTextMessage(page, "花子さんに30ドル送金してください");
      await expect(
        page.getByRole("button", { name: "Approve" }).first(),
      ).toBeVisible({
        timeout: 30000,
      });
      await page.getByRole("button", { name: "Approve" }).first().click();
      await waitForAssistantResponse(page, { timeout: 45000 });

      // When: User requests second payment (deny)
      await sendTextMessage(page, "太郎さんに500ドル送金してください");
      await expect(
        page.getByRole("button", { name: "Deny" }).first(),
      ).toBeVisible({
        timeout: 30000,
      });
      await page.getByRole("button", { name: "Deny" }).first().click();
      await waitForAssistantResponse(page, { timeout: 45000 });

      // Download and analyze
      const frontendLogPath = await downloadFrontendChunkLogs(
        page,
        "approve-then-deny",
      );
      expect(frontendLogPath).not.toBeNull();

      const analysis = await analyzeChunkLogConsistency(
        SESSION_ID,
        frontendLogPath!,
      );

      console.log("\n📊 Chunk Log Analysis (Approve Then Deny):");
      console.log(`  Consistent: ${analysis.isConsistent ? "✅" : "❌"}`);
      console.log(`  Tool calls: ${analysis.toolCalls.length}`);

      // Should have 2 process_payment calls
      const paymentCalls = analysis.toolCalls.filter(
        (tc) => tc.toolName === "process_payment",
      );
      console.log(`  Payment calls: ${paymentCalls.length}`);

      expect(analysis.isConsistent).toBe(true);
      expect(analysis.errors).toHaveLength(0);
      expect(paymentCalls.length).toBeGreaterThanOrEqual(2);
    });

    /**
     * Combined Scenario 2: Deny then Approve
     */
    test("should maintain log consistency across deny then approve sequence", async ({
      page,
    }) => {
      // Given: Backend is ready

      // When: User requests first payment (deny)
      await sendTextMessage(page, "花子さんに1000ドル送金してください");
      await expect(
        page.getByRole("button", { name: "Deny" }).first(),
      ).toBeVisible({
        timeout: 30000,
      });
      await page.getByRole("button", { name: "Deny" }).first().click();
      await waitForAssistantResponse(page, { timeout: 45000 });

      // When: User requests second payment (approve)
      await sendTextMessage(page, "太郎さんに50ドル送金してください");
      await expect(
        page.getByRole("button", { name: "Approve" }).first(),
      ).toBeVisible({
        timeout: 30000,
      });
      await page.getByRole("button", { name: "Approve" }).first().click();
      await waitForAssistantResponse(page, { timeout: 45000 });

      // Download and analyze
      const frontendLogPath = await downloadFrontendChunkLogs(
        page,
        "deny-then-approve",
      );
      expect(frontendLogPath).not.toBeNull();

      const analysis = await analyzeChunkLogConsistency(
        SESSION_ID,
        frontendLogPath!,
      );

      console.log("\n📊 Chunk Log Analysis (Deny Then Approve):");
      console.log(`  Consistent: ${analysis.isConsistent ? "✅" : "❌"}`);
      console.log(`  Tool calls: ${analysis.toolCalls.length}`);

      // Should have 2 process_payment calls
      const paymentCalls = analysis.toolCalls.filter(
        (tc) => tc.toolName === "process_payment",
      );
      console.log(`  Payment calls: ${paymentCalls.length}`);

      expect(analysis.isConsistent).toBe(true);
      expect(analysis.errors).toHaveLength(0);
      expect(paymentCalls.length).toBeGreaterThanOrEqual(2);
    });

    /**
     * Edge Case: Rapid approve sequence
     */
    test("should maintain log consistency with rapid approve sequence", async ({
      page,
    }) => {
      // Given: Backend is ready

      // When: User requests 3 payments rapidly
      await sendTextMessage(page, "花子さんに20ドル送金してください");
      await expect(
        page.getByRole("button", { name: "Approve" }).first(),
      ).toBeVisible({
        timeout: 30000,
      });
      await page.getByRole("button", { name: "Approve" }).first().click();
      await waitForAssistantResponse(page, { timeout: 45000 });

      await sendTextMessage(page, "太郎さんに30ドル送金してください");
      await expect(
        page.getByRole("button", { name: "Approve" }).first(),
      ).toBeVisible({
        timeout: 30000,
      });
      await page.getByRole("button", { name: "Approve" }).first().click();
      await waitForAssistantResponse(page, { timeout: 45000 });

      await sendTextMessage(page, "次郎さんに40ドル送金してください");
      await expect(
        page.getByRole("button", { name: "Approve" }).first(),
      ).toBeVisible({
        timeout: 30000,
      });
      await page.getByRole("button", { name: "Approve" }).first().click();
      await waitForAssistantResponse(page, { timeout: 45000 });

      // Download and analyze
      const frontendLogPath = await downloadFrontendChunkLogs(
        page,
        "rapid-approve-sequence",
      );
      expect(frontendLogPath).not.toBeNull();

      const analysis = await analyzeChunkLogConsistency(
        SESSION_ID,
        frontendLogPath!,
      );

      console.log("\n📊 Chunk Log Analysis (Rapid Approve Sequence):");
      console.log(`  Consistent: ${analysis.isConsistent ? "✅" : "❌"}`);
      console.log(`  Tool calls: ${analysis.toolCalls.length}`);

      // Should have 3 process_payment calls
      const paymentCalls = analysis.toolCalls.filter(
        (tc) => tc.toolName === "process_payment",
      );
      console.log(`  Payment calls: ${paymentCalls.length}`);

      expect(analysis.isConsistent).toBe(true);
      expect(analysis.errors).toHaveLength(0);
      expect(paymentCalls.length).toBeGreaterThanOrEqual(3);
    });

    /**
     * Edge Case: Rapid deny sequence
     */
    test("should maintain log consistency with rapid deny sequence", async ({
      page,
    }) => {
      // Given: Backend is ready

      // When: User requests 3 payments rapidly and denies all
      await sendTextMessage(page, "花子さんに200ドル送金してください");
      await expect(
        page.getByRole("button", { name: "Deny" }).first(),
      ).toBeVisible({
        timeout: 30000,
      });
      await page.getByRole("button", { name: "Deny" }).first().click();
      await waitForAssistantResponse(page, { timeout: 45000 });

      await sendTextMessage(page, "太郎さんに300ドル送金してください");
      await expect(
        page.getByRole("button", { name: "Deny" }).first(),
      ).toBeVisible({
        timeout: 30000,
      });
      await page.getByRole("button", { name: "Deny" }).first().click();
      await waitForAssistantResponse(page, { timeout: 45000 });

      await sendTextMessage(page, "次郎さんに400ドル送金してください");
      await expect(
        page.getByRole("button", { name: "Deny" }).first(),
      ).toBeVisible({
        timeout: 30000,
      });
      await page.getByRole("button", { name: "Deny" }).first().click();
      await waitForAssistantResponse(page, { timeout: 45000 });

      // Download and analyze
      const frontendLogPath = await downloadFrontendChunkLogs(
        page,
        "rapid-deny-sequence",
      );
      expect(frontendLogPath).not.toBeNull();

      const analysis = await analyzeChunkLogConsistency(
        SESSION_ID,
        frontendLogPath!,
      );

      console.log("\n📊 Chunk Log Analysis (Rapid Deny Sequence):");
      console.log(`  Consistent: ${analysis.isConsistent ? "✅" : "❌"}`);
      console.log(`  Tool calls: ${analysis.toolCalls.length}`);

      // Should have 3 process_payment calls
      const paymentCalls = analysis.toolCalls.filter(
        (tc) => tc.toolName === "process_payment",
      );
      console.log(`  Payment calls: ${paymentCalls.length}`);

      expect(analysis.isConsistent).toBe(true);
      expect(analysis.errors).toHaveLength(0);
      expect(paymentCalls.length).toBeGreaterThanOrEqual(3);
    });

    /**
     * Tool: get_location - APPROVE
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
     * Tool: get_location - DENY
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

    /**
     * Tool: get_weather - Basic execution (no approval required)
     */
    test("should maintain log consistency when requesting weather", async ({
      page,
    }) => {
      // Given: Backend is ready with chunk logger enabled

      // When: User requests weather
      await sendTextMessage(page, "東京の天気を教えてください");

      // Then: Wait for completion (no approval UI should appear)
      await waitForAssistantResponse(page, { timeout: 45000 });

      // Download frontend chunk logs
      const frontendLogPath = await downloadFrontendChunkLogs(
        page,
        "weather-request",
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
     * Tool: change_bgm - Basic execution (no approval required)
     */
    test("should maintain log consistency when changing BGM", async ({
      page,
    }) => {
      // Given: Backend is ready with chunk logger enabled

      // When: User requests BGM change
      await sendTextMessage(page, "BGMをトラック2に変更して");

      // Then: Wait for completion (no approval UI should appear)
      await waitForAssistantResponse(page, { timeout: 45000 });

      // Download frontend chunk logs
      const frontendLogPath = await downloadFrontendChunkLogs(
        page,
        "bgm-change",
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
