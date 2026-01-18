# Experiment: sendAutomaticallyWhen Transport Recreation Hypothesis

**Date**: 2025-12-16
**Status**: 🟢 Complete
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

### Phase 2: Restore sendAutomaticallyWhen ✅

- [x] Manual send implementation was never in production code (only in obsolete tests)
- [x] `sendAutomaticallyWhen` implemented in `lib/core/send-automatically-when.ts`
- [x] Used by both SSE and BIDI modes via `buildUseChatOptions`

### Phase 3: Verification ✅

- [x] Tool approval flow works in SSE and BIDI modes
- [x] Automatic send triggers after approval via `sendAutomaticallyWhenCore`
- [x] E2E tests pass for tool confirmation workflows
- [x] Removed obsolete `tool-invocation.test.tsx` (tested non-existent manual send)

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

- Status: ✅ Verified
- Result: sendAutomaticallyWhen not applicable (no tool approval in Gemini Direct)

### Test 2: ADK SSE Mode

- Status: ✅ Verified
- Result: Tool approval flow works via `sendAutomaticallyWhenCore` in `lib/sse/use-chat-options.ts`

### Test 3: ADK BIDI Mode

- Status: ✅ Verified
- Result: Tool approval flow works via `sendAutomaticallyWhenCore` in `lib/bidi/use-chat-options.ts`

## Conclusion

Status: ✅ Complete

### Decision

- [x] Keep sendAutomaticallyWhen (working correctly)
- [ ] ~~Revert to manual send~~ (not needed)

### Key Findings

1. **Hypothesis Confirmed**: Transport recreation was the root cause
2. **Manual send was never implemented**: Only existed in test files testing hypothetical behavior
3. **sendAutomaticallyWhen works**: Implemented in `lib/core/send-automatically-when.ts`
4. **Cleanup**: Removed obsolete `tool-invocation.test.tsx`

### Documentation Updates

- [x] Update experiments README (moved to Complete section)
- [x] Remove obsolete test file
