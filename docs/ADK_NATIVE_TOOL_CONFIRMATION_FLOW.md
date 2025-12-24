# ADK Native Tool Confirmation Flow (SSE Mode)

**Status**: Current Implementation (SSE Mode Only)
**Last Updated**: 2025-12-20

## Overview

This document describes the **correct, native ADK tool confirmation flow** in SSE mode. This is the baseline implementation that demonstrates how ADK's `adk_request_confirmation` tool works in its natural environment.

**Scope**: This document covers **SSE mode only**. BIDI mode implementation is documented separately.

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
Backend: Generate adk_request_confirmation tool-input
    ↓
Frontend: Display Approval UI
    ↓
User: Click Approve/Deny
    ↓
Frontend: Send adk_request_confirmation tool-output
    ↓
Backend: Process confirmation result
    ↓
[IF APPROVED]
    ↓
Backend: Execute original tool
    ↓
AI Model: Generate response with tool result
```

## Detailed Step-by-Step Flow

### Step 1: User Request

**User Input**:

```
花子さんに50ドル送金してください
```

**Frontend Action**:

- User submits message via chat interface
- Frontend sends HTTP POST to `/stream` endpoint

### Step 2: AI Model Decision

**AI Model Behavior**:

- AI decides to call `process_payment` tool
- Generates `FunctionCall` with:
    - `id`: `"function-call-123"`
    - `name`: `"process_payment"`
    - `args`: `{"amount": 50, "recipient": "花子", "currency": "USD"}`

### Step 3: Backend Confirmation Check

**Backend Logic** (`adk_compat.py` or confirmation interceptor):

```python
# Check if tool requires confirmation
if function_call.name in confirmation_tools:
    # Generate confirmation UI tool call
    return adk_request_confirmation_tool_call
```

### Step 4: Backend Generates adk_request_confirmation

**Backend Sends** (via SSE stream):

```json
// Event 1: tool-input-start for confirmation
{
  "type": "tool-input-start",
  "toolCallId": "confirmation-adk-123",
  "toolName": "adk_request_confirmation"
}

// Event 2: tool-input-available for confirmation
{
  "type": "tool-input-available",
  "toolCallId": "confirmation-adk-123",
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

**Critical Point**: Notice that:

- Confirmation tool has its own ID: `"confirmation-adk-123"`
- Original tool information is embedded in `originalFunctionCall`
- The AI model is waiting for `adk_request_confirmation` result, NOT `process_payment` result

### Step 5: Frontend Displays Approval UI

**Frontend Logic** (`components/tool-invocation.tsx`):

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

### Step 6: User Clicks Approve/Deny

**User Action**:

- User clicks "Approve" button in UI

### Step 7: Frontend Sends adk_request_confirmation Result

**Frontend Action** (`addToolOutput` from AI SDK):

```typescript
// User clicked Approve
addToolOutput({
  tool: "adk_request_confirmation",           // Confirmation tool!
  toolCallId: "confirmation-adk-123",         // Confirmation tool ID!
  output: {
    confirmed: true                           // User's decision
  }
});
```

**Critical Point**:

- Frontend sends result for `adk_request_confirmation` tool (NOT original tool)
- Uses confirmation tool's ID, not original tool's ID
- This triggers a **second HTTP request** to `/stream` endpoint

**Second HTTP Request**:

```json
POST /stream
{
  "messages": [
    // ... previous messages ...
    {
      "role": "user",
      "content": [
        {
          "type": "tool-result",
          "toolCallId": "confirmation-adk-123",
          "toolName": "adk_request_confirmation",
          "result": {"confirmed": true}
        }
      ]
    }
  ]
}
```

### Step 8: Backend Processes Confirmation Result

**Backend Logic** (SSE endpoint):

```python
# Receive adk_request_confirmation result
confirmation_result = tool_result["result"]  # {"confirmed": true}

if confirmation_result.get("confirmed"):
    # User approved - execute original tool
    original_tool_result = execute_tool(
        name="process_payment",
        args={"amount": 50, "recipient": "花子", "currency": "USD"}
    )

    # Send original tool result to AI
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

### Step 9: AI Model Generates Final Response

**AI Model Behavior**:

- Receives `process_payment` tool result
- Generates natural language response:

  ```
  花子さんに50ドルを送金しました。
  ```

## Key Protocol Characteristics (SSE Mode)

### 1. Two HTTP Requests

SSE mode naturally uses **two separate HTTP requests**:

1. **First Request**: User message → AI generates `adk_request_confirmation` call
2. **Second Request**: Confirmation result → AI continues with approved/denied action

This is the **native ADK pattern** - confirmations are just another tool call/result cycle.

### 2. Confirmation Tool Has Its Own Identity

```
Confirmation Tool:
  - ID: "confirmation-adk-123"
  - Name: "adk_request_confirmation"
  - Result: {"confirmed": true/false}

Original Tool:
  - ID: "function-call-123"
  - Name: "process_payment"
  - Args: {"amount": 50, ...}
  - Result: (executed after approval)
```

**Important**: Frontend responds to confirmation tool, NOT original tool.

### 3. Backend Controls Tool Execution

Backend logic:

```python
# 1. AI calls process_payment
# 2. Backend intercepts and generates adk_request_confirmation
# 3. Frontend approves adk_request_confirmation
# 4. Backend executes process_payment
# 5. Backend sends process_payment result to AI
```

The AI model never directly sees the approval step - it just sees:

1. Tool call for confirmation
2. Confirmation result
3. Original tool execution (if approved)

## AI SDK v6 Integration

### addToolOutput Behavior

When frontend calls `addToolOutput`:

```typescript
addToolOutput({
  tool: "adk_request_confirmation",
  toolCallId: "confirmation-adk-123",
  output: {confirmed: true}
});
```

AI SDK v6 automatically:

1. Creates a new message with tool-result
2. Appends it to conversation history
3. Sends a new HTTP request to `/stream`
4. Continues the conversation

This is the **standard AI SDK v6 pattern** for tool results in SSE mode.

## Why This Works in SSE Mode

1. **Multiple HTTP Requests Are Natural**: Each tool result triggers a new request
2. **Stateless Backend**: Each request is independent
3. **AI SDK v6 Handles Continuation**: Framework manages conversation state
4. **No Custom Protocol Needed**: Uses standard tool call/result pattern

## Common Mistakes to Avoid

### ❌ Mistake 1: Sending Original Tool Result

```typescript
// WRONG - Don't send original tool result
addToolOutput({
  tool: "process_payment",              // ❌ Original tool
  toolCallId: "function-call-123",      // ❌ Original ID
  output: {approved: true}              // ❌ Wrong format
});
```

**Why This Fails**: AI is waiting for `adk_request_confirmation` result, not `process_payment` result.

### ❌ Mistake 2: Mixing Tool IDs

```typescript
// WRONG - Mixed IDs
addToolOutput({
  tool: "adk_request_confirmation",     // ✓ Correct tool
  toolCallId: "function-call-123",      // ❌ Wrong ID (original tool ID)
  output: {confirmed: true}
});
```

**Why This Fails**: Tool name and ID must match.

### ✅ Correct Pattern

```typescript
// CORRECT - Respond to confirmation tool
addToolOutput({
  tool: "adk_request_confirmation",     // ✓ Confirmation tool
  toolCallId: "confirmation-adk-123",   // ✓ Confirmation ID
  output: {confirmed: true}             // ✓ Confirmation result
});
```

## Testing This Flow

### Verification Checklist

1. ✅ Frontend receives `adk_request_confirmation` tool-input-available
2. ✅ Approval UI displays with original tool information
3. ✅ User can click Approve/Deny
4. ✅ Frontend sends tool-result for `adk_request_confirmation`
5. ✅ Second HTTP request is triggered
6. ✅ Backend executes original tool (if approved)
7. ✅ AI generates final response with tool result

### Chunk Log Verification

**Expected Events** (in order):

```jsonl
{"type": "tool-input-start", "toolName": "adk_request_confirmation"}
{"type": "tool-input-available", "toolName": "adk_request_confirmation", "input": {...}}
// ... user approves ...
{"type": "tool-output-available", "toolName": "adk_request_confirmation", "output": {"confirmed": true}}
{"type": "tool-input-start", "toolName": "process_payment"}
{"type": "tool-input-available", "toolName": "process_payment"}
{"type": "tool-output-available", "toolName": "process_payment", "output": {...}}
```

## References

- AI SDK v6 Documentation: Tool Results Pattern
- ADK Documentation: Tool Confirmation
- Implementation: `adk_compat.py` (SSE mode)
- Tests: `scenarios/tools/process-payment-sse.spec.ts`

## Next Steps

For BIDI mode implementation, see separate documentation (TBD). BIDI requires a **different approach** because:

- Single WebSocket connection (no second HTTP request)
- Must send user message instead of tool-result
- Different protocol requirements
