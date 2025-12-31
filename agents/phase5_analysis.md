# Phase 5: Test Pyramid Rebalancing - Analysis Report

**Date:** 2026-01-01
**Status:** 🟡 In Progress

---

## Current Test Distribution

### Summary by Test Level

| Test Level | TypeScript (Vitest) | Python (Pytest) | Playwright | Total |
|------------|---------------------|-----------------|------------|-------|
| **Unit** | 22 (lib/tests/unit) | 19 (tests/unit) | - | **41** |
| **Integration** | 15 (lib/tests/integration) | 9 (tests/integration) | - | **24** |
| **Mock-based E2E** | 16 (lib/tests/e2e) | - | - | **16** |
| **App/Component** | 10 (app+components) | - | - | **10** |
| **Real E2E** | - | 26 (tests/e2e) | 39 (scenarios/) | **65** |
| **TOTAL** | **63** | **54** | **39** | **156** |

### Detailed Breakdown

#### TypeScript Tests (Vitest) - 63 files total
- `lib/tests/unit/`: 22 tests - Isolated component logic
- `lib/tests/integration/`: 15 tests - Component interactions with MSW mocks
- `lib/tests/e2e/`: 16 tests - **Mock-based E2E using MSW** (actually integration tests)
- `app/`: 3 tests - App-level tests
- `components/`: 7 tests - Component tests

#### Python Tests (Pytest) - 54 files total
- `tests/unit/`: 19 tests - Isolated backend logic
- `tests/integration/`: 9 tests - Backend component integration
- `tests/e2e/`: 26 tests - **Real backend E2E** (requires server)

#### Playwright Tests - 39 files total
- `scenarios/app-smoke/`: 4 tests - Basic smoke tests
- `scenarios/app-core/`: 4 tests - Core functionality tests
- `scenarios/app-advanced/`: 6 tests - Advanced features
- `scenarios/features/`: 15 tests - Feature-specific tests
- `scenarios/lib/`: 2 tests - Library integration tests
- `scenarios/tools/`: 8 tests - Tool-specific tests (SSE + BIDI variants)

---

## Test Pyramid Analysis

### Current State

```
                 ▲
                / \
               /   \
              /  39 \  ← Playwright E2E (Real servers)
             /───────\
            /    26   \ ← Python E2E (Real backend)
           /───────────\
          /     16      \ ← lib/tests/e2e (MSW mocks - MISCLASSIFIED)
         /───────────────\
        /       24        \ ← Integration (MSW/mocks)
       /───────────────────\
      /         41          \ ← Unit tests
     /───────────────────────\
    ───────────────────────────
```

### Ideal Pyramid

```
                 ▲
                / \
               /   \
              / 30  \  ← E2E (Real servers - REDUCE)
             /───────\
            /    40   \ ← Integration (with mocks - INCREASE)
           /───────────\
          /      90     \ ← Unit tests (isolated - INCREASE)
         /───────────────\
    ───────────────────────
```

### Issues Identified

1. **Inverted Pyramid Problem**
   - E2E tests: 65 (too many)
   - Integration tests: 40 (lib/integration:15 + lib/e2e:16 + py/integration:9)
   - Unit tests: 41 (should be the largest)
   - **Ratio:** Unit:Integration:E2E = 41:40:65 ❌
   - **Target:** Unit:Integration:E2E = 90:40:30 ✅

2. **Misclassified Tests**
   - `lib/tests/e2e/` (16 files) uses MSW mocks → Should be reclassified as integration tests
   - Per `lib/tests/e2e/README.md`: "These are NOT True E2E Tests"
   - Current: Called "e2e" but are actually integration tests
   - **Decision:** Keep directory name, clearly document in README (already done)

3. **High E2E Test Count**
   - Playwright scenarios: 39 files
   - Python E2E: 26 files
   - Total real E2E: 65 files (target: ~30)
   - **Goal:** Reduce by 20-35 tests

---

## Findings

### 1. Mock-based E2E Classification

#### `lib/tests/e2e/` (16 files) - Currently Misnamed

All tests use MSW for mocking:
- ✅ **Already Documented**: README.md explains these are NOT true E2E
- ✅ **Proper Dependency Level**: Correctly categorized as `--no-deps` in unified test runner
- ⚠️ **Misleading Name**: Directory name suggests E2E but they're integration tests

**Files:**
1. audio-control.e2e.test.ts
2. bidi-event-receiver.e2e.test.tsx
3. bidi-sequential-only-execution.e2e.test.tsx (Phase 3 - ADR test)
4. bidi-use-chat.e2e.test.tsx
5. chat-flow.e2e.test.ts
6. chunk-logging-e2e.test.tsx
7. error-handling.e2e.test.ts
8. frontend-execute-bidi.e2e.test.tsx
9. frontend-execute-sse.e2e.test.tsx
10. mode-switching.e2e.test.ts
11. multi-tool-execution-e2e.test.tsx
12. process-payment-double-approve-deny.e2e.test.tsx
13. process-payment-double.e2e.test.tsx
14. protocol-comparison-sse-vs-bidi.e2e.test.tsx (Phase 3 - ADR test)
15. sse-use-chat.e2e.test.tsx
16. tool-execution.e2e.test.ts

**Recommendation:**
- ✅ **Keep directory name** (`lib/tests/e2e/`) - renaming would cause confusion
- ✅ **Documentation already clear** - README.md explains mock usage
- ✅ **Unified test runner correct** - treats as `--no-deps` (parallel execution)

### 2. Potential Playwright Scenario Redundancies

#### Duplicate Coverage Candidates

**Tool Tests (scenarios/tools/) - 8 files:**
Each tool has SSE + BIDI variant:
- change-bgm: bidi + sse
- get-location: bidi + sse
- get-weather: bidi + sse
- process-payment: bidi + sse

**Question:** Do we need both SSE and BIDI variants for each tool?
- **Keep:** If testing protocol-specific behavior
- **Consolidate:** If only testing tool functionality (protocol-agnostic)

**Chunk Logger Tests (scenarios/features/) - 5 files:**
- chunk-logger-change-bgm.spec.ts
- chunk-logger-get-location.spec.ts
- chunk-logger-get-weather.spec.ts
- chunk-logger-integration.spec.ts
- chunk-player-ui-verification.spec.ts

**Potential:** Consolidate first 3 into chunk-logger-integration.spec.ts

**Chunk Download Tests (scenarios/features/) - 2 files:**
- chunk-download.spec.ts
- chunk-download-simple.spec.ts

**Potential:** Merge into single file with parameterized tests

**Error Handling Tests - 3 locations:**
- scenarios/app-advanced/error-handling-ui.spec.ts
- scenarios/features/error-handling-bidi.spec.ts
- scenarios/features/error-handling-sse.spec.ts

**Potential:** Consolidate or ensure clear separation of concerns

**Tool Approval Tests - 3 locations:**
- scenarios/app-smoke/tool-approval-basic.spec.ts
- scenarios/app-core/tool-approval-*.spec.ts (3 files)
- scenarios/features/tool-approval.spec.ts

**Question:** What's the difference? Smoke vs core vs features?

### 3. Unit Test Coverage Gaps

Need to analyze:
- [ ] Which components lack unit tests?
- [ ] Which utility functions are untested?
- [ ] Which state management logic needs coverage?

**Target:**
- Add 30 component behavior tests
- Add 20 utility function tests
- Add 10 state management tests

---

## Recommendations

### Priority 1: Scenario Consolidation (High Impact)

**Goal:** Reduce Playwright scenarios from 39 to ~25 (-14 tests)

**Actions:**
1. **Consolidate chunk-logger tests** (4 → 1)
   - Merge change-bgm, get-location, get-weather into chunk-logger-integration.spec.ts
   - **Saves:** 3 tests

2. **Consolidate chunk-download tests** (2 → 1)
   - Merge simple variant into main file
   - **Saves:** 1 test

3. **Review tool SSE/BIDI variants** (8 files)
   - Determine if both protocols are needed per tool
   - Consider parameterized tests for protocol switching
   - **Potential:** 4-6 tests reduction

4. **Review error-handling coverage** (3 locations)
   - Ensure no duplicate coverage
   - Consolidate if testing same scenarios
   - **Potential:** 1-2 tests reduction

5. **Review tool-approval coverage** (multiple locations)
   - Smoke (basic) vs Core (detailed) vs Features (specific) - clarify purpose
   - **Potential:** 2-3 tests reduction

**Total Expected Reduction:** 11-15 tests (target achieved)

### Priority 2: Python E2E Review (Medium Impact)

**Goal:** Reduce Python E2E tests from 26 to ~20 (-6 tests)

**Actions:**
- [ ] List all `tests/e2e/` test files
- [ ] Identify redundant coverage with Playwright scenarios
- [ ] Consolidate similar test cases

### Priority 3: Add Unit Tests (Long-term)

**Goal:** Increase unit tests from 41 to 71 (+30 tests)

**Actions:**
- [ ] Analyze component coverage
- [ ] Identify utility functions without tests
- [ ] Add state management unit tests

**Defer to future phases** (ongoing work)

---

## Action Items

### Phase 5.1: Scenario Consolidation

- [x] Consolidate chunk-logger tests (scenarios/features/) - **COMPLETED** (4 → 1 file, saved 3 tests)
  - Merged: chunk-logger-change-bgm.spec.ts (1 test)
  - Merged: chunk-logger-get-location.spec.ts (2 tests)
  - Merged: chunk-logger-get-weather.spec.ts (1 test)
  - Target: chunk-logger-integration.spec.ts (now 12 tests total)
- [x] Merge chunk-download tests - **COMPLETED** (2 → 1 file, saved 1 test)
  - Removed: chunk-download.spec.ts (debug-only test)
  - Kept: chunk-download.spec.ts (renamed from chunk-download-simple.spec.ts)
  - Rationale: Debug test provided no value beyond functional test
- [x] Review and consolidate tool SSE/BIDI tests - **DECISION: KEEP SEPARATE**
  - **Finding:** SSE and BIDI variants are near-identical (only mode selection differs)
  - **Test Coverage:** Protocol compatibility tests - verify each tool works in both modes
  - **Files Analyzed:** change-bgm-{sse,bidi}.spec.ts, get-weather-{sse,bidi}.spec.ts
  - **Initial Consideration:** Consolidate using parameterized tests (8 → 4 files)
  - **Final Decision:** KEEP SEPARATE (8 files maintained)
  - **Rationale:**
    1. Protocol compatibility testing value - ensures each tool works in both modes
    2. Failure isolation - protocol-specific breakage immediately identifiable
    3. Test organization - easy to run protocol-specific test suites
    4. Low maintenance cost - files are short (~150 lines) and change infrequently
  - **Consolidation would sacrifice:** Failure isolation, test organization, debugging clarity
- [x] Review error-handling test separation - **DECISION: KEEP SEPARATE**
  - **Files:** 3 error-handling test files in different locations
    1. `scenarios/features/error-handling-sse.spec.ts` - HTTP/SSE protocol errors
    2. `scenarios/features/error-handling-bidi.spec.ts` - WebSocket protocol errors
    3. `scenarios/app-advanced/error-handling-ui.spec.ts` - UI error handling
  - **Test Coverage:** Completely different layers and concerns
    - SSE: HTTP endpoint validation errors (FastAPI Pydantic)
    - BIDI: WebSocket connection and message errors
    - UI: Error display, recovery, user experience
  - **Decision:** KEEP SEPARATE - no overlap, different test layers
  - **Rationale:** Testing different protocols and layers; consolidation impossible
- [x] Review tool-approval test purpose - **DECISION: KEEP SEPARATE**
  - **Files:** 5 tool-approval test files in different test levels
    1. `scenarios/app-smoke/tool-approval-basic.spec.ts` - SMOKE (critical path only)
    2. `scenarios/app-core/tool-approval-sse.spec.ts` - CORE (Server Execute pattern)
    3. `scenarios/app-core/tool-approval-bidi.spec.ts` - CORE (Frontend Execute pattern)
    4. `scenarios/app-core/tool-approval-mixed.spec.ts` - CORE (Mixed scenarios)
    5. `scenarios/features/tool-approval.spec.ts` - FEATURES (Full E2E flow)
  - **Test Organization:** Intentional Testing Pyramid structure
    - Smoke → Critical functionality validation
    - Core → Comprehensive testing per mode
    - Features → Complete end-to-end scenarios
  - **Decision:** KEEP SEPARATE - well-organized test pyramid, not duplication
  - **Rationale:** Each level serves distinct testing purpose (smoke/core/features)

**Phase 5.1 Summary:**
- **Tests Consolidated:** 4 files → 2 files (saved 4 test files)
  - chunk-logger: 4 → 1 (saved 3 files)
  - chunk-download: 2 → 1 (saved 1 file)
- **Tests Reviewed and Kept:** 16 files (intentional organization, not duplication)
  - tool SSE/BIDI variants: 8 files (protocol compatibility testing)
  - error-handling: 3 files (different test layers)
  - tool-approval: 5 files (test pyramid structure)
- **New Playwright Count:** 35 tests (39 - 4 = 35)
- **Key Finding:** Many tests that appeared redundant were actually well-organized by design

### Phase 5.2: Python E2E Review

- [ ] List all tests/e2e/ files
- [ ] Identify redundancies
- [ ] Consolidate tests

### Phase 5.3: Unit Test Addition (Ongoing)

- [ ] Component behavior tests (+30)
- [ ] Utility function tests (+20)
- [ ] State management tests (+10)

---

## Success Metrics

**Before (Phase 5 Start):**
- Unit: 41
- Integration: 40 (24 + 16 mock-e2e)
- E2E: 65 (26 python + 39 playwright)
- **Ratio:** 41:40:65 (inverted pyramid)

**After Phase 5.1 (Scenario Consolidation):**
- Unit: 41 (unchanged)
- Integration: 40 (unchanged)
- E2E: 61 (26 python + 35 playwright) **[-4 tests]**
- **Ratio:** 41:40:61 (improvement, still inverted)

**Phase 5 Final Target:**
- Unit: 71 (+30) - *Deferred to ongoing work*
- Integration: 40 (keep)
- E2E: 45 (-20 total, -16 remaining needed)
- **Ratio:** 71:40:45 (proper pyramid)

**Phase 5.1 Outcome:**
- **Achieved:** Consolidated 4 test files (chunk-logger, chunk-download)
- **Reviewed:** 16 test files - determined all should be kept (intentional organization)
- **Progress:** 4 of 20 targeted reductions (20% complete)
- **Key Insight:** Many apparent duplicates were actually well-designed test organization

---

## Notes

1. **lib/tests/e2e/ naming**: Decided to keep current name despite being mock-based, as README clarifies
2. **Unified test runner**: Already correctly categorizes lib/tests/e2e as `--no-deps`
3. **Tool protocol variants**: Need clarification on whether SSE+BIDI variants are essential
4. **Test pyramid**: Current state is inverted (more E2E than Unit)

---

## Next Steps

1. Start with scenario consolidation (highest impact, lowest risk)
2. Create consolidated test files
3. Verify coverage is maintained
4. Remove redundant tests
5. Update documentation
