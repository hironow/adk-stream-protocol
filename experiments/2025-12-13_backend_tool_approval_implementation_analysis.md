# Backend Tool Approval Implementation Analysis

**Date:** 2025-12-13
**Status:** 🔴 Critical Issues Found

---

## Current Implementation Review

### Components Analyzed

1. **FrontendToolDelegate** (`server.py:80-165`)
2. **StreamProtocolConverter** (`stream_protocol.py`)
3. **WebSocket Handler** (`server.py:1155-1174`)
4. **Unit Tests** (`tests/unit/test_tool_approval.py`)

---

## Critical Issues Discovered

### Issue 1: ❌ No Handling for `approved: false` (Rejection)

**Location:** `server.py:1155-1174` (WebSocket handler)

**Current Code:**
```python
elif event_type == "tool_result":
    result_data = event.get("data", {})
    tool_call_id = result_data.get("toolCallId")
    result = result_data.get("result")
    status = result_data.get("status", "approved")  # ← Reads status but doesn't use it!

    logger.info(f"[Tool] Received result for {tool_call_id} (status: {status})")

    # Phase 4: Resolve awaitable tool execution
    if tool_call_id and result is not None:
        frontend_delegate.resolve_tool_result(tool_call_id, result)  # ← Always resolves with result
```

**Problem:**
- `status` field is read but **NEVER USED**
- `frontend_delegate.resolve_tool_result()` is called **regardless of approved/rejected**
- Tool function returns the result even when user rejected (approved=false)

**Expected Behavior:**
When `approved: false`:
1. Backend should receive rejection
2. Future should be resolved with rejection info (or rejected with exception)
3. Tool function should return error result to AI
4. AI should know the tool was rejected

**Current Behavior:**
- Backend treats rejection same as approval
- Tool function receives `result` even if user said NO
- No distinction between approval and rejection

### Issue 2: ❌ `resolve_tool_result()` Has No Rejection Path

**Location:** `server.py:143-164` (FrontendToolDelegate)

**Current Code:**
```python
def resolve_tool_result(self, tool_call_id: str, result: dict[str, Any]) -> None:
    """Resolve a pending tool call with its result."""
    if tool_call_id in self._pending_calls:
        logger.info(f"[FrontendDelegate] Resolving tool_call_id={tool_call_id} with result: {result}")
        self._pending_calls[tool_call_id].set_result(result)  # ← Always set_result
        del self._pending_calls[tool_call_id]
```

**Problem:**
- Only has `.set_result()` (success path)
- No `.set_exception()` (rejection path)
- Cannot distinguish between approval and rejection

**Missing:**
```python
def reject_tool_call(self, tool_call_id: str, reason: str) -> None:
    """Reject a pending tool call (user denied permission)."""
    if tool_call_id in self._pending_calls:
        self._pending_calls[tool_call_id].set_exception(
            ToolRejectedError(f"User rejected tool: {reason}")
        )
        del self._pending_calls[tool_call_id]
```

### Issue 3: ❌ No Unit/Integration Tests for Rejection

**Location:** `tests/unit/test_tool_approval.py`

**Current Tests:**
- ✅ Test approval request event generation
- ✅ Test required fields in approval request
- ❌ **NO TEST for approved=true handling**
- ❌ **NO TEST for approved=false handling**
- ❌ **NO TEST for FrontendToolDelegate.resolve_tool_result()**
- ❌ **NO TEST for WebSocket tool_result event handling**

**What's Missing:**
1. Integration test: StreamProtocolConverter → tool-approval-request generation
2. Integration test: FrontendToolDelegate awaiting result (approval)
3. Integration test: FrontendToolDelegate awaiting result (rejection)
4. Integration test: WebSocket handler → resolve_tool_result (approval)
5. Integration test: WebSocket handler → reject_tool_call (rejection)
6. Error scenario tests (missing fields, invalid data)

### Issue 4: ❌ Frontend Sends Both Approval AND Output on Rejection

**Location:** `components/chat.tsx:161-185` (handleRejectTool)

**Current Frontend Code:**
```typescript
// Step 1: Send rejection
addToolApprovalResponse({
  approved: false,
  reason: "User denied permission",
});

// Step 2: Send error output
addToolOutput({
  output: {
    success: false,
    error: "User denied permission",
    denied: true,
  },
});
```

**Problem:**
- Frontend sends BOTH approval-responded AND output-available
- Backend receives tool-result with full output data
- But user said NO - tool was NEVER executed!

**What Actually Happened:**
1. User clicks [Deny]
2. Frontend sends approval-responded (approved=false) → Auto-submit (single tool)
3. Backend receives tool-result with `output: { success: false, denied: true }`
4. Backend resolves Future with this "fake output"
5. Tool function returns this to AI as if tool was executed

**Expected Behavior (Option A):**
- On rejection, send ONLY approval-responded
- Backend should resolve Future with rejection error
- Tool function should return error to AI

**Expected Behavior (Option B):**
- On rejection, send approval-responded + minimal error output
- Backend checks `approved: false` and creates proper error response
- Tool function returns rejection error to AI

---

## Impact Assessment

### 🔴 Severity: HIGH

**Current State:**
- User clicks [Deny] → Backend thinks tool succeeded
- No distinction between user approval and user rejection
- AI receives misleading results

**Security Impact:**
- User denies permission → Tool "result" is still processed
- Could leak that user denied (vs tool failing for other reasons)

**User Experience Impact:**
- User says NO → System behaves as if user said YES
- Confusing behavior: rejection treated as success

---

## Proposed Solution

### Solution A: Backend Checks `approved` Status (Recommended)

**Rationale:** Frontend already sends both approval-responded and output. Backend should interpret the data correctly.

**Changes:**

1. **WebSocket Handler:**
```python
elif event_type == "tool_result":
    result_data = event.get("data", {})
    tool_call_id = result_data.get("toolCallId")
    result = result_data.get("result")
    approved = result_data.get("approved")  # ← NEW: Check approved status

    if tool_call_id:
        if approved is False:  # ← NEW: Rejection path
            # User rejected the tool
            rejection_result = {
                "success": False,
                "error": "User denied permission",
                "denied": True,
            }
            frontend_delegate.resolve_tool_result(tool_call_id, rejection_result)
        elif result is not None:  # ← Approval path
            frontend_delegate.resolve_tool_result(tool_call_id, result)
```

2. **No FrontendToolDelegate changes needed** (keeps current API)

### Solution B: Add Rejection Method to FrontendToolDelegate

**Rationale:** Explicit rejection path, cleaner separation.

**Changes:**

1. **FrontendToolDelegate:**
```python
def reject_tool_call(self, tool_call_id: str, reason: str) -> None:
    """Reject a pending tool call."""
    if tool_call_id in self._pending_calls:
        rejection_result = {
            "success": False,
            "error": reason,
            "denied": True,
        }
        self._pending_calls[tool_call_id].set_result(rejection_result)
        del self._pending_calls[tool_call_id]
```

2. **WebSocket Handler:**
```python
elif event_type == "tool_result":
    result_data = event.get("data", {})
    tool_call_id = result_data.get("toolCallId")
    approved = result_data.get("approved")
    result = result_data.get("result")

    if tool_call_id:
        if approved is False:
            frontend_delegate.reject_tool_call(tool_call_id, "User denied permission")
        elif result is not None:
            frontend_delegate.resolve_tool_result(tool_call_id, result)
```

---

## Test Plan (TDD Approach)

### Phase 1: Integration Tests for Existing Flow

**File:** `tests/integration/test_backend_tool_approval.py`

1. **Test: StreamProtocolConverter generates tool-approval-request**
   - Given: Tool call for tool requiring approval
   - When: Convert ADK event to AI SDK v6 events
   - Then: tool-approval-request event generated with correct fields

2. **Test: FrontendToolDelegate awaits and resolves (approval)**
   - Given: Pending tool call
   - When: resolve_tool_result() called with success result
   - Then: Future resolves with result

3. **Test: Full flow - approval path**
   - Given: Tool requiring approval
   - When: Frontend sends approval + result
   - Then: Tool function returns success result

### Phase 2: Integration Tests for Rejection Flow

4. **Test: FrontendToolDelegate handles rejection**
   - Given: Pending tool call
   - When: reject_tool_call() called or approved=false
   - Then: Future resolves with rejection error

5. **Test: Full flow - rejection path**
   - Given: Tool requiring approval
   - When: Frontend sends approved=false
   - Then: Tool function returns rejection error

### Phase 3: Error Scenario Tests

6. **Test: Missing tool_call_id**
7. **Test: Missing result data**
8. **Test: Timeout (tool never responds)**

---

## Next Steps

1. ✅ Create `tests/integration/test_backend_tool_approval.py`
2. ✅ Write RED tests for current behavior (approval)
3. ✅ Write RED tests for missing behavior (rejection)
4. ✅ Implement Solution A or B (GREEN)
5. ✅ Refactor if needed (REFACTOR)
6. ✅ Document final behavior

---

## References

- Frontend: `components/chat.tsx:161-185` (handleRejectTool)
- Frontend: `lib/use-chat-integration.test.tsx` (14 tests confirming approved value doesn't affect timing)
- AI SDK v6: `node_modules/ai/dist/index.mjs:11103-11154` (addToolApprovalResponse, addToolOutput)
- Backend: `server.py:80-165` (FrontendToolDelegate)
- Backend: `server.py:1155-1174` (WebSocket tool_result handler)
- Protocol: `stream_protocol.py:497-510` (tool-approval-request generation)
