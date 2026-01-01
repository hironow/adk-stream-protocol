# Frontend-Backend Integration Gap Analysis

**Date:** 2025-12-13
**Status:** ✅ **GAP RESOLVED** - Backend now processes tool-use parts from frontend messages
**Implementation Date:** 2025-12-13

---

## Executive Summary

**Original Issue (Discovered 2025-12-13):**
After analyzing frontend tests (`lib/use-chat-integration.test.tsx` and `lib/transport-integration.test.ts`), we discovered that **the backend did NOT process tool-use parts from frontend messages**. This meant tool approval/rejection messages from the frontend were completely ignored.

**Resolution (Implemented 2025-12-13):**
✅ Created `ai_sdk_v6_compat.py` with type definitions and ADK conversion
✅ Implemented `process_tool_use_parts()` in `tool_delegate.py`
✅ Added `ToolCallState` enum for type safety
✅ All 111 tests passing including 5 integration tests for tool approval flow

See **Implementation Summary** section below for detailed changes.

## Verification (2025-12-13 Re-investigation)

**Initial Investigation Result:** ✅ **GAP CONFIRMED** - Backend message handler did not process tool-use parts.
**Final Status:** ✅ **GAP RESOLVED** - Implementation completed and all tests passing.

**Evidence from Code Review:**

1. **Frontend removed custom tool_result events** (`lib/websocket-chat-transport.ts:131-132, 283-285`):

   ```typescript
   // ToolResultEvent removed - use AI SDK v6's standard addToolApprovalResponse flow
   // sendToolResult() removed - use AI SDK v6's standard addToolApprovalResponse flow
   ```

2. **Frontend sends "message" events** (`lib/websocket-chat-transport.ts:424-432`):

   ```typescript
   // Send messages to backend using structured event format (P2-T2)
   const event: MessageEvent = {
     type: "message",
     version: "1.0",
     data: {
       messages: options.messages,  // ← Contains tool-use parts with updated state
     },
   };
   this.sendEvent(event);
   ```

3. **Frontend tool rejection flow** (`components/chat.tsx:161-185`):

   ```typescript
   // Step 1: Update message state via AI SDK v6
   addToolApprovalResponse({ approved: false, reason: "User denied permission" });
   addToolOutput({ output: { success: false, denied: true } });

   // Step 2: AI SDK v6 automatically calls sendMessages() when conditions met
   // → Sends "message" event with tool-use parts (state: "approval-responded")
   ```

4. **Backend message handler ignores ToolUsePart** (`server.py:970-1017`):

   ```python
   for part in last_msg.parts:
       if isinstance(part, FilePart):
           # ... handles file parts
       elif isinstance(part, TextPart):
           # ... handles text parts
       # ❌ NO HANDLING FOR ToolUsePart!
   ```

5. **Backend "tool_result" handler is unused** (`server.py:1069-1103`):
   - Handler exists and would work correctly
   - But frontend NEVER sends "tool_result" events (removed in refactor)
   - Handler is dead code from older design

**Conclusion:** The gap analysis was accurate. Backend needs to process ToolUsePart from "message" events.

---

## Frontend Behavior (Confirmed from Tests)

### Single Tool + approved=false Scenario (line 594-728)

```typescript
// Step 1: User clicks [Deny]
addToolApprovalResponse({ approved: false, reason: "User denied permission" });
// → AI SDK v6 updates tool-use part state to "approval-responded"
// → Auto-submit triggered IMMEDIATELY (single tool complete)
// → transport.sendMessages() called

// Step 2: Frontend calls addToolOutput (optional error output)
addToolOutput({ output: { success: false, denied: true } });
// → Local state update only (status guard prevents second auto-submit)
// → Backend does NOT receive this update
```

**Key Point:** Backend receives **only the approval-responded state** (approved=false), NOT the addToolOutput result.

### Multiple Tools + mixed approval/rejection (line 463-592)

```typescript
// Tool-1: addToolApprovalResponse({ approved: false }) → no auto-submit (other tools incomplete)
// Tool-2: addToolOutput() → all tools complete → auto-submit triggered
// → Backend receives messages with BOTH tool-use parts in single request
```

### Frontend sendMessages() Data Structure

```typescript
// Frontend sends "message" event type
{
  type: "message",
  version: "1.0",
  data: {
    messages: [
      {
        id: "msg-2",
        role: "assistant",
        parts: [
          {
            type: "tool-change_bgm",
            toolCallId: "call-1",
            toolName: "change_bgm",
            args: { track: 1 },
            state: "approval-responded",  // ← State changed by addToolApprovalResponse
            approval: {
              id: "approval-1",
              approved: false,              // ← Critical field!
              reason: "User denied permission"
            }
          }
        ]
      }
    ]
  }
}
```

---

## Backend Implementation Gaps

### Gap 1: Message Handler Doesn't Process Tool-Use Parts

**Location:** `server.py:970-1017`

**Current Implementation:**

```python
if event_type == "message":
    message_data = event.get("data", {})
    messages = message_data.get("messages", [])
    if messages:
        last_msg = ChatMessage(**messages[-1])

        for part in last_msg.parts:
            # Handle file parts (images)
            if isinstance(part, FilePart):
                # ... sends via send_realtime()

            # Handle text parts
            elif isinstance(part, TextPart):
                # ... sends via send_content()

            # ❌ ToolUsePart is NOT handled!
```

**Problem:**

- Only processes `TextPart` and `FilePart`
- **Ignores `ToolUsePart`** completely
- Frontend's approval-responded tool-use parts are silently dropped
- `frontend_delegate.reject_tool_call()` or `resolve_tool_result()` never called

### Gap 2: No Routing Logic for approval-responded Parts

**What's Missing:**

```python
# Missing logic in message handler:
from models import ToolUsePart  # Needs to be imported

for part in last_msg.parts:
    # ... existing FilePart, TextPart handling ...

    # NEW: Handle tool-use parts with approval-responded state
    elif isinstance(part, ToolUsePart) and part.state == "approval-responded":
        tool_call_id = part.toolCallId
        approved = part.approval.approved if part.approval else None

        if approved is False:
            # User rejected the tool
            reason = part.approval.reason or "User denied permission"
            frontend_delegate.reject_tool_call(tool_call_id, reason)
        elif approved is True:
            # User approved the tool - need to wait for output
            # (This case might need different handling)
            pass

    elif isinstance(part, ToolUsePart) and part.state == "output-available":
        # Tool execution completed on frontend/backend
        tool_call_id = part.toolCallId
        output = part.output
        frontend_delegate.resolve_tool_result(tool_call_id, output)
```

### Gap 3: "tool_result" Event Handler is Unused

**Location:** `server.py:1069-1102`

**Current Code:**

```python
elif event_type == "tool_result":
    result_data = event.get("data", {})
    tool_call_id = result_data.get("toolCallId")
    approved = result_data.get("approved")
    result = result_data.get("result")

    if approved is False:
        frontend_delegate.reject_tool_call(tool_call_id, reason)
    elif result is not None:
        frontend_delegate.resolve_tool_result(tool_call_id, result)
```

**Problem:**

- This event handler exists but **is NEVER triggered**
- Frontend sends "message" events, NOT "tool_result" events
- This handler appears to be dead code from an older design

---

## Integration Test Results

### ✅ Tests Passing (2/5)

1. **test_frontend_single_tool_approval_flow** - Verifies tool_delegate.resolve_tool_result()
2. **test_frontend_single_tool_rejection_flow** - Verifies tool_delegate.reject_tool_call()

### ❌ Tests Failing (2/5)

1. **test_stream_protocol_generates_tool_approval_request** - ADK Event structure issue
2. **test_stream_protocol_tracks_pending_approvals** - ADK Event structure issue

**Reason:** Test implementation needs correct ADK Event construction. These tests verify that StreamProtocolConverter generates tool-approval-request events correctly.

### ⏭️ Tests Skipped (1/5)

1. **test_frontend_multiple_tools_mixed_approval_rejection** - Marked as RED

**Reason:** Backend message handler doesn't process tool-use parts yet, so this test can't pass until Gap 1 and Gap 2 are fixed.

---

## Root Cause Analysis

### Why This Gap Exists

1. **Original Design vs Current Implementation:**
   - Original design may have used "tool_result" events directly
   - Current AI SDK v6 integration uses "message" events with structured tool-use parts
   - Message handler was updated for text/file parts but not tool-use parts

2. **Frontend Flow Changed:**
   - Frontend now uses `addToolApprovalResponse()` which updates message state
   - Then `sendAutomaticallyWhen` triggers `sendMessages()` with updated messages
   - Backend wasn't updated to process these structured tool-use parts

3. **Testing Gap:**
   - No end-to-end tests for approval/rejection flow
   - Unit tests only verified event generation, not message processing
   - Integration gap went undetected

---

## Proposed Solution

### Phase 1: Add ToolUsePart Processing to Message Handler

**File:** `server.py` (message event handler, line 970-1017)

**Changes:**

1. Import `ToolUsePart` from models
2. Add `elif isinstance(part, ToolUsePart):` branch
3. Check `part.state` and `part.approval.approved` fields
4. Route to appropriate delegate methods

### Phase 2: Handle Different Tool States

**States to Handle:**

1. **approval-responded** (approved=false):
   - Extract `tool_call_id`, `reason`
   - Call `frontend_delegate.reject_tool_call(tool_call_id, reason)`

2. **approval-responded** (approved=true):
   - Tool approved but no output yet
   - Might need to wait for output-available state
   - Or handle differently based on tool type

3. **output-available**:
   - Extract `tool_call_id`, `output`
   - Call `frontend_delegate.resolve_tool_result(tool_call_id, output)`

### Phase 3: Remove Dead Code

**File:** `server.py` (line 1069-1102)

- Remove "tool_result" event handler (unused)
- Or document why it exists if it's for future use

### Phase 4: Add Integration Tests

**File:** `tests/integration/test_stream_protocol_tool_approval.py`

- Un-skip `test_frontend_multiple_tools_mixed_approval_rejection`
- Fix ADK Event construction in stream protocol tests
- Add end-to-end test for full approval/rejection flow

---

## Test Coverage Analysis

### Current Coverage

**Frontend Tests (lib/):**

- ✅ 14 tests in `use-chat-integration.test.tsx`
- ✅ Covers single tool, multiple tools, approval, rejection scenarios
- ✅ Confirms approved value doesn't affect auto-submit timing

**Backend Unit Tests (tests/unit/):**

- ✅ 15 tests in `test_tool_approval.py`
- ✅ Covers event generation, approval request format
- ❌ **Does NOT test message processing**

**Backend Integration Tests (tests/integration/):**

- ✅ 6 tests in `test_backend_tool_approval.py` (tool_delegate)
- ⚠️ 5 tests in `test_stream_protocol_tool_approval.py` (2 failed, 1 skipped)
- ❌ **No end-to-end tests for message handler**

### Missing Test Coverage

1. **Message handler processing tool-use parts**
2. **Routing from message → delegate methods**
3. **Full flow: stream_protocol → frontend → message handler → tool_delegate**

---

## Implementation Plan (TDD Approach)

### Step 1: Create RED Test (message handler)

```python
# tests/integration/test_message_handler_tool_approval.py

@pytest.mark.asyncio
async def test_message_handler_processes_approval_responded_rejection():
    """
    Should process approval-responded (approved=false) from frontend messages.

    Flow:
    1. Frontend sends messages with approval-responded tool-use part
    2. Message handler extracts tool_call_id and approved=false
    3. Calls frontend_delegate.reject_tool_call()
    4. Tool execution completes with rejection error
    """
    # given: Pending tool call + frontend rejection message
    # when: Process message event
    # then: reject_tool_call() should be called
```

### Step 2: Implement GREEN (add ToolUsePart handling)

```python
# server.py: Add to message handler

from models import ToolUsePart  # Import at top

# In message handler (line 970-1017):
for part in last_msg.parts:
    if isinstance(part, FilePart):
        # ... existing code ...
    elif isinstance(part, TextPart):
        # ... existing code ...
    elif isinstance(part, ToolUsePart):
        # NEW: Handle tool-use parts
        if part.state == "approval-responded":
            tool_call_id = part.toolCallId
            if part.approval and part.approval.approved is False:
                reason = part.approval.reason or "User denied permission"
                frontend_delegate.reject_tool_call(tool_call_id, reason)
                logger.info(f"[Tool] Rejected tool {tool_call_id}: {reason}")
        elif part.state == "output-available":
            tool_call_id = part.toolCallId
            output = part.output
            frontend_delegate.resolve_tool_result(tool_call_id, output)
            logger.info(f"[Tool] Resolved tool {tool_call_id} with output")
```

### Step 3: REFACTOR (clean up, remove dead code)

- Remove unused "tool_result" event handler
- Add comprehensive logging
- Update documentation

---

## Impact Assessment

### 🔴 Severity: CRITICAL

**Current State:**

- User approval/rejection is completely ignored
- Tool execution never completes (Future never resolves)
- Frontend thinks tool was submitted, backend doesn't process it
- System appears broken from user perspective

**User Experience Impact:**

- User clicks [Approve] or [Deny] → Nothing happens
- Tool execution hangs indefinitely
- No error messages, just silence

**Security Impact:**

- User denies dangerous tool → Backend ignores denial
- Tool might execute anyway if there's a fallback path
- Permission system is non-functional

### Timeline for Fix

**Estimated Effort:** 2-4 hours

1. Add ToolUsePart handling: 1 hour
2. Write integration tests: 1 hour
3. Test and debug: 1-2 hours

**Priority:** **IMMEDIATE** - This blocks all tool approval functionality

---

## Next Steps

1. ✅ Document this gap (this file)
2. ✅ Create RED test for message handler
3. ✅ Implement ToolUsePart processing (GREEN)
4. ✅ Verify all tests pass
5. ⏭️ Remove dead code (REFACTOR) - server.py:1069-1102 tool_result handler
6. ⏭️ Update architecture documentation (if needed)

---

## Implementation Summary (2025-12-13)

**Status:** ✅ **GAP RESOLVED** - Backend now processes tool-use parts from frontend messages

### Completed Work

#### 1. Created AI SDK v6 Compatibility Layer

**File:** `ai_sdk_v6_compat.py` (NEW)

- Centralized AI SDK v6 type definitions with ADK conversion logic
- Principle: Keep types and conversions together to reduce breakage
- Moved `ChatMessage` with `to_adk_content()` method from server.py
- Added `ToolUsePart` and `ToolApproval` models matching AI SDK v6 spec
- Added `ToolCallState` enum for type-safe state management
- Removed deprecated `experimental_attachments` field

**Key Types:**

```python
class ToolCallState(str, Enum):
    CALL = "call"
    INPUT_STREAMING = "input-streaming"
    INPUT_AVAILABLE = "input-available"
    APPROVAL_REQUESTED = "approval-requested"
    APPROVAL_RESPONDED = "approval-responded"
    OUTPUT_AVAILABLE = "output-available"
    OUTPUT_ERROR = "output-error"
    OUTPUT_DENIED = "output-denied"

class ToolUsePart(BaseModel):
    type: str
    toolCallId: str
    toolName: str
    args: dict[str, Any] | None = None
    state: ToolCallState  # Using enum for type safety
    approval: ToolApproval | None = None
    output: dict[str, Any] | None = None
```

#### 2. Implemented Tool-Use Part Processing

**File:** `tool_delegate.py`

Added `process_tool_use_parts()` function (tool_delegate.py:143-182):

```python
def process_tool_use_parts(message: ChatMessage, delegate: FrontendToolDelegate) -> None:
    """
    Process tool-use parts from frontend messages and route to delegate.

    - approval-responded with approved=False → reject_tool_call()
    - output-available → resolve_tool_result()
    """
    for part in message.parts:
        if isinstance(part, ToolUsePart):
            if part.state == ToolCallState.APPROVAL_RESPONDED:
                if part.approval and part.approval.approved is False:
                    delegate.reject_tool_call(tool_call_id, reason)
            elif part.state == ToolCallState.OUTPUT_AVAILABLE:
                if part.output is not None:
                    delegate.resolve_tool_result(tool_call_id, part.output)
```

**Rationale:** Function moved to tool_delegate.py because it takes `delegate: FrontendToolDelegate` as argument, creating logical grouping.

#### 3. Integration Tests Completed

**File:** `tests/integration/test_stream_protocol_tool_approval.py`

- Un-skipped `test_frontend_multiple_tools_mixed_approval_rejection`
- Updated tests to use `ToolCallState` enum values
- All 5 integration tests now passing (previously: 2 passed, 2 failed, 1 skipped)

**Test Results:**

```
tests/integration/test_stream_protocol_tool_approval.py::test_stream_protocol_generates_tool_approval_request PASSED
tests/integration/test_stream_protocol_tool_approval.py::test_stream_protocol_tracks_pending_approvals PASSED
tests/integration/test_stream_protocol_tool_approval.py::test_frontend_single_tool_approval_flow PASSED
tests/integration/test_stream_protocol_tool_approval.py::test_frontend_single_tool_rejection_flow PASSED
tests/integration/test_stream_protocol_tool_approval.py::test_frontend_multiple_tools_mixed_approval_rejection PASSED
```

**Total Test Coverage:** 111 tests passing (all tests in repository)

#### 4. Type Safety Improvements

- Replaced `Literal["approval-responded", "output-available", ...]` with `ToolCallState` enum
- IDE autocomplete and type checking now work for tool states
- Prevents typo-related bugs in state comparisons

### Files Modified

1. **ai_sdk_v6_compat.py** (NEW) - AI SDK v6 type definitions + ADK conversion
2. **tool_delegate.py** - Added process_tool_use_parts() function
3. **server.py** - Removed duplicate ChatMessage, updated imports
4. **tests/integration/test_stream_protocol_tool_approval.py** - Updated to use enum values

### Remaining Work

1. **Remove Dead Code:** server.py:1069-1102 contains unused "tool_result" event handler
   - Frontend never sends "tool_result" events (uses "message" events with tool-use parts)
   - Handler exists from older design, can be safely removed

2. **Architecture Documentation:** May need update if significant changes warrant documentation

### References to Implementation

- AI SDK v6 types: ai_sdk_v6_compat.py:1-323
- Process function: tool_delegate.py:143-182
- Integration tests: tests/integration/test_stream_protocol_tool_approval.py:246-322
- Frontend behavior mocked from: lib/use-chat-integration.test.tsx:463-728

---

## References

- Frontend: `lib/use-chat-integration.test.tsx` (14 tests, line 594-728 for rejection)
- Frontend: `lib/websocket-chat-transport.ts` (sendMessages implementation)
- Backend: `ai_sdk_v6_compat.py` (AI SDK v6 type definitions + ADK conversion)
- Backend: `tool_delegate.py` (FrontendToolDelegate + process_tool_use_parts)
- Backend: `server.py:1069-1102` (tool_result handler - unused, candidate for removal)
- Tests: `tests/integration/test_stream_protocol_tool_approval.py` (5 passed)
- Tests: `tests/integration/test_backend_tool_approval.py` (6 passed)
- Total: 111 tests passing
