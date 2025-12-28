# 0003. SSE vs BIDI Confirmation Protocol Differences

**Date:** 2025-12-20
**Status:** Accepted

## Context

After implementing frontend confirmation handler for tool approval flow, we discovered critical protocol differences between SSE and BIDI modes during bug investigation.

**Initial Problem**:

- SSE mode tests: All passing ✅
- BIDI mode tests: Failing with wrong AI responses 🔴
- Root cause: Different confirmation protocols needed for each mode

**Discovery Process**:

1. Noticed SSE tests passing but BIDI tests failing
2. Analyzed baseline chunk logs to understand working implementation
3. Discovered custom WebSocket events incompatible with AI expectations
4. Realized SSE and BIDI require fundamentally different approaches

## Decision

Use **different confirmation protocols** for SSE and BIDI modes, aligned with their architectural differences:

### SSE Mode: ADK Native Handling (Two HTTP Requests)

**Protocol**:

```
Request 1:
Frontend → Backend: User message requesting tool
Backend → Frontend: Streams confirmation UI → [DONE]

Request 2 (After user clicks Approve):
Frontend → Backend: New HTTP request with approval
  - Uses addToolOutput() with ADK-compatible format
  - Backend: FrontendToolDelegate receives approval
  - Backend: Executes tool and generates AI response → [DONE]
```

**Implementation**:

- Frontend: Use `addToolOutput()` to send approval result
- Backend: `_handle_confirmation_if_needed()` passes events through (no custom logic)
- ADK: Natively handles confirmation flow with two separate requests

**Why This Works**:

- ADK's confirmation flow is designed for request-response pattern
- Each HTTP request is independent
- Frontend sends new request after user approval
- No need to manually construct messages

### BIDI Mode: Manual User Message (Single WebSocket Connection)

**Protocol**:

```
Frontend → Backend: User message requesting tool (via WebSocket)
Backend → Frontend: Streams confirmation UI (WebSocket stays open)

Frontend → Backend: User message with tool-result (via WebSocket)
  - Message format: AI SDK v6 standard user message
  - Content: tool-result for ORIGINAL tool (not confirmation tool)
  - Tool ID: Original tool ID (e.g., "function-call-123")
  - Tool Name: Original tool name (e.g., "process_payment")
  - Result: {approved: true, user_message: "..."}

Backend → Frontend: Executes tool and streams AI response
```

**Implementation**:

```typescript
// BIDI confirmation handler sends user message via WebSocket
const approvalMessage: UIMessage = {
  id: `fr-${Date.now()}`,
  role: "user",
  content: [{
    type: "tool-result",
    toolCallId: originalToolInvocation.toolCallId,  // Original tool!
    toolName: originalToolInvocation.toolName,      // Original tool!
    result: {
      approved: confirmed,
      user_message: confirmed ? "User approved" : "User denied"
    }
  }]
};

// Send via WebSocket message event (not custom tool_result event!)
transport.websocket.sendMessage([approvalMessage]);
```

**Why This is Necessary**:

- BIDI maintains single WebSocket connection (no second HTTP request)
- AI model needs to see approval as part of conversation history
- Must use AI SDK v6 standard message format for AI to understand
- Custom WebSocket events don't update AI's conversation context

## Consequences

### Positive

1. **Correct AI Responses**: AI receives approval in format it understands
2. **Mode-Specific Optimization**: Each mode uses its natural pattern
3. **Framework Alignment**: Both modes align with AI SDK v6 expectations
4. **Maintainability**: Clear distinction between SSE and BIDI protocols

### Negative

1. **Code Duplication**: Different implementations for SSE and BIDI
2. **Complexity**: Developers must understand both patterns
3. **Testing Burden**: Need separate test suites for each mode

### Neutral

1. **Protocol Divergence**: SSE and BIDI confirmation flows are fundamentally different
2. **Future Compatibility**: May need updates if AI SDK v6 changes BIDI patterns

## Critical Learnings

### 1. Don't Create Custom Protocols

**Mistake Made**:

```typescript
// ❌ WRONG - Custom WebSocket event
transport.websocket.sendToolResult(
  "confirmation-function-call-...",  // Confirmation tool ID
  { confirmed: true }                 // Custom format
)
```

**Why This Failed**:

- AI never receives approval for original tool
- AI only sees result for `adk_request_confirmation` tool
- AI's conversation context is not updated
- AI responds as if still waiting for approval

**Correct Approach**:

```typescript
// ✅ CORRECT - AI SDK v6 standard user message
const message: UIMessage = {
  role: "user",
  content: [{
    type: "tool-result",
    toolCallId: originalToolId,    // Original tool ID!
    toolName: originalToolName,    // Original tool name!
    result: { approved: true }
  }]
};
```

### 2. Always Check Baseline Implementation First

**Process That Would Have Prevented This Bug**:

1. Before implementing custom protocol, check baseline chunk logs
2. Compare working vs broken implementations
3. Understand WHAT messages the AI model expects
4. Use standard protocols when they exist

**Evidence**:

- Baseline chunk logs showed 8 outgoing WebSocket events
- Current implementation showed 0 outgoing events
- Baseline used AI SDK v6 message format
- Current used custom WebSocket event (incompatible)

### 3. SSE ≠ BIDI (Different Architectural Assumptions)

**SSE Assumptions**:

- Multiple HTTP requests are natural
- Each request is independent
- ADK handles confirmation natively
- Frontend: Just send new request with approval

**BIDI Assumptions**:

- Single persistent WebSocket connection
- All communication through one channel
- Must manually manage conversation context
- Frontend: Send user message to update AI context

## References

**Implementation**:

- SSE: `services/sse_event_streamer.py:_handle_confirmation_if_needed()` (pass-through)
- BIDI: `lib/confirmation-handler.ts` (user message construction)
- Frontend: `components/tool-invocation.tsx` (mode-aware handling)

**Tests**:

- SSE: `scenarios/tools/process-payment-sse.spec.ts` (all passing)
- BIDI: `scenarios/tools/process-payment-bidi.spec.ts` (needs protocol fix)

**Evidence**:

- Baseline logs: `chunk_logs/e2e-baseline/frontend/process-payment-bidi-1-normal-flow-approve-once.jsonl`
- Current logs: `chunk_logs/scenario-11/frontend/process-payment-bidi-1-normal-flow-approve-once.jsonl`
- Investigation: `agents/bidi-tool-execution-investigation.md`

## Multi-Tool Sequential Execution

When executing **multiple tools sequentially** with separate confirmation steps, additional constraints apply beyond the single-tool protocols described above.

### SSE Mode: Multiple HTTP Requests

```
Request 1: Initial user message
→ Response 1: Tool1 confirmation (no text)

Request 2: Tool1 approval
→ Response 2: Tool2 confirmation (no text)

Request 3: Tool2 approval
→ Response 3: ALL text + tool results
```

### BIDI Mode: Single WebSocket with Multiple Confirmations

```
Message 1: Initial user message
→ Response 1: Tool1 confirmation (no text)

Message 2: Tool1 approval
→ Response 2: Tool2 confirmation (no text)

Message 3: Tool2 approval
→ Response 3: ALL text + tool results
```

**Critical Constraint**: Backend MUST NOT send text in intermediate responses (after Tool1 approval). All text must be deferred until the final response after all confirmations complete.

**Rationale**: The `sendAutomaticallyWhen` function uses text part presence to detect "backend already responded," which would block automatic sending of subsequent approvals.

**For detailed explanation**, see **ADR 0004: Multi-Tool Sequential Execution Response Timing**.

## Parallel Tool Approval Limitations

### SSE Mode: Parallel Approval Supported

When executing **multiple tools that require approval in a single message**, SSE mode can handle parallel approvals:

```
Request 1: "Aliceに30ドル、Bobに40ドル送金してください"
→ Response 1:
  - tool-input-available (Alice payment)
  - tool-input-available (Bob payment)
  - tool-approval-request (Alice)
  - tool-approval-request (Bob)
  - [DONE]

Request 2: Both approvals sent together
→ Response 2:
  - tool-output-available (Alice payment)
  - tool-output-available (Bob payment)
  - text-delta/text-done (combined response)
  - [DONE]
```

**Why This Works**:
- SSE uses `generateContent` API
- LLM response completes before tool execution
- All tool calls are generated at once
- Backend sends all tool-approval-requests before [DONE]

### BIDI Mode: Sequential Execution Only

**CRITICAL LIMITATION**: BIDI mode does **NOT** support parallel approvals. Tools are executed sequentially, one at a time.

```
Message 1: "Aliceに30ドル、Bobに40ドル送金してください"
→ Response:
  - tool-input-available (Alice payment only)
  - tool-approval-request (Alice only)
  [BLOCKS HERE - Bob payment not generated yet]

Message 2: Alice approval
→ Response:
  - tool-output-available (Alice payment)
  - tool-input-available (Bob payment) ← Now generated
  - tool-approval-request (Bob)
  [BLOCKS HERE - awaiting Bob approval]

Message 3: Bob approval
→ Response:
  - tool-output-available (Bob payment)
  - text-delta/text-done (combined response)
  - [DONE]
```

**Root Cause: Gemini Live API Design**

Investigation revealed this is **Gemini Live API behavior**, not an ADK or ApprovalQueue limitation:

1. **Function Calling Executes Sequentially by Default**:
   - [Gemini Live API documentation](https://ai.google.dev/gemini-api/docs/live-tools) states: "function calling executes sequentially by default"
   - Default behavior is `BLOCKING` (undocumented), not `NON_BLOCKING`

2. **BLOCKING Behavior Prevents Parallel Generation**:
   ```python
   # Tool declaration with BLOCKING behavior (default)
   process_payment_declaration = types.FunctionDeclaration.from_callable_with_api_option(
       callable=process_payment_simple,
       api_option="GEMINI_API",
       behavior=types.Behavior.BLOCKING,  # Sequential execution
   )
   ```

3. **First Tool Blocks Second Tool Generation**:
   - First tool starts executing and awaits approval
   - LLM/SDK does not generate second tool call until first completes
   - This is by design in Live API's streaming execution model

4. **ApprovalQueue Supports Parallel Approvals**:
   ```python
   # ApprovalQueue is designed for concurrent requests
   self._active_approvals: dict[str, dict[str, Any]] = {}
   # Multiple tools can await simultaneously
   ```
   - ApprovalQueue implementation supports parallel approvals
   - Limitation is in Live API's tool execution, not our code

**Evidence**:

Test output showing sequential behavior:
```
Event 5: tool-input-start (Alice payment)
Event 6: tool-input-available (Alice payment)
Event 7: tool-approval-request (Alice payment)
[Timeout - Bob payment never generated]
```

LLM's own reasoning acknowledges sequential execution:
```
"I'll sequentially request user approval, as required by the tool."
```

**Workaround**: None available. This is fundamental to how Live API handles BLOCKING tools.

**Design Implications**:

| Feature | SSE Mode | BIDI Mode |
|---------|----------|-----------|
| **Parallel Tool Calls** | ✅ Supported | ❌ Not Supported |
| **Parallel Approvals** | ✅ Supported | ❌ Sequential Only |
| **API Used** | generateContent | Live API |
| **Tool Execution** | After LLM completion | During streaming |
| **Use Case** | Multiple independent actions | Single focused task |

**Recommendation**: For use cases requiring parallel approvals (e.g., "pay Alice $30 and Bob $40"), prefer SSE mode over BIDI mode.

## Related ADRs

- **ADR 0002**: Tool Approval Architecture with Backend Delegation
    - Established backend delegation pattern
    - This ADR refines the protocol details for SSE vs BIDI modes
- **ADR 0004**: Multi-Tool Sequential Execution Response Timing
    - Documents response timing constraints for multi-tool scenarios
    - Applies to both SSE and BIDI modes

## Future Considerations

If AI SDK v6 adds native BIDI confirmation patterns:

- May need to update BIDI implementation
- Could potentially simplify to match SSE's pass-through approach
- Should re-evaluate this ADR

Until then, maintain separate protocols as documented here.
