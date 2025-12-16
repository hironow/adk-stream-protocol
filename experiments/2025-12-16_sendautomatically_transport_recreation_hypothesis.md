# Experiment: sendAutomaticallyWhen Transport Recreation Hypothesis

**Date**: 2025-12-16
**Status**: 🟡 In Progress
**Objective**: Test if transport recreation was the root cause of sendAutomaticallyWhen bugs

## Background

### Previous Understanding
- We believed AI SDK v6 beta's `sendAutomaticallyWhen` was buggy
- Workaround: Manual send with 100ms delay after tool approval
- Reference: `experiments/2025-12-16_manual_send_tool_approval_design.md`

### New Hypothesis
- Transport recreation issue discovered: `buildUseChatOptions` was called on every render
- This caused continuous WebSocket transport creation in ADK BIDI mode
- **Hypothesis**: Frequent transport recreation broke `sendAutomaticallyWhen` behavior
- **If true**: AI SDK v6 is not buggy; the issue was in our implementation

## Experiment Design

### Phase 1: Current State Verification ✅
- [x] Fixed transport recreation with useMemo (commit f8b6713)
- [x] Verified WebSocket transport is only created when mode changes
- [x] Console logs show only 2 transport creations (React Strict Mode)

### Phase 2: Restore sendAutomaticallyWhen
- [ ] Remove manual send implementation
- [ ] Restore `sendAutomaticallyWhen` with proper conditions
- [ ] Test in all modes (Gemini, ADK SSE, ADK BIDI)

### Phase 3: Verification
- [ ] Test tool approval flow in each mode
- [ ] Verify automatic send after approval
- [ ] Check for any race conditions or timing issues
- [ ] Confirm no duplicate messages or missing responses

## Implementation Plan

### Files to Modify
1. `lib/build-use-chat-options.ts`
   - Restore `sendAutomaticallyWhen` configuration
   - Remove comments about v6 beta bug

2. `components/chat.tsx`
   - Remove manual `sendMessage({ text: "" })` calls
   - Remove 100ms setTimeout workaround

3. `components/message.tsx`
   - Remove manual send trigger after tool approval

## Expected Results

### If Hypothesis is Correct
- ✅ `sendAutomaticallyWhen` works properly with fixed transport
- ✅ Tool approval flow completes without manual send
- ✅ No duplicate messages or missing responses
- ✅ AI SDK v6 beta is not buggy

### If Hypothesis is Incorrect
- ❌ `sendAutomaticallyWhen` still doesn't work
- ❌ Need to keep manual send workaround
- ❌ Report bug to AI SDK v6 team

## Results

### Test 1: Gemini Mode
- Status: ⏳ Pending
- Result:

### Test 2: ADK SSE Mode
- Status: ⏳ Pending
- Result:

### Test 3: ADK BIDI Mode
- Status: ⏳ Pending
- Result:

## Conclusion

Status: ⏳ Pending

### Decision
- [ ] Keep sendAutomaticallyWhen (if working)
- [ ] Revert to manual send (if not working)

### Documentation Updates Needed
- [ ] Update code comments
- [ ] Update experiments README
- [ ] Update handsoff.md if needed
