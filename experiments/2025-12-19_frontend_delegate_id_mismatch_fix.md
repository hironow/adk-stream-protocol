# Frontend Delegate Tool ID Mismatch Fix

**Date:** 2025-12-19
**Status:** 🔴 Critical Bug - Blocking BIDI Mode
**Session:** e2e-feature-1

## Problem Summary

Frontend delegate tools in BIDI mode have an ID mismatch causing deadlock:

- **Backend registers Future with**: `tool_context.invocation_id` (`e-889d47cd-...`)
- **Frontend sends tool_result with**: `function_call.id` (`function-call-15600968341102554767`)
- **Result**: `FrontendToolDelegate` can't resolve Future → deadlock

## Evidence from Logs

```log
# Backend registers Future with invocation_id
2025-12-19 02:40:46.687 | INFO | Awaiting result for tool_call_id=e-889d47cd-6fc1-4387-8d30-1fbf6527e64b

# Frontend sends tool_result with function_call.id
{"type":"tool_result","data":{"toolCallId":"function-call-15600968341102554767","result":{...}}}

# Backend can't match IDs
2025-12-19 02:40:46.711 | WARNING | No pending call found for tool_call_id=function-call-15600968341102554767
```

## Root Cause

**File**: `adk_ag_tools.py:217`

```python
async def change_bgm(track: int, tool_context: ToolContext | None = None) -> dict[str, Any]:
    if tool_context:
        delegate = tool_context.session.state.get("frontend_delegate")
        if delegate:
            # ❌ WRONG: Uses invocation_id (event ID)
            result = await delegate.execute_on_frontend(
                tool_call_id=tool_context.invocation_id,  # ← e-889d47cd-...
                tool_name="change_bgm",
                args={"track": track},
            )
            return result
```

**The problem**: `tool_context.invocation_id` is the ADK event ID, not the function_call ID that frontend uses.

## Solution

Pass the actual `function_call.id` to `execute_on_frontend()` instead of `invocation_id`.

### Approach: Add function_call.id to session state

**File**: `stream_protocol.py:494`

```python
def _process_function_call(self, function_call: types.FunctionCall) -> list[str]:
    tool_name = function_call.name
    tool_call_id = function_call.id  # This is the real ID
    tool_args = dict(function_call.args) if function_call.args else {}

    # Store function_call.id in session state (accessible to tools via tool_context)
    if self.session and tool_name:
        # Map: tool_name → function_call.id
        if "function_call_ids" not in self.session.state:
            self.session.state["function_call_ids"] = {}
        self.session.state["function_call_ids"][tool_name] = tool_call_id
```

**File**: `adk_ag_tools.py:217`

```python
async def change_bgm(track: int, tool_context: ToolContext | None = None) -> dict[str, Any]:
    if tool_context:
        delegate = tool_context.session.state.get("frontend_delegate")
        if delegate:
            # ✅ CORRECT: Use function_call.id from session state
            function_call_ids = tool_context.session.state.get("function_call_ids", {})
            tool_call_id = function_call_ids.get("change_bgm")

            if not tool_call_id:
                logger.error("[change_bgm] function_call.id not found in session state")
                # Fallback to direct execution
                return {...}

            result = await delegate.execute_on_frontend(
                tool_call_id=tool_call_id,  # ← function-call-15600968341102554767
                tool_name="change_bgm",
                args={"track": track},
            )
            return result
```

## Implementation Plan

1. **[DONE]** Write this experiment note
2. **[TODO]** Modify `stream_protocol.py` to store function_call.id in session state
3. **[TODO]** Modify `adk_ag_tools.py` to use function_call.id from session state
4. **[TODO]** Apply same fix to `get_location` and other frontend delegate tools
5. **[TODO]** Run E2E tests to verify fix
6. **[TODO]** Verify baseline is preserved (SSE: 18/18, BIDI: 21/21)

## Related Files

- `stream_protocol.py:494` - function_call processing
- `adk_ag_tools.py:217` - change_bgm tool
- `server.py:99` - FrontendToolDelegate.execute_on_frontend()
- `server.py:111` - FrontendToolDelegate.resolve_tool_result()

## Expected Outcome

After fix:
1. Backend registers Future with `function_call.id`
2. Frontend sends tool_result with same `function_call.id`
3. Backend resolves Future successfully
4. Agent continues execution
5. ✅ Test passes
