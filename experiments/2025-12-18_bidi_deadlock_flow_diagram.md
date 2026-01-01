# BIDI Mode Deadlock Flow Diagram

**Date:** 2025-12-18

## Current Behavior (DEADLOCK)

```
Backend (server.py)                       Frontend (React + WebSocket)
==================                        ================================

[Tool: change_bgm]
adk_ag_tools.py:217
  |
  v
Check tool_context exists?
  |
  +---> YES: Frontend Delegate Tool
        |
        v
[FrontendToolDelegate]
server.py:79
  |
  v
execute_on_frontend(tool_call_id, tool_name, args)
  |
  +---> Create Future
  |     Store in _pending_calls{}
  |
  +---> Send tool-input-available
  |     via WebSocket
  |                                          |
  |                                          v
  |                                     [WebSocket.onmessage]
  |                                     websocket-chat-transport.ts:556
  |                                          |
  |                                          v
  |                                     handleWebSocketMessage()
  |                                     websocket-chat-transport.ts:655
  |                                          |
  |                                          v
  |                                     Parse SSE format
  |                                     "data: {...}\n\n"
  |                                          |
  |                                          v
  |                                     controller.enqueue(chunk)
  |                                     Forward to useChat hook
  |                                          |
  |                                          v
  |                                     [useChat Hook]
  |                                     AI SDK v6
  |                                          |
  |                                          v
  |                                     Update messages state
  |                                     Re-render UI
  |                                          |
  |                                          v
  |                                     [ToolInvocationComponent]
  |                                     tool-invocation.tsx:38
  |                                          |
  |                                          v
  |                                     Display UI:
  |                                     - Tool: change_bgm
  |                                     - State: input-available
  |                                     - Label: "Executing..."
  |                                          |
  v                                          v
await future                             ❌ NO AUTO-EXECUTION
LINE 105                                 ❌ NO sendToolResult()
  |                                          |
  |                                          v
  |                                     [Ping/Pong Keepalive]
  |                                     Every 2 seconds
  |                                          |
  |                                          v
  |                                     No progress...
  |                                     No progress...
  |                                     No progress...
  |                                          |
  |                                          v
  |                                     [Test Timeout: 60s]
  |                                          |
  |                                          v
💀 DEADLOCK                              Test fails ❌
Future never resolves
Backend hangs forever
```

Legend / 凡例:

- Backend: バックエンド
- Frontend: フロントエンド
- Tool: ツール
- WebSocket: WebSocket通信
- Future: 非同期Future（Promise相当）
- DEADLOCK: デッドロック状態

---

## Expected Behavior (FIX)

```
Backend (server.py)                       Frontend (React + WebSocket)
==================                        ================================

[Tool: change_bgm]
adk_ag_tools.py:217
  |
  v
Check tool_context exists?
  |
  +---> YES: Frontend Delegate Tool
        |
        v
[FrontendToolDelegate]
server.py:79
  |
  v
execute_on_frontend(tool_call_id, tool_name, args)
  |
  +---> Create Future
  |     Store in _pending_calls{}
  |
  +---> Send tool-input-available
  |     via WebSocket
  |                                          |
  |                                          v
  |                                     [WebSocket.onmessage]
  |                                          |
  |                                          v
  |                                     handleWebSocketMessage()
  |                                          |
  |                                          v
  |                                     controller.enqueue(chunk)
  |                                          |
  |                                          v
  |                                     [useChat Hook]
  |                                          |
  |                                          v
  |                                     Update messages state
  |                                          |
  |                                          v
  |                                     [ToolInvocationComponent]
  |                                          |
  |                                          v
  |                                     ✅ DETECT: Frontend delegate tool
  |                                     ✅ AUTO-EXECUTE via useEffect
  |                                          |
  |                                          v
  |                                     executeToolCallback(
  |                                       toolName: "change_bgm",
  |                                       toolCallId: "...",
  |                                       args: {track: 1}
  |                                     )
  |                                     chat.tsx:167
  |                                          |
  |                                          v
  |                                     Execute locally:
  |                                     audioContext.bgmChannel.switchTrack()
  |                                          |
  |                                          v
  |                                     Build result:
  |                                     {
  |                                       success: true,
  |                                       current_track: 1,
  |                                       message: "BGM changed to track 1"
  |                                     }
  |                                          |
  |                                          v
  |                                     ✅ SEND via WebSocket:
  |                                     transport.sendToolResult(
  |                                       toolCallId,
  |                                       result
  |                                     )
  |                                     websocket-chat-transport.ts:320
  |                                          |
  |                                          v
  |                                     WebSocket.send({
  |                                       type: "tool_result",
  |                                       data: {
  |                                         toolCallId: "...",
  |                                         result: {...}
  |                                       }
  |                                     })
  |
  |  <----------------------------------+ WebSocket message
  |
  v
[WebSocket Handler]
server.py:784
  |
  v
event_type == "tool_result"?
  |
  +---> YES
        |
        v
Get frontend_delegate from session
  |
  v
delegate.resolve_tool_result(
  tool_call_id,
  result
)
server.py:111
  |
  v
Find Future in _pending_calls{}
  |
  v
future.set_result(result)
  |
  v
✅ Future resolves!
  |
  v
await future completes
LINE 105
  |
  v
Return result to tool
  |
  v
Tool returns to ADK agent
  |
  v
Agent continues execution
  |
  v
✅ SUCCESS
```

Legend / 凡例:

- AUTO-EXECUTE: 自動実行
- SEND: 送信
- Future resolves: Futureが解決される
- SUCCESS: 成功

---

## Tool Type Comparison

```
+-------------------+  +---------------------+  +----------------------+
| Backend Tool      |  | Frontend Delegate   |  | Long-Running Tool    |
| (get_weather)     |  | (change_bgm)        |  | (wrapped with LRT)   |
+-------------------+  +---------------------+  +----------------------+
        |                      |                          |
        v                      v                          v
    No tool_context       Has tool_context          Returns None
        |                      |                          |
        v                      v                          v
  Execute on                Check for                ADK pauses
  backend                 frontend_delegate            agent
        |                      |                          |
        v                      v                          v
  Return result         delegate.execute()          Send to frontend
  immediately                  |                          |
        |                      |                          v
        v                      v                    Show approval UI
  Send tool-output      await Future                     |
  via SSE                      |                          v
        |                      |                    User approves
        v                      |                          |
    DONE                       |                          v
                               |              sendFunctionResponse({
                               |                approved: true
                               |              })
                               |                          |
                               v                          v
                   Send tool-input-available    Backend resumes
                               |                          |
                               v                          v
                   Frontend receives           Agent continues
                               |                          |
                               v                          v
                   Auto-execute tool              DONE
                               |
                               v
                   sendToolResult({
                     result: {...}
                   })
                               |
                               v
                   Backend receives
                               |
                               v
                   resolve_tool_result()
                               |
                               v
                   Future resolves
                               |
                               v
                         DONE
```

Legend / 凡例:

- Backend Tool: バックエンドツール
- Frontend Delegate: フロントエンド委譲ツール
- Long-Running Tool: 長時間実行ツール
- Execute: 実行
- Approval UI: 承認UI
- User approves: ユーザーが承認

---

## Missing Logic Location

```
File: components/tool-invocation.tsx
====================================

Current Code (lines 85-125):
---------------------------
const isLongRunningTool =
  state === "input-available" && websocketTransport !== undefined;

// Long-running tool approval handler
const handleLongRunningToolResponse = (approved: boolean) => {
  websocketTransport?.sendFunctionResponse(
    toolInvocation.toolCallId,
    toolName,
    { approved, ... }
  );
};

// Renders approval UI for long-running tools
{isLongRunningTool && !approvalSent && (
  <button onClick={() => handleLongRunningToolResponse(true)}>
    Approve
  </button>
)}


NEED TO ADD:
-----------
// Detect frontend delegate tools (not long-running)
const isFrontendDelegateTool =
  state === "input-available" &&
  websocketTransport !== undefined &&
  !isLongRunningTool &&
  !isAdkConfirmation &&
  executeToolCallback !== undefined;

// Auto-execute frontend delegate tools
useEffect(() => {
  if (isFrontendDelegateTool && !executionAttempted) {
    setExecutionAttempted(true);

    executeToolCallback(
      toolName,
      toolInvocation.toolCallId,
      toolInvocation.input || {}
    ).then((success) => {
      if (success) {
        // Get result from executeToolCallback return value
        // or from some shared state
        const result = {...}; // Need to capture from executeToolCallback

        websocketTransport.sendToolResult(
          toolInvocation.toolCallId,
          result
        );
      }
    });
  }
}, [isFrontendDelegateTool, executionAttempted, ...]);
```

Legend / 凡例:

- Current Code: 現在のコード
- NEED TO ADD: 追加が必要なコード
- Auto-execute: 自動実行
- Long-running tool: 長時間実行ツール
- Frontend delegate tool: フロントエンド委譲ツール
