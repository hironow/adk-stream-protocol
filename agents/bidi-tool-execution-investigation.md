# BIDI Tool Execution Investigation

**Date**: 2025-12-19
**Session**: 10 (Continuation)
**Status**: 🟡 Root Cause Partially Identified

---

## Executive Summary

Frontend-delegated tools (change_bgm, get_location) in BIDI mode fail because **FunctionResponse events are not being sent back to ADK** after tool execution. Chunk log analysis reveals that:

- ✅ **Frontend receives** `tool-input-available` correctly
- ✅ **Frontend executes** tools successfully
- ✅ **Backend receives** results via WebSocket
- ❌ **ADK never receives** FunctionResponse events
- ❌ **Stream hangs** waiting for ADK to continue

---

## Evidence from Chunk Logs

### Test Case Analysis

#### ✅ SUCCESS: `get_location-bidi-1` (Approval Flow)
```
Frontend Log:
- Seq 8: tool-input-start (confirmation-function-call-5516942589680334557, adk_request_confirmation)
- Seq 9: tool-input-available (confirmation request)
- Seq 10: tool-output-available (confirmation result: confirmed=true)
```

**Backend Log**:
```
- Seq 12: FunctionCall(id=function-call-5516942589680334557, name=get_location)
- Seq 16: FunctionResponse(id=function-call-11559662495717138788, error='confirmation required')
- [NO FunctionResponse with actual location data found]
```

#### ❌ FAIL: `change_bgm-bidi-1` (Direct Execution)
```
Frontend Log:
- Seq 8: tool-input-start (function-call-2808550598849880244, change_bgm)
- Seq 9: tool-input-available (track=1)
- [NO tool-output-available - log ends here]
```

**Backend Log**:
```
- Seq 3: FunctionCall(id=function-call-2808550598849880244, name=change_bgm, args={track:1})
- [NO FunctionResponse found after this]
```

### Key Finding

Backend logs show **ZERO FunctionResponse events** with actual tool execution results:
```bash
$ grep -n "latitude\|longitude\|Tokyo\|track.*changed" chunk_logs/e2e-5/backend-adk-event.jsonl
[No results]
```

Only FunctionResponse events found are **confirmation errors**:
```python
FunctionResponse(
    id='function-call-11559662495717138788',
    name='get_location',
    response={'error': 'This tool call requires confirmation, please approve or reject.'}
)
```

---

## Code Flow Analysis

### Non-Confirmation Tools (change_bgm)

**Expected Flow**:
1. ADK emits `FunctionCall` for change_bgm
2. `inject_confirmation_for_bidi()` passes through (line adk_compat.py:317)
3. Event → SSE conversion → Frontend receives `tool-input-available`
4. **Parallel**: ADK executes `change_bgm()` function via its runtime
5. `change_bgm()` calls `delegate.execute_on_frontend()` → creates Future and awaits
6. Frontend executes tool → sends result via WebSocket
7. WebSocket handler calls `resolve_tool_result()` → resolves Future
8. `change_bgm()` returns result to ADK
9. **Expected**: ADK wraps result in FunctionResponse and emits it
10. **Actual**: No FunctionResponse in logs → Stream hangs

**Code References**:
- `adk_compat.py:315-318` - Non-confirmation passthrough
- `adk_ag_tools.py:236-242` - change_bgm calls execute_on_frontend
- `server.py:667-672, 727-730` - WebSocket handler resolves Future

### Confirmation-Required Tools (get_location, process_payment)

**Expected Flow**:
1. ADK emits `FunctionCall` for get_location
2. `inject_confirmation_for_bidi()` **intercepts** (line adk_compat.py:320+)
3. Yields confirmation request events → Frontend
4. Awaits user approval
5. **Manually executes tool** (line adk_compat.py:427)
6. Yields `tool-output-available` (line adk_compat.py:443)
7. Yields `tool-output-error` if denied (line adk_compat.py:461-465)

**Issue**: Even with manual execution, backend logs show **no FunctionResponse with actual results**.

---

## Suspected Root Causes

### Hypothesis 1: ADK Not Executing Tools in BIDI Mode

**Evidence**:
- No FunctionResponse events for non-confirmation tools
- Tool functions in `adk_ag_tools.py` appear never to be called

**Counter-evidence**:
- Integration tests pass (21/21) - these test FrontendToolDelegate in isolation
- The delegate pattern works correctly when tested directly

**Question**: Does BIDI mode prevent ADK from auto-executing tools?

### Hypothesis 2: Tool Execution Timeout

**Evidence**:
- E2E tests timeout after 30s
- "Thinking..." never disappears (AI stuck waiting)

**Counter-evidence**:
- WebSocket handler successfully receives results (logs show "Resolved tool result")
- Future resolution should be near-instant after WebSocket receives data

### Hypothesis 3: FunctionResponse Not Yielded to Stream

**Evidence**:
- `inject_confirmation_for_bidi()` yields `tool-output-available` (line 443)
- `stream_protocol.py` converts these to SSE events (line 950)
- But backend-adk-event.jsonl shows NO FunctionResponse

**Critical Question**:
Does `tool-output-available` dict from `inject_confirmation_for_bidi()` get converted back to ADK's FunctionResponse Event?

**Code Path**:
```
inject_confirmation_for_bidi() yields dict
    ↓
stream_protocol.py:950 → _convert_to_sse_events()
    ↓
Yields SSE string to frontend
    ↓
[MISSING: How does result get back to ADK?]
```

---

## Critical Gap in Understanding

### The Missing Link

For confirmation tools, `inject_confirmation_for_bidi()` manually executes tools and yields `tool-output-available`. But:

1. **Frontend receives** `tool-output-available` correctly ✅
2. **ADK never receives** FunctionResponse ❌

**The Question**:
> Who is supposed to send FunctionResponse back to ADK after frontend-delegated tool execution?

**Possibilities**:
1. ADK should auto-generate it (but tool was never called by ADK)
2. `inject_confirmation_for_bidi()` should yield it (but it yields dicts, not ADK Events)
3. `stream_protocol.py` should convert it back (but conversion is one-way: ADK→SSE)
4. WebSocket handler should send it (but it only resolves Futures)

---

## Architecture Question

### BIDI Mode Tool Execution Model

**Question for Investigation**:
Does BIDI mode use a different tool execution model than SSE?

**SSE Mode (Working)**:
- ADK executes tools directly via its runtime
- ADK auto-generates FunctionResponse
- Tools can delegate to frontend via Future pattern

**BIDI Mode (Broken)**:
- Tools shown in agent config with `execute_on_adk=True`
- But are they actually executed by ADK's runtime?
- Or does BIDI expect manual tool orchestration?

**Evidence to Check**:
- ADK documentation for BIDI mode
- Live API examples for tool execution
- Other BIDI implementations

---

## Next Steps

### Immediate Investigation (Priority 1)

1. **Add Logging**: Insert debug logs in tool functions to confirm if ADK calls them
   - `adk_ag_tools.py:217` (change_bgm entry)
   - `adk_ag_tools.py:236` (before delegate call)
   - `adk_ag_tools.py:242` (after delegate returns)

2. **Check ADK Tool Execution**: Verify if ADK actually calls tool functions in BIDI
   - Add logging in adk_ag_runner.py where tools are registered
   - Check if ADK's internal tool execution is triggered

3. **Trace Result Flow**: Follow the path of tool results
   - From `delegate.execute_on_frontend()` return value
   - Through ADK's tool execution
   - To where FunctionResponse should be generated

### Integration Test (Priority 2)

Create test that reproduces the failure:
- Mock ADK emitting FunctionCall
- Simulate frontend sending result
- Assert FunctionResponse is generated and sent to stream

**Test should verify**:
- Does ADK call the tool function?
- Does the tool function complete successfully?
- Is FunctionResponse generated?
- Does it reach the stream output?

### Alternative Approach (Priority 3)

If ADK doesn't auto-execute tools in BIDI:
- All frontend-delegated tools need manual execution in `inject_confirmation_for_bidi`
- Need to intercept ALL frontend-delegated tools, not just confirmation-required ones
- Generate FunctionResponse Events manually (not dicts)

---

## Files to Examine

### Tool Execution
- `adk_ag_tools.py:217-250` - change_bgm implementation
- `adk_ag_tools.py:253-290` - get_location implementation
- `adk_ag_runner.py` - Tool registration with ADK

### Event Processing
- `adk_compat.py:275-318` - inject_confirmation_for_bidi entry logic
- `adk_compat.py:396-456` - Manual tool execution for confirmations
- `stream_protocol.py:938-958` - Event consumption and conversion

### Communication
- `server.py:667-672` - WebSocket FunctionResponse handling
- `server.py:727-730` - WebSocket tool_result handling
- `services/frontend_tool_service.py:45-75` - FrontendToolDelegate

---

## Open Questions

1. **Does ADK execute tools in BIDI mode?**
   - If yes: Why no FunctionResponse in logs?
   - If no: Why do integration tests pass?

2. **For confirmation tools**: Does manual execution in `inject_confirmation_for_bidi` replace ADK execution?
   - Does ADK see the tool as "already executed"?
   - Or does ADK still try to execute it?

3. **For non-confirmation tools**: Who executes them?
   - ADK's runtime?
   - Manual execution needed?

4. **Where should FunctionResponse be generated?**
   - ADK automatically after tool returns?
   - Manual yield in inject_confirmation_for_bidi?
   - Conversion in stream_protocol.py?

---

## Comparison: SSE vs BIDI

### SSE Mode (17/17 tests passing ✅)

**Change BGM Flow**:
1. AI decides to call change_bgm
2. ADK emits FunctionCall → tool-input-available to frontend
3. Frontend executes via onToolCall
4. Frontend sends result to backend (different per-turn connection)
5. Backend returns to AI
6. AI continues with result

### BIDI Mode (4/17 tests passing ❌)

**Change BGM Flow** (Expected):
1. AI decides to call change_bgm
2. ADK emits FunctionCall
3. **Tool function called by ADK?** (Unclear)
4. **Tool awaits frontend execution** (via Future)
5. **Result returned to ADK?** (Missing FunctionResponse)
6. **Stream hangs** ❌

**Key Difference**: Persistent connection means tool result must flow back through same stream, but it's not happening.

---

## Conclusion

**Root Cause**: FunctionResponse events missing from backend logs after frontend-delegated tool execution in BIDI mode.

**Confidence**: HIGH that this is the proximate cause
**Confidence**: MEDIUM on why it's happening (need more investigation)

**Recommendation**: Add detailed logging to trace exact execution path before creating integration tests.
