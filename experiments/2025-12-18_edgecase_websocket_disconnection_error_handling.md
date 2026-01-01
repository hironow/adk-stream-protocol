# Edge Case: WebSocket Disconnection Error Handling

**Date:** 2025-12-18
**Status:** 🟢 Complete - TDD Success ✅
**Related:** [Edge Case #1: ChatMessage.content Type Fix](./2025-12-18_edgecase_chatmessage_content_type_fix.md), [POC Phase 5: Generic Approval UI](./2025-12-18_poc_phase5_generic_approval_success.md)

## Objective

Fix user experience issue where clicking Approve/Deny buttons after WebSocket disconnection provides no feedback to the user, leaving them wondering if the action succeeded.

## Background

During POC Phase 5 development, we identified an edge case:

- **Scenario**: User triggers a long-running tool (e.g., approval_test_tool)
- **Edge Case**: WebSocket connection drops before user clicks Approve/Deny
- **Current Behavior**: Button click silently fails with no user feedback
- **Root Cause**: `sendEvent()` in `websocket-chat-transport.ts` returns silently instead of throwing error

```typescript
// Before (lib/websocket-chat-transport.ts:224-226)
private sendEvent(event: ClientToServerEvent): void {
  if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
    console.warn("[WS Transport] Cannot send event, WebSocket not open");
    return;  // ← Silently returns, no error thrown!
  }
  // ...
}
```

## Expected Behavior

When WebSocket is disconnected and user tries to approve/deny:

1. ❌ **Before**: Button click does nothing, user confused
2. ✅ **After**: Error message displayed: "Error sending approval: WebSocket not open - cannot send event"

## TDD Approach

### RED Phase: Write Failing E2E Test

Created `e2e/poc-longrunning-bidi.spec.ts` - Phase 6 test (lines 313-384):

```typescript
test('Phase 6: WebSocket disconnection during approval', async ({ page }) => {
  console.log('[POC Phase 6] Testing WebSocket disconnection edge case');

  // 1. Send request to trigger approval
  const input = page.getByPlaceholder('Type your message...');
  await input.fill('Request approval to pay $500 to Alice');
  await input.press('Enter');

  // 2. Wait for approval UI
  await page.waitForSelector('text=approval_test_tool requires your approval', {
    timeout: 10000,
  });
  console.log('[POC Phase 6] Approval UI visible');

  // 3. Close WebSocket connection manually
  const closed = await page.evaluate(() => {
    const ws = (window as any).__websocket;
    if (!ws) {
      console.log('[POC Phase 6] ERROR: __websocket not found on window');
      return false;
    }
    console.log(`[POC Phase 6] Found WebSocket, current state: ${ws.readyState}`);
    console.log('[POC Phase 6] Closing WebSocket manually');
    ws.close();
    return true;
  });

  if (!closed) {
    throw new Error('Failed to close WebSocket: transport or ws not found');
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

  // 5. Click Approve button (should fail gracefully with error message)
  const approveButton = page.locator('button:has-text("Approve")').first();
  await approveButton.click();
  console.log('[POC Phase 6] Clicked Approve with closed WebSocket');

  // 6. Wait for error message to appear
  const errorMessage = await page.waitForSelector(
    'text=/Error sending approval|WebSocket not open|Cannot send/',
    { timeout: 3000 }
  ).catch(() => null);

  if (!errorMessage) {
    console.log('[POC Phase 6] ❌ FAIL: No error message displayed to user');
    await page.screenshot({ path: '/tmp/poc-phase6-no-error.png' });
    throw new Error('Expected error message not shown when WebSocket disconnected');
  }

  const errorText = await errorMessage.textContent();
  console.log(`[POC Phase 6] ✅ Error message shown: ${errorText}`);
  console.log('[POC Phase 6] ✅ PASS: User gets feedback when approval fails');
});
```

**RED Test Result** (First run):

```
[Browser Console] [WS Transport] Cannot send event, WebSocket not open
[POC Phase 6] ❌ FAIL: No error message displayed to user
Error: Expected error message not shown when WebSocket disconnected
```

✅ Test fails for the **correct reason** - proves the bug exists!

### GREEN Phase: Implement Fix

#### Change 1: Make `sendEvent()` throw error

**File**: `lib/websocket-chat-transport.ts:224-228`

```typescript
// After - throw error instead of returning silently
private sendEvent(event: ClientToServerEvent): void {
  if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
    const error = new Error("WebSocket not open - cannot send event");
    console.error("[WS Transport] Cannot send event, WebSocket not open");
    throw error;  // ← Now throws error!
  }
  // ...
}
```

#### Change 2: UI Error Handling (Already in Place!)

POC Phase 5 already implemented complete error handling in `components/tool-invocation.tsx`:

**Error State** (line 47):

```typescript
const [approvalError, setApprovalError] = useState<string | null>(null);
```

**Try-Catch Block** (lines 97-124):

```typescript
try {
  console.info(
    `[LongRunningTool] User ${approved ? "approved" : "denied"} ${toolName}, sending function_response`,
  );

  websocketTransport?.sendFunctionResponse(
    toolInvocation.toolCallId,
    toolName,
    {
      approved,
      user_message: approved
        ? `User approved ${toolName} execution`
        : `User denied ${toolName} execution`,
      timestamp: new Date().toISOString(),
    },
  );

  setApprovalSent(true);
  setApprovalError(null);
} catch (error) {
  const errorMessage =
    error instanceof Error ? error.message : "Unknown error";
  console.error(
    `[LongRunningTool] Failed to send function_response: ${errorMessage}`,
  );
  setApprovalError(errorMessage);  // ← Catches and stores error!
}
```

**Error Display UI** (lines 417-429):

```typescript
{/* Error message if WebSocket send fails */}
{approvalError && (
  <div
    style={{
      background: "#7f1d1d",
      padding: "0.5rem",
      borderRadius: "4px",
      fontSize: "0.75rem",
      color: "#fca5a5",
      marginBottom: "0.75rem",
    }}
  >
    Error sending approval: {approvalError}  {/* ← Displays to user! */}
  </div>
)}
```

**GREEN Test Result** (After fix):

```
[Browser Console] [WS Transport] Cannot send event, WebSocket not open
[Browser Console] [LongRunningTool] Failed to send function_response: WebSocket not open - cannot send event
[POC Phase 6] ✅ Error message shown: Error sending approval: WebSocket not open - cannot send event
[POC Phase 6] ✅ PASS: User gets feedback when approval fails
  ✓  1 [chromium] › e2e/poc-longrunning-bidi.spec.ts:313:7 › POC: LongRunningFunctionTool + BIDI › Phase 6: WebSocket disconnection during approval (4.0s)

  1 passed (6.7s)
```

✅ Test passes! Error is properly thrown, caught, and displayed to user!

## Changes Made

| File | Lines | Change |
|------|-------|--------|
| `lib/websocket-chat-transport.ts` | 224-228 | Changed `sendEvent()` to throw error instead of returning silently |
| `e2e/poc-longrunning-bidi.spec.ts` | 313-384 | Added Phase 6 E2E test for WebSocket disconnection edge case |
| `components/tool-invocation.tsx` | N/A | No changes needed - error handling already complete from POC Phase 5! |

## Test Coverage

**E2E Test**: `e2e/poc-longrunning-bidi.spec.ts` - Phase 6

**Test Scenarios**:

1. ✅ Trigger approval_test_tool
2. ✅ Wait for approval UI to appear
3. ✅ Manually close WebSocket connection
4. ✅ Verify WebSocket state is CLOSED (readyState=3)
5. ✅ Click Approve button
6. ✅ Verify error message displayed to user

## Impact Assessment

**User Experience**:

- **Before**: Silent failure, user confused and may retry indefinitely
- **After**: Clear error message explaining what happened

**Error Messages**:

- Error text: "Error sending approval: WebSocket not open - cannot send event"
- Visual feedback: Red background (#7f1d1d) with pink text (#fca5a5)

**Related Edge Cases**:

- ✅ Network timeout during long-running approval (Phase 4 - connection keep-alive)
- ✅ WebSocket disconnection before approval (Phase 6 - this fix)
- 🔄 Page reload before approval (future consideration)
- 🔄 Multiple tools running simultaneously (future consideration)

## Lessons Learned

1. **POC Phase 5 Infrastructure Paid Off**: Error handling UI was already complete!
2. **TDD RED→GREEN Worked Perfectly**: Test-first approach caught the bug immediately
3. **Silent Failures Are User Hostile**: Always throw errors and provide feedback
4. **E2E Tests Reveal Real UX Issues**: This edge case was only discoverable through E2E testing

## Verification

```bash
# Run Edge Case #2 E2E test
pnpm exec playwright test e2e/poc-longrunning-bidi.spec.ts -g "Phase 6" --project=chromium
```

**Expected Result**: 1 passed (test confirms error message is shown)

## Next Steps

- ✅ Edge Case #1: ChatMessage.content type validation fixed
- ✅ Edge Case #2: WebSocket disconnection error handling fixed
- 🔄 Edge Case #3: Consider page reload before approval
- 🔄 Edge Case #4: Consider multiple simultaneous long-running tools
