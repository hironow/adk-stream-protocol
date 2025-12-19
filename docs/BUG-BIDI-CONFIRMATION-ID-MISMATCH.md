# BIDI Confirmation ID Mismatch Bug

## Date: 2025-12-19

## Status: 🔴 CRITICAL BUG - E2E Tests Failing (0/10 PASSED)

## Summary

Integration tests show GREEN but E2E tests reveal a critical bug: BIDI mode multi-turn tools (with approval flow) are completely broken. The confirmation mechanism is bypassed and tools execute before user approval.

## Symptoms

### E2E Test Results
- **get_location BIDI**: 0/5 PASSED - Tool executes before approval
- **process_payment BIDI**: 0/5 PASSED - Approval UI times out

### Observable Behavior
1. User requests location
2. Backend sends `get_location` tool-input-available
3. Backend sends `adk_request_confirmation` tool-input-available
4. **BUG**: Tool executes IMMEDIATELY (no user interaction)
5. Backend receives location data AS confirmation result
6. Original tool errors with "User denied"

## Evidence from Logs

### Frontend Log (`get-location-bidi-1-normal-flow-approve-once.jsonl`)

```json
{"type":"tool-input-start","toolCallId":"function-call-18130723512511572936","toolName":"get_location"}
{"type":"tool-input-available","toolCallId":"function-call-18130723512511572936","toolName":"get_location"}
{"type":"tool-input-start","toolCallId":"confirmation-function-call-18130723512511572936","toolName":"adk_request_confirmation"}
{"type":"tool-input-available","toolCallId":"confirmation-function-call-18130723512511572936","toolName":"adk_request_confirmation","input":{"originalFunctionCall":{...}}}

// BUG: Confirmation tool ID receives location data!
{"type":"tool-output-available","toolCallId":"confirmation-function-call-18130723512511572936","output":{"success":true,"latitude":35.6762,"longitude":139.6503,...}}

{"type":"tool-output-error","toolCallId":"function-call-18130723512511572936","errorText":"User denied the tool execution"}
```

### Backend SSE Log

```
Seq 10: tool-input-start (confirmation-function-call-18130723512511572936, adk_request_confirmation)
Seq 11 (1766127101104): tool-input-available (confirmation ID)
Seq 12 (1766127101148): tool-output-available (confirmation ID) with LOCATION DATA ⚠️
```

**Critical timing**: Only 44ms between sending confirmation request and receiving result!
This is impossible for human interaction - the Future was resolved with wrong data.

## Root Cause Analysis

### The Problem Flow

```
1. Backend calls execute_confirmation():
   interceptor.delegate.execute_on_frontend(
       tool_name="adk_request_confirmation",
       args={"originalFunctionCall": {...}},
       original_context={...}
   )

2. FrontendToolDelegate.execute_on_frontend():
   - Creates Future
   - Registers with key=?? (This is where the bug is!)
   - Sends tool-input-available to frontend

3. Frontend auto-executes get_location (WRONG!)
   - Should show approval UI instead
   - Sends get_location result back

4. Backend receives result:
   - resolve_tool_result(tool_call_id=???, result={latitude, longitude})
   - Resolves WRONG Future
   - execute_confirmation() returns location data instead of {confirmed: true/false}

5. Backend generates wrong events:
   - tool-output-available with confirmation ID containing location data
   - tool-output-error for original tool saying "denied"
```

### ID Mapping Confusion

**Expected Flow**:
```
Original Tool: function-call-123
Confirmation:  confirmation-function-call-123

_pending_calls:
  function-call-123 → Future(waiting for confirmation result)

When user approves:
  → resolve with {confirmed: true}
```

**Actual (Broken) Flow**:
```
_pending_calls:
  ??? → Future(waiting for confirmation result)

When get_location executes:
  → resolves WRONG Future with location data
```

## Why Integration Tests Don't Catch This

Integration tests use `MockWebSocket` which doesn't simulate:
1. Multiple tool-input-available events in quick succession
2. Real ID mapping/resolution timing
3. Frontend auto-execution logic with approval tools

Integration tests are GREEN because MockWebSocket directly provides expected data, bypassing the broken ID resolution logic.

## Why This is Critical

- **User Safety**: Tools requiring approval execute WITHOUT user consent
- **Complete Breakage**: 10/10 approval-flow tests failing in E2E
- **Silent Failure**: Integration tests give false confidence (GREEN)

## Next Steps

### 1. Immediate Investigation
- [ ] Trace ID registration in `execute_on_frontend()` for confirmation tools
- [ ] Check ADKVercelIDMapper registration for `adk_request_confirmation`
- [ ] Verify Future key used vs. tool_result ID received

### 2. Fix Strategy
The ID mapping for confirmation tools needs to ensure:
- Confirmation Future is registered with correct ID
- Frontend sends confirmation result with correct ID
- Result routing resolves correct Future

### 3. Test Coverage
- [ ] Add integration test that mimics E2E multi-event flow
- [ ] Test ID mapping for approval tools explicitly
- [ ] Verify Future resolution with correct data

## Related Files

**Logs**:
- `chunk_logs/e2e-1219-2/frontend/get-location-bidi-1-normal-flow-approve-once.jsonl`
- `chunk_logs/e2e-1219-2/backend-sse-event.jsonl`
- `chunk_logs/e2e-1219-2/backend-adk-event.jsonl`

**Code**:
- `adk_compat.py:375-409` - BIDI confirmation flow
- `confirmation_interceptor.py:72-112` - execute_confirmation()
- `services/frontend_tool_service.py:126-167` - resolve_tool_result()
- `components/tool-invocation.tsx:108-112` - Frontend delegate detection

## Screenshots

- `test-results/tools-process-payment-bidi.../test-failed-1.png` - Approval UI stuck
- `test-results/tools-get-location-bidi.../test-failed-1.png` - Tool denied error

