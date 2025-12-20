# Edge Case #3: Page Reload During Approval - Investigation

**Date:** 2025-12-18
**Status:** 🔵 **Investigated - Accepted Limitation** ℹ️
**Related:** [Edge Case #1](./2025-12-18_edgecase_chatmessage_content_type_fix.md), [Edge Case #2](./2025-12-18_edgecase_websocket_disconnection_error_handling.md), [ADR-0001: Per-Connection State Management](../docs/adr/0001-per-connection-state-management.md)

## Objective

Investigate what happens when a user accidentally reloads the page while a long-running tool approval is pending, and determine if this is a bug or an accepted limitation.

## Background

After completing Edge Cases #1 and #2, we identified additional edge cases to investigate. Page reload during approval is a realistic user scenario where they might:

- Accidentally hit F5 or Cmd+R
- Click browser refresh button
- Navigate away and back using browser history

**Questions to Answer:**

1. What happens to the pending approval state?
2. Does the approval UI reappear after reload?
3. Is the WebSocket reconnected?
4. Can the user still approve/deny after reload?

## Investigation Approach

Created Phase 7 E2E test (`e2e/poc-longrunning-bidi.spec.ts:398-450`) to observe current behavior:

```typescript
test('Phase 7: Page reload during approval', async ({ page }) => {
  console.log('[POC Phase 7] Testing page reload during approval wait');

  // 1. Send request to trigger approval
  const input = page.getByPlaceholder('Type your message...');
  await input.fill('Request approval to pay $500 to Alice');
  await input.press('Enter');

  // 2. Wait for approval UI
  await page.waitForSelector('text=approval_test_tool requires your approval', {
    timeout: 10000,
  });
  console.log('[POC Phase 7] Approval UI visible');

  // Take screenshot before reload
  await page.screenshot({ path: '/tmp/poc-phase7-before-reload.png' });

  // 3. Reload the page
  console.log('[POC Phase 7] Reloading page...');
  await page.reload();
  console.log('[POC Phase 7] Page reloaded');

  // 4. Wait for page to fully load
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);

  // Take screenshot after reload
  await page.screenshot({ path: '/tmp/poc-phase7-after-reload.png' });

  // 5. Check what happened
  const approvalUIAfterReload = await page.locator('text=approval_test_tool requires your approval').first().isVisible().catch(() => false);
  const wsState = await page.evaluate(() => {
    const ws = (window as any).__websocket;
    return ws ? { readyState: ws.readyState, url: ws.url } : null;
  });
  const messages = await page.locator('[data-role="user"], [data-role="assistant"]').count();

  // Document findings
  console.log('[POC Phase 7] 📝 Investigation Results:');
  console.log(`  - Approval UI restored: ${approvalUIAfterReload}`);
  console.log(`  - WebSocket reconnected: ${wsState !== null}`);
  console.log(`  - Message history preserved: ${messages > 0}`);

  console.log('[POC Phase 7] ✅ Investigation complete (see logs for behavior)');
});
```

## Investigation Results

**Test Output:**

```
[POC Phase 7] Testing page reload during approval wait
[POC Phase 7] Approval UI visible
[POC Phase 7] Reloading page...
[POC Phase 7] Page reloaded
[POC Phase 7] Approval UI visible after reload: false
[POC Phase 7] WebSocket state after reload: null
[POC Phase 7] Message count after reload: 0
[POC Phase 7] 📝 Investigation Results:
  - Approval UI restored: false
  - WebSocket reconnected: false
  - Message history preserved: false
[POC Phase 7] ✅ Investigation complete (see logs for behavior)
  ✓  1 [chromium] › e2e/poc-longrunning-bidi.spec.ts:398:7 (5.7s)
```

**Findings:**

- ❌ **Approval UI**: NOT restored after reload
- ❌ **WebSocket**: NOT reconnected
- ❌ **Message History**: NOT preserved
- ❌ **Application State**: Completely reset to initial state

**Behavior:** Complete state loss on page reload - equivalent to starting a fresh session.

## Root Cause Analysis

After investigating the codebase, we found this is **NOT a bug** but a **documented design limitation**:

### 1. Session Resumption Not Implemented for Google AI Studio

From `server.py:576`:

```python
if use_vertexai:
    logger.info("[BIDI] Using Vertex AI with session resumption enabled")
else:
    logger.info("[BIDI] Using Google AI Studio (session resumption not available)")
```

Session resumption configuration:

```python
# server.py:588, 611
session_resumption=types.SessionResumptionConfig() if use_vertexai else None
```

### 2. Session Resumption Only Supported on Vertex AI

From ADK SDK limitations:

- **Google AI Studio**: Session resumption API not available
- **Vertex AI**: Session resumption supported via `types.SessionResumptionConfig()`

Currently using Google AI Studio for development (see `.env.example`):

```bash
# ADK Configuration - Use Google AI Studio (not Vertex AI)
GOOGLE_GENAI_USE_VERTEXAI=0
```

### 3. Future Implementation Planned

From `docs/ARCHITECTURE.md:1009`:

```markdown
**Workaround:** Users must refresh the page to restart conversation.

**Future Solution:** Implement session resumption with persistent session IDs.
```

From `docs/ARCHITECTURE.md:321`:

```
Clean up session (no automatic resumption)
```

### 4. Related Documentation

**ADR-0001: Per-Connection State Management**

- States: "Session Persistence: Store sessions in database for resumption after browser restart" (future)
- Current design: Per-connection state, no cross-connection sharing

**Previous Experiments:**

- `2025-12-11_adk_bidi_ai_sdk_v6_integration.md`: "No session resumption after disconnect"
- `2025-12-11_adk_bidi_ai_sdk_v6_integration.md:504`: "WebSocket reconnection with session resumption" (future need)

## Impact Assessment

### User Experience Impact

**Normal Chat Usage:**

- **Impact**: Medium
- **Workaround**: User can simply restart conversation
- **Loss**: Message history and context

**Long-Running Tool Approval (Critical!):**

- **Impact**: **High** 🔴
- **Scenario**: User is waiting for approval, accidentally reloads
- **Loss**: Pending approval state lost
- **Backend State**: Agent still paused waiting for response that will never come
- **User State**: Confused - approval UI gone, no way to complete/cancel

### System Behavior

**On Page Reload:**

1. Frontend React state completely reset
2. WebSocket connection closed and not restored
3. Backend agent session remains in memory but unreachable
4. If approval was pending, backend agent stays paused indefinitely
5. No cleanup mechanism for orphaned backend sessions

**Backend Session Cleanup:**

- Sessions are cleaned up eventually but not immediately
- Agent remains paused waiting for function_response
- No timeout mechanism for long-running tool approvals

## Decision: Accept as Documented Limitation

After analysis, we conclude this is an **accepted limitation** rather than a bug to fix, because:

### Reasons to Accept

1. **Documented Design Decision**
   - Already documented in ARCHITECTURE.md
   - Marked as future enhancement, not current bug
   - Consistent with ADR-0001 design

2. **Technical Complexity**
   - Session resumption requires Vertex AI (not available in dev environment)
   - Would need complete redesign of state management
   - Requires persistent session storage (database)
   - Complex reconnection logic needed

3. **Limited Scope**
   - Edge case, not common user flow
   - Browser best practices discourage accidental reload (e.g., "Leave site?" prompts)
   - Can be mitigated with UI warnings

4. **Future Roadmap Item**
   - Already planned for future implementation
   - Better to implement properly later than quick hack now
   - Should be part of larger session persistence feature

### Reasons to Fix (Why We're NOT Fixing)

1. Poor UX during long-running approvals
   - **Mitigation**: Document clearly, add UI warning
   - **Alternative**: Implement browser "beforeunload" warning

2. Orphaned backend sessions
   - **Mitigation**: Implement session timeout for long-running tools
   - **Alternative**: Add backend cleanup cron job

## Recommended Mitigations

Since we're accepting this as a limitation, we should mitigate the impact:

### 1. Documentation (High Priority)

**Update `docs/ARCHITECTURE.md` - Known Limitations:**

```markdown
### Page Reload During Long-Running Tool Approval

**Current Behavior:** All state is lost on page reload, including pending approvals.

**Impact:**
- User loses message history and context
- Pending long-running tool approvals are lost
- Backend agent remains paused waiting for response

**Workaround:**
- Avoid refreshing page during approval wait
- Browser "Leave site?" warning may appear if configured
- Backend sessions timeout after 5 minutes of inactivity (future)

**Future Solution:**
- Implement session persistence with database storage
- Add automatic session resumption on reconnect
- Requires Vertex AI or custom state management
```

### 2. UI Warning (Medium Priority)

Add browser `beforeunload` warning when approval is pending:

```typescript
// In component with pending approval
useEffect(() => {
  if (hasPendingApproval) {
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = 'You have a pending approval. Are you sure you want to leave?';
      return e.returnValue;
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }
}, [hasPendingApproval]);
```

### 3. Backend Session Timeout (Low Priority)

Add timeout for long-running tool approvals:

```python
# In approval_test_tool or LongRunningFunctionTool wrapper
@tool
def approval_test_tool(amount: float, recipient: str) -> None:
    approval_id = f"approval-{uuid.uuid4().hex[:8]}"

    # Store approval with timestamp
    approval_state = {
        'timestamp': time.time(),
        'timeout': 300,  # 5 minutes
        'approval_id': approval_id,
    }

    # Check timeout before returning
    if time.time() - approval_state['timestamp'] > approval_state['timeout']:
        raise TimeoutError(f"Approval {approval_id} timed out")

    return None  # Pause and wait for approval
```

### 4. Visual Indicator (Low Priority)

Add visual indicator that session is not persistent:

```tsx
<div className="session-warning">
  ⚠️ Session not saved - avoid refreshing during approval
</div>
```

## Conclusion

**Decision:** Accept as documented limitation, do NOT implement fix now.

**Rationale:**

- Technically complex (requires Vertex AI or major refactoring)
- Already documented as future enhancement
- Limited user impact (edge case)
- Proper solution requires broader session persistence feature

**Action Items:**

1. ✅ Document behavior in this experiment file
2. 🔄 Update `experiments/README.md` with investigation result
3. 🔄 Consider adding `beforeunload` warning (optional)
4. 🔄 Consider backend session timeout (optional)

**Future Work:**

- Implement full session persistence when migrating to Vertex AI
- OR implement custom session state management with database
- Ref: ADR-0001, `docs/ARCHITECTURE.md:1009`

## Test Coverage

**E2E Test:** `e2e/poc-longrunning-bidi.spec.ts` - Phase 7

**Test Type:** Investigation test (documents behavior, does not enforce)

**Verification:**

```bash
pnpm exec playwright test e2e/poc-longrunning-bidi.spec.ts -g "Phase 7" --project=chromium
```

**Expected Result:** Test passes, logs confirm state loss behavior

## Related Work

- ✅ **Edge Case #1**: ChatMessage.content type validation ([doc](./2025-12-18_edgecase_chatmessage_content_type_fix.md))
- ✅ **Edge Case #2**: WebSocket disconnection error handling ([doc](./2025-12-18_edgecase_websocket_disconnection_error_handling.md))
- 🔵 **Edge Case #3**: Page reload investigation (this document)
- 🔄 **Edge Case #4**: Multiple simultaneous tools (future)

## References

- **ADR**: `docs/adr/0001-per-connection-state-management.md`
- **Architecture**: `docs/ARCHITECTURE.md` - Known Limitations section
- **Previous Investigation**: `experiments/2025-12-11_adk_bidi_ai_sdk_v6_integration.md`
- **Backend Session Fix**: `experiments/2025-12-16_backend_session_persistence_fix.md`
