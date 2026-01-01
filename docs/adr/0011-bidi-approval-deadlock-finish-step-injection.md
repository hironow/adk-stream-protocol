# 0011. BIDI Mode Approval Deadlock - finish-step Injection Solution

**Date:** 2025-12-31
**Status:** Accepted

## Context

### Problem Discovery

BIDI mode tool approval workflow experiences a **deadlock** that prevents approval responses from reaching the backend:

**Timeline of Deadlock:**

1. Backend sends `tool-approval-request` (03:31:19.048)
2. Frontend receives approval-request, user clicks Approve (18:31:19.406, 343ms later)
3. Frontend **never calls** `sendAutomaticallyWhen()` - approval response is NOT sent
4. Backend `await approval_queue.wait_for_approval()` blocks for 30 seconds
5. Backend times out, returns error (03:31:49.130)
6. Frontend finally receives `finish` chunk and closes stream (18:31:54.900, 36 seconds after approval-request!)

**Root Cause Analysis:**

The deadlock occurs due to a fundamental mismatch between ADK BLOCKING pattern and AI SDK v6 streaming model:

### Backend (ADK) Behavior

```python
# adk_stream_protocol/adk_ag_tools.py:258-291
async def process_payment(...):
    if is_bidi_mode:
        # Register approval request
        approval_queue.request_approval(tool_call_id, ...)

        # BLOCKING: Awaits approval response before returning
        # Tool function does NOT return until approved/denied/timeout
        approval_result = await approval_queue.wait_for_approval(
            tool_call_id,
            timeout=30.0
        )

        if approved:
            return _execute_process_payment(...)
        else:
            return {"success": False, "error": "denied"}
```

**Key Point:** ADK Live API does NOT emit any events (including `turn_complete`) while the tool function is blocked waiting for approval. The tool must return before ADK continues processing.

### Frontend (AI SDK v6) Behavior

```typescript
// lib/bidi/event_receiver.ts:210-223
if ((chunk as UIMessageChunkFromAISDKv6).type === "tool-approval-request") {
  console.log(
    "[Event Receiver] Enqueuing approval request, waiting for finish chunk to close stream",
  );
  controller.enqueue(chunk as UIMessageChunkFromAISDKv6);

  // BLOCKING Pattern: Wait for finish chunk before closing stream
  this.waitingForFinishAfterApproval = true;
  return;
}

// lib/core/send-automatically-when.ts:40-54
export function sendAutomaticallyWhenCore(...) {
  // AI SDK v6 ONLY calls this function when status != "streaming"
  // Stream status is "streaming" until controller.close() is called
  // controller.close() happens when finish chunk arrives
  ...
}
```

**Key Point:** AI SDK v6 `sendAutomaticallyWhen()` is ONLY called when stream status is NOT "streaming". The stream remains "streaming" until `finish` chunk arrives and `controller.close()` is called.

### The Deadlock

```
┌──────────────────────────────────────────────────────────────┐
│                       DEADLOCK CYCLE                         │
│                                                              │
│  Backend:                                                    │
│    ├─ Sends tool-approval-request                           │
│    ├─ Blocks in await approval_queue.wait_for_approval()    │
│    └─ Cannot send finish until approval received            │
│                                                              │
│  Frontend:                                                   │
│    ├─ Receives tool-approval-request                        │
│    ├─ Waits for finish chunk to close stream                │
│    ├─ Stream status = "streaming" (sendAutomaticallyWhen    │
│    │   is NOT called)                                       │
│    └─ Cannot send approval response until stream closes     │
│                                                              │
│  Result: Backend timeout (30s) → Error response             │
└──────────────────────────────────────────────────────────────┘
```

### Why This Happens

The mismatch stems from different conceptual models:

1. **ADK BLOCKING Pattern:**
   - Tool function blocks execution flow
   - No events emitted while blocked
   - `turn_complete=True` only after tool returns

2. **AI SDK v6 Multi-Step Model:**
   - Each LLM API call is a "step"
   - `finish-step`: Single step complete, ready for next message
   - `finish`: Entire generation complete
   - Auto-send logic (`sendAutomaticallyWhen`) only triggered when stream is NOT "streaming"

3. **Current Implementation:**
   - Backend: Tool call → blocks → waits for approval
   - Frontend: Approval request → waits for `finish` → then sends approval
   - **Neither side can proceed!**

### Research Findings

**AI SDK v6 `finish-step` Event:**

- Emitted after each LLM API call in multi-step workflows
- Signals completion of a single step (not the entire turn)
- Allows stream to close while keeping conversation open
- Reference: DeepWiki query on vercel/ai (2025-12-31)

**ADK `turn_complete` Behavior:**

- Set to `True` when model finishes response for a turn
- After tool execution, `turn_complete=True` signals turn end
- When tool is BLOCKING, turn_complete is NOT sent until tool returns
- Reference: DeepWiki query on google/adk-python (2025-12-31)

## Decision

Inject `start-step` and `finish-step` events around `tool-approval-request` to break the deadlock and align with AI SDK v6 multi-step model.

### AI SDK v6 Step Semantics

In AI SDK v6, `start-step` and `finish-step` events delineate the boundaries of individual steps within multi-step workflows:

- **`start-step`**: Marks the beginning of a generation step
- **`finish-step`**: Marks the completion of a step (all text deltas, tool calls, and tool results for that step are available)

For tool approval flow, this creates two distinct steps:

**Step 1 (Approval Pending):**

- start-step ← Marks approval step beginning
- tool-input-start
- tool-input-available
- tool-approval-request
- finish-step ← Marks approval step completion (stream closes, frontend can send approval)

**Step 2 (Approval Processed):**

- start-step ← Marks execution step beginning
- tool-output-available
- finish ← Marks entire turn completion

### Implementation Strategy

**Location:** `adk_stream_protocol/bidi_event_sender.py` - `_handle_confirmation_if_needed()` method

**Change:** Wrap `tool-approval-request` with `start-step` and `finish-step` events:

```python
# adk_stream_protocol/bidi_event_sender.py (line 309-351)

# 1. Send original tool-input-available
await self._send_sse_event(sse_event)

# 2. NEW: Inject start-step to begin approval step
start_step_sse = "data: {\"type\":\"start-step\"}\n\n"
await self._ws.send_text(start_step_sse)
logger.info("[BIDI Phase 5] ✓ Sent start-step before tool-approval-request")

# 3. Inject tool-approval-request (existing code)
approval_request_sse = StreamProtocolConverter.format_tool_approval_request(
    original_tool_call_id=tool_call_id,
    approval_id=confirmation_id,
)
await self._ws.send_text(approval_request_sse)
logger.info("[BIDI Phase 5] ✓ Sent tool-approval-request")

# 4. NEW: Inject finish-step to complete approval step
finish_step_sse = "data: {\"type\":\"finish-step\"}\n\n"
await self._ws.send_text(finish_step_sse)
logger.info("[BIDI Phase 5] ✓ Sent finish-step after tool-approval-request")

# 5. Save confirmation mapping (existing code)
...
```

**Note:** While `start-step` may seem optional since ADK already sends a `start` event, `start` represents the entire message/turn beginning, not individual steps. In multi-step workflows, each step should have its own `start-step`/`finish-step` pair to properly signal step boundaries to AI SDK v6.

**Frontend Changes:** `lib/bidi/event_receiver.ts`

Update BIDI BLOCKING pattern to wait for `finish-step` instead of `finish`:

```typescript
// lib/bidi/event_receiver.ts (line 210-253)

// BIDI BLOCKING Pattern: Wait for finish-step after approval request
if ((chunk as UIMessageChunkFromAISDKv6).type === "tool-approval-request") {
  console.log(
    "[Event Receiver] Enqueuing approval request, waiting for finish-step to close stream",
  );
  controller.enqueue(chunk as UIMessageChunkFromAISDKv6);
  this.waitingForFinishStepAfterApproval = true;  // Changed flag name
  return;
}

// Close stream after finish-step (invocation complete)
if (
  this.waitingForFinishStepAfterApproval &&
  (chunk as UIMessageChunkFromAISDKv6).type === "finish-step"
) {
  console.log(
    "[Event Receiver] Received finish-step after approval request, closing stream",
  );
  controller.enqueue(chunk as UIMessageChunkFromAISDKv6);
  controller.close();  // This changes status to "awaiting-message"
  this.doneReceived = true;
  this.waitingForFinishStepAfterApproval = false;
  return;
}
```

### Expected Flow After Fix

```
1. User: "花子さんに50ドル送金してください"
2. Backend → Frontend (Step 1: Approval Pending):
   - tool-input-start
   - tool-input-available
   - start-step ← NEW! (approval step begins)
   - tool-approval-request
   - finish-step ← NEW! (approval step complete, stream closes)
3. Frontend:
   - Stream closes (controller.close())
   - Status changes to "awaiting-message"
   - sendAutomaticallyWhen() is called ✓
   - Returns true (approval-responded state detected)
   - sendMessages() sends approval response ✓
4. Backend:
   - Receives approval response via BidiEventReceiver
   - approval_queue.submit_approval() unblocks tool function
   - Tool executes and returns result
5. Backend → Frontend:
   - tool-output-available
   - text response
   - finish (turn complete)
```

## Consequences

### Positive

1. **Deadlock Resolved:**
   - Frontend can send approval response immediately
   - Backend receives approval within milliseconds
   - 30-second timeout eliminated

2. **Correct AI SDK v6 Usage:**
   - `finish-step` properly signals single invocation complete
   - `finish` reserved for actual turn completion
   - Multi-step workflow pattern correctly implemented

3. **Better UX:**
   - Tool approval responses are instant
   - No 30-second delay for user
   - Responsive approval workflow

4. **Aligned with Standards:**
   - AI SDK v6: finish-step for multi-step workflows
   - ADK: BLOCKING pattern for approval
   - Both work together without conflict

### Negative

1. **Custom Event Injection:**
   - We inject `finish-step` that doesn't come from ADK
   - Could cause confusion for developers debugging
   - Requires clear documentation

2. **Deviation from ADK Events:**
   - ADK doesn't send `turn_complete` during BLOCKING
   - We work around this by injecting our own event
   - May need adjustment if ADK changes behavior

3. **Frontend Dependency:**
   - Frontend must update event_receiver to handle finish-step
   - Breaking change for BIDI BLOCKING pattern
   - Requires coordinated backend/frontend deployment

### Neutral

1. **SSE Mode Unaffected:**
   - SSE mode doesn't use BIDI BLOCKING pattern
   - No changes needed for SSE mode

2. **Non-Approval Tools Unaffected:**
   - Tools without confirmation work as before
   - Only approval workflow changes

## Implementation Notes

### Files to Modify

1. **Backend:**
   - `adk_stream_protocol/bidi_event_sender.py:309-351` - Inject finish-step

2. **Frontend:**
   - `lib/bidi/event_receiver.ts:210-253` - Wait for finish-step
   - Update flag names and comments

### Testing Strategy

1. **Unit Tests:**
   - `lib/tests/unit/bidi-event-receiver.unit.test.ts` - Verify finish-step handling
   - `tests/integration/bidi/test_event_sender.py` - Verify finish-step injection

2. **E2E Tests:**
   - `scenarios/tools/process-payment-bidi.spec.ts` - Should pass after fix
   - `scenarios/tools/get-location-bidi.spec.ts` - Should pass after fix

3. **Verification:**
   - Run single test to verify clean approval flow
   - Check frontend logs for sendAutomaticallyWhen being called
   - Check backend logs for approval received within 1 second

### Rollback Plan

If issues arise:

1. Revert `bidi_event_sender.py` finish-step injection
2. Revert `event_receiver.ts` finish-step handling
3. Return to finish-based BIDI BLOCKING pattern
4. Re-investigate alternative solutions

## Test Coverage Gap Analysis (Reference)

### Why Existing E2E Tests Didn't Catch This Bug

The deadlock was only discovered by `scenarios/` tests because three different test layers each tested different aspects of the approval flow:

**1. lib/tests/e2e/ (Vitest + MSW WebSocket Mock)**

- **Test Type:** Mock backend with real React frontend
- **Gap:** MSW mock sent `[DONE]` immediately after `tool-approval-request`
- **Why it passed:** Stream closed immediately → `sendAutomaticallyWhen` called → No deadlock
- **Example:** `process-payment-double.e2e.test.tsx:113-115`

  ```typescript
  client.send('data: {"type": "tool-approval-request", ...}\n\n');
  client.send("data: [DONE]\n\n");  // ← Mock closes stream immediately
  ```

- **Impact:** Mock didn't reproduce real ADK BLOCKING behavior

**2. tests/e2e/backend_fixture/ (Python + Real WebSocket)**

- **Test Type:** Real backend with manual Python client
- **Gap:** Python test client bypassed `sendAutomaticallyWhen` logic entirely
- **Why it passed:** Test manually constructed and sent approval messages
- **Example:** `test_process_payment_approved_bidi_baseline.py:80-99`

  ```python
  # Manually construct approval message (bypasses frontend logic)
  approval_message = {
      "role": "user",
      "parts": [{
          "type": "tool-adk_request_confirmation",
          "state": "approval-responded",
          "approval": {"id": confirmation_id, "approved": True}
      }]
  }
  await websocket.send(json.dumps({"type": "message", "messages": [approval_message]}))
  ```

- **Impact:** Didn't test frontend approval flow (BIDI BLOCKING pattern, `sendAutomaticallyWhen`)

**3. scenarios/ (Playwright + Full Stack)**

- **Test Type:** Real backend + real frontend React components + real browser
- **Coverage:** Complete user flow including:
    - Real `ToolInvocationComponent` click handling
    - Real `sendAutomaticallyWhen` logic execution
    - Real `event_receiver.ts` BIDI BLOCKING pattern
    - Real ADK BLOCKING `await approval_queue.wait_for_approval()`
- **Result:** ✅ **Found the deadlock** - only complete E2E test

### Impact of This ADR on Existing Tests

**scenarios/ (10 tests) - PRIMARY TARGET**

- Status: Currently failing with 30s timeout
- After fix: ✅ Will pass - deadlock resolved

**tests/e2e/backend_fixture/ (Python tests)**

- Status: Already passing
- After fix: ✅ No impact - tests bypass `sendAutomaticallyWhen`

**lib/tests/e2e/ (Vitest tests)**

- Status: Already passing
- After fix: ⚠️ Optional - Update MSW mocks to use `start-step`/`finish-step` for more accurate testing
- Recommended change:

  ```typescript
  // Before:
  client.send('data: {"type": "tool-approval-request", ...}\n\n');
  client.send("data: [DONE]\n\n");

  // After (more accurate):
  client.send('data: {"type": "start-step"}\n\n');
  client.send('data: {"type": "tool-approval-request", ...}\n\n');
  client.send('data: {"type": "finish-step"}\n\n');
  // [DONE] sent later after approval response
  ```

### Lesson Learned

Complete E2E tests (`scenarios/`) that exercise the full stack (real backend + frontend + browser) are essential for catching integration issues like this deadlock. Mock-based tests and backend-only tests can pass while missing critical frontend-backend interaction bugs.

## References

- ADR 0002: Tool Approval Architecture
- ADR 0010: BIDI Confirmation Chunk Generation
- AI SDK v6 Documentation: finish-step event (DeepWiki: vercel/ai)
- ADK Documentation: turn_complete behavior (DeepWiki: google/adk-python)
- Investigation logs: `/tmp/bidi_single_test.log`, `logs/frontend_test-bidi.log`, `logs/server_failed-e2e.log`
- Test coverage analysis: `lib/tests/e2e/`, `tests/e2e/backend_fixture/`, `scenarios/`
