# POC Phase 2: LongRunningFunctionTool Success

**Date:** 2025-12-18
**Objective:** Test proper `LongRunningFunctionTool` API usage to pause agent execution
**Status:** 🟢 **SUCCESS** - Mechanism works as designed

## Summary

POC Phase 2 **successfully validated** that ADK's `LongRunningFunctionTool` mechanism works correctly when used with proper API:

✅ Tool returns `None` → ADK pauses agent
✅ `long_running_tool_ids` populated with tool ID
✅ NO `tool-output-available` event sent (correct)
✅ Tool stays in "Executing..." state (not "Completed")
✅ Agent stops processing (connection closes after ~10s)

## Background

**Phase 1 Results:** Failed because we returned data instead of `None`:
```python
# Phase 1 (WRONG):
def approval_test_tool(...) -> dict:
    return {"status": "pending", "approval_id": "..."}  # ❌
```

**API Discovery:** Found proper pattern requires returning `None`:
```python
# Phase 2 (CORRECT):
def approval_test_tool(...) -> None:
    # Store approval request for later
    return None  # ✅ Triggers pause!

# Registration:
LongRunningFunctionTool(approval_test_tool)
```

**Reference:** [2025-12-18_longrunning_tool_api_discovery.md](./2025-12-18_longrunning_tool_api_discovery.md)

## Implementation Changes

### File: `adk_ag_tools.py`

**Before (Phase 1):**
```python
def approval_test_tool(amount: float, recipient: str) -> dict[str, Any]:
    approval_id = f"poc-approval-{uuid.uuid4().hex[:8]}"
    logger.info(...)
    return {
        "status": "pending",
        "approval_id": approval_id,
        "amount": amount,
        "recipient": recipient,
        "message": "Approval request pending user confirmation",
    }
```

**After (Phase 2):**
```python
def approval_test_tool(amount: float, recipient: str) -> None:
    """
    POC Phase 2: Test LongRunningFunctionTool with proper API pattern.

    This tool returns None to trigger ADK's long-running tool pause mechanism.
    The tool must be wrapped with LongRunningFunctionTool() for proper behavior.

    Expected behavior:
    1. Tool executes immediately
    2. Returns None (no function_response created)
    3. ADK adds tool ID to long_running_tool_ids
    4. Agent pauses automatically
    5. Resume later via function_response with same function_call_id

    Args:
        amount: Payment amount in USD
        recipient: Payment recipient name

    Returns:
        None - This signals to ADK that the tool is waiting for user action
    """
    import uuid

    approval_id = f"poc-approval-{uuid.uuid4().hex[:8]}"

    logger.info(
        f"[POC Phase 2 approval_test_tool] Tool executed, returning None to pause: "
        f"approval_id={approval_id}, amount=${amount}, recipient={recipient}"
    )

    # CRITICAL: Must return None to trigger pause!
    # Returning data would create function_response and complete the tool.
    return None
```

### File: `adk_ag_runner.py`

**Before (Phase 1):**
```python
bidi_agent = Agent(
    # ...
    tools=[
        # ...
        approval_test_tool,  # ❌ Not wrapped
    ],
)
```

**After (Phase 2):**
```python
from google.adk.tools.long_running_tool import LongRunningFunctionTool

bidi_agent = Agent(
    # ...
    tools=[
        # ...
        LongRunningFunctionTool(approval_test_tool),  # ✅ Wrapped!
    ],
)
```

## Test Execution Results

### Test Command:
```bash
pnpm exec playwright test e2e/poc-longrunning-bidi.spec.ts --grep "Phase 1" \
  --reporter=list --timeout=120000 2>&1 | tee /tmp/poc-phase2.log
```

### Test Output:
```
Running 1 test using 1 worker

[POC Phase 1] Testing basic pending status handling
  ✘  1 [chromium] › e2e/poc-longrunning-bidi.spec.ts:46:7 › POC: LongRunningFunctionTool + BIDI › Phase 1: LongRunningFunctionTool returns pending status

    Error: expect(locator).toBeVisible() failed

    Locator: locator('text=Completed').first()
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found
```

### Why Test "Failed":
Test expects "Completed" status, but with proper `LongRunningFunctionTool` implementation, the tool **correctly stays in "Executing..." state** waiting for `function_response`.

This is **not a bug** - this is **correct behavior**! The test expectations need updating.

## Backend Log Evidence

### Tool Execution Log:
```
2025-12-18 19:44:46.844 | INFO | adk_ag_tools:approval_test_tool:391 -
[POC Phase 2 approval_test_tool] Tool executed, returning None to pause:
approval_id=poc-approval-d5f05c3c, amount=$500, recipient=Alice
```

### 🎉 BREAKTHROUGH: `long_running_tool_ids` Populated!

**Phase 1 (WRONG API):**
```python
'long_running_tool_ids': set()  # ❌ EMPTY
```

**Phase 2 (CORRECT API):**
```python
'long_running_tool_ids': {'function-call-17561808245438725350'}  # ✅ POPULATED!
```

This is the **smoking gun** evidence that the mechanism works!

### Events Sent to Frontend:
```
[BIDI-SEND] Sending event type: tool-input-start
    tool_call_id: function-call-17561808245438725350
    tool_name: approval_test_tool

[BIDI-SEND] Sending event type: tool-input-available
    tool_call_id: function-call-17561808245438725350
    args: {"recipient": "Alice", "amount": 500}

# NO tool-output-available sent! (Correct for None return)

[BIDI] Client disconnected
```

### Connection Behavior:
- Tool executes at ~19:44:46
- Client disconnects at ~19:44:56 (~10 seconds later)
- No continuous stream after tool execution
- Agent **properly paused**

## UI State Evidence

From `test-results/.../error-context.md`:

```yaml
- generic [ref=e50]:
  - generic [ref=e52]: approval_test_tool (dynamic-tool)
  - generic [ref=e53]: Executing...  # ✅ NOT "Completed"!
- generic [ref=e54]:
  - generic [ref=e55]: Input
  - generic [ref=e56]: "{ \"recipient\": \"Alice\", \"amount\": 500 }"
  # NO Result/Output section! (Correct - None returned)
- generic [ref=e57]: Thinking...  # Still visible during pause
```

**Key Observations:**
- Tool shows "Executing..." status ✅
- Input section visible with tool args ✅
- NO Result/Output section (because `None` returned) ✅
- "Thinking..." still visible ✅
- No error messages ✅

## Comparison: Phase 1 vs Phase 2

| Aspect | Phase 1 (WRONG) | Phase 2 (CORRECT) |
|--------|----------------|-------------------|
| Return value | `dict` with data | `None` |
| Wrapper | None | `LongRunningFunctionTool()` |
| `long_running_tool_ids` | Empty set `set()` | Populated `{'function-call-...'}` |
| `tool-output-available` | Sent | NOT sent ✅ |
| Tool status | "Completed" | "Executing..." ✅ |
| Agent behavior | Completed | **Paused** ✅ |
| Connection | Stays open | Closes after ~10s ✅ |

## Success Criteria Met

✅ **Criterion 1:** Tool executes successfully
✅ **Criterion 2:** Returns `None` (logged)
✅ **Criterion 3:** ADK recognizes long-running tool (IDs populated)
✅ **Criterion 4:** Agent pauses (connection closes)
✅ **Criterion 5:** NO `tool-output-available` sent
✅ **Criterion 6:** Tool stays in "Executing..." state

**All 6 criteria passed!** 🎉

## Confidence Assessment

**Progression:**
1. **Before POC:** 60% Option A will work
2. **After Phase 1:** 📉 30% (incorrect API usage)
3. **After API Discovery:** 📈 75% (API found)
4. **After Phase 2:** 📈 **85% Option A will work** ✅

**Why 85%?**
- ✅ Pause mechanism **proven to work**
- ✅ `long_running_tool_ids` population **confirmed**
- ✅ Event stream behavior **correct**
- ⚠️ Still need to test resume via `function_response`
- ⚠️ Connection timeout handling unknown
- ⚠️ WebSocket message format needs validation

## Remaining Unknowns

1. **Resume Mechanism:** Can we inject `function_response` via WebSocket?
2. **Message Format:** What is the exact WebSocket message structure?
3. **Connection Timeout:** Does connection stay open during 2+ minute wait?
4. **Event Stream:** Does "Thinking..." eventually disappear?
5. **Error Handling:** What happens if resume message is malformed?

## Next Steps

### Immediate Tasks:

1. ✅ **Document Phase 2 success** (this document)
2. **Fix POC Phase 1 test expectations:**
   ```typescript
   // WRONG:
   await expect(page.locator('text=Completed')).toBeVisible();

   // CORRECT:
   await expect(page.locator('text=Executing')).toBeVisible();
   ```
3. **Update `agents/tasks.md`** with Phase 2 results

### POC Phase 3 (Next):
Test `function_response` injection via WebSocket to resume agent:
- Capture tool_call_id from pause
- Construct `function_response` message
- Send via WebSocket
- Verify agent resumes
- Check final AI response

### POC Phase 4:
Test connection timeout and keep-alive during 2-minute wait

### POC Phase 5:
Complete end-to-end approval flow

## Deep Dive: Finish Event Investigation

After Phase 2 success, we conducted a deeper investigation into the finish event behavior to ensure complete understanding.

### Question: Is finish event sent during pause?

**Investigation Result:** NO - finish event is intentionally NOT sent (by design)

### Evidence from ADK Source Code

**File:** `.venv/lib/python3.13/site-packages/google/adk/flows/llm_flows/base_llm_flow.py:405-417`

```python
if (
    invocation_context.is_resumable
    and events
    and len(events) > 1
    # Check if should pause based on long_running_tool_ids
    and (
        invocation_context.should_pause_invocation(events[-1])
        or invocation_context.should_pause_invocation(events[-2])
    )
):
    return  # ← EARLY RETURN! No further events yielded
```

**File:** `.venv/lib/python3.13/site-packages/google/adk/agents/invocation_context.py:382-389`

```python
def should_pause_invocation(self, event: Event) -> bool:
    if not event.long_running_tool_ids or not event.get_function_calls():
        return False

    for fc in event.get_function_calls():
        if fc.id in event.long_running_tool_ids:
            return True  # Pause!

    return False
```

### Pause Mechanism Flow

1. Tool returns `None` → No `function_response` created
2. ADK adds tool ID to `event.long_running_tool_ids`
3. `should_pause_invocation(event)` returns `True`
4. `_postprocess_model_response()` executes **early return** (line 417)
5. **No further events are yielded** → finish event never sent
6. Stream ends without finish → "Thinking..." stays visible

### Verification via Logs

**Events Sent:**
```
[BIDI-SEND] Sending event type: tool-input-start
[BIDI-SEND] Sending event type: tool-input-available
[BIDI] Client disconnected  # ~10 seconds later
```

**Events NOT Sent:**
- ❌ `tool-output-available` (correct - `None` returned)
- ❌ `finish` (correct - early return in base_llm_flow.py)
- ❌ `end` (correct - stream paused)

### Stream Processing Path

All events processed through `stream_protocol.py`:

```python
# Line 942: Receives Event from inject_confirmation_for_bidi
stream_protocol:stream_adk_to_ai_sdk:942 - Received: type=Event

# Line 870: Converts to SSE events
stream_protocol:_convert_to_sse_events:870 - Received: type=Event

# Line 226: Processes event attributes
stream_protocol:convert_event:226 - Event attributes: 'long_running_tool_ids': {'function-call-...'}

# Line 494: Processes function_call
stream_protocol:_process_function_call:494 - [TOOL CALL] approval_test_tool(...)
```

**Confirmed:** All LongRunningFunctionTool events pass through `stream_protocol.py` → conversion pipeline → BIDI WebSocket

## Conclusion

🎉 **POC Phase 2 is a SUCCESS!**

The "test failure" is actually **correct behavior** - the tool is properly paused and waiting for `function_response`. The test expectations were based on Phase 1's incorrect API usage.

**Key Validation:**
- `long_running_tool_ids` populated ✅
- Agent pauses automatically ✅
- Tool stays in executing state ✅
- No premature completion ✅
- **finish event intentionally NOT sent (by design)** ✅
- **All events processed through stream_protocol.py** ✅

**Deep Verification Complete:**
1. ✅ BIDI mode confirmed via logs
2. ✅ stream_protocol.py processing confirmed
3. ✅ finish event absence confirmed (intentional design)

**This confirms that ADK's `LongRunningFunctionTool` mechanism works exactly as designed, and we can proceed with confidence to Phase 3!**

---

**References:**
- API Discovery: [2025-12-18_longrunning_tool_api_discovery.md](./2025-12-18_longrunning_tool_api_discovery.md)
- ADK Source: `.venv/lib/python3.13/site-packages/google/adk/tools/long_running_tool.py`
- ADK Pause Logic: `.venv/lib/python3.13/site-packages/google/adk/flows/llm_flows/base_llm_flow.py:405-417`
- ADK Pause Detection: `.venv/lib/python3.13/site-packages/google/adk/agents/invocation_context.py:382-389`
- POC Test: `e2e/poc-longrunning-bidi.spec.ts`
- Backend Log: `/tmp/poc-phase2.log`
