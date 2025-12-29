# 0009. Phase 12 BLOCKING Mode for Tool Approval Flow

**Date:** 2025-12-27
**Status:** Accepted

## Context

When implementing deferred approval flow in BIDI mode, we discovered two distinct implementation patterns in ADK:

1. **Phase 5: LongRunningFunctionTool** - Tool returns pending status immediately, execution continues asynchronously
2. **Phase 12: BLOCKING Mode** - Tool awaits approval inside function using `types.Behavior.BLOCKING`

The critical question was: **Which pattern should we use for BIDI mode tool approval, and why?**

### Initial Phase 5 Implementation

**Pattern**:

```python
from adk import LongRunningFunctionTool

class ProcessPaymentTool(LongRunningFunctionTool):
    async def send_content(self, content, tool_context):
        # Tool returns pending immediately
        return {"status": "pending", "tool_call_id": tool_context.tool_call_id}

    async def execute(self, args, tool_context):
        # Actual execution happens later
        # Requires multi-turn flow with separate [DONE] markers
        pass
```

**Event Flow (Phase 5)**:

```
Turn 1:
  User: "次郎さんに200ドル送金してください"
  Backend: tool-input → adk_request_confirmation
  Backend: tool-output (pending status) → [DONE]

Turn 2 (After approval):
  User: approval message
  Backend: tool-output (actual result) → [DONE]
```

**Characteristics**:

- **2 separate turns** with **2 [DONE] markers**
- Tool returns pending immediately
- Requires session state (`pending_long_running_calls`) to track pending tools
- Complex state management for multi-turn flow

### Discovery of Phase 12 BLOCKING Mode

While investigating ADK capabilities, we discovered `types.Behavior.BLOCKING`:

**Pattern**:

```python
from adk import FunctionDeclaration, types

process_payment = FunctionDeclaration.from_callable_with_api_option(
    fn=process_payment_impl,
    api_options=types.FunctionDeclarationOptions(
        behavior=types.Behavior.BLOCKING
    )
)

async def process_payment_impl(amount: float, recipient: str, currency: str) -> dict:
    # Request approval
    approval_queue.request_approval(tool_call_id, "process_payment", args)

    # BLOCKS HERE (awaiting approval) - but doesn't block event loop
    result = await approval_queue.wait_for_approval(tool_call_id, timeout=30.0)

    if result["approved"]:
        return execute_payment(amount, recipient, currency)
    else:
        raise ValueError("User denied the payment")
```

**Event Flow (Phase 12)**:

```
Single Continuous Turn:
  User: "次郎さんに200ドル送金してください"
  Backend: tool-input → adk_request_confirmation
  [Tool is BLOCKING, awaiting approval - event loop continues]
  User: approval message (unblocks tool)
  Backend: tool-output (actual result) → finish → [DONE]
```

**Characteristics**:

- **Single continuous stream** with **1 [DONE] marker**
- Tool awaits approval inside function
- No session state tracking needed
- Event loop continues during await (non-blocking await)

### Key Insight: BLOCKING ≠ Event Loop Blocking

**Critical Discovery**:

BLOCKING mode in ADK does NOT block the event loop. It uses Python's `async/await` to suspend the coroutine while allowing other tasks to continue:

```python
# BLOCKING tool awaits approval
result = await approval_queue.wait_for_approval(tool_call_id, timeout=30.0)
# ↑ This suspends the coroutine but doesn't block the event loop
# ↓ Other tasks (like WebSocket message handling) continue running

# Meanwhile, WebSocket handler can still receive messages:
async def _handle_confirmation_approval(self, confirmation_id, response_data):
    # This runs while tool is awaiting
    approval_queue.submit_approval(original_tool_call_id, approved)
    # This unblocks the awaiting tool
```

This is **exactly what we need** for deferred approval flow:

- Tool function pauses at approval point
- WebSocket handler continues receiving messages
- Approval message unblocks the tool
- Tool continues execution and returns result

## Decision

Use **Phase 12 BLOCKING Mode** for BIDI mode tool approval flow instead of Phase 5 LongRunningFunctionTool.

### Implementation Architecture

**Backend Components**:

1. **ApprovalQueue** - Bridge between WebSocket handler and BLOCKING tools:

   ```python
   class ApprovalQueue:
       async def wait_for_approval(self, tool_call_id: str) -> dict[str, Any]:
           """Blocks tool execution until approval received"""
           # Suspends coroutine, doesn't block event loop

       def submit_approval(self, tool_call_id: str, approved: bool) -> None:
           """Called by WebSocket handler to unblock tool"""
   ```

2. **BLOCKING Tool Declaration**:

   ```python
   FunctionDeclaration.from_callable_with_api_option(
       fn=process_payment,
       api_options=types.FunctionDeclarationOptions(
           behavior=types.Behavior.BLOCKING
       )
   )
   ```

3. **BidiEventReceiver** - Handles approval messages from frontend:

   ```python
   async def _handle_confirmation_approval(self, confirmation_id, response_data):
       # Phase 12: Check for approval_queue
       approval_queue = self._session.state.get("approval_queue")
       if approval_queue:
           # Submit approval to unblock BLOCKING tool
           approval_queue.submit_approval(original_tool_call_id, approved)

           # CRITICAL: Clean up pending_long_running_calls
           # This allows final tool-output-available to be sent
           pending_calls = self._session.state.get("pending_long_running_calls", {})
           if original_tool_call_id in pending_calls:
               del pending_calls[original_tool_call_id]
   ```

**Frontend Protocol** (unchanged):

- Uses existing `message` event with `approval-responded` state
- Same format as Phase 5 (no frontend changes needed)

### Why Phase 12 is Better

1. **Simpler Event Flow**: Single continuous stream vs multi-turn flow
2. **No State Management**: No need for `pending_long_running_calls` tracking
3. **Natural Code Flow**: Linear function execution with await
4. **Fewer [DONE] Markers**: 1 vs 2 (easier for frontend to handle)
5. **Better Error Handling**: Tool can raise exception directly, no need for deferred error state

### Technical Comparison

| Aspect | Phase 5 (LongRunningFunctionTool) | Phase 12 (BLOCKING) |
|--------|-----------------------------------|---------------------|
| **Turn Count** | 2 turns | 1 continuous turn |
| **[DONE] Count** | 2 | 1 |
| **State Tracking** | `pending_long_running_calls` required | Optional (only for cleanup) |
| **Code Structure** | Split: `send_content()` + `execute()` | Linear: single `async def` |
| **Error Handling** | Deferred error state | Direct exception raising |
| **Event Loop** | Non-blocking | Non-blocking (async await) |
| **Frontend Changes** | None | None |

## Consequences

### Positive

1. **Simpler Implementation**: Linear code flow matches developer mental model
2. **Easier Testing**: Single stream easier to test than multi-turn flow
3. **Better Performance**: Fewer events, less state management overhead
4. **Clearer Semantics**: "Tool awaits approval" is more intuitive than "tool returns pending"
5. **Frontend Compatibility**: Same approval protocol as Phase 5 (seamless migration)
6. **Error Propagation**: Exceptions propagate naturally through await chain

### Negative

1. **ADK Dependency**: Requires understanding of `types.Behavior.BLOCKING` (not in standard docs)
2. **ApprovalQueue Necessity**: Custom bridge required (LiveRequestQueue not accessible from tools)
3. **Timeout Handling**: Must implement timeout logic in ApprovalQueue
4. **Debugging Complexity**: Suspended coroutines harder to debug than explicit state machines

### Neutral

1. **Different Pattern**: Developers familiar with Phase 5 need to learn Phase 12
2. **No LiveRequestQueue Access**: Tools cannot access LiveRequestQueue directly (design limitation)
3. **Parameter Injection**: BLOCKING tools (return dict) don't receive LiveRequestQueue injection (only async generator streaming tools do)

## Implementation Details

### Phase 12 BLOCKING Tool Pattern

```python
# 1. Create approval queue
approval_queue = ApprovalQueue()
session.state["approval_queue"] = approval_queue

# 2. Create BLOCKING tool
async def process_payment(amount: float, recipient: str, currency: str) -> dict:
    tool_call_id = get_current_tool_call_id()  # From context

    # Register approval request
    approval_queue.request_approval(tool_call_id, "process_payment", {
        "amount": amount,
        "recipient": recipient,
        "currency": currency
    })

    # Await approval (suspends coroutine, doesn't block event loop)
    result = await approval_queue.wait_for_approval(tool_call_id, timeout=30.0)

    if result["approved"]:
        # Execute payment
        return {
            "success": True,
            "transaction_id": generate_txn_id(),
            "amount": amount,
            "recipient": recipient
        }
    else:
        # User denied
        raise ValueError("User denied the payment")

# 3. Declare tool with BLOCKING behavior
process_payment_tool = FunctionDeclaration.from_callable_with_api_option(
    fn=process_payment,
    api_options=types.FunctionDeclarationOptions(
        behavior=types.Behavior.BLOCKING
    )
)
```

### Phase 12 Event Flow

```
1. User sends message: "次郎さんに200ドル送金してください"

2. Backend events (single continuous stream):
   - start
   - tool-input-start (process_payment)
   - tool-input-available (process_payment)
   - tool-input-start (adk_request_confirmation)
   - tool-input-available (adk_request_confirmation)
   [Tool is BLOCKING, awaiting approval]

3. User sends approval message

4. Backend events (continuation):
   - tool-output-available (process_payment) ← Unblocked!
   - text-start
   - text-delta
   - text-end
   - finish
   - [DONE]
```

### Critical Implementation Notes

1. **Cleanup pending_long_running_calls**: Even in Phase 12, `pending_long_running_calls` may be populated by `BidiEventSender._handle_confirmation_if_needed()`. Must clean up this dict when approval is submitted, otherwise final `tool-output-available` will be skipped.

2. **confirmation_id_mapping**: Required to map `adk_request_confirmation` tool call ID back to original tool call ID:

   ```python
   confirmation_id_mapping = {
       "adk-confirmation-123": "function-call-original-456"
   }
   ```

3. **Frontend Protocol Alignment**: Use existing `message` event with `approval-responded` state (not custom `tool_approval` event):

   ```typescript
   const approvalMessage = {
       role: "user",
       parts: [{
           type: "tool-adk_request_confirmation",
           toolCallId: confirmation_id,
           state: "approval-responded",
           approval: {
               id: confirmation_id,
               approved: true
           }
       }]
   };
   ```

## Migration Path

### From Phase 5 to Phase 12

1. **Backend Changes**:
   - Create `ApprovalQueue` in session state
   - Convert tools to BLOCKING pattern
   - Update tool declarations to use `types.Behavior.BLOCKING`
   - Update `BidiEventReceiver._handle_confirmation_approval` to handle Phase 12

2. **Frontend Changes**:
   - **NONE** - Frontend approval protocol remains the same

3. **Testing**:
   - Create Phase 12 baseline fixtures
   - Add Phase 12 tests to `transport-done-baseline.test.ts`
   - Verify frontend can handle single continuous stream

### Baseline Fixtures

Phase 12 baseline fixtures created:

- `fixtures/frontend/process_payment-approved-bidi-phase12.json`
- `fixtures/frontend/process_payment-denied-bidi-phase12.json`

Key differences from Phase 5 fixtures:

- `expectedDoneCount: 1` (instead of 2)
- `expectedStreamCompletion: true`
- Single continuous event sequence (no break between turns)

## References

**Implementation**:

- `adk_stream_protocol/approval_queue.py` - ApprovalQueue bridge
- `adk_stream_protocol/bidi_event_receiver.py:_handle_confirmation_approval()` - Phase 12 handling
- `tests/e2e/backend_fixture/test_process_payment_approved_bidi_phase12.py` - Approval test
- `tests/e2e/backend_fixture/test_process_payment_denied_bidi_phase12.py` - Denial test

**Baseline Fixtures**:

- `fixtures/frontend/process_payment-approved-bidi-phase12.json`
- `fixtures/frontend/process_payment-denied-bidi-phase12.json`

**Frontend Tests**:

- `lib/tests/integration/transport-done-baseline.test.ts` - Phase 12 transport tests

**Related ADRs**:

- ADR 0002: Tool Approval Architecture with Backend Delegation
- ADR 0003: SSE vs BIDI Confirmation Protocol Differences

## Future Considerations

### Potential Phase 12 Enhancements

1. **Timeout Customization**: Allow per-tool timeout configuration
2. **Cancellation Support**: Add ability to cancel pending approvals
3. **Multi-Approval**: Support tools requiring multiple approval steps
4. **Audit Trail**: Log approval decisions for compliance

### ADK Evolution

If ADK adds native deferred approval support:

- May obsolete ApprovalQueue bridge
- Could simplify implementation
- Should re-evaluate this ADR

Until then, Phase 12 BLOCKING mode provides the best balance of simplicity and functionality.
