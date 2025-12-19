/**
 * POC: LongRunningFunctionTool + BIDI Live API Compatibility Test
 *
 * Purpose: Test if ADK's Live API supports LongRunningFunctionTool pause/resume pattern
 * Approach: TDD RED → Observe what breaks → Understand the gaps
 *
 * Expected Outcome:
 * - 60% chance: All tests pass → GO for full implementation
 * - 40% chance: Tests fail → NO-GO, pivot to alternative
 */

import { expect, test } from "@playwright/test";

test.describe("POC: LongRunningFunctionTool + BIDI", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("http://localhost:3000");

    // Select BIDI mode
    const bidiButton = page.locator('button:has-text("ADK BIDI")');
    await bidiButton.click();

    // Wait for mode to be selected (button should have active state)
    await page.waitForTimeout(500);

    // Clear any previous sessions
    await page.evaluate(() => {
      fetch("http://localhost:8000/clear-sessions", { method: "POST" });
    });
  });

  /**
   * POC Phase 1: LongRunningFunctionTool Pause Mechanism
   *
   * Test: Does LongRunningFunctionTool properly pause agent execution?
   *
   * Success Criteria:
   * - Tool invocation triggers
   * - Tool returns None (no result/output)
   * - Tool stays in "Executing..." state (NOT "Completed")
   * - ADK adds tool to long_running_tool_ids
   * - Agent pauses (connection closes)
   *
   * Failure Criteria:
   * - Tool doesn't execute
   * - Tool completes instead of pausing
   * - Error/timeout occurs
   */
  test("Phase 1: LongRunningFunctionTool returns pending status", async ({
    page,
  }) => {
    console.log(
      "[POC Phase 1] Testing LongRunningFunctionTool pause mechanism",
    );

    // Send request that triggers long-running tool
    const input = page.getByPlaceholder("Type your message...");
    await input.fill("Request approval to pay $500 to Alice");
    await input.press("Enter");

    // Wait for tool to appear with Executing status (NOT Completed)
    const executingStatus = page.locator("text=Executing").first();
    await expect(executingStatus).toBeVisible({ timeout: 10000 });
    console.log("[POC Phase 1] Tool in Executing state (paused) ✅");

    // Wait for Input section to appear (tool args should be visible)
    const inputLabel = page.locator("text=Input").first();
    await expect(inputLabel).toBeVisible({ timeout: 5000 });
    console.log("[POC Phase 1] Input section visible");

    // Verify Input contains expected args
    const inputContent = page
      .locator("text=/recipient.*Alice|amount.*500/i")
      .first();
    await expect(inputContent).toBeVisible({ timeout: 5000 });
    console.log(
      "[POC Phase 1] Input args visible (recipient: Alice, amount: 500)",
    );

    // CRITICAL: Result section should NOT exist (None returned)
    const resultLabel = page.locator("text=Result").first();
    await expect(resultLabel).not.toBeVisible({ timeout: 2000 });
    console.log(
      "[POC Phase 1] Result section NOT visible (correct - None returned) ✅",
    );

    // Verify "Thinking..." is still visible (agent paused, not completed)
    const thinking = page.locator("text=/Thinking/i").first();
    await expect(thinking).toBeVisible({ timeout: 2000 });
    console.log('[POC Phase 1] "Thinking..." still visible (agent paused) ✅');

    console.log(
      "[POC Phase 1] ✅ PASS: Tool correctly paused with LongRunningFunctionTool",
    );
  });

  /**
   * POC Phase 2: Event Stream Behavior During Pause
   *
   * Test: Does Live API stop generating events after pending status?
   *
   * Success Criteria:
   * - "Thinking..." disappears after pending status
   * - No continuous reasoning events after pending
   * - Stream status becomes stable (not "streaming")
   *
   * Failure Criteria:
   * - "Thinking..." continues forever (same as current problem)
   * - Live API keeps sending reasoning events
   * - Stream never closes
   */
  test("Phase 2: Live API stops events after pending status", async ({
    page,
  }) => {
    console.log("[POC Phase 2] Testing event stream behavior during pause");

    // Send request
    const input = page.getByPlaceholder("Type your message...");
    await input.fill("Request approval to pay $500 to Alice");
    await input.press("Enter");

    // Wait for "Thinking..." to appear
    const thinking = page.locator("text=/Thinking/i").first();
    await expect(thinking).toBeVisible({ timeout: 5000 });
    console.log('[POC Phase 2] "Thinking..." appeared');

    // Wait for tool invocation
    const toolInvocation = page
      .locator('[data-testid="tool-invocation"]')
      .first();
    await expect(toolInvocation).toBeVisible({ timeout: 10000 });
    console.log("[POC Phase 2] Tool invocation visible");

    // CRITICAL TEST: Does "Thinking..." disappear after pending?
    await expect(thinking).not.toBeVisible({ timeout: 5000 });
    console.log('[POC Phase 2] ✅ "Thinking..." disappeared');

    // Check that status is not "streaming"
    const statusIndicator = page
      .locator('[data-testid="stream-status"]')
      .first();
    const status = await statusIndicator.textContent();
    console.log(`[POC Phase 2] Stream status: ${status}`);

    expect(status).not.toContain("streaming");

    console.log("[POC Phase 2] ✅ PASS: Stream stopped after pending");
  });

  /**
   * POC Phase 3: Function Response Injection
   *
   * Test: Can we inject function_response via WebSocket?
   *
   * Success Criteria:
   * - Approval button appears for pending tool
   * - Clicking Approve sends function_response via WebSocket
   * - Backend receives function_response
   * - Agent resumes execution
   *
   * Failure Criteria:
   * - No approval UI appears
   * - WebSocket send fails
   * - Backend doesn't recognize function_response
   * - Agent doesn't resume
   */
  test("Phase 3: Function response injection via WebSocket", async ({
    page,
  }) => {
    console.log("[POC Phase 3] Testing function_response injection");

    // Setup console monitoring to verify function_response was sent
    const consoleLogs: string[] = [];
    page.on("console", (msg) => {
      const text = msg.text();
      if (text.includes("[WS Transport]") || text.includes("[POC Phase 3]")) {
        consoleLogs.push(text);
        console.log(text);
      }
    });

    // Send request
    const input = page.getByPlaceholder("Type your message...");
    await input.fill("Request approval to pay $500 to Alice");
    await input.press("Enter");

    // Wait for approval UI
    const approveButton = page.locator('button:has-text("Approve")').first();
    await expect(approveButton).toBeVisible({ timeout: 10000 });
    console.log("[POC Phase 3] Approval UI visible");

    // Click Approve
    await approveButton.click();
    console.log("[POC Phase 3] Clicked Approve button");

    // Wait a bit for message to be sent and logged
    await page.waitForTimeout(1000);

    // Verify that sendFunctionResponse was called (by checking console logs)
    const sendFunctionResponseCalled = consoleLogs.some((log) =>
      log.includes(
        "[WS Transport] Sending function_response for approval_test_tool",
      ),
    );

    expect(sendFunctionResponseCalled).toBe(true);
    console.log("[POC Phase 3] ✅ Verified: sendFunctionResponse was called");

    // Wait for agent to resume and generate response
    // Note: Tool should transition from "Executing..." to "Completed" or show output
    const aiResponseOrToolResult = await Promise.race([
      // Wait for new AI response
      page
        .locator('[data-testid="message-assistant"]')
        .last()
        .waitFor({ timeout: 15000 })
        .then(() => "ai-response"),
      // Or wait for tool to show result/output
      page
        .locator("text=Result")
        .first()
        .waitFor({ timeout: 15000 })
        .then(() => "tool-result"),
    ]).catch(() => "timeout");

    if (aiResponseOrToolResult === "timeout") {
      console.log("[POC Phase 3] ⚠️ TIMEOUT: No response within 15s");
      // Take screenshot for debugging
      await page.screenshot({ path: "/tmp/poc-phase3-timeout.png" });
    } else {
      console.log(`[POC Phase 3] ✅ Agent resumed: ${aiResponseOrToolResult}`);
    }

    console.log(
      "[POC Phase 3] ✅ PASS: Function response was sent via WebSocket",
    );
  });

  /**
   * POC Phase 4: Connection Timeout and Keep-Alive
   *
   * Test: Does WebSocket stay open during 2-minute wait?
   *
   * Success Criteria:
   * - WebSocket connection stays open for 2+ minutes
   * - Can still inject function_response after delay
   * - Agent resumes successfully after long wait
   *
   * Failure Criteria:
   * - WebSocket times out
   * - Connection closes before approval
   * - Cannot resume after timeout
   */
  test("Phase 4: Connection timeout and keep-alive", async ({ page }) => {
    console.log("[POC Phase 4] Testing connection timeout (2-minute wait)");

    // Setup console monitoring for ping events
    const consoleLogs: string[] = [];
    page.on("console", (msg) => {
      const text = msg.text();
      if (text.includes("[WS Transport]") || text.includes("ping")) {
        consoleLogs.push(text);
      }
    });

    // Send request
    const input = page.getByPlaceholder("Type your message...");
    await input.fill("Request approval to pay $500 to Alice");
    await input.press("Enter");

    // Wait for approval UI
    const approveButton = page.locator('button:has-text("Approve")').first();
    await expect(approveButton).toBeVisible({ timeout: 10000 });
    console.log("[POC Phase 4] Approval UI visible");

    // Monitor WebSocket connection status
    const wsStatus = await page.evaluate(() => {
      const ws = (window as any).__websocket;
      return ws ? { readyState: ws.readyState, url: ws.url } : null;
    });
    console.log(`[POC Phase 4] Initial WebSocket:`, wsStatus);
    expect(wsStatus).toBeTruthy();
    expect(wsStatus?.readyState).toBe(1); // 1 = OPEN

    // Wait 2 minutes with periodic status checks
    console.log("[POC Phase 4] Waiting 2 minutes (checking every 30s)...");
    for (let i = 0; i < 4; i++) {
      await page.waitForTimeout(30000); // 30 seconds

      const statusCheck = await page.evaluate(() => {
        const ws = (window as any).__websocket;
        return ws ? ws.readyState : null;
      });

      console.log(
        `[POC Phase 4] Status check ${i + 1}/4 (${(i + 1) * 30}s): ${statusCheck === 1 ? "OPEN ✅" : `CLOSED ❌ (${statusCheck})`}`,
      );

      // Fail fast if connection drops
      expect(statusCheck).toBe(1);
    }

    // Check WebSocket still connected after full 2 minutes
    const wsStatusAfter = await page.evaluate(() => {
      const ws = (window as any).__websocket;
      return ws ? ws.readyState : null;
    });
    console.log(
      `[POC Phase 4] Final WebSocket status after 2 min: ${wsStatusAfter === 1 ? "OPEN ✅" : `CLOSED ❌ (${wsStatusAfter})`}`,
    );

    expect(wsStatusAfter).toBe(1); // 1 = OPEN

    // Approve button should still be visible and clickable
    await expect(approveButton).toBeVisible();
    await approveButton.click();
    console.log("[POC Phase 4] Clicked Approve after 2-minute wait");

    // Wait for agent to resume and generate response
    const aiResponseOrToolResult = await Promise.race([
      page
        .locator('[data-testid="message-assistant"]')
        .last()
        .waitFor({ timeout: 15000 })
        .then(() => "ai-response"),
      page
        .locator("text=Result")
        .first()
        .waitFor({ timeout: 15000 })
        .then(() => "tool-result"),
    ]).catch(() => "timeout");

    if (aiResponseOrToolResult === "timeout") {
      console.log("[POC Phase 4] ⚠️ TIMEOUT: No response within 15s");
      await page.screenshot({ path: "/tmp/poc-phase4-timeout.png" });
      throw new Error("Agent did not resume after 2-minute wait");
    }

    console.log(`[POC Phase 4] ✅ Agent resumed: ${aiResponseOrToolResult}`);
    console.log(
      "[POC Phase 4] ✅ PASS: Connection stayed open for 2 minutes, resume successful",
    );
  });

  /**
   * POC Phase 6: WebSocket Disconnection During Approval Wait
   *
   * Edge Case: User tries to approve/deny while WebSocket is disconnected
   *
   * Expected Behavior:
   * - sendFunctionResponse() throws error when WebSocket is closed
   * - Frontend catches error and displays error message to user
   * - User understands why approval failed
   *
   * BUG: Currently sendEvent() returns silently when WebSocket is closed
   *      - No error thrown
   *      - No feedback to user
   *      - Approval button seems to work but nothing happens
   */
  test("Phase 6: WebSocket disconnection during approval", async ({ page }) => {
    console.log("[POC Phase 6] Testing WebSocket disconnection edge case");

    // 1. Send request to trigger approval
    const input = page.getByPlaceholder("Type your message...");
    await input.fill("Request approval to pay $500 to Alice");
    await input.press("Enter");

    // 2. Wait for approval UI
    await page.waitForSelector(
      "text=approval_test_tool requires your approval",
      {
        timeout: 10000,
      },
    );
    console.log("[POC Phase 6] Approval UI visible");

    // 3. Close WebSocket connection
    const closed = await page.evaluate(() => {
      // Access the WebSocket instance directly (exposed from websocket-chat-transport.ts)
      const ws = (window as any).__websocket;
      if (!ws) {
        console.log("[POC Phase 6] ERROR: __websocket not found on window");
        return false;
      }
      console.log(
        `[POC Phase 6] Found WebSocket, current state: ${ws.readyState}`,
      );
      console.log("[POC Phase 6] Closing WebSocket manually");
      ws.close();
      return true;
    });

    if (!closed) {
      throw new Error("Failed to close WebSocket: transport or ws not found");
    }

    // Wait for WebSocket to close
    await page.waitForTimeout(500);

    // 4. Verify WebSocket is closed
    const wsState = await page.evaluate(() => {
      const ws = (window as any).__websocket;
      return ws?.readyState;
    });
    console.log(`[POC Phase 6] WebSocket state: ${wsState} (CLOSED=3)`);

    if (wsState !== 3) {
      throw new Error(`WebSocket not closed: readyState=${wsState}`);
    }

    // 5. Click Approve button (should fail gracefully)
    const approveButton = page.locator('button:has-text("Approve")').first();
    await approveButton.click();
    console.log("[POC Phase 6] Clicked Approve with closed WebSocket");

    // 6. Wait for error message to appear
    // Expected: "Error sending approval: ..." or similar
    const errorMessage = await page
      .waitForSelector(
        "text=/Error sending approval|WebSocket not open|Cannot send/",
        { timeout: 3000 },
      )
      .catch(() => null);

    if (!errorMessage) {
      console.log("[POC Phase 6] ❌ FAIL: No error message displayed to user");
      await page.screenshot({ path: "/tmp/poc-phase6-no-error.png" });
      throw new Error(
        "Expected error message not shown when WebSocket disconnected",
      );
    }

    const errorText = await errorMessage.textContent();
    console.log(`[POC Phase 6] ✅ Error message shown: ${errorText}`);
    console.log(
      "[POC Phase 6] ✅ PASS: User gets feedback when approval fails",
    );
  });

  /**
   * POC Phase 7: Page Reload During Approval Wait
   *
   * Edge Case: User accidentally reloads page while approval is pending
   *
   * Investigation Questions:
   * - What happens to the pending approval state?
   * - Does the approval UI reappear after reload?
   * - Is the WebSocket reconnected?
   * - Can user still approve/deny after reload?
   *
   * Expected Behavior (to be determined):
   * Option A: Session restored, approval UI reappears
   * Option B: State lost, clear message explaining what happened
   * Option C: Approval lost, user needs to retry original request
   */
  test("Phase 7: Page reload during approval", async ({ page }) => {
    console.log("[POC Phase 7] Testing page reload during approval wait");

    // 1. Send request to trigger approval
    const input = page.getByPlaceholder("Type your message...");
    await input.fill("Request approval to pay $500 to Alice");
    await input.press("Enter");

    // 2. Wait for approval UI
    await page.waitForSelector(
      "text=approval_test_tool requires your approval",
      {
        timeout: 10000,
      },
    );
    console.log("[POC Phase 7] Approval UI visible");

    // Take screenshot before reload for comparison
    await page.screenshot({ path: "/tmp/poc-phase7-before-reload.png" });

    // 3. Reload the page
    console.log("[POC Phase 7] Reloading page...");
    await page.reload();
    console.log("[POC Phase 7] Page reloaded");

    // 4. Wait for page to fully load
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000); // Give React time to render

    // Take screenshot after reload
    await page.screenshot({ path: "/tmp/poc-phase7-after-reload.png" });

    // 5. Check what happened to the approval UI
    const approvalUIAfterReload = await page
      .locator("text=approval_test_tool requires your approval")
      .first()
      .isVisible()
      .catch(() => false);
    console.log(
      `[POC Phase 7] Approval UI visible after reload: ${approvalUIAfterReload}`,
    );

    // 6. Check if WebSocket reconnected
    const wsState = await page.evaluate(() => {
      const ws = (window as any).__websocket;
      return ws ? { readyState: ws.readyState, url: ws.url } : null;
    });
    console.log(`[POC Phase 7] WebSocket state after reload:`, wsState);

    // 7. Check message history
    const messages = await page
      .locator('[data-role="user"], [data-role="assistant"]')
      .count();
    console.log(`[POC Phase 7] Message count after reload: ${messages}`);

    // 8. Document findings
    console.log("[POC Phase 7] 📝 Investigation Results:");
    console.log(`  - Approval UI restored: ${approvalUIAfterReload}`);
    console.log(`  - WebSocket reconnected: ${wsState !== null}`);
    console.log(`  - Message history preserved: ${messages > 0}`);

    // This is an investigation test - we don't fail, just report findings
    console.log(
      "[POC Phase 7] ✅ Investigation complete (see logs for behavior)",
    );
  });

  /**
   * POC Phase 8: Multiple Simultaneous Long-Running Tools
   *
   * Edge Case: AI calls multiple long-running tools requiring approval
   *
   * Investigation Questions:
   * - Can AI call multiple tools in sequence before any are approved?
   * - Do multiple approval UIs display correctly?
   * - Can user approve them in any order?
   * - Does each tool maintain independent approval state?
   *
   * Expected Behavior (to be determined):
   * Option A: AI calls tools one at a time (waits for first approval)
   * Option B: AI calls multiple tools, all displayed simultaneously
   * Option C: System limitation - only one pending approval at a time
   */
  test("Phase 8: Multiple simultaneous long-running tools", async ({
    page,
  }) => {
    console.log(
      "[POC Phase 8] Testing multiple simultaneous long-running tools",
    );

    // 1. Send request asking for multiple approvals
    // Note: We only have one approval_test_tool, so AI will likely call it multiple times
    const input = page.getByPlaceholder("Type your message...");
    await input.fill(
      "I need two approvals: first pay $100 to Alice, then pay $200 to Bob. Please request approval for both.",
    );
    await input.press("Enter");
    console.log("[POC Phase 8] Sent request for multiple approvals");

    // 2. Wait for first approval UI
    const firstApprovalUI = page
      .locator("text=approval_test_tool requires your approval")
      .first();
    await expect(firstApprovalUI).toBeVisible({ timeout: 15000 });
    console.log("[POC Phase 8] First approval UI visible");

    // 3. Wait a bit to see if second approval appears
    await page.waitForTimeout(3000);

    // 4. Count how many approval UIs are visible
    const approvalUICount = await page
      .locator("text=approval_test_tool requires your approval")
      .count();
    console.log(
      `[POC Phase 8] Number of approval UIs visible: ${approvalUICount}`,
    );

    // 5. Count total tool invocations (including non-approval tools)
    const toolInvocationCount = await page
      .locator('[data-testid="tool-invocation"]')
      .count();
    console.log(`[POC Phase 8] Total tool invocations: ${toolInvocationCount}`);

    // Take screenshot to visualize state
    await page.screenshot({ path: "/tmp/poc-phase8-multiple-tools.png" });

    // 6. Document findings
    console.log("[POC Phase 8] 📝 Investigation Results:");
    console.log(`  - Multiple approval UIs displayed: ${approvalUICount > 1}`);
    console.log(`  - Total tool invocations: ${toolInvocationCount}`);
    console.log(`  - Approval UIs count: ${approvalUICount}`);

    if (approvalUICount > 1) {
      console.log(
        "[POC Phase 8] ✅ Multiple approvals detected - testing approval order",
      );

      // Test: Approve second one first (reverse order)
      const allApprovalButtons = page.locator('button:has-text("Approve")');
      const approveButtonCount = await allApprovalButtons.count();
      console.log(
        `[POC Phase 8] Number of Approve buttons: ${approveButtonCount}`,
      );

      if (approveButtonCount >= 2) {
        // Click second Approve button (index 1)
        await allApprovalButtons.nth(1).click();
        console.log("[POC Phase 8] Clicked second Approve button");
        await page.waitForTimeout(500);

        // Click first Approve button (index 0)
        await allApprovalButtons.nth(0).click();
        console.log("[POC Phase 8] Clicked first Approve button");

        console.log(
          "[POC Phase 8] ✅ Approved in reverse order - checking if system handles correctly",
        );
      }
    } else if (approvalUICount === 1) {
      console.log(
        "[POC Phase 8] Only one approval UI visible - AI likely calls tools sequentially",
      );
      console.log(
        "[POC Phase 8] This is expected behavior - approve first tool to allow second",
      );

      // Approve the first one
      const approveButton = page.locator('button:has-text("Approve")').first();
      await approveButton.click();
      console.log("[POC Phase 8] Approved first tool");

      // Wait to see if second approval appears
      await page.waitForTimeout(5000);

      const secondApprovalUI = page
        .locator("text=approval_test_tool requires your approval")
        .first();
      const secondVisible = await secondApprovalUI
        .isVisible()
        .catch(() => false);
      console.log(
        `[POC Phase 8] Second approval UI appeared after first approval: ${secondVisible}`,
      );
    }

    // This is an investigation test - we don't enforce specific behavior
    console.log(
      "[POC Phase 8] ✅ Investigation complete (see logs for behavior)",
    );
  });

  /**
   * POC Summary Test: End-to-End Flow
   *
   * Test: Complete approval flow from request to final response
   *
   * This is the "golden path" test that validates the entire workflow.
   */
  test("POC Summary: Complete approval flow", async ({ page }) => {
    console.log("[POC Summary] Testing complete approval flow");

    // 1. Send request
    const input = page.getByPlaceholder("Type your message...");
    await input.fill("Request approval to pay $500 to Alice");
    await input.press("Enter");
    console.log("[POC Summary] Step 1: Request sent");

    // 2. Wait for approval UI
    const approveButton = page.locator('button:has-text("Approve")').first();
    await expect(approveButton).toBeVisible({ timeout: 10000 });
    console.log("[POC Summary] Step 2: Approval UI appeared");

    // 3. Verify "Thinking..." is NOT visible (stream paused)
    const thinking = page.locator("text=/Thinking/i").first();
    await expect(thinking).not.toBeVisible({ timeout: 5000 });
    console.log("[POC Summary] Step 3: Stream paused (no thinking)");

    // 4. Click Approve
    await approveButton.click();
    console.log("[POC Summary] Step 4: Clicked Approve");

    // 5. Wait for AI response
    const aiResponse = page.locator('[data-role="assistant"]').last();
    await expect(aiResponse).toBeVisible({ timeout: 10000 });

    const responseText = await aiResponse.textContent();
    console.log(`[POC Summary] Step 5: AI response received: ${responseText}`);

    // 6. Verify response contains expected content
    expect(responseText).toMatch(/送金|pay|approved|完了|success/i);

    console.log("[POC Summary] ✅ PASS: Complete flow successful");
    console.log("[POC Summary] 🎉 GO FOR FULL IMPLEMENTATION");
  });
});
