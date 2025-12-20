# POC Phase 1 Results: LongRunningFunctionTool + BIDI Live API

**Date**: 2025-12-18
**Status**: 🟢 Test Passed, ⚠️ Behavior Not as Expected

## Test Execution

**Test**: `e2e/poc-longrunning-bidi.spec.ts::Phase 1`
**Result**: ✅ PASSED (4.0s)
**Log**: `/tmp/poc-phase1-success.log`

## What We Tested

Created minimal POC tool (`approval_test_tool`) that immediately returns:

```python
{
    "status": "pending",
    "approval_id": "poc-approval-xxxxx",
    "amount": amount,
    "recipient": recipient,
    "message": f"Approval required for ${amount} payment to {recipient}",
}
```

## Results

### ✅ What Worked

1. **Tool Execution**: Tool called successfully in BIDI mode
2. **Return Value**: Tool returned `{status: 'pending', ...}` as expected
3. **Frontend Display**: UI properly showed:
   - Tool name: `approval_test_tool (dynamic-tool)`
   - Status: `Completed`
   - INPUT section with arguments
   - RESULT section with pending status and approval_id
4. **No Errors**: No crashes, timeouts, or exceptions

### ❌ What Didn't Work

1. **ADK Recognition**: `'long_running_tool_ids': set()` - **ADK did NOT recognize tool as long-running**
2. **Agent Behavior**: Agent treated tool as completed, NOT paused
3. **Tool Status**: UI shows "Completed", not "Pending"
4. **No Pause State**: No evidence of agent pausing or waiting for resume

## Critical Discovery

**Simply returning `{status: 'pending'}` from a normal Python function is NOT sufficient to trigger ADK's LongRunningFunctionTool behavior.**

### Evidence from Logs

```python
'long_running_tool_ids': set(),  # EMPTY - Not recognized as long-running
```

```
[BIDI-SEND] Sending event type: tool-output-available
[BIDI] Client disconnected  # Agent completed turn
```

The tool output was treated as a regular `function_response`, not a special long-running state.

## Analysis

### Why It Didn't Work

ADK's `LongRunningFunctionTool` is likely:

- A specific class/decorator (not just a return value convention)
- Requires special registration or metadata
- May need ADK-specific APIs to signal pause/resume

Simply returning Python dict with `status: 'pending'` creates:

- ✅ Valid tool output data
- ❌ NOT a LongRunningFunctionTool behavior

### What We Learned

1. **Tool Mechanism Works**: BIDI can execute tools and receive outputs
2. **Pending Status is Data**: The `{status: 'pending'}` is just output data, not a control signal
3. **Need ADK API**: Must use proper LongRunningFunctionTool class/pattern from ADK

## Next Steps

### Option 1: Find Real LongRunningFunctionTool API

- Search ADK codebase for `LongRunningFunctionTool` class
- Check if there's a decorator like `@LongRunningFunctionTool`
- Review ADK documentation for proper pause/resume pattern

### Option 2: Test Backend Blocking Pattern

- If LongRunningFunctionTool doesn't exist for Live API
- Test PR #3224 backend blocking poll approach
- This doesn't require agent pause

### Option 3: Accept SSE-Only Limitation

- LongRunningFunctionTool may only work in generateContent (SSE)
- Not supported in Live API due to streaming nature
- Document limitation and recommend SSE mode for confirmations

## Conclusion

**POC Phase 1 Verdict**: ⚠️ INCONCLUSIVE

- ✅ Technical execution works
- ❌ LongRunningFunctionTool pattern not triggered
- 🔍 Need to investigate proper ADK API usage

**Confidence in Option A (LongRunningFunctionTool)**: 📉 **Decreased from 60% to 30%**

The fact that `long_running_tool_ids` stayed empty suggests:

- Either: We're using the wrong API
- Or: LongRunningFunctionTool doesn't work with Live API

**Recommended Next Action**: Search ADK source code for proper LongRunningFunctionTool usage before continuing POC Phase 2.
