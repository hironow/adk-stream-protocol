# Backend Session Persistence Fix for E2E Tests

**Date**: 2025-12-16
**Objective**: Fix E2E test isolation by clearing backend session state
**Status**: 🔴 Blocked - `/clear-sessions` endpoint implementation issue discovered

## Background

After implementing the frontend delegate fix and adding E2E tests, we discovered that:
- ✅ SSE Mode E2E Tests: Initially 3/3 passing
- ❌ BIDI Mode E2E Tests: 0/3 failing - conversation history persistence
- ❌ Mode Switching Test: 0/1 failing - same issue

The `clearHistory()` helper only cleared frontend React state, not backend sessions.

## Root Cause Investigation

### Phase 1: Evidence Collection

**Backend Session Management** (`adk_compat.py:54-74`):
- **SSE mode**: `session_id = f"session_{user_id}_{app_name}"`
  - Same session ID reused across all requests from the same user/app
  - Sessions stored in global `_sessions` dictionary
  - **Never cleared between tests!**

- **BIDI mode**: `session_id = f"session_{user_id}_{connection_signature}"`
  - Each WebSocket connection gets unique UUID
  - New session per connection

**Frontend Clear History** (`app/page.tsx:132-153`):
```typescript
<button onClick={() => { setMessages([]) }}>Clear History</button>
```
- Only calls `setMessages([])` - clears React state only
- Does NOT clear backend session or conversation history

### Phase 2: Hypothesis

Backend session history persists across E2E tests, causing conversation context leakage:

```
Test 1: "Change to track 1" → Backend: [msg1, response1]
clearHistory() → Frontend: [], Backend: [msg1, response1]  ← SESSION PERSISTS!
Test 2: "Change to track 0" → Backend: [msg1, response1, msg2, response2]
clearHistory() → Frontend: [], Backend: [msg1, response1, msg2, response2]
Test 3: "Change to track 1" → AI sees full history, responds "BGM is already set to track 1"
```

## Solution Implementation

### Step 1: Add Backend API Endpoint

**File**: `server.py:168-179`

```python
@app.post("/clear-sessions")
async def clear_backend_sessions():
    """
    Clear all backend sessions (for testing/development)

    This endpoint clears the global _sessions dictionary, resetting
    all conversation history and session state. Useful for E2E tests
    that need clean state between test runs.
    """
    logger.info("[/clear-sessions] Clearing all backend sessions")
    clear_sessions()
    return {"status": "success", "message": "All sessions cleared"}
```

**Import added** (`server.py:43`):
```python
from adk_compat import (
    clear_sessions,  # ← Added
    get_or_create_session,
    sync_conversation_history_to_session,
)
```

### Step 2: Update Frontend Helper (Initial Attempt)

**File**: `e2e/helpers.ts:157-177` (First version with `page.evaluate`)

```typescript
export async function clearHistory(page: Page) {
  // Clear frontend UI state
  const clearButton = page.getByRole("button", { name: "Clear History" });
  if (await clearButton.count() > 0) {
    await clearButton.click();
    await page.waitForTimeout(500);
  }

  // Clear backend sessions - FAILED: page.evaluate has security restrictions
  try {
    await page.evaluate(async () => {
      await fetch("http://localhost:8000/clear-sessions", {
        method: "POST",
      });
    });
  } catch (error) {
    console.warn("Failed to clear backend sessions:", error);
  }

  await page.waitForTimeout(500);
}
```

**Issue**: `page.evaluate()` runs in browser context with security restrictions

### Step 3: Update Frontend Helper (Revised)

**File**: `e2e/helpers.ts:157-177` (Updated to use `page.request`)

```typescript
export async function clearHistory(page: Page) {
  // Clear frontend UI state
  const clearButton = page.getByRole("button", { name: "Clear History" });
  if (await clearButton.count() > 0) {
    await clearButton.click();
    await page.waitForTimeout(500);
  }

  // Clear backend sessions using Playwright request API
  try {
    await page.request.post("http://localhost:8000/clear-sessions");
  } catch (error) {
    console.warn("Failed to clear backend sessions:", error);
  }

  await page.waitForTimeout(500);
}
```

**Change**: Use `page.request.post()` instead of `page.evaluate()` to avoid browser security restrictions

## Test Results

### E2E Test Execution (2025-12-16 16:46 JST)

**Command**: `pnpm exec playwright test e2e/frontend-delegate-fix.spec.ts --reporter=list`

**Results**: 3 failed, 4 did not run
- ✘ SSE Mode test 1: "Approval Required" dialog never appeared (30s timeout)
- ✘ BIDI Mode test: Test timeout (3 minutes) trying to access message .nth(3)
- ✘ Mode Switching test: "Approval Required" dialog never appeared (30s timeout)

### Server Log Analysis

**Log File**: `logs/server_20251216_040548.log`

**Finding at 16:46:35**:
```
2025-12-16 16:46:38.681 | DEBUG | stream_protocol:convert_event:217 - [convert_event INPUT] type=Event, content=parts=[Part(
  text='The BGM is already set to track 1.',
  ...
```

**Analysis**:
- AI responded with **text** instead of calling the `change_bgm` tool
- Same symptom as original session persistence bug
- Indicates `/clear-sessions` was never called or didn't work

**Grep for `/clear-sessions` calls**: NONE FOUND in any server logs

## Critical Issue Discovered

### `/clear-sessions` Endpoint Hangs

**Test**: Direct curl request
```bash
$ curl -X POST http://localhost:8000/clear-sessions -H "Content-Type: application/json" --max-time 2
curl: (28) Operation timed out after 2002 milliseconds with 0 bytes received
```

**Symptoms**:
- Endpoint connects successfully
- Server receives request but never responds
- Request hangs indefinitely
- No log entry showing "[/clear-sessions] Clearing all backend sessions"

**Hypothesis**:
- The endpoint may be stuck waiting for something
- Could be event loop blocking issue
- `clear_sessions()` function itself is simple (just `_sessions.clear()`), shouldn't block

### Current State

**Files Modified (Staged for Commit)**:
1. `server.py` - Added `/clear-sessions` endpoint (HANGS)
2. `e2e/helpers.ts` - Updated `clearHistory()` to use `page.request.post()`

**E2E Test Status**: ❌ All tests failing
- SSE tests fail because AI sees persistent session history
- BIDI tests timeout due to persistent message history
- `/clear-sessions` endpoint exists but is not functional

## Next Steps Required

### Investigation Needed

1. **Debug endpoint hanging**:
   - Add logging before/after `clear_sessions()` call
   - Check if endpoint is actually registered
   - Verify FastAPI middleware isn't blocking
   - Check for asyncio event loop issues

2. **Alternative approaches to consider**:
   - Add session clear parameter to existing `/stream` endpoint
   - Clear sessions at test setup instead of between tests
   - Reset sessions using direct file modification in test fixtures
   - Use separate test database/session store

### Recommended Path Forward

**Option A**: Debug `/clear-sessions` hanging issue
- Add detailed logging
- Check FastAPI route registration
- Verify no middleware interference

**Option B**: Alternative implementation
- Add `?clear_session=true` parameter to `/stream` endpoint
- Clear session at start of each `/stream` request when parameter present
- Simpler, less risk of hanging

**Option C**: Test-level solution
- Clear sessions directly in test setup via Python test fixtures
- No HTTP endpoint needed
- Better test isolation

## Files Modified

1. `server.py`
   - Added `clear_sessions` import (line 43)
   - Added `/clear-sessions` endpoint (lines 168-179) - **HANGS**

2. `e2e/helpers.ts`
   - Enhanced `clearHistory()` to call backend endpoint (lines 157-177)
   - Changed from `page.evaluate()` to `page.request.post()`

3. `e2e/frontend-delegate-fix.spec.ts`
   - Removed `forceReload: true` from BIDI mode beforeEach
   - Removed `forceReload: true` from Mode Switching test

## References

- Related Fix: `experiments/2025-12-16_frontend_delegate_fix.md`
- Test Simplification: `experiments/2025-12-16_frontend_delegate_e2e_test_simplification.md`
- Test Plan: `agents/add_tests.md`
