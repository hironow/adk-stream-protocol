# Confirmation Flow Specification

**Status:** Draft for discussion
**Date:** 2025-12-20
**Context:** Fixing E2E test failures for `adk_request_confirmation` timeout issues

## Problem Statement

E2E tests are failing with timeout errors because confirmation results are not being sent from frontend to backend. Backend waits 5 seconds for confirmation result, then times out.

### Failing Tests

1. `scenarios/tools/process-payment-sse.spec.ts` - SSE mode (3 tests failing)
2. `scenarios/tools/process-payment-bidi.spec.ts` - BIDI mode (3 tests failing)

### Root Cause (from logs)

**Backend behavior:**

```log
[FrontendDelegate] Awaiting result for tool=adk_request_confirmation,
function_call.id=confirmation-adk-384471c4-9d3e-43ca-bd3f-f203a12673dd
[FrontendDelegate] ========== TIMEOUT DETECTED ==========
[FrontendDelegate] Frontend never sent result after 5 seconds.
```

**Frontend behavior (from chunk logs):**

- ✅ Frontend receives `tool-input-available` event with correct `toolCallId`
- ✅ Frontend shows approval UI
- ❌ Frontend does NOT send `tool-result` back to backend
- Evidence: All chunk log events show `direction: "in"`, no outgoing events

## Correct Behavior Specification

### SSE Mode

#### Sequence Diagram

```
Backend                    Frontend
   |                          |
   |--- tool-input-start ---->|
   |--- tool-input-available->| (toolCallId: confirmation-adk-XXXX)
   |                          |
   |                          | [User sees approval UI]
   |                          | [User clicks Approve]
   |                          |
   |<-- addToolOutput --------|  {
   |                          |    tool: "adk_request_confirmation",
   |                          |    toolCallId: "confirmation-adk-XXXX",
   |                          |    output: { confirmed: true }
   |                          |  }
   |                          |
   |--- continue execution -->|
```

Legend:

- tool-input-start: ツール入力開始イベント
- tool-input-available: ツール入力利用可能イベント
- addToolOutput: ツール出力追加（SSEモード）
- continue execution: 実行継続

#### Critical Requirements

1. **Exact toolCallId preservation**
   - Backend sends: `confirmation-adk-384471c4-9d3e-43ca-bd3f-f203a12673dd`
   - Frontend MUST send back: `confirmation-adk-384471c4-9d3e-43ca-bd3f-f203a12673dd`
   - NO modification, NO regeneration

2. **Output structure**

   ```typescript
   {
     tool: "adk_request_confirmation",
     toolCallId: "confirmation-adk-384471c4-9d3e-43ca-bd3f-f203a12673dd",
     output: {
       confirmed: true  // or false for denial
     }
   }
   ```

3. **Transport method**
   - Use `addToolOutput()` function from AI SDK
   - This function MUST actually send the result to backend (current investigation needed)

#### Current Implementation Gap

**Location:** `components/tool-invocation.tsx:321-359`

```typescript
// Current code (NOT WORKING)
<button
  onClick={() => {
    const output = createAdkConfirmationOutput(toolInvocation, true);
    addToolOutput?.(output);  // ← This doesn't send to backend!
  }}
>
  Approve
</button>
```

**Expected fix:**

- Replace inline logic with `handleConfirmation()`
- Investigate why `addToolOutput()` doesn't send to backend in SSE mode
- Ensure tool-result event is actually transmitted

### BIDI Mode

#### Sequence Diagram

```
Backend                    Frontend
   |                          |
   |--- FunctionCall -------->| (id: confirmation-function-call-XXXX)
   |                          |
   |                          | [User sees approval UI]
   |                          | [User clicks Approve]
   |                          |
   |<-- sendToolResult -------|  (
   |                          |    toolCallId: "confirmation-function-call-XXXX",
   |                          |    result: { confirmed: true }
   |                          |  )
   |                          |
   |--- continue execution -->|
```

Legend:

- FunctionCall: 関数呼び出し（BIDIモード）
- sendToolResult: ツール結果送信（WebSocket）

#### Critical Requirements

1. **Exact toolCallId preservation**
   - Backend sends: `confirmation-function-call-456`
   - Frontend MUST send back: `confirmation-function-call-456`

2. **Result structure**

   ```typescript
   { confirmed: true }  // Simple object, not wrapped
   ```

3. **Transport method**
   - Use `websocketTransport.sendToolResult(toolCallId, result)`
   - WebSocket sends directly to backend

#### Known Working Case

**get_location tool** (BIDI mode) works correctly:

- Same WebSocket transport
- Same `sendToolResult()` mechanism
- Pattern should be replicated for confirmations

### Cross-Mode Behavior

#### Transport Priority

When both transports available:

1. **Priority 1:** WebSocket (BIDI mode)
2. **Priority 2:** SSE (SSE mode)

Rationale: WebSocket is more efficient for bidirectional communication.

#### ID Format Differences

**SSE mode:**

- Format: `confirmation-adk-{UUID}`
- Example: `confirmation-adk-384471c4-9d3e-43ca-bd3f-f203a12673dd`

**BIDI mode:**

- Format: `confirmation-function-call-{ID}`
- Example: `confirmation-function-call-456`

**Critical:** Frontend must preserve whatever ID backend sends, regardless of format.

## Implementation Plan

### Phase 1: Integrate Handler (TDD Green)

1. **Update `tool-invocation.tsx`**
   - Replace inline approval logic with `handleConfirmation()`
   - Pass correct transport object
   - Remove duplicate code

2. **Transport object construction**

   ```typescript
   const transport: ConfirmationTransport = {
     websocket: websocketTransport ? {
       sendToolResult: websocketTransport.sendToolResult
     } : undefined,
     sse: addToolOutput ? {
       addToolOutput
     } : undefined,
   };

   handleConfirmation(toolInvocation, true, transport);
   ```

### Phase 2: Investigate SSE addToolOutput (if needed)

If E2E tests still fail after Phase 1:

1. **Trace `addToolOutput` implementation**
   - Location: `lib/build-use-chat-options.ts`
   - Verify it calls backend API
   - Check if tool-result events are sent

2. **Potential fix approaches**
   - Fix `addToolOutput` implementation
   - Use WebSocket for confirmations even in SSE mode
   - Create custom SSE submission mechanism

### Phase 3: Verify E2E Tests Pass

Run all confirmation E2E tests:

```bash
just test-baseline-e2e
```

Expected result: All 6 tests pass (0 failures)

## Test Coverage

### Unit Tests ✅

- `lib/confirmation-handler.test.ts` (8 tests, all passing)
- Tests handler logic in isolation
- Defines correct behavior

### Integration Tests ✅

- `lib/confirmation-handler.integration.test.ts` (9 tests, all passing)
- Tests handler with createAdkConfirmationOutput
- Reproduces exact E2E scenarios

### E2E Tests ❌ (Currently failing)

- `scenarios/tools/process-payment-sse.spec.ts` (3 failures)
- `scenarios/tools/process-payment-bidi.spec.ts` (3 failures)
- Will pass after Phase 1 integration

## Evidence Trail

### Chunk Logs

**File:** `chunk_logs/scenario-9/frontend/process-payment-sse-1-normal-flow-approve-once.jsonl`

Line 4 shows frontend receives confirmation request:

```json
{
  "type": "tool-input-available",
  "toolCallId": "confirmation-adk-384471c4-9d3e-43ca-bd3f-f203a12673dd",
  "toolName": "adk_request_confirmation",
  "input": {
    "originalFunctionCall": {
      "id": "adk-384471c4-9d3e-43ca-bd3f-f203a12673dd",
      "name": "process_payment",
      "args": {"recipient": "花子", "amount": 50, "currency": "USD"}
    },
    "toolConfirmation": {"confirmed": false}
  }
}
```

**Missing:** No outgoing event with `direction: "out"` for tool-result

### Backend Logs

**File:** `logs/server_scenario-9.log`

```log
2025-12-20 14:39:18.384 | INFO - [FrontendDelegate] Awaiting result for
tool=adk_request_confirmation,
function_call.id=confirmation-adk-6038360e-0572-46c2-b868-9ae035efe8d6

2025-12-20 14:39:23.386 | ERROR - [FrontendDelegate] ========== TIMEOUT DETECTED ==========
2025-12-20 14:39:23.386 | ERROR - [FrontendDelegate] Tool: adk_request_confirmation,
function_call.id=confirmation-adk-6038360e-0572-46c2-b868-9ae035efe8d6
2025-12-20 14:39:23.386 | ERROR - [FrontendDelegate] Frontend never sent result after 5 seconds.
```

## Discussion Points

### Question 1: Should we investigate `addToolOutput` first?

**Option A:** Integrate handler first, then investigate if still failing
**Option B:** Investigate `addToolOutput` implementation before integration

**Recommendation:** Option A - integrate first, as it's the simpler fix and may solve the issue.

### Question 2: Should we always use WebSocket for confirmations?

Even in SSE mode, if WebSocket connection exists, we could use it for confirmations.

**Pros:**

- More reliable (proven working for get_location)
- Simpler debugging

**Cons:**

- Inconsistent with other SSE tools
- May hide `addToolOutput` bugs

**Recommendation:** Follow transport priority (WebSocket > SSE) as designed.

### Question 3: Should we add E2E tests for edge cases?

Current E2E tests only cover:

- Normal flow (approve once)
- Approve twice

Missing:

- Denial flow
- Timeout handling
- Invalid tool names

**Recommendation:** Add after fixing current failures.

## Success Criteria

✅ All unit tests pass (8/8)
✅ All integration tests pass (9/9)
❌ All E2E tests pass (0/6) ← **Target**

**Definition of Done:**

1. E2E tests pass without timeout errors
2. Chunk logs show outgoing tool-result events
3. Backend logs show confirmation results received
4. No regressions in other tests
