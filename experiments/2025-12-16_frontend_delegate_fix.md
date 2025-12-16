# Frontend Delegate Fix - SSE Mode Tool Output Processing

**Date**: 2025-12-16
**Objective**: Fix frontend delegate tool approval flow in SSE mode
**Status**: 🟢 Complete

## Problem Statement

### Critical Issue
Frontend delegate pattern **does not work in SSE mode**. Backend tools that call `execute_on_frontend()` await forever because `resolve_tool_result()` is never called.

### Root Cause Analysis

**SSE Mode Flow (Current - BROKEN)**:
```
1. Backend: tool calls execute_on_frontend() → creates Future, awaits
2. Frontend: receives tool-approval request
3. Frontend: user approves → executes tool locally
4. Frontend: calls addToolOutput() → adds to messages array
5. Frontend: calls sendMessage() → sends messages to /stream
6. Backend: receives new request with messages
7. ❌ Backend: does NOT process tool outputs from messages
8. ❌ Backend: delegate Future never resolves → hangs forever
```

**BIDI Mode Flow (Current - WORKS)**:
```
1. Backend: tool calls execute_on_frontend() → creates Future, awaits
2. Frontend: receives tool-approval request via WebSocket
3. Frontend: user approves → executes tool locally
4. Frontend: sends tool_result via WebSocket
5. Backend: WebSocket handler calls process_tool_use_parts()
6. ✅ Backend: delegate.resolve_tool_result() called → Future resolves
```

### Evidence from Code

#### tool_delegate.py:71-91
```python
async def execute_on_frontend(...) -> dict[str, Any]:
    future: asyncio.Future[dict[str, Any]] = asyncio.Future()
    self._pending_calls[tool_call_id] = future

    logger.info(f"[FrontendDelegate] Awaiting result for tool_call_id={tool_call_id}")
    result = await future  # ← Hangs here in SSE mode
    return result
```

#### ai_sdk_v6_compat.py:421-475
```python
def process_tool_use_parts(message: ChatMessage, delegate: FrontendToolDelegate) -> bool:
    """
    Extract tool-use parts and call delegate methods based on state:
    - "approval-responded" with approved=False → reject_tool_call()
    - "output-available" → resolve_tool_result()  ← This is what we need
    """
    # ... process tool parts ...
    elif part.state == ToolCallState.OUTPUT_AVAILABLE:
        if part.output is not None:
            delegate.resolve_tool_result(tool_call_id, part.output)  # ← Never called in SSE mode
```

#### server.py:240-310 (/stream endpoint)
```python
@app.post("/stream")
async def stream(...):
    # Receives request.messages from frontend
    # ❌ Missing: process tool outputs from request.messages
    # ❌ Missing: call process_tool_use_parts(msg, frontend_delegate)

    # Only processes the last user message
    last_user_message_obj = request.messages[-1]
    message_content = last_user_message_obj.to_adk_content()

    # Runs agent → generates new tool approval requests
    # But never resolves previous tool results!
```

### Server Logs Evidence

```
2025-12-16 10:25:29.668 | INFO  | tool_delegate:execute_on_frontend:74 -
  [FrontendDelegate] Awaiting result for tool_call_id=adk-98d0eba6-4895-4d11-89cc-13dbfd1fa8cc

2025-12-16 10:25:29.668 | DEBUG | tool_delegate:execute_on_frontend:82 -
  [FrontendDelegate] Starting await for adk-98d0eba6-4895-4d11-89cc-13dbfd1fa8cc...

# ← No "resolve_tool_result" log after this
# ← Backend hangs forever
```

## Solution Design

### Minimal Fix Strategy

**Add tool output processing before running agent in SSE mode**:

```python
@app.post("/stream")
async def stream(request: UIMessagesRequest):
    # ... existing code ...

    # NEW: Process tool outputs from all messages BEFORE running agent
    for msg in request.messages:
        if msg.role == "assistant":
            # Check for tool outputs in assistant messages
            msg_data = msg.to_dict()
            process_tool_use_parts(
                ChatMessage.from_dict(msg_data),
                frontend_delegate
            )

    # THEN: Run agent as usual
    last_user_message_obj = request.messages[-1]
    # ... rest of existing code ...
```

### Why This Works

1. **Sequential Processing**: Tool outputs are processed BEFORE starting new agent run
2. **Future Resolution**: `resolve_tool_result()` is called, unblocking awaiting tools
3. **Minimal Change**: Only adds missing processing step, doesn't change architecture
4. **Consistent with BIDI**: Uses same `process_tool_use_parts()` function

## Implementation Plan

### Phase 1: Add Tool Output Processing to SSE Mode ✅
1. Import `process_tool_use_parts` and `ChatMessage` in server.py
2. Add processing loop before agent run in /stream endpoint
3. Add debug logging to verify processing

### Phase 1.5: Fix ToolUsePart Validation ✅
**Root Cause Discovery**: Frontend sends tool parts without `toolName` field, causing Pydantic to classify them as `GenericPart` instead of `ToolUsePart`.

**Evidence from logs (09:38:13)**:
```
WARNING | ai_sdk_v6_compat:_process_part:366 - [AI SDK v6] Ignoring internal chunk type: 'tool-change_bgm'
Full part data: {
  'type': 'tool-change_bgm',
  'toolCallId': 'adk-4c4ebd1f-6bd6-4a46-96f5-e639f6b4f591',
  'state': 'output-available',
  ...
  // ❌ Missing 'toolName' field
}
```

**Fix**: Modified `ToolUsePart` in `ai_sdk_v6_compat.py`:
1. Made `tool_name` optional: `tool_name: str | None = Field(default=None, alias="toolName")`
2. Added `model_post_init()` to derive `tool_name` from `type` field
3. If `type='tool-change_bgm'`, derives `tool_name='change_bgm'`

**Why this works**: Pydantic can now validate tool parts even without explicit `toolName`, allowing `process_tool_use_parts()` to process them correctly.

### Phase 2: Test with Minimal Tool
1. Test with existing `change_bgm` tool
2. Verify logs show `resolve_tool_result` being called
3. Verify backend doesn't hang
4. Verify conversation continues normally

### Phase 3: Verify Both Scenarios
1. Test approve scenario
2. Test deny scenario
3. Verify no regressions

## Expected Results

### Before Fix
- ❌ Backend hangs after tool approval
- ❌ No `resolve_tool_result` in logs
- ❌ Conversation stalls

### After Fix
- ✅ Backend processes tool output from messages
- ✅ `resolve_tool_result` called and logged
- ✅ Future resolves, tool returns result
- ✅ Conversation continues normally

## Test Plan

1. Start backend and frontend servers
2. Switch to ADK SSE mode
3. Request: "Please change the BGM to track 0"
4. Approve tool execution
5. Verify:
   - Server logs show `[FrontendDelegate] Awaiting result for tool_call_id=...`
   - Server logs show `[Tool] Tool {id} output available: ...`
   - Server logs show `[FrontendDelegate] Resolving tool_call_id=... with result: ...`
   - Server logs show `[FrontendDelegate] Received result for tool_call_id=...`
   - Conversation continues without hanging

## Test Results (2025-12-16 12:40 JST)

### ✅ Test Successful - Both Fixes Working

**Test Scenario**: User requested "Please change the BGM to track 1"

**Observed Behavior**:
1. Tool approval UI displayed correctly
2. User clicked "Approve"
3. BGM changed from track 0 to track 1 (UI showed 🎵 BGM 2)
4. Tool status: "Completed"
5. Tool result displayed correctly
6. Conversation continued with: "The BGM has been changed to track 1."
7. **No errors, no hanging!**

**Server Log Evidence**:

```
# Tool approval sent
12:40:44 | INFO | [FrontendDelegate] Awaiting result for tool_call_id=adk-d0ca264c-57b6-4766-886a-c259ba007c8d

# Frontend sends tool output, backend processes it
12:41:06 | INFO | [/stream] Processing tool outputs from 3 messages
12:41:06 | INFO | [Tool] Tool adk-d0ca264c-57b6-4766-886a-c259ba007c8d output available
12:41:06 | DEBUG | [FrontendDelegate] resolve_tool_result called for adk-d0ca264c-57b6-4766-886a-c259ba007c8d
12:41:06 | INFO | [FrontendDelegate] Resolving tool_call_id=adk-d0ca264c-57b6-4766-886a-c259ba007c8d with result
12:41:06 | DEBUG | [FrontendDelegate] Future resolved successfully for adk-d0ca264c-57b6-4766-886a-c259ba007c8d
12:41:06 | INFO | [FrontendDelegate] Received result for tool_call_id=adk-d0ca264c-57b6-4766-886a-c259ba007c8d

# Conversation continues
12:41:07 | INFO | The BGM has been changed to track 1.
12:41:07 | INFO | [/stream] Completed with 13 SSE events
```

**Key Confirmations**:
- ✅ No `NameError: name 'frontend_delegate' is not defined` (import fix working)
- ✅ Tool parts correctly identified as `ToolUsePart` with `type='tool-change_bgm'` (validation fix working)
- ✅ `resolve_tool_result()` called and Future resolved successfully
- ✅ Full flow completed without hanging

**Files Modified**:
1. `ai_sdk_v6_compat.py:216-228` - Made `tool_name` optional and added auto-derivation from `type` field
2. `server.py:52` - Added import: `from tool_delegate import FrontendToolDelegate, frontend_delegate`

## References

- Tool delegate pattern: `tool_delegate.py`
- Tool output processing: `ai_sdk_v6_compat.py:process_tool_use_parts()`
- SSE endpoint: `server.py:/stream`
- Previous analysis: `experiments/2025-12-16_manual_send_tool_approval_design.md`
