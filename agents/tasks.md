# Agent Tasks

Current active task tracking for the ADK AI Data Protocol project.

## 📊 Current Test Status (2025-12-20 Session 11)

### Unit Tests
- ✅ **All passing** (including new `lib/confirmation-handler.test.ts`)
- Frontend confirmation handler tests: 9/9 ✅

### Integration Tests
- ✅ **All passing**
- SSE confirmation wait tests: All GREEN ✅

### E2E Tests
- ✅ **SSE Mode**: All confirmation tests passing
- 🔴 **BIDI Mode**: Protocol mismatch discovered

---

## 🔴 Active Task: BIDI Confirmation Protocol Fix

**Status**: 🟡 **Protocol Mismatch Identified** - Need to change approval mechanism
**Priority**: CRITICAL
**Branch**: `hironow/fix-confirm`

### Problem

BIDI confirmation flow uses wrong protocol for sending approval to backend.

**Current Behavior**:
- ✅ `this` binding fixed - No more timeout errors
- ✅ Confirmation sent successfully
- ✅ Tool executes and returns result
- ❌ AI responds with wrong text ("waiting for approval" instead of "transfer completed")

### Root Cause: Protocol Mismatch

**Baseline (Working)**:
```json
// Approval sent as NEW user message
{"type":"message", "data":{"messages":[{
  "role":"user",
  "content":[{
    "type":"tool-result",
    "toolCallId":"function-call-1086064592897085322",  // Original tool
    "toolName":"process_payment",
    "result":{"approved":true, "user_message":"..."}
  }]
}]}}
```

**Current Implementation (Broken)**:
```typescript
// Approval sent via WebSocket tool_result event
transport.websocket.sendToolResult(
  "confirmation-function-call-...",  // ❌ Confirmation tool ID
  { confirmed: true }                 // ❌ Wrong format
)
```

### Analysis

From baseline chunk logs (`chunk_logs/e2e-baseline/frontend/`):
- Baseline sends **8 outgoing events** (including approval message)
- Current implementation sends **0 outgoing events** (approval not logged)
- Baseline uses **AI SDK v6's message flow** (addToolApprovalResponse pattern)
- Current uses **custom WebSocket event** (incompatible with AI)

### Next Steps

**Option 1: Use AI SDK v6 Standard Flow**
- Check if `addToolApprovalResponse` works in BIDI mode
- If yes, use it directly (like SSE mode)
- If no, proceed to Option 2

**Option 2: Send User Message Manually**
- Create user message with tool-result content
- Send via WebSocket using message event
- Match baseline format exactly

**Files to Modify**:
- `lib/confirmation-handler.ts` - Change from sendToolResult to user message
- `lib/confirmation-handler.test.ts` - Update tests for new protocol
- `components/tool-invocation.tsx` - May need access to original tool info

---

## ✅ Completed (Session 11)

### SSE Confirmation Flow Fix
- **Fixed**: Premature `[DONE]` marker issue
- **Solution**: Pass-through to ADK native handling (two HTTP requests)
- **Result**: All SSE tests passing (6/6 for process_payment, 5/6 for get_location)

### BIDI `this` Binding Fix
- **Problem**: Method reference loses context
- **Solution**: `createConfirmationTransport` helper with arrow functions
- **Result**: No more timeout errors, confirmation sent successfully

### Frontend Confirmation Handler
- **Created**: `lib/confirmation-handler.ts` (testable business logic)
- **Created**: `lib/confirmation-handler.test.ts` (9 tests, all passing)
- **Updated**: `components/tool-invocation.tsx` (uses new handler)
- **Status**: ⚠️ Needs protocol fix (user message instead of tool_result event)

---

## 📁 Key Files (Session 11)

**Created**:
- `lib/confirmation-handler.ts` - Confirmation handling logic (needs protocol fix)
- `lib/confirmation-handler.test.ts` - Unit tests (9 tests)
- `agents/bidi-tool-execution-investigation.md` - Investigation notes

**Modified**:
- `components/tool-invocation.tsx` - Uses confirmation handler
- `services/sse_event_streamer.py` - Simplified to pass-through

**Referenced**:
- `chunk_logs/e2e-baseline/frontend/process-payment-bidi-1-normal-flow-approve-once.jsonl` - Baseline protocol
- `chunk_logs/scenario-11/frontend/process-payment-bidi-1-normal-flow-approve-once.jsonl` - Current test logs

---

## 📝 Architecture Decisions

### SSE vs BIDI Confirmation Patterns

**SSE Mode**:
- ADK natively handles confirmation (two separate HTTP requests)
- First request: Display confirmation UI, stream ends
- Second request: User approval → tool execution → AI response
- Frontend: Use `addToolOutput` with ADK-compatible format

**BIDI Mode** (To Be Fixed):
- Single WebSocket connection (no HTTP requests)
- Need to send user message with tool-result
- Must use original tool ID, not confirmation tool ID
- Must match AI SDK v6 message format

### Lesson Learned

⚠️ **Don't create custom protocols when standard ones exist**

The confirmation handler should use AI SDK v6's standard message format, not custom WebSocket events. This ensures compatibility with the AI model's expectations.
