# BIDI Mode Frontend Delegate Deadlock Analysis

**Date:** 2025-12-18
**Status:** 🟢 Root Cause Identified
**Session:** e2e-feature-1

## Executive Summary

Identified the root cause of BIDI mode failures for frontend delegate tools (change_bgm, get_location, process_payment). The deadlock occurs because frontend receives `tool-input-available` events but never sends back `tool_result` to resolve backend's awaiting Future.

## Test Results Baseline

| Tool | Type | Confirmation | SSE Mode | BIDI Mode | Issue |
|------|------|--------------|----------|-----------|-------|
| get_weather | Backend | No | ✅ PASS | ✅ PASS | None |
| change_bgm | Frontend Delegate | No | ✅ PASS | ❌ FAIL | Deadlock - No tool result sent |
| process_payment | Frontend Delegate | Yes | ✅ PASS | ❌ FAIL | Deadlock - No tool result sent |
| get_location | Frontend Delegate | Yes | ✅ PASS | ❌ FAIL | Deadlock - No tool result sent |

## Evidence

### Frontend Chunk Logs Analysis

**✅ get_weather (SUCCESS):**
```jsonl
{"sequence_number":11,"chunk":"data: {\"type\": \"tool-input-available\", ...}"}
{"sequence_number":42,"chunk":"data: {\"type\": \"tool-output-available\", ...}"}
```
- Has complete flow: tool-input → **tool-output**

**❌ change_bgm (FAILURE):**
```jsonl
{"sequence_number":10,"chunk":"data: {\"type\": \"tool-input-available\", ...}"}
{"sequence_number":11,"chunk":"{\"type\":\"ping\",...}"}
```
- **Missing:** tool-output-available
- Only ping/pong after tool-input-available → Deadlock

**❌ process_payment (FAILURE):**
```jsonl
{"sequence_number":14,"chunk":"data: {\"type\": \"tool-input-available\", ...}"}
{"sequence_number":16,"chunk":"{\"type\":\"message\",\"data\":{\"messages\":[{\"content\":[{\"type\":\"tool-result\",\"result\":{\"approved\":true,...}}]}]}}"}
```
- User approval sent (approved: true)
- **Missing:** tool-output-available after approval → Deadlock

### Backend Logs Analysis

**change_bgm deadlock timestamp gap:**
```python
# Line 179: change_bgm function_call
{"timestamp": 1766077628391, "chunk": "Event(...function_call=FunctionCall(name='change_bgm'..."}

# Line 180: Next event 105 seconds later (next test!)
{"timestamp": 1766077733260, "sequence_number": 180}
```
- 105-second gap = Test timeout (60s) + next test start
- Proves backend is blocked waiting for frontend response

## Root Cause: Missing Auto-Execution Logic

### Backend: Frontend Delegate Pattern (server.py:62-121)

```python
class FrontendToolDelegate:
    """Delegate tool execution to frontend via WebSocket."""

    async def execute_on_frontend(
        self, tool_call_id: str, tool_name: str, args: dict[str, Any]
    ) -> dict[str, Any]:
        """Delegate to frontend and await result."""
        future: asyncio.Future[dict[str, Any]] = asyncio.Future()
        self._pending_calls[tool_call_id] = future

        # Await frontend result (BLOCKS HERE)
        result = await future  # LINE 105 - DEADLOCK POINT

        return result

    def resolve_tool_result(self, tool_call_id: str, result: dict[str, Any]) -> None:
        """Resolve pending Future when frontend sends tool_result."""
        if tool_call_id in self._pending_calls:
            self._pending_calls[tool_call_id].set_result(result)
```

**Backend WebSocket Handler (server.py:784-798):**
```python
elif event_type == "tool_result":
    tool_result_data = event.get("data", {})
    tool_call_id = tool_result_data.get("toolCallId")
    result = tool_result_data.get("result")

    if tool_call_id and result:
        delegate = session.state.get("frontend_delegate")
        if delegate:
            delegate.resolve_tool_result(tool_call_id, result)  # ✅ Ready to resolve
            logger.info(f"[BIDI] Resolved tool result for {tool_call_id}")
```

**Backend is ready!** It can handle incoming `tool_result` events and resolve Futures.

### Frontend: WebSocket Transport (lib/websocket-chat-transport.ts:320-333)

```typescript
public sendToolResult(
  toolCallId: string,
  result: Record<string, unknown>,
): void {
  const event: ToolResultEvent = {
    type: "tool_result",
    version: "1.0",
    data: {
      toolCallId,
      result,
    },
  };
  this.sendEvent(event);
}
```

**Frontend has the method!** `sendToolResult()` exists and can send tool_result events.

### Frontend: Tool Execution (components/chat.tsx:167-266)

```typescript
const executeToolCallback = useCallback(
  async (toolName: string, toolCallId: string, args: Record<string, unknown>): Promise<boolean> => {
    let result: Record<string, unknown> = {};

    switch (toolName) {
      case "change_bgm": {
        const track = args?.track ?? 1;
        audioContext.bgmChannel.switchTrack();
        result = {
          success: true,
          current_track: track,
          message: `BGM changed to track ${track}`,
        };
        break;
      }

      case "get_location": {
        result = await new Promise((resolve) => {
          navigator.geolocation.getCurrentPosition(
            (position) => resolve({ success: true, latitude: position.coords.latitude, ... }),
            (error) => resolve({ success: false, error: error.message }),
          );
        });
        break;
      }
    }

    // Send result via AI SDK v6 standard API
    addToolOutput({
      tool: toolName,
      toolCallId: toolCallId,
      state: "output-available",
      output: result,
    });

    return true;
  },
  [audioContext, addToolOutput]
);
```

**Frontend has the logic!** `executeToolCallback` can execute tools locally.

### Frontend: UI Component (components/tool-invocation.tsx)

**Current behavior - Only executes for approved tools:**
```typescript
// Line 85-86: Long-running tool detection
const isLongRunningTool =
  state === "input-available" && websocketTransport !== undefined;

// Line 89-125: Long-running tool approval handler
const handleLongRunningToolResponse = (approved: boolean) => {
  websocketTransport?.sendFunctionResponse(toolCallId, toolName, {
    approved,
    user_message: approved ? `User approved ${toolName} execution` : `User denied ${toolName} execution`,
    timestamp: new Date().toISOString(),
  });
};

// Line 320-361: Standard approval flow (only for approval-requested state)
onClick={async () => {
  addToolApprovalResponse?.({ id: toolInvocation.approval.id, approved: true });

  // Execute tool ONLY after approval
  if (executeToolCallback) {
    await executeToolCallback(toolName, toolInvocation.toolCallId, toolInvocation.input || {});
  }
}}
```

**❌ Missing: Auto-execution for frontend delegate tools that DON'T require approval**

## Deadlock Mechanism

```
┌──────────────────────────────────────────────────────────────────────┐
│                        BIDI Frontend Delegate Flow                   │
└──────────────────────────────────────────────────────────────────────┘

Backend                          Frontend
───────                          ────────

1. Tool call: change_bgm(track=1)
   └─ Check for tool_context
   └─ Get frontend_delegate
   └─ delegate.execute_on_frontend()
       ├─ Create Future
       ├─ Store in _pending_calls
       └─ await future ⏸️             → Send tool-input-available
        (BLOCKS HERE)                    │
                                         ↓
                                    2. WebSocket receives event
                                       └─ handleWebSocketMessage()
                                       └─ Parse SSE format
                                       └─ controller.enqueue(chunk)
                                           │
                                           ↓
                                    3. useChat hook processes
                                       └─ Add to messages
                                       └─ Re-render UI
                                           │
                                           ↓
                                    4. ToolInvocationComponent renders
                                       └─ state = "input-available"
                                       └─ Display "Executing..."
                                       └─ ❌ NO AUTO-EXECUTION
                                       └─ ❌ NO sendToolResult()
                                           │
                                           ↓
                                    5. Ping/pong keepalive
                                       └─ No progress
                                       └─ Test timeout (60s)

⏸️ await future (never resolves)
   │
   ↓
💀 DEADLOCK
   │
   ↓
Test fails with timeout
```

## The Missing Logic

**For frontend delegate tools in BIDI mode that DON'T require approval:**

1. **Detection:** When `tool-input-available` arrives with:
   - Tool is frontend delegate (change_bgm, get_location, etc.)
   - NOT a long-running tool requiring approval
   - WebSocket transport available

2. **Execution:** Automatically call:
   ```typescript
   const result = await executeToolCallback(toolName, toolCallId, args);
   ```

3. **Result transmission:** Send result back via WebSocket:
   ```typescript
   transport.sendToolResult(toolCallId, result);
   ```

This should happen **automatically** when tool-input-available arrives, without waiting for user action.

## Tool Type Classification

| Tool Type | Approval | Execution | Result Transmission | Example |
|-----------|----------|-----------|---------------------|---------|
| Backend Tool | No | Backend | SSE events | get_weather |
| Frontend Delegate (no approval) | No | Frontend auto-execute | **sendToolResult** | change_bgm |
| Frontend Delegate (with approval) | Yes | Frontend after approval | **sendToolResult** | get_location, process_payment |
| Long-running (ADK pattern) | Yes | Backend resumes | **sendFunctionResponse** | Wrapped with LongRunningFunctionTool |

## Key Distinction

**Two different patterns in BIDI mode:**

1. **LongRunningFunctionTool Pattern:**
   - Tool returns None → Backend pauses
   - Frontend shows approval UI
   - User approves → `sendFunctionResponse()` with approved flag
   - Backend resumes with user's decision
   - Used for: Tools wrapped with `LongRunningFunctionTool()`

2. **Frontend Delegate Pattern:**
   - Tool calls `delegate.execute_on_frontend()` → Backend awaits Future
   - Frontend receives tool-input-available
   - Frontend **should auto-execute** tool locally
   - Frontend **should send tool_result** back
   - Backend resolves Future and returns result
   - Used for: Tools with `tool_context` parameter that check for frontend delegate

## Next Steps

1. **Implement auto-execution logic** in ToolInvocationComponent:
   - Detect frontend delegate tools (state="input-available", websocketTransport available, NOT long-running)
   - Call executeToolCallback automatically using useEffect
   - Send result via transport.sendToolResult()

2. **Distinguish frontend delegate tools from long-running tools:**
   - Frontend delegate: Auto-execute → sendToolResult
   - Long-running: Show approval UI → sendFunctionResponse

3. **Test with all 4 tools:**
   - get_weather: Should still work (backend tool)
   - change_bgm: Should auto-execute and send result
   - process_payment: Should show approval, then execute and send result
   - get_location: Should show approval, then execute and send result

## References

- Frontend chunk logs: `chunk_logs/e2e-feature-1/frontend/`
- Backend chunk logs: `chunk_logs/e2e-feature-1/backend-adk-event.jsonl`
- WebSocket transport: `lib/websocket-chat-transport.ts:320-333` (sendToolResult method)
- Tool execution: `components/chat.tsx:167-266` (executeToolCallback)
- Tool UI: `components/tool-invocation.tsx`
- Backend delegate: `server.py:62-121` (FrontendToolDelegate)
- Backend WebSocket handler: `server.py:784-798` (tool_result event handling)
