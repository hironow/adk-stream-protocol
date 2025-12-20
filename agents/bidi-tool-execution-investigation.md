# BIDI Tool Execution Investigation

**Status**: 🟡 In Progress - Protocol Mismatch Identified
**Date**: 2025-12-20

## Problem Statement

E2E tests failing with BIDI confirmation timeout after SSE confirmation flow was fixed.

## Investigation Timeline

### Phase 1: `this` Binding Issue (SOLVED ✅)
- **Symptom**: "Frontend never responded after 5 seconds" timeout
- **Root Cause**: Method reference `websocketTransport.sendToolResult` loses `this` context
- **Solution**: Created `createConfirmationTransport` helper with arrow functions
- **Result**: Timeout fixed, confirmation sent successfully

### Phase 2: Protocol Mismatch (CURRENT 🔴)
- **Symptom**: AI responds "waiting for approval" instead of "transfer completed"
- **Root Cause**: Wrong approval protocol being used

#### Baseline vs Current Implementation

**Baseline (Working)**:
```json
// Sends approval as NEW user message via AI SDK v6
{"type":"message", "data":{"messages":[{
  "role":"user",
  "content":[{
    "type":"tool-result",
    "toolCallId":"function-call-1086064592897085322",  // Original tool ID
    "toolName":"process_payment",                       // Original tool name
    "result":{"approved":true, "user_message":"..."}
  }]
}]}}
```

**Current (Broken)**:
```typescript
// Sends via WebSocket sendToolResult
transport.websocket.sendToolResult(
  "confirmation-function-call-...",  // Confirmation tool ID ❌
  { confirmed: true }                 // Wrong format ❌
)
```

#### Key Differences

| Aspect | Baseline | Current |
|--------|----------|---------|
| Transport | User message | WebSocket event |
| Tool ID | Original tool | Confirmation tool |
| Tool Name | `process_payment` | N/A |
| Result Format | `{approved: true}` | `{confirmed: true}` |

## Next Steps

1. **Revert to AI SDK v6 standard flow**:
   - Use `addToolApprovalResponse` (if available in BIDI)
   - Or send user message manually via WebSocket

2. **Update `lib/confirmation-handler.ts`**:
   - Change to send user message instead of tool_result event
   - Use original tool ID, not confirmation tool ID

3. **Verify with baseline chunk logs**:
   - Ensure outgoing events match e2e-baseline logs

## Files Modified (This Session)

- `lib/confirmation-handler.ts` - NEW (needs protocol fix)
- `lib/confirmation-handler.test.ts` - NEW (tests pass but wrong protocol)
- `components/tool-invocation.tsx` - Updated to use helper (needs protocol fix)

## Critical Learning

⚠️ **The confirmation flow must send a user message with tool-result for the ORIGINAL tool, not the confirmation tool.**

This matches how AI SDK v6's `addToolApprovalResponse` works - it creates a user message with the approval result for the tool being approved.
