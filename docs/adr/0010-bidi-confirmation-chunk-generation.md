# 0010. BIDI Mode Confirmation Chunk Generation Mechanism

**Date:** 2025-12-28
**Status:** Accepted

## Context

In BIDI Blocking Mode (ADR 0009), approval/deny UI is presented to users through `adk_request_confirmation` chunks. However, the **mechanism of how these chunks are generated** differs fundamentally between SSE and BIDI modes.

**Key Challenge**:

ADK SDK natively generates `adk_request_confirmation` FunctionCalls in SSE mode, but **does NOT generate them in BIDI mode** due to SDK limitations. We need to manually inject these chunks in BIDI mode while maintaining UX consistency with SSE mode.

**User Perspective**:

From the user's perspective, both SSE and BIDI modes should present identical approval UI. The chunk generation mechanism must be transparent:

```
SSE Mode (ADK native)  →  [Approval UI]
BIDI Mode (Manual)     →  [Approval UI]  ← Same UX
```

## Decision

**Inject `adk_request_confirmation` chunks manually in BIDI mode** using `BidiEventSender._handle_confirmation_if_needed()` to match SSE mode's native behavior.

### Chunks Visible to Users

When a confirmation-required tool (e.g., `get_location`, `process_payment`) is invoked, users see two sequential chunks:

#### 1. Original Tool Call Chunk

```json
{
  "type": "tool-input-available",
  "toolCallId": "function-call-14585904258601352739",
  "toolName": "get_location",
  "input": {}
}
```

**Purpose**: Shows that the tool was invoked with specific arguments.

#### 2. Confirmation Request Chunk (Triggers Approval UI)

```json
{
  "type": "tool-input-available",
  "toolCallId": "adk-e27fcf16-59c5-40d6-82d1-c0d8e6714b7b",
  "toolName": "adk_request_confirmation",
  "input": {
    "originalFunctionCall": {
      "id": "function-call-14585904258601352739",
      "name": "get_location",
      "args": {}
    },
    "toolConfirmation": {
      "hint": "Please approve or reject the tool call get_location() by responding with a FunctionResponse with an expected ToolConfirmation payload.",
      "confirmed": false
    }
  }
}
```

**Purpose**: Triggers frontend to display approval UI.

**Critical**: The `originalFunctionCall.id` links the confirmation back to the original tool, enabling proper approval routing.

### Chunk Generation Call Chain

```
┌─────────────────────────────────────────────────────────┐
│ 1. ADK (Google GenAI SDK)                                │
│    - Generates FunctionCall for tool invocation          │
│    - types.Behavior.BLOCKING set for confirmation tools  │
└──────────────────┬──────────────────────────────────────┘
                   │ FunctionCall: get_location()
                   ↓
┌─────────────────────────────────────────────────────────┐
│ 2. ADK AG Runner (adk_ag_runner.py)                     │
│    - Configures tools with BLOCKING behavior             │
│    - Registers confirmation_tools list                   │
└──────────────────┬──────────────────────────────────────┘
                   │ Stream events from ADK
                   ↓
┌─────────────────────────────────────────────────────────┐
│ 3. Stream Protocol (stream_protocol.py)                 │
│    - Converts ADK events to AI SDK format               │
│    - Generates SSE-formatted event stream               │
└──────────────────┬──────────────────────────────────────┘
                   │ SSE events
                   ↓
┌─────────────────────────────────────────────────────────┐
│ 4. BIDI Event Sender (bidi_event_sender.py)             │
│    ★ Generates adk_request_confirmation chunks HERE ★   │
│                                                          │
│    Method: _handle_confirmation_if_needed()              │
│    Lines: 221-367                                        │
│                                                          │
│    Detection Flow:                                       │
│    ① tool-input-start → Record in pending_confirmation  │
│    ② tool-input-available → Trigger injection          │
│                                                          │
│    Injection Process:                                    │
│    ③ Send original tool-input-available                │
│    ④ Generate confirmation_id (UUID)                    │
│    ⑤ Inject tool-input-start (adk_request_confirmation) │
│    ⑥ Inject tool-input-available (w/ originalFunctionCall) │
│    ⑦ Map confirmation_id → original_tool_call_id       │
└──────────────────┬──────────────────────────────────────┘
                   │ WebSocket send
                   ↓
┌─────────────────────────────────────────────────────────┐
│ 5. Frontend (React)                                      │
│    - Detects adk_request_confirmation chunk             │
│    - Renders Approval UI component                       │
│    - User clicks Approve/Deny                            │
│    - Sends approval response via WebSocket               │
└─────────────────────────────────────────────────────────┘
```

### Implementation: BidiEventSender._handle_confirmation_if_needed()

**Location**: `adk_stream_protocol/transport/bidi_event_sender.py:221-367`

**Step-by-Step Process**:

```python
async def _handle_confirmation_if_needed(self, sse_event: str) -> bool:
    """
    Detects confirmation-required tools and injects adk_request_confirmation chunks.

    Returns:
        True if event should be sent immediately
        False if event was deferred and sent later
    """
    # Parse SSE event
    event_data = parse_sse_event(sse_event)
    event_type = event_data.get("type")
    tool_call_id = event_data.get("toolCallId")
    tool_name = event_data.get("toolName")

    # Step 1: Record tool-input-start for confirmation-required tools
    if event_type == "tool-input-start" and tool_name in self._confirmation_tools:
        self._pending_confirmation[tool_call_id] = tool_name
        return True  # Send original event

    # Step 2: Detect tool-input-available for pending confirmations
    elif event_type == "tool-input-available":
        if tool_call_id in self._pending_confirmation:
            tool_name = self._pending_confirmation.pop(tool_call_id)

            # Extract tool arguments from input
            tool_args = event_data.get("input", {})

            # Save pending call info for execution after approval
            self._session.state["pending_long_running_calls"][tool_call_id] = {
                "name": tool_name,
                "args": tool_args
            }

            # Step 3: Send original tool-input-available FIRST
            await self._send_sse_event(sse_event)

            # Step 4: Generate unique confirmation ID
            confirmation_id = f"adk-{uuid.uuid4()}"

            # Step 5: Create originalFunctionCall payload
            original_function_call = {
                "id": tool_call_id,
                "name": tool_name,
                "args": tool_args
            }

            # Step 6: Inject tool-input-start for adk_request_confirmation
            start_event = {
                "type": "tool-input-start",
                "toolCallId": confirmation_id,
                "toolName": "adk_request_confirmation"
            }
            await self._ws.send_text(f"data: {json.dumps(start_event)}\n\n")

            # Step 7: Inject tool-input-available for adk_request_confirmation
            available_event = {
                "type": "tool-input-available",
                "toolCallId": confirmation_id,
                "toolName": "adk_request_confirmation",
                "input": {
                    "originalFunctionCall": original_function_call,
                    "toolConfirmation": {
                        "hint": f"Please approve or reject the tool call {tool_name}()...",
                        "confirmed": False
                    }
                }
            }
            await self._ws.send_text(f"data: {json.dumps(available_event)}\n\n")

            # Step 8: Map confirmation_id → original_tool_call_id
            self._session.state["confirmation_id_mapping"][confirmation_id] = tool_call_id

            # Return False because we already sent the original event
            return False

    return True  # Send all other events normally
```

**Key Implementation Details**:

1. **Event Order Matters**: Original `tool-input-available` MUST be sent before confirmation chunks
2. **ID Mapping Required**: `confirmation_id → original_tool_call_id` mapping enables approval routing
3. **Session State**: `pending_long_running_calls` tracks pending executions for BIDI Blocking Mode cleanup
4. **UUID Generation**: Each confirmation request gets unique ID to avoid collisions

### Component Responsibilities

| Component | Responsibility |
|-----------|----------------|
| **ADK AG Runner** | Configure BLOCKING behavior, register confirmation_tools list |
| **Stream Protocol** | Convert ADK events to AI SDK format (no confirmation logic) |
| **BidiEventSender** | **Generate adk_request_confirmation chunks** (Lines 338-349) |
| **ConfirmationInterceptor** | Execute confirmation flow (await approval, handle timeout) |
| **FrontendToolDelegate** | Bridge between WebSocket and BLOCKING tools (Future pattern) |

**Design Principle**: Separation of concerns - chunk generation (BidiEventSender) vs execution (ConfirmationInterceptor).

## Consequences

### Positive

1. **UX Consistency**: Identical approval UI in SSE and BIDI modes
2. **SDK Limitation Workaround**: Compensates for ADK's BIDI mode gap
3. **Maintainability**: Clear injection logic in single method
4. **Testability**: Chunk generation can be tested independently
5. **Transparency**: Frontend unaware of difference between modes

### Negative

1. **Code Complexity**: Manual chunk injection adds ~150 lines of logic
2. **Fragility**: Depends on specific event sequence (tool-input-start → tool-input-available)
3. **ADK Coupling**: Breaks if ADK changes event format
4. **Debugging Difficulty**: Injected chunks harder to trace than native ones

### Neutral

1. **SSE Mode Unchanged**: SSE continues using ADK native confirmation (no injection)
2. **ID Mapping Overhead**: Requires maintaining `confirmation_id_mapping` dict
3. **Session State Dependency**: Injection logic coupled to session state structure

## Critical Implementation Notes

### 1. Event Order is Critical

**Correct Order**:

```
1. tool-input-start (original tool)
2. tool-input-available (original tool)
3. tool-input-start (adk_request_confirmation)
4. tool-input-available (adk_request_confirmation)
```

**Why**: Frontend expects confirmation chunk AFTER seeing the original tool call. Incorrect order breaks UI rendering.

### 2. ID Mapping Enables Approval Routing

When user approves/denies, frontend sends:

```typescript
{
  type: "tool-adk_request_confirmation",
  toolCallId: "adk-e27fcf16-59c5-40d6-82d1-c0d8e6714b7b",  // Confirmation ID
  approval: { approved: true }
}
```

Backend uses `confirmation_id_mapping` to find original tool:

```python
confirmation_id = "adk-e27fcf16-59c5-40d6-82d1-c0d8e6714b7b"
original_tool_call_id = mapping[confirmation_id]  # "function-call-14585904258601352739"
```

This enables `ApprovalQueue` to unblock the correct BLOCKING tool.

### 3. BIDI Blocking Mode State Cleanup Required

Even though BIDI Blocking Mode tools don't use `pending_long_running_calls` for execution, `BidiEventSender` populates this dict during injection. Must clean up on approval:

```python
# BidiEventReceiver._handle_confirmation_approval()
pending_calls = self._session.state.get("pending_long_running_calls", {})
if original_tool_call_id in pending_calls:
    del pending_calls[original_tool_call_id]  # Critical cleanup
```

**Why**: Without cleanup, final `tool-output-available` is skipped (Legacy Approval Mode behavior).

## Testing Strategy

### Unit Tests

**Target**: `BidiEventSender._handle_confirmation_if_needed()`

**Test Cases**:

1. Non-confirmation tools → Pass through unchanged
2. Confirmation tool detection → Inject correct chunks
3. Event ordering → Original before confirmation
4. ID mapping → Correct confirmation_id → original_id
5. Multiple confirmations → No ID collisions

### Integration Tests

**Target**: End-to-end approval flow

**Baseline Fixtures**:

- `fixtures/frontend/get_location-approved-bidi-baseline.json`
- `fixtures/frontend/process_payment-approved-bidi-baseline.json`

**Verification**:

```typescript
// Check chunk sequence
expect(chunks[0].toolName).toBe("get_location");
expect(chunks[1].toolName).toBe("adk_request_confirmation");
expect(chunks[1].input.originalFunctionCall.id).toBe(chunks[0].toolCallId);
```

### E2E Tests

**Target**: Real WebSocket communication

**Tests**:

- `tests/e2e/backend_fixture/test_get_location_approved_bidi_baseline.py`
- `tests/e2e/backend_fixture/test_process_payment_approved_bidi_baseline.py`

**Validation**: Compare actual chunks against baseline fixtures (structure + content).

## Related ADRs

- **ADR 0009**: BIDI Blocking Mode for Tool Approval Flow
    - Establishes BLOCKING behavior and ApprovalQueue
    - This ADR documents chunk generation mechanism for BIDI Blocking Mode
- **ADR 0003**: SSE vs BIDI Confirmation Protocol Differences
    - Documents protocol differences between modes
    - This ADR focuses specifically on BIDI chunk injection

## Future Considerations

### If ADK Adds Native BIDI Confirmation

If Google adds native `adk_request_confirmation` generation for BIDI mode:

1. **Remove injection logic** from `BidiEventSender._handle_confirmation_if_needed()`
2. **Simplify to pass-through** (like SSE mode)
3. **Update tests** to expect native chunks
4. **Deprecate** manual ID mapping

### Potential Enhancements

1. **Configurable Hint Messages**: Allow per-tool customization of confirmation hint
2. **Rich Confirmation UI**: Add metadata for custom UI rendering (icons, colors)
3. **Multi-Step Confirmations**: Support approval chains (e.g., manager → exec approval)
4. **Audit Trail**: Log chunk generation for compliance/debugging

## References

**Implementation**:

- `adk_stream_protocol/transport/bidi_event_sender.py:221-367` - Chunk injection logic
- `adk_stream_protocol/transport/bidi_event_sender.py:338-349` - Confirmation chunk creation
- `adk_stream_protocol/confirmation_interceptor.py` - Confirmation execution
- `adk_stream_protocol/tools/approval_queue.py` - BLOCKING tool coordination

**Tests**:

- `tests/e2e/backend_fixture/test_get_location_approved_bidi_baseline.py` - E2E approval test
- `lib/tests/integration/transport-done-baseline.test.ts` - Frontend integration tests

**Baseline Fixtures**:

- `fixtures/frontend/get_location-approved-bidi-baseline.json` - BIDI approval baseline
- `fixtures/frontend/get_location-approved-sse-baseline.json` - SSE comparison baseline
