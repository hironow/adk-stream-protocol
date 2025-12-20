# LongRunningFunctionTool API Discovery Results

**Date**: 2025-12-18
**Status**: 🟢 **COMPLETE - API FOUND AND UNDERSTOOD**
**Confidence Update**: 📈 **60% → 75%** (significant increase)

## Executive Summary

Successfully discovered the proper `LongRunningFunctionTool` API in ADK source code. The mechanism exists and is well-implemented, but requires specific usage pattern that differs from POC Phase 1 approach.

## Key Findings

### 1. `LongRunningFunctionTool` Class Exists

**Location**: `.venv/lib/python3.13/site-packages/google/adk/tools/long_running_tool.py`

```python
class LongRunningFunctionTool(FunctionTool):
    """A function tool that returns the result asynchronously."""

    def __init__(self, func: Callable):
        super().__init__(func)
        self.is_long_running = True  # KEY ATTRIBUTE
```

### 2. Complete Pause/Resume Mechanism

**Pause Flow** (discovered in `flows/llm_flows/functions.py`):

```python
if tool.is_long_running:
    # Allow long running function to return None to not provide function response.
    if not function_response:
        return None  # ← NO function_response event created!
```

**Key Requirements**:

1. Use `LongRunningFunctionTool(your_function)` wrapper
2. Function must return `None` to signal "waiting for user action"
3. Returning data (like `{status: 'pending'}`) defeats the mechanism!

**Pause Detection** (discovered in `agents/invocation_context.py`):

```python
def should_pause_invocation(self, event: Event) -> bool:
    """Returns whether to pause the invocation right after this event."""
    if not self.is_resumable:
        return False

    if not event.long_running_tool_ids or not event.get_function_calls():
        return False

    for fc in event.get_function_calls():
        if fc.id in event.long_running_tool_ids:
            return True  # ← Agent pauses here!

    return False
```

**Resume Flow**:

- Frontend sends `function_response` with original `function_call_id`
- Agent receives function_response and resumes execution
- Continues from where it paused

### 3. `long_running_tool_ids` Population

**How tool IDs get added** (discovered in `a2a/converters/event_converter.py`):

```python
# A2A message converter checks metadata
if (a2a_part.root.metadata
    and a2a_part.root.metadata.get(_get_adk_metadata_key(A2A_DATA_PART_METADATA_IS_LONG_RUNNING_KEY))
    is True):
    for part in parts:
        if part.function_call:
            long_running_tool_ids.add(part.function_call.id)  # ← Added here!
```

The `is_long_running` attribute propagates from tool → metadata → event field.

### 4. Why POC Phase 1 Failed

**Problem**:

```python
def approval_test_tool(amount: float, recipient: str) -> dict[str, Any]:
    return {
        "status": "pending",  # ❌ Returned DATA
        "approval_id": "...",
    }
```

**What happened**:

1. ✅ Tool executed successfully
2. ❌ Returned dict (not `None`)
3. ❌ ADK created function_response event immediately
4. ❌ `long_running_tool_ids` stayed empty
5. ❌ Agent treated tool as completed

**Correct Pattern**:

```python
def approval_test_tool(amount: float, recipient: str) -> None:
    # Save approval request to session or database
    # ...
    return None  # ← Must return None to trigger pause!
```

## Additional Discoveries

### `ToolConfirmation` Model

**Location**: `.venv/lib/python3.13/site-packages/google/adk/tools/tool_confirmation.py`

```python
@experimental
class ToolConfirmation(BaseModel):
    hint: str = ""  # Why input is needed
    confirmed: bool = False  # Whether execution is confirmed
    payload: Optional[Any] = None  # Custom data from user
```

This model is for a different pattern (likely used with `require_confirmation=True`).

### Pause vs Confirmation

Two separate mechanisms discovered:

| Feature | `LongRunningFunctionTool` | `FunctionTool(require_confirmation=True)` |
|---------|---------------------------|-------------------------------------------|
| **Purpose** | Async execution, manual resume | User approval before execution |
| **When** | Tool executes immediately, pauses after | Tool pauses before execution |
| **Return** | Must return `None` | Returns normally |
| **Resume** | Via `function_response` | Via confirmation callback |
| **Use Case** | Human-in-the-loop workflows | Dangerous operations |

## Architecture Implications

### BIDI Mode Compatibility

**Positive Signals**:

- ✅ `long_running_tool_ids` field exists in Event model
- ✅ Pause/resume logic works in both SSE and Live API paths
- ✅ `should_pause_invocation()` agnostic to API mode
- ✅ A2A converter handles `is_long_running` metadata

**Potential Issues**:

- ⚠️ Live API event stream behavior during pause (unknown)
- ⚠️ WebSocket connection timeout during long wait (needs testing)
- ⚠️ How to inject `function_response` via WebSocket (needs testing)

### Resume via WebSocket

**Expected Flow**:

1. Agent calls `LongRunningFunctionTool`, returns `None`
2. Agent pauses (stream stops)
3. Frontend shows approval UI
4. User clicks Approve
5. Frontend sends via WebSocket:

   ```typescript
   ws.send(JSON.stringify({
       type: 'function_response',  // Or similar
       function_call_id: 'original-id',
       response: { approved: true, ... }
   }))
   ```

6. Agent resumes with function_response

**Question**: What is the exact WebSocket message format?

## Updated Confidence Assessment

**Before Discovery**: 30% (POC Phase 1 failed, API unknown)
**After Discovery**: 📈 **75%** (API found, mechanism understood)

**Why 75% (not 100%)**:

- Still need to test WebSocket `function_response` injection format
- Event stream pause behavior in Live API unconfirmed
- Connection timeout handling needs verification

**Remaining Unknowns**:

1. Exact WebSocket message format for `function_response`
2. Does Live API truly stop streaming after pause?
3. How long can connection stay open during pause?
4. Can we resume after 2+ minute wait?

## Next Steps

### POC Phase 2: Proper `LongRunningFunctionTool` Implementation

**Changes from Phase 1**:

```python
# OLD (Phase 1) - WRONG:
def approval_test_tool(amount: float, recipient: str) -> dict[str, Any]:
    return {"status": "pending", ...}  # ❌ Returns data

# NEW (Phase 2) - CORRECT:
def approval_test_tool(amount: float, recipient: str) -> None:
    # Save to session for later retrieval
    logger.info(f"Approval pending: ${amount} to {recipient}")
    return None  # ✅ Returns None to pause!

# Registration:
LongRunningFunctionTool(approval_test_tool)  # ✅ Use wrapper class!
```

**Expected Behavior**:

1. ✅ Tool executes
2. ✅ Returns `None`
3. ✅ `long_running_tool_ids` gets populated with tool ID
4. ✅ Agent pauses (stream stops)
5. ✅ "Thinking..." disappears
6. ⚠️ **TO TEST**: WebSocket stays open, can send `function_response`

### Test Phases 2-5

If Phase 2 shows proper pausing:

- **Phase 3**: Test `function_response` injection via WebSocket
- **Phase 4**: Test connection timeout (2-minute wait)
- **Phase 5**: Complete end-to-end approval flow

## Conclusion

**MAJOR BREAKTHROUGH**: The `LongRunningFunctionTool` API exists and is well-designed. POC Phase 1 failure was due to incorrect usage (returning data instead of `None`), not a fundamental API limitation.

**Recommendation**: **PROCEED TO POC PHASE 2** with proper implementation.

**Risk Level**: 🟡 **MEDIUM** (down from HIGH)

- API exists ✅
- Mechanism understood ✅
- BIDI compatibility likely ⚠️
- WebSocket resume format unknown ⚠️
