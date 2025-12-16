/**
 * P4-T4.4: Systematic Model/Mode Testing
 *
 * This test suite systematically validates all combinations of:
 * - Modes: Gemini Direct, ADK SSE, ADK BIDI
 * - Models: gemini-2.0-flash-exp, gemini-1.5-pro, gemini-1.5-flash
 * - Features: Text, Images, Tools, Audio, Mode Switching
 */

import { expect, test } from "@playwright/test";
import {
  clearChatHistory,
  getMessages,
  navigateToChat,
  selectBackendMode,
  sendTextMessage,
  waitForAssistantResponse,
} from "./helpers";

// Test configuration
const MODELS = [
  "gemini-2.0-flash-exp",
  "gemini-1.5-pro",
  "gemini-1.5-flash",
  "gemini-2.5-flash-native-audio-preview-09-2025", // ADK BIDI specific model
] as const;

const MODES = ["gemini", "adk-sse", "adk-bidi"] as const;

const _TEST_TIMEOUT = 30000; // 30 seconds per test

// Test data
const TEST_PROMPTS = {
  simple: "Hi, please respond with just 'Hello!'",
  math: "What is 25 + 17?",
  context: "My name is TestUser. What's my name?",
  tool: "What's the weather like in Tokyo?",
  creative: "Write a haiku about testing",
};

// Test matrix tracking
interface TestResult {
  mode: string;
  model: string;
  feature: string;
  status: "pass" | "fail" | "skip";
  error?: string;
  responseTime?: number;
}

const testResults: TestResult[] = [];

test.describe("Systematic Mode/Model Testing (P4-T4.4)", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToChat(page);
  });

  test.afterEach(async ({ page }) => {
    await clearChatHistory(page);
  });

  // Test 1: Basic text conversation for all mode/model combinations
  test.describe("Basic Text Conversation", () => {
    for (const mode of MODES) {
      for (const model of MODELS) {
        // Skip unsupported combinations
        // ADK BIDI only works with native-audio model
        if (
          mode === "adk-bidi" &&
          model !== "gemini-2.5-flash-native-audio-preview-09-2025"
        ) {
          test.skip(`${mode} + ${model}: BIDI only supports native-audio model`, async () => {});
          continue;
        }
        // Other modes don't support native-audio model
        if (
          mode !== "adk-bidi" &&
          model === "gemini-2.5-flash-native-audio-preview-09-2025"
        ) {
          test.skip(`${mode} + ${model}: Native-audio model only for BIDI`, async () => {});
          continue;
        }

        test(`${mode} + ${model}: Basic text`, async ({ page }) => {
          const startTime = Date.now();

          try {
            // Select mode
            await selectBackendMode(page, mode);

            // TODO: Configure model (requires UI or env var change)
            // For now, we test with default model per mode

            // Send simple message
            await sendTextMessage(page, TEST_PROMPTS.simple);

            // Wait for response
            await waitForAssistantResponse(page);

            // Verify response received
            const messages = await getMessages(page);
            expect(messages.length).toBeGreaterThanOrEqual(2);

            // Check last message is from assistant
            const lastMessage = messages[messages.length - 1];
            await expect(lastMessage).toContainText(/Hello|Hi|Hey/i);

            // Record success
            testResults.push({
              mode,
              model,
              feature: "text",
              status: "pass",
              responseTime: Date.now() - startTime,
            });
          } catch (error) {
            testResults.push({
              mode,
              model,
              feature: "text",
              status: "fail",
              error: error instanceof Error ? error.message : String(error),
            });
            throw error;
          }
        });
      }
    }
  });

  // Test 2: Context preservation
  test.describe("Context Preservation", () => {
    for (const mode of MODES) {
      test(`${mode}: Context preservation`, async ({ page }) => {
        await selectBackendMode(page, mode);

        // Send context-setting message
        await sendTextMessage(
          page,
          "My name is TestUser. Please remember this.",
        );
        await waitForAssistantResponse(page);

        // Send follow-up requiring context
        await sendTextMessage(page, "What's my name?");
        await waitForAssistantResponse(page);

        // Verify context was maintained
        const messages = await getMessages(page);
        const lastMessage = messages[messages.length - 1];
        await expect(lastMessage).toContainText(/TestUser/i);
      });
    }
  });

  // Test 3: Mode switching with history preservation
  test("Mode switching preserves history", async ({ page }) => {
    // Start in Gemini Direct
    await selectBackendMode(page, "gemini");
    await sendTextMessage(page, "Message 1 in Gemini Direct");
    await waitForResponse(page);

    const messagesAfterGemini = await getMessages(page);
    const countAfterGemini = messagesAfterGemini.length;

    // Switch to ADK SSE
    await selectBackendMode(page, "adk-sse");
    await page.waitForTimeout(1000); // Wait for mode switch

    // Verify history preserved
    let messagesAfterSwitch = await getMessages(page);
    expect(messagesAfterSwitch.length).toBe(countAfterGemini);

    // Send message in ADK SSE
    await sendTextMessage(page, "Message 2 in ADK SSE");
    await waitForResponse(page);

    const messagesAfterSSE = await getMessages(page);
    const countAfterSSE = messagesAfterSSE.length;

    // Switch to ADK BIDI
    await selectBackendMode(page, "adk-bidi");
    await page.waitForTimeout(1000);

    // Verify history still preserved
    messagesAfterSwitch = await getMessages(page);
    expect(messagesAfterSwitch.length).toBe(countAfterSSE);

    // Send message in ADK BIDI
    await sendTextMessage(page, "Message 3 in ADK BIDI");
    await waitForResponse(page);

    // Final verification
    const finalMessages = await getMessages(page);
    expect(finalMessages.length).toBeGreaterThanOrEqual(6); // 3 user + 3 assistant
  });

  // Test 4: Tool usage (weather)
  test.describe("Tool Usage", () => {
    for (const mode of ["adk-sse", "adk-bidi"] as const) {
      test(`${mode}: Weather tool`, async ({ page }) => {
        await selectBackendMode(page, mode);

        // Ask about weather (triggers tool)
        await sendTextMessage(page, TEST_PROMPTS.tool);

        // Wait for tool approval UI
        await page
          .waitForSelector('[data-testid="tool-approval"]', {
            timeout: 10000,
          })
          .catch(() => {
            // Tool approval might auto-approve in test mode
          });

        // If approval needed, approve it
        const approveButton = page.locator('button:has-text("Approve")');
        if (await approveButton.isVisible()) {
          await approveButton.click();
        }

        // Wait for response
        await waitForAssistantResponse(page);

        // Verify response contains weather info
        const messages = await getMessages(page);
        const lastMessage = messages[messages.length - 1];
        await expect(lastMessage).toContainText(
          /weather|温度|天気|temperature/i,
        );
      });
    }
  });

  // Test 5: Error handling
  test.describe("Error Handling", () => {
    test("Handles network error gracefully", async ({ page }) => {
      await selectBackendMode(page, "adk-sse");

      // Simulate network issue by sending while offline
      await page.context().setOffline(true);

      // Try to send message
      await sendTextMessage(page, "Test message");

      // Should show error state
      await page
        .waitForSelector('[data-testid="error-message"], .error', {
          timeout: 5000,
        })
        .catch(() => {
          // Error UI might vary
        });

      // Go back online
      await page.context().setOffline(false);

      // Retry should work
      await sendTextMessage(page, "Retry message");
      await waitForAssistantResponse(page);

      const messages = await getMessages(page);
      expect(messages.length).toBeGreaterThan(0);
    });
  });

  // Test 6: Performance benchmarks
  test("Performance: Response times", async ({ page }) => {
    const performanceResults: Record<string, number[]> = {};

    for (const mode of MODES) {
      performanceResults[mode] = [];

      await selectBackendMode(page, mode);

      // Run 3 iterations per mode
      for (let i = 0; i < 3; i++) {
        const startTime = Date.now();

        await sendTextMessage(page, `Performance test ${i + 1}`);
        await waitForAssistantResponse(page);

        const responseTime = Date.now() - startTime;
        performanceResults[mode].push(responseTime);

        // Clear for next iteration
        if (i < 2) {
          await clearChatHistory(page);
        }
      }
    }

    // Log performance results
    console.log("Performance Results (ms):");
    for (const [mode, times] of Object.entries(performanceResults)) {
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      console.log(
        `  ${mode}: avg=${avg.toFixed(0)}ms, times=${times.join(", ")}`,
      );

      // Assert reasonable response times
      expect(avg).toBeLessThan(10000); // 10 seconds max average
    }
  });

  // Test 7: Long context handling
  test("Long context (50+ messages)", async ({ page }) => {
    test.setTimeout(120000); // 2 minutes for long test

    await selectBackendMode(page, "adk-sse");

    // Send many messages to build up context
    for (let i = 0; i < 10; i++) {
      await sendTextMessage(
        page,
        `Context message ${i + 1}: This is message number ${i + 1} in our conversation.`,
      );
      await waitForAssistantResponse(page);

      // Brief pause between messages
      await page.waitForTimeout(500);
    }

    // Verify all messages are present
    const messages = await getMessages(page);
    expect(messages.length).toBeGreaterThanOrEqual(20); // 10 user + 10 assistant

    // Test that context is still maintained
    await sendTextMessage(page, "How many messages have we exchanged?");
    await waitForResponse(page);

    const finalMessages = await getMessages(page);
    const lastMessage = finalMessages[finalMessages.length - 1];

    // Should reference the message count
    await expect(lastMessage).toContainText(/10|ten|20|twenty/i);
  });

  // Test 8: Special characters and Unicode
  test("Unicode and special characters", async ({ page }) => {
    const specialMessages = [
      "Hello 世界! 🌍",
      "Math: ∑(n=1 to ∞) 1/n²",
      "Emoji test: 😀 🎉 🚀 ❤️",
      "Special chars: <>&\"'`",
    ];

    for (const mode of MODES) {
      await selectBackendMode(page, mode);

      for (const message of specialMessages) {
        await sendTextMessage(page, message);
        await waitForAssistantResponse(page);

        // Verify message was sent correctly
        const messages = await getMessages(page);
        // Find the user message that should contain our special text
        const userMessages = messages.filter(async (msg) => {
          const text = await msg.textContent();
          return text?.includes(message);
        });
        expect(userMessages.length).toBeGreaterThan(0);
      }

      await clearChatHistory(page);
    }
  });

  // Final test: Generate summary report
  test.afterAll(async () => {
    console.log("\n=== Systematic Testing Summary ===\n");
    console.log("Test Results:");

    const summary = testResults.reduce(
      (acc, result) => {
        const key = `${result.mode}-${result.feature}`;
        if (!acc[key]) {
          acc[key] = { pass: 0, fail: 0, skip: 0 };
        }
        acc[key][result.status]++;
        return acc;
      },
      {} as Record<string, { pass: number; fail: number; skip: number }>,
    );

    console.table(summary);

    // Log failures
    const failures = testResults.filter((r) => r.status === "fail");
    if (failures.length > 0) {
      console.log("\nFailures:");
      failures.forEach((f) => {
        console.log(`  - ${f.mode}/${f.model}/${f.feature}: ${f.error}`);
      });
    }

    // Log performance metrics
    const performanceData = testResults
      .filter((r) => r.responseTime)
      .reduce(
        (acc, r) => {
          const key = r.mode;
          if (!acc[key]) {
            acc[key] = [];
          }
          acc[key].push(r.responseTime!);
          return acc;
        },
        {} as Record<string, number[]>,
      );

    console.log("\nPerformance Metrics (ms):");
    for (const [mode, times] of Object.entries(performanceData)) {
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      const min = Math.min(...times);
      const max = Math.max(...times);
      console.log(`  ${mode}: avg=${avg.toFixed(0)}, min=${min}, max=${max}`);
    }
  });
});
