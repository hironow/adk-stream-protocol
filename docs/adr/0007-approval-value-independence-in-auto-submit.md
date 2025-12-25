# 0007. Approval Value Independence in Auto-Submit Timing

**Date:** 2025-12-25
**Status:** Accepted

## Context

When implementing tool approval flow with AI SDK v6's `sendAutomaticallyWhen` function, developers commonly assume that **approval decisions (approve vs deny) affect auto-submit timing**. This is a **natural but incorrect assumption** that leads to confusion and bugs.

### The Common Misconception

Developers intuitively expect:

```typescript
// ❌ WRONG ASSUMPTION
addToolApprovalResponse({ approved: true });
// → "Auto-submit should happen immediately"

addToolApprovalResponse({ approved: false });
// → "Auto-submit should be delayed or not happen"
```

**Why this seems logical**: In traditional UI patterns, "approve" and "deny" often trigger different code paths with different timings.

### The Actual Behavior

```typescript
// ✅ ACTUAL BEHAVIOR (both cases identical)
addToolApprovalResponse({ approved: true });
// → Auto-submit happens immediately (if all conditions met)

addToolApprovalResponse({ approved: false });
// → Auto-submit happens immediately (if all conditions met)
// Timing is IDENTICAL
```

**The key insight**: AI SDK v6's `lastAssistantMessageIsCompleteWithApprovalResponses()` function **does not check the `approved` value**. It only checks the **state**.

### Why This Matters

This misconception causes:

1. **Incorrect timing logic**: Developers add unnecessary delays for `approved: false`
2. **Redundant code**: Separate handling for approve/deny when unified handling works
3. **Debugging confusion**: Expected behavior doesn't match actual behavior
4. **Test gaps**: Tests may pass for approve but fail for deny due to timing assumptions

### Evidence from AI SDK v6 Source Code

**Source**: `node_modules/ai/dist/index.mjs:11342-11363`

```javascript
function lastAssistantMessageIsCompleteWithApprovalResponses({ messages }) {
  const message = messages[messages.length - 1];
  // ... extract last step tool invocations ...

  return (
    // Condition 1: At least one approval-responded exists
    lastStepToolInvocations.filter(
      (part) => part.state === "approval-responded"  // ← Only checks STATE
    ).length > 0 &&

    // Condition 2: All tools are complete
    lastStepToolInvocations.every(
      (part) =>
        part.state === "output-available" ||
        part.state === "output-error" ||
        part.state === "approval-responded"  // ← Only checks STATE
    )
  );
}
```

**Critical observation**: The `approval.approved` field is **never referenced** in the decision logic.

## Decision

We explicitly document and enforce the principle:

**The `approved` value (true/false) in `approval-responded` state does NOT affect auto-submit timing. Only the state and completion conditions matter.**

### State-Based Auto-Submit Logic

```typescript
// Both scenarios trigger auto-submit at IDENTICAL timing
Scenario A: User Approves
  state: "approval-requested"
    → addToolApprovalResponse({ approved: true })
    → state: "approval-responded"
    → sendAutomaticallyWhen() returns true
    → Auto-submit happens

Scenario B: User Denies
  state: "approval-requested"
    → addToolApprovalResponse({ approved: false })
    → state: "approval-responded"  // ← Same state as Scenario A
    → sendAutomaticallyWhen() returns true  // ← Same result
    → Auto-submit happens  // ← Same timing
```

### The `approved` Value's Actual Purpose

The `approved` value is **not for frontend timing logic**. It is:

1. **Sent to backend** in the auto-submitted message
2. **Interpreted by backend** to decide:
   - `approved: true` → Execute the actual tool
   - `approved: false` → Skip tool execution, send error response

**Separation of concerns**:

- **Frontend**: Manages user decision process, records approval state
- **Backend**: Interprets `approved` value, executes or rejects tool
- **Auto-submit logic**: Only checks state completion, ignores `approved` value

### Timing Comparison Matrix

| Scenario | State After Response | Auto-Submit Timing | Backend Behavior |
|----------|---------------------|-------------------|------------------|
| **Single Tool Approval** | `approval-responded` (approved: true) | Immediate | Executes tool |
| **Single Tool Denial** | `approval-responded` (approved: false) | Immediate (same) | Skips tool, sends error |
| **Multiple Tools (mixed)** | Tool A: `approval-responded` (approved: false)<br>Tool B: `output-available` | After both complete (same) | Processes both results |

**Key insight**: The timing column is identical regardless of `approved` value.

## Consequences

### Positive

1. **Simplified frontend logic**: No need for separate approve/deny timing paths
2. **Consistent behavior**: Single code path handles both scenarios
3. **Predictable testing**: Same test structure for approve and deny
4. **Clear separation**: Frontend records decision, backend interprets it
5. **Framework alignment**: Works with AI SDK v6's design, not against it

### Negative

1. **Counterintuitive**: Developers expect different timing for approve/deny
2. **Documentation burden**: Requires explicit ADR to prevent misconception
3. **Training overhead**: Team members need to understand this non-obvious behavior

### Neutral

1. **Backend must handle both cases**: Backend receives `approved: false` and must process it appropriately
2. **Error messages differ**: Backend response differs based on `approved` value, but timing doesn't

## Test Evidence

### Test 1: Approval Auto-Submit Timing

**File**: `lib/tests/integration/sse-integration.test.ts:257-297`

```typescript
it("sendAutomaticallyWhen detects confirmation completion", async () => {
  // Given: Message with approval-responded (approved: true)
  const messages: UIMessage[] = [
    {
      id: "1",
      role: "assistant",
      content: "",
      parts: [
        {
          type: "tool-adk_request_confirmation",
          state: "approval-responded",  // ← Key: state
          approval: {
            id: "call-1",
            approved: true,  // ← This value NOT checked by auto-submit
          },
        },
      ],
    },
  ];

  // When: Check if should auto-send
  const shouldSend = await sendAutomaticallyWhen({ messages });

  // Then: Returns true immediately
  expect(shouldSend).toBe(true);
});
```

### Test 2: Denial Auto-Submit Timing (IDENTICAL)

**File**: `lib/tests/integration/sse-integration.test.ts:299-340`

```typescript
it("sendAutomaticallyWhen detects confirmation denial", async () => {
  // Given: Message with approval-responded (approved: false)
  const messages: UIMessage[] = [
    {
      id: "1",
      role: "assistant",
      content: "",
      parts: [
        {
          type: "tool-adk_request_confirmation",
          state: "approval-responded",  // ← Same state as approval
          approval: {
            id: "call-1",
            approved: false,  // ← Different value, SAME timing
            reason: "User rejected the operation",
          },
        },
      ],
    },
  ];

  // When: Check if should auto-send
  const shouldSend = await sendAutomaticallyWhen({ messages });

  // Then: Returns true immediately (SAME as approval)
  expect(shouldSend).toBe(true);
});
```

**Critical observation**: Both tests have identical structure except for the `approved` value. Both return `true` at the same timing.

### Test 3: Component-Level Behavior

**File**: `components/tests/unit/tool-invocation.test.tsx:27-127`

```typescript
it("should call sendMessage after tool approval (approved=true)", () => {
  const addToolApprovalResponse = vi.fn();
  const sendMessage = vi.fn();

  // When: User approves
  addToolApprovalResponse({ approved: true });
  setTimeout(() => sendMessage(), 100);

  // Then: sendMessage called after 100ms timeout
  vi.advanceTimersByTime(100);
  expect(sendMessage).toHaveBeenCalledTimes(1);
});

it("should call sendMessage after tool rejection (approved=false)", () => {
  const addToolApprovalResponse = vi.fn();
  const sendMessage = vi.fn();

  // When: User denies
  addToolApprovalResponse({ approved: false });
  setTimeout(() => sendMessage(), 100);  // ← Same 100ms timeout

  // Then: sendMessage called after 100ms timeout (SAME timing)
  vi.advanceTimersByTime(100);
  expect(sendMessage).toHaveBeenCalledTimes(1);
});
```

**Key insight**: Both tests use identical 100ms timeout. No timing difference.

## Implementation Guidelines

### DO: Unified Handling

```typescript
// ✅ CORRECT: Single code path for both approve and deny
const handleApprovalResponse = (approved: boolean, reason?: string) => {
  addToolApprovalResponse({
    id: approvalId,
    approved,  // true or false - doesn't affect timing
    reason,
  });

  // Auto-submit happens automatically via sendAutomaticallyWhen
  // No manual timing logic needed
};
```

### DON'T: Separate Timing Logic

```typescript
// ❌ WRONG: Unnecessary separate handling
const handleApprove = () => {
  addToolApprovalResponse({ approved: true });
  // Auto-submit happens immediately
};

const handleDeny = () => {
  addToolApprovalResponse({ approved: false });
  // ⚠️ Adding delay here is WRONG - auto-submit timing is same
  setTimeout(() => {
    // This delay is unnecessary and creates inconsistency
  }, 500);
};
```

### Code Comments

When implementing approval handling, include this comment:

```typescript
// IMPORTANT: approved: true and approved: false have IDENTICAL auto-submit timing.
// AI SDK v6's sendAutomaticallyWhen() only checks state, not the approved value.
// See: docs/adr/0007-approval-value-independence-in-auto-submit.md
addToolApprovalResponse({ id, approved, reason });
```

## Related ADRs

- **ADR 0002**: Tool Approval Architecture - Foundation of approval flow
- **ADR 0004**: Multi-Tool Response Timing - Timing when multiple tools involved
- **ADR 0006**: sendAutomaticallyWhen Decision Logic Order - Check ordering logic

## References

- **AI SDK v6 Source**: `node_modules/ai/dist/index.mjs:11342-11363`
- **Architecture Documentation**: `docs/ARCHITECTURE.md:730-748` (explicit warning about this)
- **Integration Tests**: `lib/tests/integration/sse-integration.test.ts:257-340`
- **Component Tests**: `components/tests/unit/tool-invocation.test.tsx:27-127`

## FAQ

**Q: Why doesn't AI SDK v6 check the `approved` value in auto-submit logic?**

A: Because the frontend's role is to record user decisions, not to interpret them. The backend interprets the `approved` value to execute or reject the tool. Auto-submit timing is about "completion of frontend process," not "nature of decision."

**Q: Should I add delays for denial to improve UX?**

A: No. Auto-submit timing is framework-controlled and should not be manually adjusted. If you want UX feedback (e.g., showing "Denied" message), do it separately from the auto-submit logic.

**Q: What if I need different backend handling for approve vs deny?**

A: That's correct and expected. The backend receives the `approved` value and handles it differently. But the **frontend timing** remains identical.

**Q: How do I test this correctly?**

A: Write identical test structure for approve and deny, only changing the `approved` value. Both should have same timing assertions.

---

**Last Updated**: 2025-12-25
**Status**: This is a permanent architectural principle, not subject to future change unless AI SDK v6 fundamentally redesigns approval handling.
