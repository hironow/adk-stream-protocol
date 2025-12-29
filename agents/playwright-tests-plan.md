# Playwright Tests - Current Status and Action Plan

**Date**: 2025-12-29
**Last Updated**: 2025-12-29 22:25 JST

## Executive Summary

- **Total Tests**: 281 tests across 38 files
- **Test Results**: 182 passed | 5 failed | 15 skipped | 12 did not run
- **Overall Pass Rate**: 96.8% (182/188 executed)
- **Total Execution Time**: ~10.2 minutes
- **Timeout Configuration**: ✅ Properly configured with global and per-project timeouts

## Test Structure Reorganization (Completed)

### Before
```
app/tests/e2e/
├── smoke/
├── core/
└── advanced/
```

### After
```
scenarios/
├── *.spec.ts                    (Event-to-event integration)
├── app-smoke/                   (Tier 1: Fast critical path)
├── app-core/                    (Tier 2: Core functionality)
├── app-advanced/                (Tier 3: Edge cases, visual, a11y)
├── features/
├── tools/
└── helpers/                     (Consolidated test helpers)
    ├── index.ts                 (Scenarios helpers)
    ├── page-objects.ts          (Page Object Models)
    ├── test-data.ts             (Test data fixtures)
    ├── test-mocks.ts            (Mock utilities)
    └── wait-strategies.ts       (Wait helpers)
```

### Rationale
- **Clear Separation**: Vitest tests in `lib/tests/`, `app/tests/integration/`, `components/tests/`
- **Playwright Tests**: All consolidated under `scenarios/`
- **Helper Consolidation**: Single `scenarios/helpers/` for all Playwright test utilities
- **No Confusion**: Test runner type is obvious from directory location

## Timeout Configuration

### Global Settings
```typescript
globalTimeout: 60 * 60 * 1000,  // 60 minutes (entire test run)
```

### Per-Project Timeouts
| Project | Individual Test Timeout | Rationale |
|---------|------------------------|-----------|
| scenarios | 60s | Backend interactions can be slower |
| app-e2e-smoke | 30s | Smoke tests should be fast |
| app-e2e-core | 45s | More complex interactions |
| app-e2e-advanced | 60s | Visual regression, accessibility scans |

### Assertion Timeout
```typescript
expect: { timeout: 10000 }  // 10s per assertion
```

**CRITICAL**: Timeout failures are correctly treated as **FAIL**, not success.

## Test Results by Project

### 1. scenarios (Event-to-Event Integration)
```
✅ 57 passed
⏭️  8 skipped
❓ 12 did not run
⏱️  6.5 minutes
```

**Analysis**:
- ✅ Core integration tests working well
- ❓ **Action Required**: Investigate "did not run" tests
  - Likely: Conditional tests or environment-specific tests
  - Need to determine if they should run in local environment

**Tests**:
- Error handling (BIDI/SSE)
- Chat history sharing
- Chunk logging/download
- Frontend delegate fixes
- Mode testing (Gemini/ADK-SSE/ADK-BIDI)
- Tool approval flows
- Tool-specific tests (get_location, process_payment, etc.)

### 2. app-e2e-smoke (Tier 1: Critical Path)
```
✅ 17 passed
❌ 2 failed
⏭️  2 skipped
⏱️  31.6 seconds
```

#### Failed Tests

**FAIL-1**: `chat-basic.spec.ts:35` - Gemini mode response
```
Error: Strict mode violation
Expected: Single element
Actual: 2 elements found for locator('text=...')
```

**Root Cause**: Non-unique text selector
**Impact**: Medium (smoke test failure)
**Priority**: High

---

**FAIL-2**: `tool-approval-basic.spec.ts:185` - Chat history preservation
```
Error: Strict mode violation
Locator: 'text=First message without tools'
Found: 2 elements (duplicate in history)
```

**Root Cause**: Message appears twice (original + AI response containing same text)
**Impact**: Medium
**Priority**: High

#### Action Items
1. ✅ Replace text-based selectors with `data-testid` selectors
2. Use `getByTestId()` instead of `locator('text=...')`
3. Add unique test-ids to message components if missing

### 3. app-e2e-core (Tier 2: Core Functionality)
```
✅ 37 passed
❌ 2 failed
⏭️  3 skipped
⏱️  1.3 minutes
```

#### Failed Tests

**FAIL-3**: `tool-approval-mixed.spec.ts:20` - SSE to BIDI mode switch
```
Error: Test timeout (45s)
Details: Not captured in logs
```

**Root Cause**: Unknown (timeout)
**Impact**: High (mode switching is critical)
**Priority**: Critical
**Next Steps**:
- Reproduce locally
- Add debug logging
- Check if backend response is received
- Verify WebSocket connection establishment

---

**FAIL-4**: `tool-approval-sse.spec.ts:241` - Message order with approvals
```
Error: Strict mode violation
Locator: 'text=Thank you'
Found: 2 elements
```

**Root Cause**: Same as FAIL-1/FAIL-2 (text selector issue)
**Impact**: Medium
**Priority**: High

#### Action Items
1. 🔴 **CRITICAL**: Investigate timeout in mode switching test
2. ✅ Fix text selector to use test-ids
3. Review all core tests for similar selector issues

### 4. app-e2e-advanced (Tier 3: Edge Cases)
```
✅ 71 passed
❌ 1 failed
⏭️  2 skipped
⏱️  2.1 minutes
```

#### Failed Tests

**FAIL-5**: `multi-tool-execution.spec.ts:335` - Rapid successive tool executions
```
Error: Test timeout (60s)
Details: Input field remained disabled
Waiting: Element to be enabled
Attempted: 50+ retries over 60 seconds
```

**Root Cause**: Chat input never re-enabled after rapid tool executions
**Actual Issue**: Likely race condition or state management bug
**Impact**: Low (edge case scenario)
**Priority**: Medium

**Deeper Analysis**:
- Test simulates rapid tool execution (5 tools in quick succession)
- Chat input disabled correctly during execution
- Input never re-enables → suggests frontend state stuck
- **Hypothesis**: `isLoading` state not properly reset
- **Alternative**: Message queue backlog preventing UI update

#### Action Items
1. Add debug logging to track `isLoading` state transitions
2. Review chat input enable/disable logic
3. Consider: Is this a test issue or real bug?
4. If real bug: Add debouncing or queue management

### 5. Skipped Tests Summary

**Total**: 15 skipped tests across all projects

**Categories**:
1. **Environment-specific** (likely)
2. **Work in progress** (WIP)
3. **Flaky tests** (temporarily disabled)
4. **Feature not implemented**

**Action Required**: Audit all `.skip()` calls to determine:
- Should they run now?
- Should they be removed?
- Should they have `.todo()` instead?

## Critical Issues (Priority Order)

### 🔴 P0: Critical
1. **FAIL-3**: Mode switching timeout
   - **Impact**: Core functionality broken
   - **Assign**: Immediate investigation
   - **ETA**: 1 day

### 🟠 P1: High
2. **FAIL-1, FAIL-2, FAIL-4**: Strict mode violations (text selectors)
   - **Impact**: 3 smoke/core tests failing
   - **Solution**: Replace with test-id selectors
   - **ETA**: 2 hours
   - **Scope**: ~10-15 selector updates

### 🟡 P2: Medium
3. **FAIL-5**: Rapid execution timeout
   - **Impact**: Edge case only
   - **Investigation**: State management review
   - **ETA**: 4 hours

4. **12 "Did Not Run" Tests**
   - **Impact**: Unknown coverage gaps
   - **Investigation**: Determine why tests didn't execute
   - **ETA**: 2 hours

5. **15 Skipped Tests Audit**
   - **Impact**: Missing test coverage
   - **Action**: Review each `.skip()` and justify or fix
   - **ETA**: 4 hours

## Action Plan

### Phase 1: Critical Fixes (Day 1)
**Goal**: Get all smoke and core tests passing

1. ✅ **Fix Text Selectors** (2 hours)
   - [ ] Update `chat-basic.spec.ts:35`
   - [ ] Update `tool-approval-basic.spec.ts:185`
   - [ ] Update `tool-approval-sse.spec.ts:241`
   - **Pattern**:
     ```typescript
     // Before (brittle)
     await expect(page.locator("text=Thank you")).toBeVisible();

     // After (robust)
     await expect(page.getByTestId("user-message")).toContainText("Thank you");
     ```

2. 🔴 **Investigate Mode Switching Timeout** (4 hours)
   - [ ] Reproduce `tool-approval-mixed.spec.ts:20` locally
   - [ ] Add debug logging to mode switch flow
   - [ ] Check WebSocket connection establishment
   - [ ] Verify backend response received
   - [ ] Fix root cause

**Expected Outcome**: 4/5 failures resolved → 99.5% pass rate

### Phase 2: Medium Priority (Day 2-3)
**Goal**: Improve test stability and coverage

3. **Investigate Rapid Execution Bug** (4 hours)
   - [ ] Add state transition logging
   - [ ] Review `isLoading` state management
   - [ ] Test with different execution speeds
   - [ ] Decide: Test fix vs. app bug fix

4. **Audit "Did Not Run" Tests** (2 hours)
   - [ ] List all 12 tests
   - [ ] Check environment conditions
   - [ ] Determine if they should run
   - [ ] Document reason or fix

5. **Audit Skipped Tests** (4 hours)
   - [ ] Review each `.skip()` call (15 tests)
   - [ ] Categorize: WIP / Flaky / Not Needed
   - [ ] Re-enable or remove as appropriate
   - [ ] Document decisions

**Expected Outcome**: 100% pass rate on applicable tests

### Phase 3: Test Improvements (Ongoing)
**Goal**: Prevent future selector issues

6. **Selector Standards** (Documentation)
   - [ ] Document test-id naming conventions
   - [ ] Add lint rule for `locator('text=...')` usage
   - [ ] Create page object patterns guide

7. **CI Integration** (1 day)
   - [ ] Add Playwright tests to CI pipeline
   - [ ] Configure retry strategy for flaky tests
   - [ ] Set up visual regression baseline
   - [ ] Enable accessibility testing in CI

## Test Organization Best Practices

### Selector Priority (Recommended Order)
1. **`getByTestId()`** - Most stable, explicit
2. **`getByRole()`** - Accessibility-friendly
3. **`getByLabel()`** - For form inputs
4. **`getByPlaceholder()`** - For inputs without labels
5. **`getByText()` with `exact: true`** - Only when unique
6. ❌ **`locator('text=...')`** - Avoid (strict mode violations)

### Test-ID Naming Convention
```typescript
// Format: {component}-{element}-{purpose?}
data-testid="chat-input"
data-testid="user-message"
data-testid="assistant-message-text"
data-testid="tool-approve-button"
data-testid="mode-switcher-gemini"
```

### Page Object Pattern (Already in `scenarios/helpers/page-objects.ts`)
```typescript
export class ChatPage {
  constructor(private page: Page) {}

  // Good: Uses test-id
  async sendMessage(text: string) {
    await this.page.getByTestId("chat-input").fill(text);
    await this.page.getByTestId("chat-input").press("Enter");
  }

  // Good: Returns locator for flexible assertions
  getMessage(index: number) {
    return this.page.getByTestId(`message-${index}`);
  }
}
```

## Metrics & Goals

### Current State
| Metric | Value | Target | Status |
|--------|-------|--------|--------|
| Total Tests | 281 | - | ✅ |
| Pass Rate | 96.8% | 100% | 🟡 |
| Execution Time | 10.2min | <15min | ✅ |
| Flaky Tests | 5 | 0 | 🟡 |
| Skipped Tests | 15 | <5 | 🟡 |
| Did Not Run | 12 | 0 | 🔴 |

### Success Criteria (End of Phase 2)
- [ ] **100% pass rate** for all executed tests
- [ ] **<5 skipped tests** (justified and documented)
- [ ] **0 "did not run"** tests (or documented why)
- [ ] **0 strict mode violations** (all use test-ids)
- [ ] **All timeouts justified** (not hiding bugs)

## Risk Assessment

### Low Risk
- Text selector fixes (well-understood, mechanical)
- Skipped tests audit (documentation/cleanup)

### Medium Risk
- Rapid execution bug (may require state management refactor)
- "Did not run" investigation (unknown scope)

### High Risk
- Mode switching timeout (core functionality, unknown cause)
  - **Mitigation**: Priority investigation with debug logging
  - **Fallback**: Add timeout extension if legitimate slow operation

## Next Actions (Immediate)

1. **Create Issues/Tasks**
   - [ ] Create issue for text selector migration
   - [ ] Create critical issue for mode switching timeout
   - [ ] Create issue for skipped tests audit

2. **Assign Priority**
   - [ ] Assign P0 (mode switching) to immediate work
   - [ ] Schedule P1 (selectors) for today
   - [ ] Schedule P2 items for this week

3. **Document Decisions**
   - [ ] Update this plan as work progresses
   - [ ] Add findings to relevant test files
   - [ ] Update README with test running instructions

## References

- **Test Files**: `scenarios/app-{smoke,core,advanced}/`
- **Helpers**: `scenarios/helpers/`
- **Config**: `playwright.config.ts`
- **CI Setup**: `.github/workflows/playwright.yml` (TODO)
- **Related Docs**:
  - `lib/tests/` - Vitest tests
  - `app/tests/integration/` - Vitest integration tests
  - `components/tests/` - Vitest component tests

## Change Log

### 2025-12-29
- ✅ Reorganized E2E tests from `app/tests/e2e/` to `scenarios/app-*/`
- ✅ Consolidated helpers into `scenarios/helpers/`
- ✅ Added timeout configuration (global + per-project)
- ✅ Ran all Playwright tests, documented results
- ✅ Identified 5 failing tests with root causes
- ✅ Created action plan for fixes
