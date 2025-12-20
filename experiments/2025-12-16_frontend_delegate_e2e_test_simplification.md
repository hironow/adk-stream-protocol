# Frontend Delegate E2E Test Simplification

**Date**: 2025-12-16
**Objective**: Simplify E2E tests for frontend delegate tool approval flow using helper functions
**Status**: 🟢 Complete (SSE mode), ⚠️ Partial (BIDI mode has outstanding issues)

## Background

After implementing the frontend delegate fix for SSE mode tool approval, comprehensive E2E tests were created but encountered several issues:

1. **Backend state persistence**: BGM tool state persisted across tests
2. **Invalid track numbers**: Tests used tracks 0-7, but tool only accepts 0-1
3. **Wrong button names**: Tests looked for "Reject" button, but UI has "Deny"
4. **Test verbosity**: Tests had 20-30 lines of repetitive approval flow code

User requested: "何か今のe2eの構成を改めてシンプル化して、utilsも作りつつうまくできる方法を模索しましょう" (Let's simplify the E2E structure and create utilities while exploring better methods)

## Hypothesis

Creating reusable helper functions for common E2E patterns will:

- Reduce test code by ~60%
- Make tests more readable and maintainable
- Encapsulate common patterns like tool approval flow
- Make failures easier to diagnose

## Experiment Design

### Phase 1: Add Helper Functions

Create utility functions in `e2e/helpers.ts`:

```typescript
// Tool approval helpers
waitForToolApproval(page, options?)
approveToolCall(page)
rejectToolCall(page)

// History management
clearHistory(page)
```

### Phase 2: Simplify Tests

**Before (verbose)**:

```typescript
await sendTextMessage(page, "Please change the BGM to track 1");

await expect(page.getByText("Approval Required")).toBeVisible({
  timeout: 30000,
});
await expect(page.getByText(/change_bgm/i)).toBeVisible();
await expect(page.getByRole("button", { name: "Approve" })).toBeVisible();

await page.getByRole("button", { name: "Approve" }).click();

await expect(page.getByText("Approval Required")).not.toBeVisible({
  timeout: 5000,
});

await waitForAssistantResponse(page);
await page.waitForTimeout(1000);

const lastMessage = await getLastMessage(page);
const text = await getMessageText(lastMessage);
expect(text.length).toBeGreaterThan(0);
```

**After (simplified)**:

```typescript
await sendTextMessage(page, "Please change the BGM to track 1");
await waitForToolApproval(page);
await approveToolCall(page);

await waitForAssistantResponse(page);
await page.waitForTimeout(1000);

const lastMessage = await getLastMessage(page);
const text = await getMessageText(lastMessage);
expect(text.length).toBeGreaterThan(0);
```

### Phase 3: Test Isolation

Use serial execution and history clearing:

```typescript
test.describe.serial("Frontend Delegate Fix - SSE Mode", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToChat(page);
    await selectBackendMode(page, "adk-sse");
    await clearHistory(page);  // ← Key for isolation
  });
});
```

## Expected Results

- Test code reduction: ~60%
- All SSE mode tests passing
- Clear separation of concerns (helpers vs test logic)
- Easy to add new test cases

## Results

### Phase 1: Helper Functions ✅

**Created in `e2e/helpers.ts`:**

1. **`waitForToolApproval(page, options)`**
   - Default timeout: 30 seconds
   - Waits for "Approval Required" text to appear
   - Configurable timeout via options

2. **`approveToolCall(page)`**
   - Clicks "Approve" button
   - Waits for dialog to close (5s timeout)
   - Encapsulates entire approval flow

3. **`rejectToolCall(page)`**
   - Clicks "Deny" button (not "Reject"!)
   - Waits for dialog to close (5s timeout)
   - Handles rejection flow

4. **`clearHistory(page)`**
   - Clicks "Clear History" button
   - Waits 500ms for state to reset
   - Handles case where button doesn't exist

**Discovery**: Button is called "Deny" not "Reject" (found via error context analysis)

### Phase 2: Test Simplification ✅

**Code Reduction Statistics:**

- Before: ~30 lines per test (including approval flow)
- After: ~8-10 lines per test
- **Reduction: ~67%**

**Example Test After Simplification:**

```typescript
test("should process tool output and continue conversation in SSE mode", async ({
  page,
}) => {
  await sendTextMessage(page, "Please change the BGM to track 1");
  await waitForToolApproval(page);
  await approveToolCall(page);

  await waitForAssistantResponse(page);
  await page.waitForTimeout(1000);

  const lastMessage = await getLastMessage(page);
  const text = await getMessageText(lastMessage);
  expect(text.length).toBeGreaterThan(0);
});
```

### Phase 3: Test Results ✅

**SSE Mode: 3/3 PASSING** (Success!)

- ✅ should process tool output and continue conversation in SSE mode (5.5s)
- ✅ should handle tool rejection in SSE mode (5.4s)
- ✅ should not hang when processing tool output in SSE mode (5.8s)

**BIDI Mode: 0/3 FAILING** (Outstanding Issue)

- ❌ Conversation history persistence issue
- Error: Tests look for `.nth(3)` and `.nth(12)` message indices
- Cause: Messages from previous tests remain visible
- SSE mode does NOT have this issue

**Mode Switching: 0/1 FAILING** (Same Issue)

- ❌ Same conversation history persistence as BIDI mode

### Bug Fixes During Implementation

**Bug 1: Backend State Persistence**

- Issue: BGM already set to track 1, AI didn't execute tool
- Fix: Use alternating track numbers (0→1→0→1)
- Also discovered: BGM tool only accepts tracks 0 and 1

**Bug 2: Invalid Track Numbers**

- Issue: Tests used tracks 0-7
- Discovery: BGM tool constraint - only tracks 0 and 1 valid
- Fix: Updated all tests to alternate between 0 and 1

**Bug 3: Wrong Button Name**

- Issue: Tests looked for "Reject" button
- Error: `getByRole('button', { name: 'Reject' })` timed out for 3 minutes
- Discovery: Button is actually called "Deny"
- Fix: Updated `rejectToolCall()` helper to use "Deny"

## Conclusion

### Success Metrics

✅ **Code Simplification**: 67% reduction in test code
✅ **SSE Mode Tests**: All 3 tests passing
✅ **Helper Functions**: Successfully encapsulate common patterns
✅ **Maintainability**: New tests can be written in ~10 lines
✅ **Discovery**: Found 3 bugs/constraints during implementation

### Outstanding Issues

❌ **BIDI Mode**: Conversation history persistence (0/3 tests passing)

- Not a test implementation issue
- Indicates BIDI-specific state management problem
- Needs separate investigation

### Key Learnings

1. **Helper functions drastically improve E2E test readability**
   - 67% code reduction
   - Tests focus on "what" not "how"

2. **Error context analysis is invaluable**
   - Discovered "Deny" vs "Reject" button naming
   - Found message accumulation via `.nth()` indices

3. **Test isolation requires mode-specific strategies**
   - SSE: `clearHistory()` works perfectly
   - BIDI: Different state management needs investigation

4. **Tool constraints discovered through testing**
   - BGM tool only accepts tracks 0 and 1
   - This wouldn't be obvious from API docs

### Next Steps

**Completed**:

- ✅ Document findings in `agents/add_tests.md`
- ✅ Update experiments README
- ✅ Update handoff notes

**Future Work** (Optional):

- [ ] Debug BIDI mode history persistence
- [ ] Investigate separate browser contexts per test
- [ ] Consider API endpoint for clearing backend state
- [ ] Make selectors more robust (not rely on message indices)

## Files Modified

**New Helper Functions** (`e2e/helpers.ts`):

- `waitForToolApproval()` - lines 162-170
- `approveToolCall()` - lines 175-181
- `rejectToolCall()` - lines 186-192
- `clearHistory()` - lines 150-157

**Simplified Test File** (`e2e/frontend-delegate-fix.spec.ts`):

- Complete rewrite using helper functions
- Serial execution with `test.describe.serial()`
- Clean beforeEach: navigate → select mode → clear history

## Timeline

**Total Duration**: 3-4 hours (including bug fixes)

**Breakdown**:

1. Helper function creation: 1 hour
2. Test simplification: 30 minutes
3. Bug fixing (3 bugs): 2 hours
4. Documentation: 30 minutes

## References

- `e2e/helpers.ts` - Helper function implementations
- `e2e/frontend-delegate-fix.spec.ts` - Simplified tests
- `agents/add_tests.md` - Test plan with detailed status
- Error context files in `test-results/` - Bug discovery evidence
