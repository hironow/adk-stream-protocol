# 0005. Frontend Execute Pattern and [DONE] Sending Timing

**Date:** 2025-12-24
**Status:** Accepted

## Scope

**This ADR documents:**
- Frontend Execute pattern where frontend executes tools (e.g., browser APIs) and sends results via `addToolOutput()`
- WebSocket `[DONE]` sending timing for both Server Execute and Frontend Execute patterns
- Critical React state timing requirements for Frontend Execute
- Test validation requirements

**Related ADRs:**
- **ADR 0002**: Tool Approval Architecture - General approval architecture
- **ADR 0003**: SSE vs BIDI Confirmation Protocol - Approval message protocols
- **ADR 0004**: Multi-Tool Response Timing - Server Execute timing constraints

## Context

During E2E test development for Frontend Execute pattern, we discovered critical timing requirements for when backend should send `[DONE]` and when frontend should call `addToolOutput()`. Initial tests were flaky and failing due to incorrect timing assumptions.

**Problem Scenarios**:

1. **BIDI failure test timeout**: Test waited 5 seconds for error message but never received it
2. **Root cause**: `addToolOutput()` was called immediately after `addToolApprovalResponse()` without waiting for React state to update
3. **Symptom**: Only 2 `sendMessages()` calls instead of expected 3
4. **Discovery**: Success test had `waitFor` approval state update, but failure test didn't

## Decision

### Pattern 1: Server Execute (Backend Executes Tools)

**Flow**:
```
User approves tool → Backend executes → Backend sends result + [DONE]
```

**[DONE] Timing**:
```
1. Initial user message
   Backend → tool-input-start, tool-input-available, tool-approval-request, [DONE]

2. User approval (via addToolApprovalResponse)
   Backend → text-delta("Success"), tool-result, [DONE]
```

**Characteristic**: Backend sends `[DONE]` after EVERY response, including intermediate confirmations (ADR 0004).

### Pattern 2: Frontend Execute (Frontend Executes Tools)

**Flow**:
```
User approves tool → Frontend executes → addToolOutput() → Backend receives result → Backend sends response + [DONE]
```

**[DONE] Timing**:
```
1. Initial user message
   Backend → tool-input-start, tool-input-available, tool-approval-request, [DONE]

2. User approval (via addToolApprovalResponse)
   Backend → (returns without sending [DONE])  ← Stream stays open!

3. Frontend execution complete (via addToolOutput)
   Frontend → tool-result via sendMessages()
   Backend → text-delta("Success"), [DONE]
```

**Critical Difference**: Backend does NOT send `[DONE]` after approval in step 2. This keeps the WebSocket stream open so AI SDK can call `sendMessages()` when `addToolOutput()` completes.

### Why Backend Must NOT Send [DONE] After Approval

**The Problem**:
```
If backend sends [DONE] after approval:

1. User approves → addToolApprovalResponse()
2. Backend sends approval acknowledgment + [DONE]
3. Stream closes
4. Frontend executes tool → addToolOutput()
5. AI SDK tries to call sendMessages()
6. But stream is already closed!
7. AI SDK opens NEW stream, triggering approval flow again
8. Infinite loop
```

**The Solution**:
```
Backend does NOT send [DONE] after approval:

1. User approves → addToolApprovalResponse()
2. Backend returns (stream stays open)
3. Frontend executes tool → addToolOutput()
4. sendAutomaticallyWhen() returns true (tool output available)
5. AI SDK calls sendMessages() on SAME stream
6. Backend receives tool result and responds with [DONE]
```

### Frontend Timing Requirement: Wait for Approval State

**Critical Rule**: **MUST `waitFor` approval state to update before calling `addToolOutput()`**

**Implementation Pattern**:

```typescript
// 1. User approves
await act(async () => {
  result.current.addToolApprovalResponse({
    id: part.toolCallId,
    approved: true,
  });
});

// 2. CRITICAL: Wait for approval state to update
await waitFor(
  () => {
    const msg = result.current.messages[result.current.messages.length - 1];
    const confirmationPart = msg.parts.find(
      (p: any) => p.type === TOOL_TYPE_ADK_REQUEST_CONFIRMATION,
    ) as any;
    expect(confirmationPart?.state).toBe(TOOL_STATE_APPROVAL_RESPONDED);
  },
  { timeout: 3000 },
);

// 3. Only NOW call addToolOutput
await act(async () => {
  result.current.addToolOutput({
    tool: "take_photo",
    toolCallId: "orig-camera",
    output: JSON.stringify({ success: true }),
  });
});
```

**Why This is Necessary**:

1. **React state batching**: Without `waitFor`, React may batch the approval state update with the `addToolOutput` call
2. **AI SDK stream lifecycle**: AI SDK needs to process the approval and call the 2nd `sendMessages()` before `addToolOutput()` triggers the 3rd call
3. **Message state consistency**: The message must have approval in "approval-responded" state before adding tool output

**Evidence**:

Success test (`lib/tests/e2e/frontend-execute-bidi.e2e.test.tsx:210-219`):
```typescript
// Wait for approval state to update
await waitFor(
  () => {
    const msg = result.current.messages[result.current.messages.length - 1];
    const part = msg.parts.find(
      (p: any) => p.type === TOOL_TYPE_ADK_REQUEST_CONFIRMATION,
    ) as any;
    expect(part?.state).toBe(TOOL_STATE_APPROVAL_RESPONDED);
  },
  { timeout: 3000 },
);
```

Failure test BEFORE fix: No `waitFor` → Test failed
Failure test AFTER fix: Added `waitFor` → Test passed ✅

## Test Evidence

### Frontend Execute Tests

#### frontend-execute-bidi.e2e.test.tsx (BIDI Mode)

**Test: Success Flow**
```typescript
1. Initial message
   Handler sends: tool-input-start, tool-input-available, tool-approval-request
   Handler returns without [DONE]  ← Stream stays open

2. User approves
   Handler returns immediately without sending anything  ← Critical!

3. addToolOutput()
   sendMessages() sends tool output to backend
   Handler receives output and sends: text-start, text-delta, text-end, [DONE]
```

**Verified**: ✅ `toolResultReceived = true` (handler received tool output)

**Test: Failure Flow**
```typescript
Same flow as success, but:
- addToolOutput() sends error result
- Handler sends error message instead of success
```

**Verified**: ✅ Test passes after adding `waitFor` before `addToolOutput()`

#### frontend-execute-sse.e2e.test.tsx (SSE Mode)

**Test: Success Flow**
```typescript
1. Request 1: Initial message
   Response: tool-input-start, tool-input-available, tool-approval-request, [DONE]

2. Request 2: User approval
   (No response - backend waits for tool output)

3. Request 3: addToolOutput()
   Frontend sends tool output
   Response: text-start, text-delta, text-end, [DONE]
```

**Verified**: ✅ `toolResultReceived = true`

**Test: Failure Flow**
```typescript
Same flow, sends error result instead of success
```

**Verified**: ✅ Error message displayed correctly

### Server Execute Tests

#### sse-use-chat.e2e.test.tsx (SSE Mode)

**Multi-Tool Sequential Execution**:
```typescript
Request 1: Initial message
  Response: tool1 confirmation, [DONE]

Request 2: Tool1 approval
  Response: tool2 confirmation, [DONE]  ← No text (ADR 0004)

Request 3: Tool2 approval
  Response: text("All steps completed!"), tool1-result, tool2-result, [DONE]
```

**Verified**: ✅ All text deferred until final response (ADR 0004 compliance)

#### bidi-use-chat.e2e.test.tsx (BIDI Mode)

**Multi-Tool Sequential Execution**:
```typescript
Message 1: Initial message
  Stream: tool1 confirmation, [DONE]

Message 2: Tool1 approval
  Stream: tool2 confirmation, [DONE]  ← No text (ADR 0004)

Message 3: Tool2 approval
  Stream: text("All steps completed!"), tool1-result, tool2-result, [DONE]
```

**Verified**: ✅ Same pattern as SSE (BIDI-specific pending confirmation check working)

## [DONE] Sending Timing Summary

| Scenario | When [DONE] is Sent | Stream State |
|----------|-------------------|-------------|
| **Server Execute - After Approval** | Immediately after sending tool result | Closed |
| **Frontend Execute - After Approval** | NOT sent (stream stays open) | Open |
| **Frontend Execute - After addToolOutput** | After sending backend response | Closed |
| **Multi-Tool - Intermediate Confirmation** | After sending confirmation (no text) | Closed then reopened |
| **Multi-Tool - Final Response** | After sending all text + results | Closed |

## Consequences

### Positive

1. **Clear Protocol**: Explicit timing rules for `[DONE]` prevent confusion
2. **Test Reliability**: All 6 Frontend Execute tests now pass consistently
3. **Correct Behavior**: Frontend Execute pattern works reliably in both SSE and BIDI modes
4. **Documentation**: Future developers understand critical timing requirements

### Negative

1. **Timing Sensitivity**: Tests must use `waitFor` correctly or they fail
2. **React Knowledge Required**: Developers must understand React state batching
3. **Debugging Difficulty**: Timing issues are hard to diagnose without understanding

stream lifecycle

### Neutral

1. **Pattern Divergence**: Server Execute and Frontend Execute have different `[DONE]` timing
2. **Test Complexity**: Frontend Execute tests require more sophisticated timing assertions

## Implementation Requirements

### Backend Requirements

**Frontend Execute Pattern**:
```python
def handle_approval_response(approval):
    # Update approval state
    self.approval_state[approval.id] = approval.approved

    # CRITICAL: Do NOT send [DONE]
    # Stream must stay open for addToolOutput()
    return  # Just return, no response
```

**After receiving tool output from addToolOutput()**:
```python
def handle_tool_output(tool_output):
    # Process tool output
    result = process_output(tool_output)

    # Send response
    yield text_delta(result.message)
    yield tool_result(tool_output)
    yield "[DONE]"  # NOW close the stream
```

### Frontend Requirements

**Always use this pattern**:
```typescript
// 1. Approve
await act(async () => {
  result.current.addToolApprovalResponse({ id, approved: true });
});

// 2. CRITICAL: Wait for state update
await waitFor(
  () => {
    const part = /* find confirmation part */;
    expect(part?.state).toBe(TOOL_STATE_APPROVAL_RESPONDED);
  },
  { timeout: 3000 },
);

// 3. Execute and send output
await act(async () => {
  result.current.addToolOutput({ toolCallId, output });
});
```

**NEVER skip the waitFor**:
```typescript
// ❌ WRONG - Will cause flaky tests
await act(async () => {
  result.current.addToolApprovalResponse({ id, approved: true });
});
// Missing waitFor!
await act(async () => {
  result.current.addToolOutput({ toolCallId, output });  // Too soon!
});
```

### Test Requirements

All Frontend Execute tests MUST verify:

1. **Tool result received**: `expect(toolResultReceived).toBe(true)`
2. **Response message correct**: `expect(finalText).toContain(expectedMessage)`
3. **Timing correct**: Use `waitFor` between approval and `addToolOutput()`

Example assertion pattern:
```typescript
// Verify backend received tool output
expect(toolResultReceived).toBe(true);

// Verify response message
const finalText = getMessageText(
  result.current.messages[result.current.messages.length - 1],
);
expect(finalText).toContain("Success message");
```

## Test Validation Matrix

| Test File | Pattern | Mode | [DONE] Timing | waitFor Required | Status |
|-----------|---------|------|--------------|------------------|--------|
| `frontend-execute-bidi.e2e.test.tsx` | Frontend Execute | BIDI | After addToolOutput | ✅ Yes | ✅ Pass |
| `frontend-execute-sse.e2e.test.tsx` | Frontend Execute | SSE | After addToolOutput | ✅ Yes | ✅ Pass |
| `bidi-use-chat.e2e.test.tsx` | Server Execute | BIDI | After approval | ❌ No | ✅ Pass |
| `sse-use-chat.e2e.test.tsx` | Server Execute | SSE | After approval | ❌ No | ✅ Pass |

**Key Insight**: `waitFor` is ONLY required for Frontend Execute pattern, not Server Execute.

## Related ADRs

- **ADR 0003**: SSE vs BIDI Confirmation Protocol
  - Established approval message protocols
  - This ADR adds Frontend Execute pattern and `[DONE]` timing
- **ADR 0004**: Multi-Tool Response Timing
  - Documents Server Execute timing constraints
  - This ADR complements with Frontend Execute timing

## Future Considerations

If AI SDK v6 improves stream lifecycle management:

1. May be able to send `[DONE]` after approval in Frontend Execute
2. Could simplify timing requirements
3. Should re-evaluate this ADR

Until then, maintain the documented `[DONE]` timing patterns.
