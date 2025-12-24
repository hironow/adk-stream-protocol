# BIDI Tool Confirmation with LongRunningFunctionTool - Implementation Plan

**Date:** 2025-12-18
**Status:** 🟡 Planning (Ultrathink Mode)
**Objective:** Implement tool confirmation in BIDI mode using ADK's LongRunningFunctionTool pattern

---

## 📋 Executive Summary

**Problem:** Current approach (ToolConfirmationInterceptor + sendAutomaticallyWhen) is structurally impossible in BIDI mode because ADK's continuous event stream prevents the frontend from detecting stream completion.

**Solution:** Adopt ADK's LongRunningFunctionTool pattern to explicitly pause/resume agent execution, allowing proper human-in-the-loop approval workflow.

---

## 🎯 Current Architecture vs. Proposed Architecture

### Current Architecture (SSE Mode - Working ✅)

```
User Request
   ↓
LLM calls process_payment(amount=50, recipient="花子")
   ↓
ADK detects require_confirmation=True
   ↓
ADK auto-generates adk_request_confirmation tool call
   ↓
Frontend shows approval UI
   ↓
User clicks Approve → Backend receives confirmation
   ↓
ADK executes original process_payment
   ↓
LLM generates response: "送金しました"
```

**Why it works:** ADK SDK natively handles the confirmation flow in generateContent API (SSE).

### Current Architecture (BIDI Mode - Broken ❌)

```
User Request
   ↓
LLM calls process_payment(amount=50, recipient="花子")
   ↓
ADK detects require_confirmation=True → BUT Live API doesn't support it!
   ↓
Tool executes immediately WITHOUT approval (Bug #1)
   ↓
LLM generates text: None (Bug #2)
```

**Why it doesn't work:**

1. Live API (`_call_live()`) has TODO: "tool confirmation is not yet supported for live mode"
2. Even with custom interceptor, ADK continues sending events during await, reopening stream

### Proposed Architecture (BIDI Mode with LongRunningFunctionTool 🟡)

```
┌─────────────────────────────────────────────────────────────────┐
│ Phase 1: Tool Invocation                                        │
└─────────────────────────────────────────────────────────────────┘
User Request: "花子に50ドル送金"
   ↓
LLM: process_payment_approval(amount=50, recipient="花子")
   ↓
LongRunningFunctionTool executes:
   return {
       'status': 'pending',
       'approval_id': 'approval-123',
       'amount': 50,
       'recipient': '花子',
       'currency': 'USD'
   }
   ↓
🔴 AGENT RUN PAUSES (returns FunctionResponse to client)

┌─────────────────────────────────────────────────────────────────┐
│ Phase 2: Frontend Approval (WebSocket connection still open)   │
└─────────────────────────────────────────────────────────────────┘
Backend sends tool-output event with status='pending'
   ↓
Frontend detects {'status': 'pending'} → Shows approval UI
   ↓
User reviews: "花子に50ドル送金しますか？"
   ↓
User clicks Approve

┌─────────────────────────────────────────────────────────────────┐
│ Phase 3: Agent Resume                                           │
└─────────────────────────────────────────────────────────────────┘
Frontend sends approval via WebSocket:
   {
       type: 'function_response',
       approval_id: 'approval-123',
       response: {'status': 'approved'}
   }
   ↓
Backend receives function_response
   ↓
🟢 AGENT RESUMES with updated FunctionResponse
   ↓
LLM processes approved response
   ↓
LLM: "承認されました。では実行します。"
   ↓
LLM calls actual process_payment(amount=50, recipient="花子")
   ↓
Tool executes → Success
   ↓
LLM generates final response: "花子さんに50ドル送金しました。"
```

---

## 🔍 Deep Analysis: Key Differences

### 1. Tool Design Pattern

**Current (require_confirmation=True):**

- Single tool: `process_payment`
- ADK intercepts and auto-generates `adk_request_confirmation`
- Works: SSE mode ✅
- Broken: BIDI mode ❌

**Proposed (LongRunningFunctionTool):**

- Wrapper tool: `process_payment_approval` (LongRunningFunctionTool)
- Actual tool: `process_payment` (regular FunctionTool)
- Explicit pause/resume cycle
- Should work: BIDI mode 🟡 (needs verification)

### 2. Agent Run Lifecycle

**Current:**

```python
# Single continuous generator
async for event in runner.run_async(session_id=session_id):
    yield event  # Never pauses
```

**Proposed:**

```python
# Phase 1: Run until pending
async for event in runner.run_async(session_id=session_id):
    if event.type == 'function_call' and 'status': 'pending' in response:
        # Agent automatically pauses here
        break  # Exit generator, connection stays open

# [User approval happens]

# Phase 2: Resume with function_response
async for event in runner.run_async(
    session_id=session_id,
    new_message=Content(parts=[Part(function_response=approval_response)])
):
    yield event  # Continues from pause point
```

### 3. Frontend Protocol

**Current (AI SDK sendAutomaticallyWhen):**

- Waits for stream completion (`[DONE]`)
- Checks `status !== "streaming"`
- Auto-sends tool output
- **Problem:** Stream never closes due to ADK continuous events

**Proposed (Explicit Resume Message):**

- Detects `status: 'pending'` in tool output
- Shows approval UI
- User action → Send explicit WebSocket message:

  ```json
  {
    "type": "resume_agent",
    "function_response": {
      "id": "approval-123",
      "name": "process_payment_approval",
      "response": {"status": "approved"}
    }
  }
  ```

- Backend routes to `runner.run_async()` with `new_message`

---

## 📐 Implementation Phases

### Phase 1: Backend - LongRunningFunctionTool Wrapper

**File:** `adk_ag_tools.py`

```python
def _process_payment_approval_impl(
    amount: float,
    recipient: str,
    currency: str = "USD",
    description: str | None = None
) -> dict[str, Any]:
    """
    Long-running approval wrapper for process_payment.

    This function does NOT execute the payment - it only returns
    a pending status that requires user approval.

    Returns:
        dict: Approval request with status='pending'
    """
    approval_id = f"approval-{uuid.uuid4().hex[:8]}"

    return {
        'status': 'pending',
        'approval_id': approval_id,
        'amount': amount,
        'recipient': recipient,
        'currency': currency,
        'description': description,
        'message': f'{recipient}に{amount}{currency}送金します。承認してください。'
    }

# Wrap with LongRunningFunctionTool
from google.adk.tools.function_tool import LongRunningFunctionTool

process_payment_approval = LongRunningFunctionTool(
    func=_process_payment_approval_impl
)
```

**Changes to adk_ag_runner.py:**

```python
# BIDI Agent configuration
bidi_agent = Agent(
    name="adk_assistant_agent_bidi",
    model=bidi_model,
    tools=[
        get_weather,
        process_payment_approval,  # LongRunningFunctionTool wrapper
        process_payment,  # Actual payment tool (called after approval)
        change_bgm,
        get_location,
    ],
)
```

**Instruction Update:**

```python
AGENT_INSTRUCTION_BIDI = (
    "... (existing instructions) ...\n\n"
    "PAYMENT APPROVAL WORKFLOW (BIDI mode only):\n"
    "1. When user requests payment, call process_payment_approval() first\n"
    "2. This returns status='pending' and pauses execution\n"
    "3. After user approves, you will receive updated response with status='approved'\n"
    "4. Then call process_payment() to execute the actual transaction\n"
    "5. Inform user of completion\n\n"
    "Example:\n"
    "User: '花子に50ドル送金して'\n"
    "Step 1: Call process_payment_approval(amount=50, recipient='花子', currency='USD')\n"
    "Step 2: Wait for approval (agent pauses automatically)\n"
    "Step 3: After approval, call process_payment(amount=50, recipient='花子', currency='USD')\n"
    "Step 4: Respond '花子さんに50ドル送金しました。'\n"
)
```

### Phase 2: Backend - WebSocket Resume Handler

**File:** `server.py` (WebSocket endpoint)

```python
@app.websocket("/bidi")
async def bidi_websocket(websocket: WebSocket):
    await websocket.accept()

    # ... (existing session initialization) ...

    # NEW: Track pending approvals
    pending_approvals: dict[str, dict[str, Any]] = {}

    async def handle_client_message(data: dict[str, Any]):
        msg_type = data.get("type")

        if msg_type == "resume_agent":
            # Handle function_response for LongRunningFunctionTool
            function_response = data.get("function_response")
            approval_id = function_response.get("id")

            if approval_id not in pending_approvals:
                logger.error(f"Unknown approval_id: {approval_id}")
                return

            # Construct FunctionResponse for ADK
            from google.adk.types import Content, Part, FunctionResponse as ADKFunctionResponse

            original_call = pending_approvals[approval_id]
            updated_response = ADKFunctionResponse(
                id=original_call['id'],
                name=original_call['name'],
                response=function_response.get('response', {})
            )

            # Resume agent with updated function_response
            async for event in bidi_agent_runner.run_async(
                session_id=session.id,
                user_id=USER_ID,
                new_message=Content(
                    parts=[Part(function_response=updated_response)],
                    role='user'
                )
            ):
                # Convert and send ADK events to frontend
                sse_event = await convert_adk_event_to_ai_sdk(event)
                await websocket.send_text(sse_event)

            # Clean up
            del pending_approvals[approval_id]

        elif msg_type == "user_message":
            # ... (existing user message handling) ...

            async for event in bidi_agent_runner.run_async(...):
                # Check if LongRunningFunctionTool returned pending status
                if (event.type == 'function_call' and
                    'response' in event.data and
                    event.data['response'].get('status') == 'pending'):

                    # Store for later resume
                    approval_id = event.data['response']['approval_id']
                    pending_approvals[approval_id] = {
                        'id': event.data['id'],
                        'name': event.data['name'],
                        'response': event.data['response']
                    }

                sse_event = await convert_adk_event_to_ai_sdk(event)
                await websocket.send_text(sse_event)
```

### Phase 3: Frontend - Approval UI for Pending Status

**File:** `components/tool-invocation.tsx`

```typescript
// Detect pending approval from LongRunningFunctionTool
const isPendingApproval =
  toolInvocation.state === 'output-available' &&
  toolInvocation.output?.status === 'pending';

if (isPendingApproval) {
  const approvalData = toolInvocation.output;

  return (
    <div className="approval-ui">
      <div className="approval-message">
        {approvalData.message ||
         `${approvalData.recipient}に${approvalData.amount}${approvalData.currency}送金します。`}
      </div>
      <div className="approval-buttons">
        <button onClick={() => handleApprove(approvalData.approval_id)}>
          承認
        </button>
        <button onClick={() => handleDeny(approvalData.approval_id)}>
          拒否
        </button>
      </div>
    </div>
  );
}

function handleApprove(approvalId: string) {
  // Send resume message via WebSocket
  websocket.send(JSON.stringify({
    type: 'resume_agent',
    function_response: {
      id: approvalId,
      response: { status: 'approved' }
    }
  }));
}

function handleDeny(approvalId: string) {
  websocket.send(JSON.stringify({
    type: 'resume_agent',
    function_response: {
      id: approvalId,
      response: { status: 'denied' }
    }
  }));
}
```

### Phase 4: Testing Strategy

**Test 1: Basic Approval Flow**

```python
# e2e/bidi-longrunning-approval.spec.ts
test("BIDI: Approve payment with LongRunningFunctionTool", async ({ page }) => {
  await page.goto("http://localhost:3000");
  await selectBackendMode(page, "ADK BIDI");

  // Request payment
  await sendTextMessage(page, "花子さんに50ドル送金してください");

  // Wait for pending status approval UI
  await expect(page.getByText(/承認してください/)).toBeVisible({ timeout: 30000 });

  // Approve
  await page.getByRole("button", { name: "承認" }).click();

  // Wait for completion message
  await expect(page.getByText(/送金しました/)).toBeVisible({ timeout: 30000 });
});
```

**Test 2: Denial Flow**

```python
test("BIDI: Deny payment with LongRunningFunctionTool", async ({ page }) => {
  // ... similar setup ...

  // Deny
  await page.getByRole("button", { name: "拒否" }).click();

  // Wait for denial message
  await expect(page.getByText(/拒否|キャンセル/)).toBeVisible({ timeout: 30000 });
});
```

---

## ⚠️ Critical Risks and Mitigations

### Risk 1: Live API Resume Support Unknown

**Risk:** ADK's Live API (`_call_live()`) might not support pause/resume with LongRunningFunctionTool.

**Evidence:**

- Documentation doesn't explicitly mention Live API compatibility
- Issue #1851 mentions session service limitations
- No examples found for BIDI + LongRunningFunctionTool

**Mitigation:**

1. Create minimal proof-of-concept test first
2. Test with simple LongRunningFunctionTool (not payment)
3. Verify WebSocket connection stays open during pause
4. Check ADK internal events for pause/resume signals

**Fallback:** If Live API doesn't support it, document as architectural limitation and stick with Option B (SSE-only support).

### Risk 2: WebSocket Connection Timeout

**Risk:** WebSocket might close during pause (30+ seconds for approval).

**Mitigation:**

- Implement keep-alive ping/pong
- Configure WebSocket timeout to 5 minutes
- Add connection status monitoring on frontend

### Risk 3: Duplicate Tool Execution

**Risk:** ADK documentation warns "Tools run at least once and may execute multiple times when resuming."

**Mitigation:**

- Implement idempotency key in actual `process_payment`
- Track executed approval_ids to prevent duplicates
- Add transaction-level deduplication

### Risk 4: Agent Instruction Complexity

**Risk:** LLM might not follow the multi-step approval workflow correctly.

**Mitigation:**

- Extensive instruction tuning with examples
- Add chain-of-thought prompting: "Think step by step"
- Consider using SequentialAgent if single agent struggles

### Risk 5: Frontend State Management

**Risk:** React state might not properly handle pause/resume cycle.

**Mitigation:**

- Use AI SDK's built-in message state
- Add explicit "pending" state to message parts
- Implement state machine for approval UI

---

## 📊 Success Criteria

### Must Have (MVP)

- ✅ BIDI approval UI displays for pending payments
- ✅ User can approve/deny via WebSocket
- ✅ Agent resumes after approval decision
- ✅ Actual payment executes only after approval
- ✅ LLM generates appropriate response after completion

### Should Have

- ✅ Idempotent payment execution
- ✅ Timeout handling for abandoned approvals
- ✅ Proper error messages for denied payments
- ✅ WebSocket reconnection during pause

### Nice to Have

- ✅ Progress indication during pause
- ✅ Approval history tracking
- ✅ Multiple simultaneous approvals
- ✅ Approval timeout with auto-denial

---

## 🚀 Implementation Order

1. **Proof of Concept** (1-2 hours)
   - Create simple LongRunningFunctionTool test
   - Verify pause/resume works in BIDI Live API
   - **GO/NO-GO Decision Point**

2. **Backend Implementation** (2-3 hours)
   - Implement `process_payment_approval` wrapper
   - Add WebSocket resume handler
   - Update agent instructions

3. **Frontend Implementation** (2-3 hours)
   - Add pending status detection
   - Implement approval UI
   - Add WebSocket resume message

4. **Testing** (2-3 hours)
   - E2E approval flow tests
   - Denial flow tests
   - Timeout and error cases

5. **Documentation** (1 hour)
   - Update architecture docs
   - Add developer guide
   - Document known limitations

**Total Estimate:** 8-12 hours of focused development

---

## 📝 Open Questions

1. **Q:** Does ADK's Live API actually support LongRunningFunctionTool pause/resume?
   **A:** UNKNOWN - needs POC

2. **Q:** Will WebSocket connection stay open during agent pause?
   **A:** LIKELY - but needs verification

3. **Q:** How does ADK signal "agent paused" in Live API events?
   **A:** UNKNOWN - need to inspect event stream

4. **Q:** Can we reuse existing approval UI from SSE mode?
   **A:** PARTIALLY - need to adapt for status='pending' detection

5. **Q:** What happens if user closes browser during approval?
   **A:** UNDEFINED - need timeout and cleanup logic

---

## 🎓 Key Learnings from Investigation

1. **ADK Native Confirmation (`require_confirmation=True`) is SSE-only**
   - Live API has explicit TODO for this feature
   - No ETA for Live API support

2. **LongRunningFunctionTool is the Recommended Pattern**
   - Explicit pause/resume control
   - Better for complex approval workflows
   - More flexibility than native confirmation

3. **Current Approach Was Doomed from Start**
   - `inject_confirmation_for_bidi()` fought against ADK's event stream model
   - `sendAutomaticallyWhen` assumes stream completion (never happens in BIDI)
   - Trying to force SSE patterns into BIDI architecture

4. **LongRunningFunctionTool Might Also Not Work**
   - Session service limitation suggests architectural constraints
   - Live API might have same limitations as session service
   - POC is critical before committing to this approach

---

## 🔗 References

- [ADK LongRunningFunctionTool Docs](https://google.github.io/adk-docs/tools-custom/function-tools/)
- [ADK Resume Agents Docs](https://google.github.io/adk-docs/runtime/resume/)
- [GitHub Issue #1851](https://github.com/google/adk-python/issues/1851)
- [Session 5 Investigation](agents/handsoff.md)
- [SSE vs BIDI Confirmation Protocol](../docs/adr/0003-sse-vs-bidi-confirmation-protocol.md)

---

## ✅ Next Steps

1. **Create POC** - Test LongRunningFunctionTool with BIDI Live API
2. **Verify pause/resume** - Inspect ADK events during pause
3. **GO/NO-GO Decision** - Based on POC results
4. **If GO:** Follow implementation phases above
5. **If NO-GO:** Document limitation, accept Option B (SSE-only)
