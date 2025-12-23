# 0006. sendAutomaticallyWhen Decision Logic Order

**Date:** 2024-12-24
**Status:** Accepted

## Context

During implementation of Frontend Execute pattern (ADR 0005), we discovered that the **order of checks** in `sendAutomaticallyWhen()` is critical for correctly distinguishing between:
1. **Backend already responded** (should NOT auto-send)
2. **Frontend Execute** (user called `addToolOutput()`, should auto-send)

### The Problem

Both scenarios have similar message state:
- Confirmation tool: `state = "approval-responded"`
- Original tool: `state = "output-available"`

**How do we distinguish them?**

### Initial Naive Approach (WRONG)

```typescript
// Check order that seemed logical but was WRONG:
1. Has text part? → return false
2. Has tool output? → return true  ❌ Too early!
3. Has approval-responded? → validate
4. Other tools completed? → return false
```

**Problem**: Check 2 fires for BOTH cases, causing infinite loops when backend has already responded.

## Decision

### Critical Check Order

The **order of checks** is the architectural decision:

```typescript
Check 1: Has text part in assistant message?
    YES → return false (backend already sent AI response)
    NO → Continue

Check 2: Has approval-responded confirmation?
    NO → return false (user hasn't approved yet)
    YES → Continue

Check 3: Has pending approval-requested confirmations?
    YES → return false (wait for user to approve all)
    NO → Continue

Check 4: Any other tool in ERROR state?
    YES → return false (backend already responded with error)
    NO → Continue
    NOTE: output-available NOT checked here

Check 5: Has tool output from addToolOutput()? (Frontend Execute)
    YES → return true (frontend executed tool, send result)
    NO → Continue

Default: return true (Server Execute: send approval)
```

### Why This Order Matters

#### Check 1: Text Part is Definitive

**Why first**: Text part is the **most reliable indicator** that backend has completed the full response cycle.

**Evidence**: When backend responds, it ALWAYS sends text (even if just "Success" or error message).

#### Check 2-3: Validate Approval State

**Why before pattern detection**: Must validate that confirmation is in the correct state before checking execution patterns.

**Evidence**: Prevents false positives from confirmations in wrong states (e.g., `output-available` instead of `approval-responded`).

#### Check 4: Error State Only

**Critical decision**: Check for **ERROR only**, NOT `output-available`.

**Rationale**:
- `output-error` → Backend definitely responded (return false)
- `output-available` → Could be Frontend Execute (check in Check 5)

**Why this works**:
```typescript
Scenario: Backend responded with error
  - Confirmation: approval-responded
  - Tool: output-error
  - Result: Check 4 catches it → return false ✅

Scenario: Frontend Execute success
  - Confirmation: approval-responded
  - Tool: output-available (from addToolOutput)
  - Result: Check 4 skips it, Check 5 catches it → return true ✅
```

#### Check 5: Frontend Execute Detection

**Why after error check**: By this point, we know:
- Text part is absent (not backend response)
- Approval is valid
- No errors occurred

**Therefore**: `output-available` state can ONLY be from `addToolOutput()`.

### The Pattern Matrix

| Check 1 (Text) | Check 4 (Error) | Check 5 (Output) | Scenario | Result |
|---|---|---|---|---|
| YES | - | - | Backend responded | false ✅ |
| NO | YES | - | Backend error | false ✅ |
| NO | NO | YES | Frontend Execute | true ✅ |
| NO | NO | NO | First approval | true ✅ |

## Consequences

### Positive

1. **Prevents infinite loops**: Correctly distinguishes backend responses from frontend execution
2. **Clear separation**: Each check has a single responsibility
3. **Testable**: Each decision point can be tested independently
4. **Self-documenting**: Order itself documents the decision logic

### Negative

1. **Order dependency**: Checks must remain in this exact order
2. **Fragile**: Changing order breaks the logic
3. **Non-obvious**: Requires documentation to understand WHY this order

### Mitigation

1. **Extensive comments**: Added WHY explanation for each check in code
2. **ASCII art documentation**: Visual decision flow in `send-automatically-when.ts`
3. **This ADR**: Permanent record of the architectural decision
4. **Integration tests**: `sendAutomaticallyWhen-integration.test.ts` validates all scenarios

## Test Evidence

### Test: Frontend Execute (should return true)

```typescript
const messages = [
  {
    role: "assistant",
    content: "", // ← Check 1: NO text
    parts: [
      {
        type: "tool-adk_request_confirmation",
        state: "approval-responded", // ← Check 2: YES
        approval: { approved: true },
      },
      {
        type: "tool-search",
        state: "output-available", // ← Check 5: YES
        output: { results: [] },
      },
    ],
  },
];

expect(sendAutomaticallyWhen({ messages })).toBe(true); // ✅
```

### Test: Backend Already Responded (should return false)

```typescript
const messages = [
  {
    role: "assistant",
    content: "Here are the results", // ← Check 1: YES → return false
    parts: [
      {
        type: "tool-adk_request_confirmation",
        state: "approval-responded",
      },
      {
        type: "tool-search",
        state: "output-available",
      },
      {
        type: "text",
        text: "Here are the results",
      },
    ],
  },
];

expect(sendAutomaticallyWhen({ messages })).toBe(false); // ✅
```

### Test: Backend Error Response (should return false)

```typescript
const messages = [
  {
    role: "assistant",
    content: "",
    parts: [
      {
        type: "tool-adk_request_confirmation",
        state: "approval-responded",
      },
      {
        type: "tool-search",
        state: "output-error", // ← Check 4: YES → return false
        error: "Network timeout",
      },
    ],
  },
];

expect(sendAutomaticallyWhen({ messages })).toBe(false); // ✅
```

## Related ADRs

- **ADR 0004**: Multi-Tool Response Timing - Server Execute timing
- **ADR 0005**: Frontend Execute Pattern and [DONE] Timing - When backend sends [DONE]
- **ADR 0002**: Tool Approval Architecture - Approval flow foundation
- **ADR 0003**: SSE vs BIDI Confirmation Protocol - Transport-specific approval

## Implementation

**Files**:
- `lib/bidi/send-automatically-when.ts`
- `lib/sse/send-automatically-when.ts`

**Tests**:
- `lib/tests/integration/sendAutomaticallyWhen-integration.test.ts`
- `lib/tests/integration/sendAutomaticallyWhen-false-cases.test.ts`
- `lib/tests/e2e/frontend-execute-bidi.e2e.test.tsx`
- `lib/tests/e2e/frontend-execute-sse.e2e.test.tsx`
