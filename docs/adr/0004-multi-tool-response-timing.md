# 0004. Multi-Tool Sequential Execution Response Timing

**Date:** 2025-12-23
**Status:** Accepted

## Scope and Limitations

**This ADR applies to:**
- **Server-side tool execution** where backend executes tools and requests user approval
- Sequential multi-tool execution requiring multiple confirmation steps
- Both SSE and BIDI modes using `addToolApprovalResponse()`

**This ADR does NOT apply to:**
- **Frontend-side tool execution** where frontend executes browser APIs and sends results via `addToolOutput()`
- Single-tool execution scenarios
- Tools that don't require user confirmation

**Key Distinction:**

```typescript
// SERVER EXECUTE (this ADR applies)
// Backend requests approval → User approves → Backend executes tool
addToolApprovalResponse({ id: "call-tool1", approved: true });

// FRONTEND EXECUTE (this ADR does NOT apply)
// Frontend executes browser API → Sends result to backend
addToolOutput({ toolCallId: "tool-123", output: result });
```

For frontend-execute pattern, see **ADR 0002** (Tool Approval Architecture) and **ADR 0003** (SSE vs BIDI Confirmation Protocol).

## Context

During E2E test development for sequential multi-tool execution with confirmations, we discovered critical constraints on when backend can send text responses. The issue manifested as tests expecting text like "Database updated successfully" but only receiving "Found 10 users."

**Problem Scenario**:

```
1. User requests: "Search and update database"
2. Backend requests Tool1 confirmation (search_database)
3. User approves Tool1
4. Backend WANTS TO: Send "Found 10 users" + Tool2 confirmation
5. User approves Tool2
6. Backend sends: "Database updated successfully"
7. Test expects BOTH texts but only receives first one
```

**Root Cause**:

The `sendAutomaticallyWhen` function uses text part presence as an indicator that "backend has already responded to this approval," blocking automatic message send to prevent infinite loops. When Tool2 confirmation is sent WITH text from Tool1 execution, the function incorrectly blocks the Tool2 approval from being sent automatically.

## Decision

**Backend MUST NOT send text responses in intermediate confirmations. All text MUST be deferred until the final response after all confirmations complete.**

### Response Timing Rules

#### Rule 1: First Confirmation Request (No Text)

```
User: "Do action1 and action2"
↓
Backend Response:
  - tool-input-start (confirmation for action1)
  - tool-input-available
  - tool-approval-request
  - [DONE]
  ❌ NO text-delta chunks
```

#### Rule 2: Intermediate Response After Approval (No Text)

```
User approves action1
↓
Backend Response:
  - tool-input-start (confirmation for action2)
  - tool-input-available
  - tool-approval-request
  - [DONE]
  ❌ NO text-delta chunks
  ❌ NO tool-result for action1
```

#### Rule 3: Final Response After All Approvals (All Text + Results)

```
User approves action2
↓
Backend Response:
  - text-start
  - text-delta: "Found 10 users. "     ← Result from action1
  - text-delta: "Database updated."    ← Result from action2
  - text-end
  - tool-result (action1)
  - tool-result (action2)
  - [DONE]
```

### Why This Pattern is Necessary

The `sendAutomaticallyWhen` function implements **infinite loop prevention** by checking if backend has already responded:

```typescript
// Check if backend has ALREADY responded
const hasTextPart = parts.some((part: any) => isTextUIPart(part));

if (hasTextPart) {
  // Backend already responded, don't send again
  return false;
}
```

**The Problem**:

```
Scenario: Tool1 approved, backend sends "Found 10 users" + Tool2 confirmation

Message state:
{
  parts: [
    { type: "tool-adk_request_confirmation", toolCallId: "tool1", state: "approval-responded" },
    { type: "text", text: "Found 10 users. " },  ← Text from Tool1
    { type: "tool-adk_request_confirmation", toolCallId: "tool2", state: "approval-requested" }
  ]
}

When user approves Tool2:
1. addToolApprovalResponse() updates tool2 state to "approval-responded"
2. sendAutomaticallyWhen() checks for confirmation completion ✓
3. sendAutomaticallyWhen() finds TEXT part from Tool1 ✗
4. Function assumes backend ALREADY responded to Tool2 approval
5. Blocks automatic send → Backend never receives Tool2 approval
```

**The Solution**:

```
Scenario: Tool1 approved, backend sends ONLY Tool2 confirmation

Message state:
{
  parts: [
    { type: "tool-adk_request_confirmation", toolCallId: "tool1", state: "approval-responded" },
    { type: "tool-adk_request_confirmation", toolCallId: "tool2", state: "approval-requested" }
  ]
}

When user approves Tool2:
1. addToolApprovalResponse() updates tool2 state to "approval-responded"
2. sendAutomaticallyWhen() checks for confirmation completion ✓
3. sendAutomaticallyWhen() finds NO text parts ✓
4. Automatic send proceeds → Backend receives Tool2 approval
5. Backend sends final response with ALL results
```

## SSE vs BIDI Differences

### Common Behavior (Both Modes)

Both SSE and BIDI share the **same core logic** for detecting when to automatically send:

1. Check for confirmation in "approval-responded" state
2. Check for text parts (if found, block send)
3. Check for completed tools (if found, block send)

### BIDI-Specific: Pending Confirmation Check

**BIDI mode adds an additional check** not present in SSE:

```typescript
// BIDI ONLY - lib/bidi/send-automatically-when.ts
const hasPendingConfirmation = parts.some(
  (part: any) =>
    part.type === TOOL_TYPE_ADK_REQUEST_CONFIRMATION &&
    part.state === TOOL_STATE_APPROVAL_REQUESTED,
);

if (hasPendingConfirmation) {
  return false;  // Wait for user to respond to pending confirmation
}
```

**Why BIDI Needs This**:

In BIDI mode, **multiple confirmations can accumulate in the SAME message** because WebSocket maintains a persistent connection. The message grows as new confirmations arrive:

```
WebSocket persistent connection:

Initial state:
{ parts: [{ confirmation: tool1, state: "approval-requested" }] }

After user approves tool1 → Backend sends tool2 confirmation → Same message updated:
{ parts: [
  { confirmation: tool1, state: "approval-responded" },  ← Already approved
  { confirmation: tool2, state: "approval-requested" }   ← Pending approval
]}
```

Without this check, `sendAutomaticallyWhen` would trigger automatic send when tool1's state changes to "approval-responded", even though tool2 is still pending.

**Why SSE Doesn't Need This**:

SSE uses **HTTP request/response cycles**. Each response creates a NEW message:

```
HTTP Request/Response:

Request 1 → Response 1:
{ parts: [{ confirmation: tool1, state: "approval-requested" }] }

Request 2 (after approval) → Response 2 (NEW message):
{ parts: [{ confirmation: tool2, state: "approval-requested" }] }
```

Each HTTP response is independent, so there's no accumulation of confirmations in a single message.

### Implementation Comparison

```typescript
// SSE - lib/sse/send-automatically-when.ts
export function sendAutomaticallyWhen({ messages }: SendAutomaticallyWhenOptions): boolean {
  // 1. Check for confirmation in approval-responded state ✓
  // 2. Check for text parts ✓
  // 3. Check for completed tools ✓
  // ❌ NO pending confirmation check
}

// BIDI - lib/bidi/send-automatically-when.ts
export function sendAutomaticallyWhen({ messages }: SendAutomaticallyWhenOptions): boolean {
  // 1. Check for confirmation in approval-responded state ✓
  // 2. Check for text parts ✓
  // ✅ Check for pending confirmations (BIDI-specific)
  // 3. Check for completed tools ✓
}
```

## Test Evidence

### SSE Mode Test (`lib/tests/e2e/sse-use-chat.e2e.test.tsx`)

```typescript
// Request 1: First confirmation (no text)
if (requestCount === 1) {
  return createAdkConfirmationRequest({ toolCallId: "call-1", ... });
}

// Request 2: Second confirmation (no text)
if (requestCount === 2) {
  return createAdkConfirmationRequest({ toolCallId: "call-2", ... });
}

// Request 3: Final response with ALL text
if (requestCount === 3) {
  return createTextResponse("All", " steps completed!");
}
```

### BIDI Mode Test (`lib/tests/e2e/bidi-use-chat.e2e.test.tsx`)

```typescript
if (!firstConfirmationSent) {
  // First confirmation (no text)
  client.send(tool-input-start, tool-input-available, tool-approval-request);
  client.send("[DONE]");
}
else if (hasFirstApproval && !secondConfirmationSent) {
  // Second confirmation (no text)
  client.send(tool-input-start, tool-input-available, tool-approval-request);
  client.send("[DONE]");
}
else if (hasSecondApproval) {
  // Final response with ALL text
  client.send(text-start);
  client.send(text-delta: "All");
  client.send(text-delta: " steps completed!");
  client.send(text-end);
  client.send("[DONE]");
}
```

**Both tests follow the same pattern**: No text in intermediate responses, all text in final response.

### Multi-Tool Execution Test (`lib/tests/e2e/multi-tool-execution-e2e.test.tsx`)

Before fix (BROKEN):
```typescript
// After Tool1 approval
client.send(text-delta: "Found 10 users. ");  // ❌ Text in intermediate response
client.send(tool-result: tool1);
client.send(tool2 confirmation request);
client.send("[DONE]");

// After Tool2 approval - Never received! sendAutomaticallyWhen blocked
```

After fix (WORKING):
```typescript
// After Tool1 approval
client.send(tool2 confirmation request);  // ✓ No text
client.send("[DONE]");

// After Tool2 approval
client.send(text-delta: "Found 10 users. ");      // ✓ Tool1 result
client.send(text-delta: "Database updated.");     // ✓ Tool2 result
client.send(tool-result: tool1);
client.send(tool-result: tool2);
client.send("[DONE]");
```

## Consequences

### Positive

1. **Predictable Behavior**: Clear rules for when to send text responses
2. **Test Reliability**: E2E tests consistently pass with expected text content
3. **User Experience**: Users see complete results after all approvals, not fragmented partial results
4. **Infinite Loop Prevention**: Maintains safety mechanism without false positives

### Negative

1. **Delayed Feedback**: Users don't see intermediate results until all approvals complete
2. **Backend Complexity**: Backend must buffer results and send them together at the end
3. **Memory Overhead**: Holding multiple tool results in memory until final response

### Neutral

1. **Protocol Constraint**: This is a limitation of the current `sendAutomaticallyWhen` implementation, not a design choice
2. **Future Improvement**: Could be solved with more sophisticated detection (e.g., tracking which text corresponds to which tool approval)

## Alternative Considered: Smart Text Detection

**Idea**: Track which text parts were added AFTER the current approval.

```typescript
// Hypothetical improvement
const textPartsBeforeApproval = /* track text count before approval */;
const textPartsAfterApproval = /* compare current text count */;

if (textPartsAfterApproval > textPartsBeforeApproval) {
  // New text added AFTER approval → Backend responded
  return false;
}
```

**Why Not Implemented**:

1. Requires tracking message state changes over time
2. Complex edge cases (what if text arrives during approval click?)
3. Current solution (defer all text) is simpler and works reliably
4. Future AI SDK v6 updates might provide better hooks

## Implementation Notes

### Backend Requirements

When implementing multi-tool sequential execution:

1. **Buffer tool execution results** until all confirmations complete
2. **Send only confirmation requests** in intermediate responses
3. **Send all results together** in final response after last approval

Example backend implementation pattern:

```python
# After Tool1 approval
pending_results = []
result1 = execute_tool1()
pending_results.append(result1)

# Send Tool2 confirmation (no text)
yield tool_confirmation_chunks(tool2)
yield "[DONE]"

# After Tool2 approval
result2 = execute_tool2()
pending_results.append(result2)

# Send ALL results
for result in pending_results:
    yield text_delta(result.message)
for result in pending_results:
    yield tool_result(result)
yield "[DONE]"
```

### Frontend Requirements

The frontend implementation in `lib/bidi/send-automatically-when.ts` and `lib/sse/send-automatically-when.ts` is **correct as-is**. No changes needed.

Tests must verify this pattern:

```typescript
// Verify intermediate response has NO text
expect(intermediateMessage.parts.every(p => p.type !== "text")).toBe(true);

// Verify final response has ALL text
expect(finalMessage).toContain("result from tool1");
expect(finalMessage).toContain("result from tool2");
```

## Related ADRs

- **ADR 0003**: SSE vs BIDI Confirmation Protocol Differences
  - Established different confirmation handling for SSE vs BIDI
  - This ADR adds constraints on response timing for multi-tool scenarios

## Future Considerations

If `sendAutomaticallyWhen` is enhanced to support smarter text detection:

1. Could allow intermediate text responses
2. Would improve user experience with progressive feedback
3. Requires careful design to avoid infinite loop vulnerabilities

Until then, maintain the "defer all text" pattern as documented here.
