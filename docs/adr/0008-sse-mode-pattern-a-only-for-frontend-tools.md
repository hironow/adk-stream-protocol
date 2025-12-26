# 0008. SSE Mode Supports Pattern A Only for Frontend-Delegated Tools

**Date:** 2025-12-27
**Status:** Accepted

## Context

Frontend-delegated tools (e.g., `get_location`) require user approval before execution. After approval, the tool executes in the frontend (e.g., `navigator.geolocation.getCurrentPosition()`), and the result is sent back to the backend.

There are two possible patterns for sending approval and tool results:

### Pattern A (1-request)
Send approval response AND tool execution result in the **same HTTP request**:
```json
{
  "messages": [{
    "role": "user",
    "content": [
      {"type": "tool-result", "toolCallId": "confirmation-123", "result": {"approval": "approved"}},
      {"type": "tool-result", "toolCallId": "tool-456", "result": {"latitude": 35.6762, ...}}
    ]
  }]
}
```

### Pattern B (2-request)
Send approval and tool result in **separate HTTP requests**:

Request 1 (approval only):
```json
{
  "messages": [{
    "role": "user",
    "content": [
      {"type": "tool-result", "toolCallId": "confirmation-123", "result": {"approval": "approved"}}
    ]
  }]
}
```

Request 2 (tool result):
```json
{
  "messages": [{
    "role": "user",
    "content": [
      {"type": "tool-result", "toolCallId": "tool-456", "result": {"latitude": 35.6762, ...}}
    ]
  }]
}
```

### Technical Constraints

**SSE Mode (HTTP/REST)** operates on a request-response model:
- Each HTTP request creates a new invocation
- When the response completes, the invocation terminates
- Awaiting tool results (via `asyncio.Future`) blocks until timeout or resolution
- Pattern B fails because:
  1. Turn 2a (approval only): ADK calls `get_location()` → creates Future → waits → **timeout after 10s** → response completes → invocation ends
  2. Turn 2b (tool result): **New invocation** → pre-resolved result cached, but the original Future was already destroyed

**BIDI Mode (WebSocket)** maintains persistent connections:
- Single invocation spans multiple messages
- Future created in Turn 2a remains active when Turn 2b arrives
- Both Pattern A and Pattern B work correctly

### Frontend Implementation Perspective

From a frontend perspective, Pattern A is the **natural flow**:

```typescript
// Natural implementation (Pattern A)
const handleApprove = async () => {
  // 1. User approves
  // 2. Execute tool immediately (approval granted)
  const location = await navigator.geolocation.getCurrentPosition()

  // 3. Send approval + result together
  submit({
    toolResults: [
      { id: confirmationId, result: { approval: 'approved' }},
      { id: toolCallId, result: location }
    ]
  })
}
```

Pattern B would require artificial separation:
```typescript
// Unnatural implementation (Pattern B)
const handleApprove = async () => {
  // Why send approval alone when we can execute immediately?
  submit({ toolResults: [{ id: confirmationId, result: { approval: 'approved' }}] })

  // Execute tool
  const location = await navigator.geolocation.getCurrentPosition()

  // Why make a separate request? We already have the result.
  submit({ toolResults: [{ id: toolCallId, result: location }] })
}
```

## Decision

**SSE Mode supports Pattern A only** for frontend-delegated tools.

- Frontend should execute the tool immediately after user approval
- Send both approval response and tool execution result in a single HTTP request
- Backend will use pre-resolution cache to handle timing (result arrives before Future creation)

**BIDI Mode continues to support both patterns** due to persistent connection nature.

## Consequences

### Positive
- **Natural frontend implementation**: Matches the intuitive user flow (approve → execute → send)
- **Simpler API contract**: One pattern to document and test for SSE mode
- **Aligned with technical constraints**: Pattern A avoids the invocation lifecycle issues inherent to HTTP request-response model
- **Better performance**: Single round-trip instead of two separate requests
- **Pre-resolution cache works perfectly**: Result always arrives before Future creation in Pattern A

### Negative
- **Less flexibility**: Clients cannot choose to send approval and result separately in SSE mode
- **Different behavior between modes**: SSE and BIDI have different supported patterns (though this reflects their fundamental architectural differences)

### Neutral
- Pattern B remains available in BIDI mode for edge cases where deferred tool execution is needed
- Documentation must clearly state the pattern difference between SSE and BIDI modes
- Test suite simplified: SSE tests only need to cover Pattern A
