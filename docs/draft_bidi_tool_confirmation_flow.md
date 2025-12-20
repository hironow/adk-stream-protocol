# BIDI Tool Confirmation Flow (Draft - SSE Pattern Applied)

**Status**: Draft Design (Not Yet Implemented)
**Last Updated**: 2025-12-20

## Overview

This document describes a **draft design** for BIDI tool confirmation flow that **exactly mirrors the SSE native pattern**. This design applies the same protocol structure from `adk_native_tool_confirmation_flow.md` to BIDI mode.

**Design Goal**: Achieve maximum consistency between SSE and BIDI modes by using identical protocol semantics.

**Key Difference from SSE**: Transport layer only (WebSocket vs HTTP), protocol semantics remain identical.

## Flow Diagram

```
User Request
    ↓
AI Model Decision (tool call needed)
    ↓
Backend Confirmation Check
    ↓
[CONFIRMATION NEEDED]
    ↓
Backend: Generate adk_request_confirmation tool-input (via WebSocket)
    ↓
Frontend: Display Approval UI
    ↓
User: Click Approve/Deny
    ↓
Frontend: Send adk_request_confirmation tool-output (via WebSocket)
    ↓
Backend: Process confirmation result
    ↓
[IF APPROVED]
    ↓
Backend: Execute original tool
    ↓
AI Model: Generate response with tool result
```

**Note**: Flow is **identical to SSE** - only transport mechanism changes.

## Detailed Step-by-Step Flow

### Step 1: User Request

**User Input**:

```
花子さんに50ドル送金してください
```

**Frontend Action**:

- User submits message via chat interface
- Frontend sends WebSocket message event:

```json
{
  "type": "message",
  "version": "1.0",
  "data": {
    "messages": [
      {
        "role": "user",
        "content": [{"type": "text", "text": "花子さんに50ドル送金してください"}]
      }
    ]
  }
}
```

### Step 2: AI Model Decision

**AI Model Behavior**:

- AI decides to call `process_payment` tool
- Generates `FunctionCall` with:
    - `id`: `"function-call-123"`
    - `name`: `"process_payment"`
    - `args`: `{"amount": 50, "recipient": "花子", "currency": "USD"}`

**Note**: Same as SSE - AI model behavior is transport-agnostic.

### Step 3: Backend Confirmation Check

**Backend Logic** (same as SSE):

```python
# Check if tool requires confirmation
if function_call.name in confirmation_tools:
    # Generate confirmation UI tool call
    return adk_request_confirmation_tool_call
```

### Step 4: Backend Generates adk_request_confirmation

**Backend Sends** (via WebSocket SSE-formatted events):

```json
// WebSocket Event 1: tool-input-start for confirmation
data: {
  "type": "tool-input-start",
  "toolCallId": "confirmation-function-call-789",
  "toolName": "adk_request_confirmation"
}

// WebSocket Event 2: tool-input-available for confirmation
data: {
  "type": "tool-input-available",
  "toolCallId": "confirmation-function-call-789",
  "toolName": "adk_request_confirmation",
  "input": {
    "originalFunctionCall": {
      "id": "function-call-123",
      "name": "process_payment",
      "args": {"amount": 50, "recipient": "花子", "currency": "USD"}
    },
    "toolConfirmation": {
      "confirmed": false
    }
  }
}
```

**Critical Points** (identical to SSE):

- Confirmation tool has its own ID: `"confirmation-function-call-789"`
- Original tool information is embedded in `originalFunctionCall`
- The AI model is waiting for `adk_request_confirmation` result, NOT `process_payment` result

**Transport Difference**:

- SSE: Sent via HTTP response stream
- BIDI: Sent via WebSocket messages (but same event structure)

### Step 5: Frontend Displays Approval UI

**Frontend Logic** (identical to SSE):

```typescript
// Detect adk_request_confirmation tool invocation
if (toolInvocation.toolName === "adk_request_confirmation") {
  const originalToolCall = toolInvocation.input?.originalFunctionCall;

  // Display Approve/Deny buttons
  return (
    <div>
      <p>Approve {originalToolCall.name}?</p>
      <button onClick={() => handleApprove()}>Approve</button>
      <button onClick={() => handleDeny()}>Deny</button>
    </div>
  );
}
```

**Note**: UI code is **identical** between SSE and BIDI modes.

### Step 6: User Clicks Approve/Deny

**User Action**:

- User clicks "Approve" button in UI

**Note**: User experience is identical to SSE mode.

### Step 7: Frontend Sends adk_request_confirmation Result

**Frontend Action** (BIDI-specific implementation):

In SSE mode, we use `addToolOutput()` which triggers a second HTTP request.
In BIDI mode, we send a tool-result message via WebSocket:

```typescript
// User clicked Approve
websocketTransport.sendToolResult(
  "confirmation-function-call-789",  // Confirmation tool ID!
  {
    confirmed: true                   // User's decision
  }
);
```

**WebSocket Message Sent**:

```json
{
  "type": "tool_result",
  "version": "1.0",
  "data": {
    "toolCallId": "confirmation-function-call-789",
    "toolName": "adk_request_confirmation",
    "result": {
      "confirmed": true
    }
  }
}
```

**Critical Points** (matching SSE semantics):

- Frontend sends result for `adk_request_confirmation` tool (NOT original tool)
- Uses confirmation tool's ID: `"confirmation-function-call-789"`
- Does NOT use original tool's ID: `"function-call-123"`
- Result format: `{"confirmed": true/false}`

**Transport Difference**:

- SSE: `addToolOutput()` → New HTTP POST to `/stream`
- BIDI: `sendToolResult()` → WebSocket message

### Step 8: Backend Processes Confirmation Result

**Backend Logic** (identical to SSE):

```python
# Receive adk_request_confirmation result via WebSocket
confirmation_result = tool_result["result"]  # {"confirmed": true}

if confirmation_result.get("confirmed"):
    # User approved - execute original tool
    original_tool_result = execute_tool(
        name="process_payment",
        args={"amount": 50, "recipient": "花子", "currency": "USD"}
    )

    # Send original tool result to AI (via WebSocket)
    yield tool_output_available_event(
        tool_call_id="function-call-123",
        tool_name="process_payment",
        output=original_tool_result
    )
else:
    # User denied - send error
    yield tool_output_error_event(
        tool_call_id="function-call-123",
        error="User denied execution"
    )
```

**Transport Difference**:

- SSE: Events sent via HTTP response stream
- BIDI: Events sent via WebSocket messages

**Protocol Semantics**: Identical - backend processes confirmation and executes original tool.

### Step 9: AI Model Generates Final Response

**AI Model Behavior** (identical to SSE):

- Receives `process_payment` tool result
- Generates natural language response:

  ```
  花子さんに50ドルを送金しました。
  ```

**Transport Difference**:

- SSE: Response sent via HTTP stream
- BIDI: Response sent via WebSocket messages

## Key Protocol Characteristics (BIDI with SSE Pattern)

### 1. Single WebSocket Connection (Not Two HTTP Requests)

BIDI mode uses **single persistent WebSocket connection**:

1. **User Message**: Sent via WebSocket message event
2. **AI Response Stream**: Received via WebSocket (including confirmation events)
3. **Confirmation Result**: Sent via WebSocket tool_result event
4. **AI Continuation**: Received via same WebSocket

**Key Difference from SSE**: No second HTTP request - all communication via one WebSocket.

### 2. Confirmation Tool Identity (Identical to SSE)

```
Confirmation Tool:
  - ID: "confirmation-function-call-789"
  - Name: "adk_request_confirmation"
  - Result: {"confirmed": true/false}

Original Tool:
  - ID: "function-call-123"
  - Name: "process_payment"
  - Args: {"amount": 50, ...}
  - Result: (executed after approval)
```

**Important**: Protocol semantics **identical to SSE** - frontend responds to confirmation tool, NOT original tool.

### 3. Backend Controls Tool Execution (Identical to SSE)

Backend logic flow:

```python
# 1. AI calls process_payment
# 2. Backend intercepts and generates adk_request_confirmation
# 3. Frontend approves adk_request_confirmation
# 4. Backend executes process_payment
# 5. Backend sends process_payment result to AI
```

**Note**: Logic is **identical to SSE** - only transport layer differs.

## Implementation Requirements

### Frontend Changes Required

#### 1. Add sendToolResult Method to WebSocket Transport

```typescript
// lib/websocket-chat-transport.ts
public sendToolResult(
  toolCallId: string,
  result: Record<string, unknown>,
): void {
  const message: ToolResultEvent = {
    type: "tool_result",
    version: "1.0",
    data: {
      toolCallId,
      result,
    },
  };
  this.sendEvent(message);
}
```

#### 2. Update Confirmation Handler for BIDI

```typescript
// lib/confirmation-handler.ts
export function handleConfirmation(
  toolInvocation: ConfirmationToolInvocation,
  confirmed: boolean,
  transport: ConfirmationTransport,
): ConfirmationResult {
  if (transport.websocket) {
    // Send result for CONFIRMATION tool (not original tool!)
    transport.websocket.sendToolResult(
      toolInvocation.toolCallId,        // confirmation-function-call-789
      {
        confirmed: confirmed,
      }
    );
    return { success: true, mode: "websocket" };
  }

  // ... SSE mode handling ...
}
```

**Critical Change**: Send result for `toolInvocation.toolCallId` (confirmation tool), NOT `originalFunctionCall.id`.

### Backend Changes Required

#### 1. Add tool_result Event Handler

```python
# services/bidi_event_receiver.py
async def handle_tool_result_event(event: dict) -> None:
    """Handle tool_result event from WebSocket."""
    tool_call_id = event["data"]["toolCallId"]
    result = event["data"]["result"]

    # Resolve pending tool result (for frontend delegate tools like adk_request_confirmation)
    frontend_delegate.resolve_tool_result(tool_call_id, result)
```

#### 2. Update FrontendToolDelegate to Handle adk_request_confirmation

```python
# services/frontend_tool_service.py
class FrontendToolDelegate:
    async def execute_on_frontend(
        self,
        tool_name: str,
        args: dict[str, Any],
        function_call_id: str,
    ) -> Result[dict[str, Any], str]:
        """
        Execute tool on frontend and wait for result via tool_result event.

        This is used for both:
        - Frontend delegate tools (change_bgm, get_location in BIDI)
        - Confirmation tools (adk_request_confirmation in BIDI)
        """
        # Register pending call
        future = asyncio.Future()
        self.pending_calls[function_call_id] = future

        # Wait for frontend to send tool_result event
        try:
            result = await asyncio.wait_for(future, timeout=5.0)
            return Ok(result)
        except asyncio.TimeoutError:
            return Error(f"Timeout waiting for {tool_name} result")
```

## Comparison with SSE Mode

| Aspect | SSE Mode | BIDI Mode (This Draft) |
|--------|----------|------------------------|
| **Transport** | HTTP (multiple requests) | WebSocket (single connection) |
| **User Message** | HTTP POST | WebSocket message event |
| **Confirmation Tool** | tool-input-available via SSE | tool-input-available via WebSocket |
| **User Approval** | addToolOutput() → New HTTP POST | sendToolResult() → WebSocket tool_result |
| **Confirmation Target** | `adk_request_confirmation` | `adk_request_confirmation` (SAME) |
| **Tool ID Used** | Confirmation tool ID | Confirmation tool ID (SAME) |
| **Backend Processing** | Process confirmation, execute original tool | SAME |
| **AI Response** | Via SSE stream | Via WebSocket |
| **Protocol Semantics** | Native ADK pattern | **IDENTICAL** |

**Key Insight**: Only transport layer differs - protocol semantics are identical.

## Advantages of This Design

### 1. Maximum Consistency

```typescript
// Frontend code is NEARLY IDENTICAL
if (mode === "sse") {
  addToolOutput({
    tool: "adk_request_confirmation",
    toolCallId: confirmationToolId,
    output: { confirmed: true }
  });
} else { // BIDI
  websocketTransport.sendToolResult(
    confirmationToolId,  // Same ID!
    { confirmed: true }  // Same result!
  );
}
```

### 2. Clear Separation of Concerns

- **Protocol Layer**: Identical between SSE and BIDI
- **Transport Layer**: Different (HTTP vs WebSocket)
- **UI Layer**: Identical (same components, same logic)

### 3. Aligned with ADK Native Pattern

- Both modes follow ADK's native confirmation tool pattern
- Both modes use confirmation tool ID for responses
- Both modes separate confirmation from original tool execution

### 4. Easier to Test and Maintain

- Same test scenarios work for both modes
- Same baseline chunk logs structure
- Same debugging approach

## Testing This Design

### Verification Checklist

1. ✅ Frontend receives `adk_request_confirmation` tool-input-available (via WebSocket)
2. ✅ Approval UI displays with original tool information
3. ✅ User can click Approve/Deny
4. ✅ Frontend sends tool_result for `adk_request_confirmation` (via WebSocket)
5. ✅ Backend receives tool_result event
6. ✅ Backend executes original tool (if approved)
7. ✅ AI generates final response with tool result

### Expected WebSocket Message Flow

```
→ message event (user: "花子さんに50ドル送金してください")
← tool-input-start (adk_request_confirmation)
← tool-input-available (adk_request_confirmation)
→ tool_result event (confirmation-function-call-789: {confirmed: true})
← tool-input-start (process_payment)
← tool-input-available (process_payment)
← tool-output-available (process_payment)
← text-delta (AI response)
```

**Note**: Structure mirrors SSE mode, just via WebSocket.

## Open Questions

1. **Event Type Naming**: Should we use `tool_result` or `tool-result` in WebSocket events?
2. **Error Handling**: How to handle WebSocket disconnection during confirmation wait?
3. **Timeout Behavior**: Should timeout be same as SSE (5 seconds) or different?
4. **ID Mapper Integration**: Does `adk_request_confirmation` need ID mapping?

## Next Steps

To implement this design:

1. **Update Frontend**:
   - Modify `handleConfirmation` to send confirmation tool result
   - Update tests to verify confirmation tool ID is used

2. **Update Backend**:
   - Add `tool_result` event handler in `bidi_event_receiver.py`
   - Ensure `FrontendToolDelegate` resolves confirmation results

3. **Testing**:
   - Run E2E tests to verify protocol works
   - Compare chunk logs with SSE baseline
   - Verify no timeout errors

## References

- Base Pattern: `docs/adk_native_tool_confirmation_flow.md` (SSE mode)
- ADR 0003: `docs/adr/0003-sse-vs-bidi-confirmation-protocol.md` (may need update)
- Current BIDI Implementation: `services/bidi_event_sender.py`, `services/bidi_event_receiver.py`
