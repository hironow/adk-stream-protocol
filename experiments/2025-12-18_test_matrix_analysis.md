# E2E Test Matrix Analysis - 4x2x2 Coverage

**Date:** 2025-12-18
**Status:** 📊 Analysis Complete

## Matrix Definition

**4 Tools** × **2 Modes** × **2 Approvals** = **16 test patterns**

### Tools (4)

1. `process_payment` - Payment processing tool with confirmation
2. `change_bgm` - Background music change (frontend-delegated)
3. `get_location` - User location retrieval (requires tool context)
4. `get_weather` - Weather information retrieval

### Modes (2)

1. **ADK SSE** - Server-Sent Events (traditional streaming)
2. **ADK BIDI** - Bidirectional WebSocket (Live API)

### Approvals (2)

1. **Approve** - User approves tool execution
2. **Deny** - User denies tool execution

## Current Test Coverage Matrix

| # | Tool | Mode | Approval | Test File | Test Name | Status |
|---|------|------|----------|-----------|-----------|--------|
| 1 | process_payment | SSE | Approve | adk-confirmation-minimal.spec.ts | Test 1: Normal Flow - Approve Once | ✅ |
| 2 | process_payment | SSE | Deny | adk-confirmation-minimal.spec.ts | Test 2: Denial Flow - Deny Once | ✅ |
| 3 | process_payment | SSE | Approve | adk-confirmation-minimal.spec.ts | Test 3: Sequential Flow - Approve Twice | ✅ |
| 4 | process_payment | SSE | Approve+Deny | adk-confirmation-minimal.spec.ts | Test 4: Deny Then Approve | ✅ |
| 5 | process_payment | SSE | Deny+Approve | adk-confirmation-minimal.spec.ts | Test 5: Approve Then Deny | ✅ |
| 6 | process_payment | BIDI | Approve | adk-confirmation-minimal-bidi.spec.ts | Test 1: Normal Flow - Approve Once | ✅ |
| 7 | process_payment | BIDI | Deny | adk-confirmation-minimal-bidi.spec.ts | Test 2: Denial Flow - Deny Once | ✅ |
| 8 | process_payment | BIDI | Approve | adk-confirmation-minimal-bidi.spec.ts | Test 3: Sequential Flow - Approve Twice | ✅ |
| 9 | process_payment | BIDI | Approve+Deny | adk-confirmation-minimal-bidi.spec.ts | Test 4: Deny Then Approve | ✅ |
| 10 | process_payment | BIDI | Deny+Approve | adk-confirmation-minimal-bidi.spec.ts | Test 5: Approve Then Deny | ✅ |
| 11 | change_bgm | SSE | Approve | ❌ NOT COVERED | - | ❌ |
| 12 | change_bgm | SSE | Deny | ❌ NOT COVERED | - | ❌ |
| 13 | change_bgm | BIDI | Approve | ❌ NOT COVERED (delegated to frontend) | - | ⚠️ N/A |
| 14 | change_bgm | BIDI | Deny | ❌ NOT COVERED (delegated to frontend) | - | ⚠️ N/A |
| 15 | get_location | SSE | Approve | ❌ NOT COVERED | - | ❌ |
| 16 | get_location | SSE | Deny | ❌ NOT COVERED | - | ❌ |
| 17 | get_location | BIDI | Approve | ❌ NOT COVERED | - | ❌ |
| 18 | get_location | BIDI | Deny | ❌ NOT COVERED | - | ❌ |
| 19 | get_weather | SSE | Approve | ❌ NOT COVERED | - | ❌ |
| 20 | get_weather | SSE | Deny | ❌ NOT COVERED | - | ❌ |
| 21 | get_weather | BIDI | Approve | ❌ NOT COVERED | - | ❌ |
| 22 | get_weather | BIDI | Deny | ❌ NOT COVERED | - | ❌ |

**Note:** `change_bgm` is delegated to frontend in BIDI mode and doesn't require backend confirmation.

## Coverage Summary

### By Tool

- `process_payment`: ✅ **10/10 patterns** (100% - SSE Approve, SSE Deny, BIDI Approve, BIDI Deny + sequences)
- `change_bgm`: ❌ **0/4 patterns** (0% - no tests exist)
- `get_location`: ❌ **0/4 patterns** (0% - no tests exist)
- `get_weather`: ❌ **0/4 patterns** (0% - no tests exist)

### By Mode

- **SSE Mode**: 5/8 tool-approval patterns covered (62.5%)
    - process_payment: ✅ Approve & Deny
    - change_bgm: ❌ NOT COVERED
    - get_location: ❌ NOT COVERED
    - get_weather: ❌ NOT COVERED

- **BIDI Mode**: 5/8 tool-approval patterns covered (62.5%)
    - process_payment: ✅ Approve & Deny
    - change_bgm: ⚠️ N/A (frontend delegated)
    - get_location: ❌ NOT COVERED
    - get_weather: ❌ NOT COVERED

### By Approval Type

- **Approve**: 5/8 tool-mode combinations (62.5%)
- **Deny**: 5/8 tool-mode combinations (62.5%)

### Overall Coverage

**Actual Coverage:** 10/16 base patterns (62.5%)

- ✅ Covered: 10 patterns (all process_payment)
- ❌ Missing: 6 patterns (change_bgm, get_location, get_weather)

**Note:** Sequential patterns (Approve→Deny, Deny→Approve) are bonus coverage beyond the 16 base patterns.

## Test File Organization

### Current Structure

```
e2e/
├── adk-confirmation-minimal.spec.ts          # SSE mode - process_payment only
├── adk-confirmation-minimal-bidi.spec.ts     # BIDI mode - process_payment only
├── adk-tool-confirmation.spec.ts             # Legacy? (needs review)
├── poc-longrunning-bidi.spec.ts              # POC phases + Edge cases
├── chunk-logger-integration.spec.ts          # Chunk logger verification
└── [other test files]
```

### Issues with Current Organization

1. **Tool Coverage Gap**
   - Only `process_payment` has comprehensive tests
   - Missing: `change_bgm`, `get_location`, `get_weather`

2. **File Naming Inconsistency**
   - `adk-confirmation-minimal.spec.ts` doesn't indicate tool name
   - Should be: `process-payment-sse.spec.ts` or similar

3. **POC Tests Mixed with Production**
   - `poc-longrunning-bidi.spec.ts` contains both POC experiments and edge case tests
   - Should separate POC (can be moved to experiments/) from production tests

4. **No Individual Test Execution**
   - Cannot test single tool independently
   - All tests bundled in "minimal" suites

## Chunk Logger Integration

### Current Status

**Covered:**

- ✅ `process_payment` - Full chunk logger integration in `chunk-logger-integration.spec.ts`
- ✅ 8 test scenarios with 3-way log consistency verification

**Not Covered:**

- ❌ `change_bgm` - No chunk logger tests
- ❌ `get_location` - No chunk logger tests
- ❌ `get_weather` - No chunk logger tests

## Recommendations

### 1. Complete Tool Coverage (Priority: HIGH)

**Create missing test files:**

```
e2e/
├── process-payment-sse.spec.ts          # ✅ EXISTS (rename from adk-confirmation-minimal.spec.ts)
├── process-payment-bidi.spec.ts         # ✅ EXISTS (rename from adk-confirmation-minimal-bidi.spec.ts)
├── change-bgm-sse.spec.ts               # ❌ MISSING - CREATE
├── get-location-sse.spec.ts             # ❌ MISSING - CREATE
├── get-location-bidi.spec.ts            # ❌ MISSING - CREATE
├── get-weather-sse.spec.ts              # ❌ MISSING - CREATE
├── get-weather-bidi.spec.ts             # ❌ MISSING - CREATE
└── edge-cases-longrunning-bidi.spec.ts  # ✅ EXISTS (rename from poc-longrunning-bidi.spec.ts)
```

**Note:** `change-bgm-bidi.spec.ts` not needed - frontend delegated tool doesn't require backend confirmation tests.

### 2. Standardize File Naming (Priority: MEDIUM)

**Current → Proposed:**

- `adk-confirmation-minimal.spec.ts` → `process-payment-sse.spec.ts`
- `adk-confirmation-minimal-bidi.spec.ts` → `process-payment-bidi.spec.ts`
- `poc-longrunning-bidi.spec.ts` → `edge-cases-longrunning-bidi.spec.ts`
- `adk-tool-confirmation.spec.ts` → Review and potentially remove (legacy?)

### 3. Expand Chunk Logger Coverage (Priority: MEDIUM)

**Add chunk logger tests for:**

- `change-bgm-sse.spec.ts` (with afterEach chunk log download)
- `get-location-sse.spec.ts` (with afterEach chunk log download)
- `get-location-bidi.spec.ts` (with afterEach chunk log download)
- `get-weather-sse.spec.ts` (with afterEach chunk log download)
- `get-weather-bidi.spec.ts` (with afterEach chunk log download)

### 4. Separate POC from Production (Priority: LOW)

**Move POC experiments:**

```
experiments/pocs/
└── poc-longrunning-bidi-phases.spec.ts  # Phase 1-5 POC tests
```

**Keep production edge cases:**

```
e2e/
└── edge-cases-longrunning-bidi.spec.ts  # Edge Cases #1-4
```

## Test Execution

### Individual Tool Tests

```bash
# Process payment (SSE)
pnpm exec playwright test e2e/process-payment-sse.spec.ts

# Process payment (BIDI)
pnpm exec playwright test e2e/process-payment-bidi.spec.ts

# Change BGM (SSE) - AFTER CREATING FILE
pnpm exec playwright test e2e/change-bgm-sse.spec.ts

# Get location (SSE) - AFTER CREATING FILE
pnpm exec playwright test e2e/get-location-sse.spec.ts

# Get location (BIDI) - AFTER CREATING FILE
pnpm exec playwright test e2e/get-location-bidi.spec.ts

# Get weather (SSE) - AFTER CREATING FILE
pnpm exec playwright test e2e/get-weather-sse.spec.ts

# Get weather (BIDI) - AFTER CREATING FILE
pnpm exec playwright test e2e/get-weather-bidi.spec.ts
```

### Full Test Suite

```bash
# All confirmation tests
pnpm exec playwright test e2e/*-sse.spec.ts e2e/*-bidi.spec.ts

# All edge case tests
pnpm exec playwright test e2e/edge-cases-*.spec.ts

# Full E2E suite
just test-e2e-clean
```

## Target: 100% Coverage

**To achieve 100% coverage of 4x2x2 matrix:**

1. ✅ Create `change-bgm-sse.spec.ts` (Approve + Deny)
2. ✅ Create `get-location-sse.spec.ts` (Approve + Deny)
3. ✅ Create `get-location-bidi.spec.ts` (Approve + Deny)
4. ✅ Create `get-weather-sse.spec.ts` (Approve + Deny)
5. ✅ Create `get-weather-bidi.spec.ts` (Approve + Deny)

**Total new test files needed:** 5
**Total new test cases:** ~20 (4 tests per file × 5 files, following minimal test pattern)

## Related Documents

- `e2e/adk-confirmation-minimal.spec.ts` - Current SSE mode tests
- `e2e/adk-confirmation-minimal-bidi.spec.ts` - Current BIDI mode tests
- `e2e/poc-longrunning-bidi.spec.ts` - POC phases + Edge cases
- `e2e/chunk-logger-integration.spec.ts` - Chunk logger 8-scenario tests
- `experiments/2025-12-18_edgecase_*.md` - Edge Case documentation (#1-4)
- `agents/tasks.md` - Current test status
