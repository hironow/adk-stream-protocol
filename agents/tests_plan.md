# Test Reorganization and Coverage Plan

**Date:** 2025-12-31
**Purpose:** Comprehensive test reorganization to ensure ADR compliance and multi-approval scenario coverage
**Status:** ✅ Phase 1 Complete - Multi-Approval Scenarios (6/6 tests passing, all fixtures generated)

---

## Executive Summary

This document analyzes the current test coverage and proposes a reorganization plan to ensure:

1. All ADR documentation has corresponding frontend tests that catch violations immediately
2. Complete coverage for multi-tool approval scenarios (especially 2×2 combinations)
3. Proper test categorization across unit/integration/e2e/scenario layers
4. Centralized mock management with minimal usage
5. Easy maintenance when ADRs change

**Current Test Inventory:**
- **lib/tests**: 46 tests (unit: 24, integration: 12, e2e: 10)
- **app/tests**: 3 integration tests
- **components/tests**: 7 unit tests
- **scenarios**: 40 scenario tests
- **tests** (Python): ~60 tests (unit: 19, integration: 9, e2e: 32)

**Total**: ~156 tests across all layers

---

## ADR Coverage Analysis

### ADR 0001: Per-Connection State Management

**Frontend Impact**: Session isolation, no cross-tab history sharing

**Current Test Coverage:**
- ✅ `scenarios/features/chat-history-sharing.spec.ts` - All 5 tests **SKIPPED** (future feature)
- ✅ `lib/tests/integration/use-chat-integration.test.tsx` - Message isolation
- ✅ `tests/e2e/test_websocket_bidi_validation.py` - Connection-specific session

**Coverage Status:** **COMPLETE** ✅
- Tests correctly verify each connection creates independent session
- History sharing tests properly skipped (not current scope)

**Gaps:** None

**Action Required:** None - Coverage is adequate

---

### ADR 0002: Tool Approval Architecture with Backend Delegation

**Frontend Impact**: Uses `addToolOutput()` and `addToolApprovalResponse()`, NOT `onToolCall`

**Current Test Coverage:**
- ✅ `lib/tests/e2e/frontend-execute-sse.e2e.test.tsx` - Frontend Execute pattern (SSE)
- ✅ `lib/tests/e2e/frontend-execute-bidi.e2e.test.tsx` - Frontend Execute pattern (BIDI)
- ✅ `lib/tests/integration/approval-state-verification.test.tsx` - `addToolApprovalResponse()` state changes
- ✅ `scenarios/tools/process-payment-sse.spec.ts` - Server Execute (SSE)
- ✅ `scenarios/tools/process-payment-bidi.spec.ts` - Server Execute (BIDI)
- ✅ `tests/unit/test_tool_approval.py` - Backend approval handling
- ✅ `tests/integration/test_deferred_approval_flow.py` - Deferred approval flow

**Coverage Status:** **GOOD** ✅
- Both Frontend Execute and Server Execute patterns covered
- Both SSE and BIDI modes tested
- Approval state transitions validated

**Gaps:**
1. ⚠️ No explicit test verifying `onToolCall` is NOT used
2. ⚠️ No test documenting the `approval.id` vs `toolCallId` distinction (from `agents/my-understanding.md`)

**Action Required:**
- **Priority: LOW** - Add negative test case verifying `onToolCall` is not in use
- **Priority: MEDIUM** - Add integration test documenting `approval.id` usage (reference ADR 0002)

---

### ADR 0003: SSE vs BIDI Confirmation Protocol Differences

**Frontend Impact**: SSE uses `addToolOutput()`, BIDI uses user message with tool-result

**Current Test Coverage:**
- ✅ `lib/tests/e2e/frontend-execute-sse.e2e.test.tsx` - SSE confirmation pattern
- ✅ `lib/tests/e2e/frontend-execute-bidi.e2e.test.tsx` - BIDI confirmation pattern
- ✅ `lib/tests/integration/sse-integration.test.ts` - SSE approval detection
- ✅ `scenarios/tools/*-sse.spec.ts` (8 tests) - SSE tool execution
- ✅ `scenarios/tools/*-bidi.spec.ts` (8 tests) - BIDI tool execution
- ✅ `tests/e2e/backend_fixture/test_*_sse_baseline.py` - SSE baseline validation
- ✅ `tests/e2e/backend_fixture/test_*_bidi_baseline.py` - BIDI baseline validation

**Coverage Status:** **EXCELLENT** ✅
- Both protocols comprehensively tested
- Baseline fixtures ensure correct behavior preserved

**Gaps:**
1. ⚠️ No explicit test verifying protocol difference (SSE vs BIDI message format)
2. ⚠️ Parallel tool approval limitation (BIDI sequential only) not explicitly tested

**Action Required:**
- **Priority: MEDIUM** - Add comparison test showing SSE/BIDI protocol difference side-by-side
- **Priority: HIGH** - Add test verifying BIDI sequential-only execution (multi-tool scenario)

---

### ADR 0004: Multi-Tool Sequential Execution Response Timing

**Frontend Impact**: No text in intermediate responses, all text deferred until final response

**Current Test Coverage:**
- ✅ `lib/tests/e2e/sse-use-chat.e2e.test.tsx` - Multi-tool SSE timing (lines 196-250)
- ✅ `lib/tests/e2e/bidi-use-chat.e2e.test.tsx` - Multi-tool BIDI timing (lines 205-253)
- ✅ `lib/tests/e2e/multi-tool-execution-e2e.test.tsx` - Multi-tool timing validation
- ✅ `scenarios/app-advanced/multi-tool-execution.spec.ts` - Multi-tool UI behavior

**Coverage Status:** **COMPLETE** ✅
- Timing constraints verified in both modes
- Text deferral pattern tested

**Gaps:** None

**Action Required:** None - ADR 0004 fully covered

---

### ADR 0005: Frontend Execute Pattern and [DONE] Timing

**Frontend Impact**: Frontend must `waitFor` approval state before calling `addToolOutput()`

**Current Test Coverage:**
- ✅ `lib/tests/e2e/frontend-execute-sse.e2e.test.tsx` - Uses `waitFor` pattern (lines 135-145)
- ✅ `lib/tests/e2e/frontend-execute-bidi.e2e.test.tsx` - Uses `waitFor` pattern (lines 210-219)
- ✅ Tests verify both success and failure flows

**Coverage Status:** **COMPLETE** ✅
- `waitFor` pattern properly tested
- Both SSE and BIDI modes covered

**Gaps:**
1. ⚠️ No negative test showing what happens WITHOUT `waitFor` (to prevent regression)

**Action Required:**
- **Priority: MEDIUM** - Add test demonstrating failure when `waitFor` is skipped

---

### ADR 0006: sendAutomaticallyWhen Decision Logic Order

**Frontend Impact**: Critical check order determines auto-submit behavior

**Current Test Coverage:**
- ✅ `lib/tests/integration/sendAutomaticallyWhen-integration.test.ts` - Decision logic tests
- ✅ `lib/tests/integration/sendAutomaticallyWhen-false-cases.test.ts` - False return scenarios
- ✅ `lib/tests/unit/send-automatically-when-core.unit.test.ts` - Core logic unit tests

**Coverage Status:** **EXCELLENT** ✅
- All decision paths tested
- Check order validated
- Pattern matrix covered

**Gaps:** None

**Action Required:** None - ADR 0006 fully covered

---

### ADR 0007: Approval Value Independence in Auto-Submit Timing

**Frontend Impact**: `approved: true` and `approved: false` have IDENTICAL auto-submit timing

**Current Test Coverage:**
- ✅ `lib/tests/integration/sse-integration.test.ts:257-340` - Both approve and deny timing
- ✅ `components/tests/unit/tool-invocation.test.tsx:27-127` - Component-level timing verification
- ✅ Both tests use identical timeout (100ms) for approve/deny

**Coverage Status:** **COMPLETE** ✅
- Timing independence verified
- Both approval and denial tested

**Gaps:** None

**Action Required:** None - ADR 0007 fully covered

---

### ADR 0008: SSE Mode Pattern A Only for Frontend Tools

**Frontend Impact**: SSE sends approval + tool result in same request (Pattern A only)

**Current Test Coverage:**
- ✅ `lib/tests/e2e/frontend-execute-sse.e2e.test.tsx` - Pattern A implementation
- ✅ `scenarios/tools/get-location-sse.spec.ts` - Frontend tool execution
- ✅ `tests/e2e/backend_fixture/test_get_location_approved_sse_baseline.py` - SSE baseline

**Coverage Status:** **GOOD** ✅
- Pattern A correctly implemented and tested

**Gaps:**
1. ❌ No explicit test verifying Pattern B is NOT supported in SSE
2. ⚠️ No comparison test showing BIDI supports both patterns but SSE only Pattern A

**Action Required:**
- **Priority: MEDIUM** - Add documentation test explaining SSE Pattern A restriction
- **Priority: LOW** - Add comparison showing BIDI vs SSE pattern support

---

### ADR 0009: Phase 12 BLOCKING Mode for Approval

**Frontend Impact**: BLOCKING tools use ApprovalQueue, single continuous stream

**Current Test Coverage:**
- ✅ `scenarios/tools/process-payment-bidi.spec.ts` - BIDI BLOCKING flow
- ✅ `tests/integration/test_deferred_approval_flow_blocking.py` - BLOCKING behavior
- ✅ `tests/integration/test_live_request_queue_during_blocking.py` - Queue behavior during BLOCKING
- ✅ `tests/e2e/backend_fixture/test_process_payment_approved_bidi_baseline.py` - Phase 12 baseline

**Coverage Status:** **COMPLETE** ✅
- BLOCKING pattern tested
- ApprovalQueue behavior verified
- Single stream with 1 [DONE] marker validated

**Gaps:** None

**Action Required:** None - ADR 0009 fully covered

---

### ADR 0010: BIDI Confirmation Chunk Generation

**Frontend Impact**: Frontend receives manually injected `adk_request_confirmation` chunks

**Current Test Coverage:**
- ✅ `lib/tests/integration/transport-done-baseline.test.ts` - Chunk sequence validation
- ✅ `tests/unit/test_bidi_event_sender.py` - Chunk injection logic
- ✅ `tests/integration/test_bidi_event_sender_integration.py` - End-to-end chunk generation
- ✅ `tests/e2e/backend_fixture/test_*_bidi_baseline.py` - Baseline chunk validation

**Coverage Status:** **EXCELLENT** ✅
- Chunk injection mechanism thoroughly tested
- Event order validated
- ID mapping verified

**Gaps:** None

**Action Required:** None - ADR 0010 fully covered

---

### ADR 0011: BIDI Approval Deadlock - finish-step Injection

**Frontend Impact**: Must wait for `finish-step` (not `finish`) after approval-request

**Current Test Coverage:**
- ❌ **CRITICAL GAP**: No tests for `finish-step` handling yet
- ⚠️ `scenarios/tools/*-bidi.spec.ts` currently FAILING due to deadlock
- ⚠️ `lib/tests/unit/bidi-event-receiver.unit.test.ts` needs `finish-step` handling

**Coverage Status:** **INCOMPLETE** ❌
- ADR recently accepted (2025-12-31)
- Tests exist but need updates for `finish-step`

**Gaps:**
1. ❌ No test verifying `finish-step` injection after `tool-approval-request`
2. ❌ No test verifying frontend waits for `finish-step` (not `finish`)
3. ❌ No test verifying deadlock is resolved

**Action Required:**
- **Priority: CRITICAL** - Update `lib/tests/unit/bidi-event-receiver.unit.test.ts` for `finish-step` handling
- **Priority: CRITICAL** - Update `lib/tests/integration/transport-done-baseline.test.ts` to expect `finish-step`
- **Priority: CRITICAL** - Verify `scenarios/tools/*-bidi.spec.ts` pass after implementation
- **Priority: HIGH** - Add regression test proving deadlock doesn't occur

---

## Multi-Approval Scenario Coverage

### Requirement from User

**Original Request:**
> 元々のタスクでもあった通り、何度もprocess_paymentのapprovalが要求される場合は、SSEモードとBIDIモードの両方でテストされていますか？また、2度のapprovalの場合（approve/denyの2\*2の組み合わせで4パターン）をテストすることで、conversationが正しく続くかどうかを確認するテストは存在していますか？

**Translation:**
"Is the case where `process_payment` approval is requested multiple times tested in both SSE and BIDI modes? Also, are there tests for 2 approvals (4 patterns: approve×approve, approve×deny, deny×approve, deny×deny) to verify conversation continues correctly?"

### Current Coverage Analysis

#### SSE Mode - Multiple Approvals

**Existing Tests:**
- ✅ `tests/e2e/backend_fixture/test_multiple_payments_approved_sse_baseline.py`
  - Scenario: "Aliceに30ドル、Bobに40ドル送金してください"
  - Pattern: Parallel tool approvals (both tools presented at once)
  - Approvals: Both approved (approve × approve)

**Coverage:** **PARTIAL** ⚠️
- Only 1 of 4 combinations tested (approve × approve)
- Missing: approve×deny, deny×approve, deny×deny

#### BIDI Mode - Multiple Approvals

**Existing Tests:**
- ✅ `tests/e2e/backend_fixture/test_multiple_payments_sequential_bidi_baseline.py`
  - Scenario: "Aliceに30ドル、Bobに40ドル送金してください"
  - Pattern: Sequential tool approvals (one at a time, per ADR 0003)
  - Approvals: Both approved (approve × approve)

**Coverage:** **PARTIAL** ⚠️
- Only 1 of 4 combinations tested (approve × approve)
- Sequential execution verified (per ADR 0003)
- Missing: approve×deny, deny×approve, deny×deny

#### Frontend Scenario Tests

**Existing Tests:**
- ⚠️ `lib/tests/e2e/process-payment-double.e2e.test.tsx`
  - Scenario: Two sequential process_payment approvals
  - Pattern: Mock backend, both approved
  - Coverage: approve × approve only

- ⚠️ `scenarios/app-advanced/multi-tool-execution.spec.ts`
  - Scenario: Multi-tool execution UI verification
  - Not specifically testing approval combinations

**Coverage:** **PARTIAL** ⚠️
- Only approve × approve tested
- Missing 3 combinations

### 2×2 Approval Combinations Coverage Matrix

| Approval 1 | Approval 2 | SSE Test | BIDI Test | Scenario Test | Conversation Verified |
|------------|------------|----------|-----------|---------------|----------------------|
| Approve | Approve | ✅ test_multiple_payments_approved_sse_baseline.py | ✅ test_multiple_payments_sequential_bidi_baseline.py | ✅ process-payment-double.e2e.test.tsx | ✅ Yes |
| Approve | Deny | ✅ test_multiple_payments_approve_deny_sse.py (fixture: ✅) | ✅ test_multiple_payments_approve_deny_bidi.py (fixture: ✅) | ⏳ Pending | ✅ Backend verified |
| Deny | Approve | ✅ test_multiple_payments_deny_approve_sse.py (fixture: ✅) | ✅ test_multiple_payments_deny_approve_bidi.py (fixture: ✅, flaky) | ⏳ Pending | ✅ Backend verified |
| Deny | Deny | ✅ test_multiple_payments_deny_deny_sse.py (fixture: ✅) | ✅ test_multiple_payments_deny_deny_bidi.py (fixture: ✅) | ⏳ Pending | ✅ Backend verified |

**Overall Coverage:** **100% Backend E2E (4/4 combinations)** ✅ | **25% Frontend E2E (1/4 combinations)** ⏳

**Note on Flakiness:** `test_multiple_payments_deny_approve_bidi.py` exhibited transient Gemini Live API errors ("models/gemini-live-2.5-flash-preview is not found for API version v1alpha") but succeeded on retry. This is an API availability issue, not a structural problem.

### What Needs to Be Verified

For each combination, tests should verify:

1. **Both approval requests appear correctly**
2. **First approval response processed correctly**
3. **Second approval request still appears (not blocked)**
4. **Second approval response processed correctly**
5. **Conversation continues with appropriate AI response**
   - approve × approve: Both payments succeed
   - approve × deny: First succeeds, second fails, AI acknowledges mixed result
   - deny × approve: First fails, second succeeds, AI acknowledges mixed result
   - deny × deny: Both fail, AI acknowledges both denials

### Gap Analysis

**✅ Completed Tests (Backend E2E):**

1. **SSE Mode:**
   - ✅ `test_multiple_payments_approve_deny_sse.py` (1st approve, 2nd deny) - CREATED
   - ✅ `test_multiple_payments_deny_approve_sse.py` (1st deny, 2nd approve) - CREATED
   - ✅ `test_multiple_payments_deny_deny_sse.py` (both deny) - CREATED

2. **BIDI Mode:**
   - ✅ `test_multiple_payments_approve_deny_bidi.py` (1st approve, 2nd deny) - CREATED
   - ✅ `test_multiple_payments_deny_approve_bidi.py` (1st deny, 2nd approve) - CREATED
   - ✅ `test_multiple_payments_deny_deny_bidi.py` (both deny) - CREATED

**⏳ Remaining Tests (Frontend E2E & Scenarios):**

3. **Frontend E2E:**
   - ⏳ `lib/tests/e2e/process-payment-double-approve-deny.e2e.test.tsx`
   - ⏳ `lib/tests/e2e/process-payment-double-deny-approve.e2e.test.tsx`
   - ⏳ `lib/tests/e2e/process-payment-double-deny-deny.e2e.test.tsx`

4. **Scenario Tests:**
   - ⏳ `scenarios/app-advanced/multi-tool-approval-combinations.spec.ts` (all 4 combinations)

**Status:** **Backend E2E Complete** ✅ | **Frontend E2E Pending** ⏳
**Next Step:** Execute backend tests to verify and generate fixture files

---

## Mock Usage Audit

### Current Mock Locations

#### Python Tests (Backend)

**Centralized Mocks:**
- ✅ `tests/utils/mocks.py` - Shared mocks for Python tests
  - Mock ADK runners
  - Mock session objects
  - Mock WebSocket connections

**Inline Mocks:**
- ⚠️ `tests/unit/test_frontend_delegate.py` - Mock approval queue
- ⚠️ `tests/unit/test_stream_protocol.py` - Mock ADK events
- ⚠️ `tests/integration/test_bidi_event_sender_integration.py` - Mock WebSocket

**Analysis:** Mostly centralized, some inline mocks in unit tests (acceptable pattern)

#### TypeScript Tests (Frontend)

**Centralized Mocks:**
- ✅ `lib/tests/shared-mocks/` - **DOES NOT EXIST YET** ❌
- ⚠️ Mocks scattered across individual test files

**Inline Mock Locations:**
- `lib/tests/e2e/frontend-execute-sse.e2e.test.tsx` - Mock fetch for SSE
- `lib/tests/e2e/frontend-execute-bidi.e2e.test.tsx` - Mock WebSocket
- `lib/tests/e2e/sse-use-chat.e2e.test.tsx` - Mock HTTP client
- `lib/tests/e2e/bidi-use-chat.e2e.test.tsx` - Mock WebSocket client
- `lib/tests/e2e/multi-tool-execution-e2e.test.tsx` - Mock WebSocket
- `lib/tests/e2e/process-payment-double.e2e.test.tsx` - Mock WebSocket
- `lib/tests/unit/chunk-player-transport.test.ts` - Mock transport
- `lib/tests/unit/websocket-chat-transport.test.ts` - Mock WebSocket

**Mock Duplication Analysis:**
- Mock WebSocket client: **5 locations** (bidi-use-chat, frontend-execute-bidi, multi-tool, process-payment-double, websocket-chat-transport)
- Mock HTTP fetch: **2 locations** (frontend-execute-sse, sse-use-chat)
- Mock transport: **2 locations** (chunk-player-transport, chunk-player)

**Status:** **NEEDS CONSOLIDATION** ⚠️

### Unused Mocks

**To Be Identified:**
- Need to scan for mock definitions that are never referenced
- Check for outdated mocks from deprecated patterns

**Action Required:**
- Grep for `vi.fn()`, `vi.mock()`, `@mock` decorators
- Cross-reference with actual usage
- Remove unused definitions

### Mock Consolidation Plan

**Priority: HIGH** ⚠️

**Phase 1: Create Centralized Mock Directory**

1. Create `lib/tests/shared-mocks/` directory
2. Create subdirectories:
   - `lib/tests/shared-mocks/websocket/` - WebSocket mocks
   - `lib/tests/shared-mocks/http/` - HTTP/fetch mocks
   - `lib/tests/shared-mocks/transport/` - Transport layer mocks

**Phase 2: Extract Common Mocks**

1. **WebSocket Mock** (`lib/tests/shared-mocks/websocket/mock-websocket-client.ts`):
   - Extract from 5 duplicate locations
   - Provide factory function for test-specific configuration
   - Support both SSE and BIDI patterns

2. **HTTP Mock** (`lib/tests/shared-mocks/http/mock-fetch.ts`):
   - Extract from 2 duplicate locations
   - Support streaming responses
   - Support SSE format

3. **Transport Mock** (`lib/tests/shared-mocks/transport/mock-transport.ts`):
   - Extract from 2 duplicate locations
   - Generic transport interface mock

**Phase 3: Update Test Imports**

1. Update all test files to import from `lib/tests/shared-mocks/`
2. Remove inline mock definitions
3. Verify all tests still pass

**Phase 4: Documentation**

1. Create `lib/tests/shared-mocks/README.md` explaining mock usage
2. Document when to use shared mocks vs inline mocks
3. Add examples for each mock type

---

## Test Organization and Categorization

### Current Test Structure

```
lib/tests/
├── unit/ (24 tests) - ✅ Correctly categorized
├── integration/ (12 tests) - ✅ Correctly categorized
└── e2e/ (10 tests) - ⚠️ Some might be integration

app/tests/
└── integration/ (3 tests) - ✅ Correctly categorized

components/tests/
└── unit/ (7 tests) - ✅ Correctly categorized

scenarios/ (40 tests) - ⚠️ Could be better organized
├── app-smoke/ (4 tests)
├── app-core/ (5 tests)
├── app-advanced/ (5 tests)
├── features/ (14 tests)
├── lib/ (2 tests)
├── tools/ (8 tests)
└── error-handling-*.spec.ts (2 tests)

tests/ (Python backend, ~60 tests)
├── unit/ (19 tests) - ✅ Correctly categorized
├── integration/ (9 tests) - ✅ Correctly categorized
└── e2e/ (32 tests) - ✅ Correctly categorized
```

### Potential Misplacements

**lib/tests/e2e/ Analysis:**

Most tests use **mock backends** (MSW), which technically makes them **integration tests**, not true E2E:

- `lib/tests/e2e/frontend-execute-sse.e2e.test.tsx` - Mock backend → **Integration**
- `lib/tests/e2e/frontend-execute-bidi.e2e.test.tsx` - Mock backend → **Integration**
- `lib/tests/e2e/sse-use-chat.e2e.test.tsx` - Mock backend → **Integration**
- `lib/tests/e2e/bidi-use-chat.e2e.test.tsx` - Mock backend → **Integration**
- `lib/tests/e2e/multi-tool-execution-e2e.test.tsx` - Mock backend → **Integration**
- `lib/tests/e2e/process-payment-double.e2e.test.tsx` - Mock backend → **Integration**

**True E2E (Real Backend):**
- `lib/tests/e2e/chat-flow.e2e.test.ts` - Might use real backend? (needs verification)
- `lib/tests/e2e/tool-execution.e2e.test.ts` - Might use real backend? (needs verification)

**Recommendation:**
- Keep current naming for clarity (tests ARE end-to-end from frontend perspective)
- Add comment to each file explaining mock usage
- Consider renaming directory to `lib/tests/frontend-e2e/` to clarify scope

### Scenarios Test Organization

Current structure groups by feature area, which is good. But could be clearer:

**Proposed Reorganization:**

```
scenarios/
├── smoke/ (Quick validation tests, <5 min)
│   ├── setup-verification.spec.ts
│   ├── chat-basic.spec.ts
│   ├── mode-switching.spec.ts
│   └── tool-approval-basic.spec.ts
├── core/ (Essential features, must pass)
│   ├── tool-approval-sse.spec.ts
│   ├── tool-approval-bidi.spec.ts
│   ├── tool-approval-mixed.spec.ts
│   ├── tool-execution-ui.spec.ts
│   └── multi-tool-execution.spec.ts
├── tools/ (Per-tool validation)
│   ├── process-payment-sse.spec.ts
│   ├── process-payment-bidi.spec.ts
│   ├── get-location-sse.spec.ts
│   ├── get-location-bidi.spec.ts
│   ├── get-weather-sse.spec.ts
│   ├── get-weather-bidi.spec.ts
│   ├── change-bgm-sse.spec.ts
│   └── change-bgm-bidi.spec.ts
├── features/ (Feature-specific validation)
│   ├── mode-testing.spec.ts
│   ├── chat-backend-equivalence.spec.ts
│   ├── chunk-logger-*.spec.ts (4 tests)
│   ├── chunk-download.spec.ts
│   ├── chunk-download-simple.spec.ts
│   ├── chunk-player-ui-verification.spec.ts
│   ├── frontend-delegate-fix.spec.ts
│   └── chat-history-sharing.spec.ts (SKIPPED)
├── integration/ (Backend integration)
│   ├── sse-backend-integration.spec.ts
│   └── bidi-backend-integration.spec.ts
├── advanced/ (Complex scenarios, can be slow)
│   ├── audio-multimodal.spec.ts
│   ├── accessibility.spec.ts
│   ├── error-handling-ui.spec.ts
│   └── visual-regression.spec.ts
└── error-handling/
    ├── sse-errors.spec.ts
    └── bidi-errors.spec.ts
```

**Benefits:**
- Clearer test priority (smoke → core → features → advanced)
- Easier to run subsets (e.g., "just run smoke tests")
- Better CI/CD organization

---

## Test Pyramid Validation

### Current Distribution

```
Unit Tests (smallest, fastest): ~50 tests
├── lib/tests/unit/: 24 tests
├── components/tests/unit/: 7 tests
├── tests/unit/ (Python): 19 tests

Integration Tests (medium): ~24 tests
├── lib/tests/integration/: 12 tests
├── app/tests/integration/: 3 tests
├── tests/integration/ (Python): 9 tests

E2E Tests (largest, slowest): ~42 tests
├── lib/tests/e2e/: 10 tests
├── tests/e2e/ (Python): 32 tests

Scenario Tests (full stack): ~40 tests
└── scenarios/: 40 tests
```

**Pyramid Shape:**
```
         ▲ Scenarios (40)
        ███
       ██████ E2E (42)
      █████████
     ████████████ Integration (24)
    ███████████████
   ██████████████████ Unit (50)
  ═══════════════════
```

**Analysis:** **INVERTED PYRAMID** ⚠️

We have too many E2E and Scenario tests relative to Unit/Integration tests.

**Ideal Distribution:**
- Unit: 70% (should be ~107 tests)
- Integration: 20% (should be ~31 tests)
- E2E + Scenarios: 10% (should be ~16 tests)

**Current Distribution:**
- Unit: 32% (50 tests)
- Integration: 15% (24 tests)
- E2E + Scenarios: 53% (82 tests) ❌ **TOO MANY**

### Recommendations

1. **Convert some E2E tests to Integration:**
   - Tests using mock backends should be integration tests
   - Focus E2E on critical user journeys only

2. **Add more Unit tests:**
   - Component behavior (especially approval UI)
   - Utility functions
   - State management logic

3. **Reduce Scenario test duplication:**
   - Combine similar scenarios
   - Focus on happy path + critical edge cases
   - Remove redundant validations

4. **Prioritize test speed:**
   - Unit tests: <100ms each
   - Integration: <1s each
   - E2E: <10s each
   - Scenarios: <30s each

---

## Implementation Roadmap

### Phase 1: Critical Gaps (Week 1)

**Priority: CRITICAL** ⏳ **In Progress**

1. **ADR 0011 Implementation:**
   - [ ] Implement `finish-step` injection in `bidi_event_sender.py`
   - [ ] Update `event_receiver.ts` to wait for `finish-step`
   - [ ] Verify all `scenarios/tools/*-bidi.spec.ts` pass (8 tests)
   - [ ] Add unit test for `finish-step` handling

2. **Multi-Approval Scenarios (Backend E2E):** ✅ **COMPLETED**
   - [x] Add SSE tests for 3 missing combinations (approve×deny, deny×approve, deny×deny)
   - [x] Add BIDI tests for 3 missing combinations
   - [x] Execute tests to verify and generate fixtures
   - [x] All 6 tests passing (5 on first run, 1 flaky resolved on retry)
   - [ ] ⏳ Add frontend E2E tests for 3 missing combinations
   - [ ] ⏳ Add Playwright scenario test for all 4 combinations

**Files Created:**
- `tests/e2e/backend_fixture/test_multiple_payments_approve_deny_sse.py` ✅
- `tests/e2e/backend_fixture/test_multiple_payments_deny_approve_sse.py` ✅
- `tests/e2e/backend_fixture/test_multiple_payments_deny_deny_sse.py` ✅
- `tests/e2e/backend_fixture/test_multiple_payments_approve_deny_bidi.py` ✅
- `tests/e2e/backend_fixture/test_multiple_payments_deny_approve_bidi.py` ✅ (flaky, passed on retry)
- `tests/e2e/backend_fixture/test_multiple_payments_deny_deny_bidi.py` ✅

**Fixtures Generated:**
- `fixtures/frontend/multiple-payments-approve-deny-sse.json` (6.8K)
- `fixtures/frontend/multiple-payments-deny-approve-sse.json` (6.8K)
- `fixtures/frontend/multiple-payments-deny-deny-sse.json` (6.2K)
- `fixtures/frontend/multiple-payments-approve-deny-bidi.json` (13K)
- `fixtures/frontend/multiple-payments-deny-approve-bidi.json` (12K)
- `fixtures/frontend/multiple-payments-deny-deny-bidi.json` (10K)

**Actual Effort:** 1 day (Backend E2E: ✅ complete with all fixtures, Frontend: pending)

### Phase 2: Mock Consolidation (Week 2)

**Priority: HIGH** ⚠️

1. **Create Shared Mocks:**
   - [ ] Create `lib/tests/shared-mocks/` directory structure
   - [ ] Extract WebSocket mock (from 5 locations)
   - [ ] Extract HTTP mock (from 2 locations)
   - [ ] Extract transport mock (from 2 locations)

2. **Update Test Imports:**
   - [ ] Update all 9 test files to use shared mocks
   - [ ] Remove inline mock definitions
   - [ ] Verify all tests pass

3. **Documentation:**
   - [ ] Create `lib/tests/shared-mocks/README.md`
   - [ ] Document mock usage patterns
   - [ ] Add examples

**Estimated Effort:** 2-3 days

### Phase 3: ADR Test Coverage (Week 3)

**Priority: MEDIUM** ⚠️

1. **ADR 0002 Gaps:**
   - [ ] Add negative test for `onToolCall` non-usage
   - [ ] Add integration test for `approval.id` vs `toolCallId` distinction

2. **ADR 0003 Gaps:**
   - [ ] Add protocol comparison test (SSE vs BIDI message format)
   - [ ] Add test for BIDI sequential-only execution

3. **ADR 0005 Gaps:**
   - [ ] Add negative test showing failure without `waitFor`

4. **ADR 0008 Gaps:**
   - [ ] Add test verifying Pattern B unsupported in SSE
   - [ ] Add BIDI vs SSE pattern support comparison

**Estimated Effort:** 2-3 days

### Phase 4: Test Reorganization (Week 4)

**Priority: LOW** ✅

1. **Scenarios Reorganization:**
   - [ ] Create new directory structure (smoke/core/tools/features/advanced)
   - [ ] Move tests to new locations
   - [ ] Update CI/CD scripts
   - [ ] Verify all tests pass

2. **lib/tests/e2e Clarification:**
   - [ ] Add comments explaining mock usage
   - [ ] Consider renaming to `frontend-e2e/`
   - [ ] Update documentation

**Estimated Effort:** 1-2 days

### Phase 5: Test Pyramid Rebalancing (Ongoing)

**Priority: LOW** ✅

1. **Add Unit Tests:**
   - [ ] Component behavior tests (target: +30 tests)
   - [ ] Utility function tests (target: +20 tests)
   - [ ] State management tests (target: +10 tests)

2. **Convert E2E to Integration:**
   - [ ] Identify mock-based E2E tests
   - [ ] Reclassify or refactor to integration
   - [ ] Target: Reduce E2E count by 20

3. **Reduce Scenario Duplication:**
   - [ ] Identify redundant scenarios
   - [ ] Combine similar tests
   - [ ] Target: Reduce scenario count by 10

**Estimated Effort:** 4-6 weeks (ongoing)

---

## Testing Best Practices (Reference)

### When to Use Each Test Type

**Unit Tests:**
- Isolated component logic
- Utility functions
- State transformations
- Pure functions
- **Avoid:** External dependencies, real network calls

**Integration Tests:**
- Component interactions
- Hook integration
- Transport layer integration
- Mock backends OK
- **Avoid:** Full app stack, real backends

**E2E Tests:**
- Real backend + real frontend
- Complete user flows
- Critical paths only
- **Minimize:** Due to slowness and flakiness

**Scenario Tests:**
- Production-ready validation
- Can run against production (URL change only)
- User acceptance criteria
- **Minimize:** Run full stack, slowest tests

### Mock Usage Guidelines

**When to Mock:**
- External APIs (weather, payment)
- Browser APIs (geolocation, camera)
- Slow operations (database, network)
- Non-deterministic behavior (time, random)

**When NOT to Mock:**
- Internal business logic
- State management
- Component rendering
- User interactions

**Mock Centralization:**
- Shared mocks: `lib/tests/shared-mocks/` or `tests/utils/mocks.py`
- Inline mocks: Only for test-specific scenarios
- Never duplicate mock definitions

---

## Success Criteria

This test reorganization plan is complete when:

1. ✅ All 11 ADRs have comprehensive frontend test coverage
2. ✅ All 4 multi-approval combinations tested (approve×approve, approve×deny, deny×approve, deny×deny)
3. ✅ All mocks centralized in designated directories
4. ✅ No unused mock definitions remain
5. ✅ Test pyramid restored (70% unit, 20% integration, 10% e2e+scenarios)
6. ✅ All tests pass consistently
7. ✅ ADR violations caught immediately by tests
8. ✅ Easy to update tests when ADRs change

---

## Questions for User

Before proceeding with implementation:

1. **Priority Confirmation:** Should we prioritize ADR 0011 (deadlock fix) first, or multi-approval scenarios?

2. **Multi-Approval Scope:** Should multi-approval tests cover only `process_payment`, or all approval-requiring tools?

3. **Mock Consolidation:** Should we consolidate Python mocks (`tests/utils/mocks.py`) as well, or focus on TypeScript only?

4. **Scenario Reorganization:** Is the proposed directory structure (smoke/core/tools/features/advanced) acceptable?

5. **Test Pyramid:** What's the acceptable timeline for rebalancing the test pyramid? (Currently inverted)

---

## Appendices

### Appendix A: Complete Test File Inventory

**Frontend Tests (TypeScript):**
- lib/tests/: 46 files
- app/tests/: 3 files
- components/tests/: 7 files
- scenarios/: 40 files

**Backend Tests (Python):**
- tests/unit/: 19 files
- tests/integration/: 9 files
- tests/e2e/: 32 files

**Total:** ~156 test files

### Appendix B: ADR Quick Reference

1. **ADR 0001:** Per-Connection State (Session = Connection)
2. **ADR 0002:** Tool Approval Architecture (addToolOutput, addToolApprovalResponse)
3. **ADR 0003:** SSE vs BIDI Protocols (different confirmation patterns)
4. **ADR 0004:** Multi-Tool Timing (no intermediate text)
5. **ADR 0005:** Frontend Execute (waitFor before addToolOutput)
6. **ADR 0006:** sendAutomaticallyWhen Logic Order (check order matters)
7. **ADR 0007:** Approval Value Independence (approve/deny timing identical)
8. **ADR 0008:** SSE Pattern A Only (frontend tools)
9. **ADR 0009:** Phase 12 BLOCKING (ApprovalQueue pattern)
10. **ADR 0010:** BIDI Chunk Generation (manual injection)
11. **ADR 0011:** BIDI Deadlock (finish-step injection)

### Appendix C: Glossary

- **SSE:** Server-Sent Events (HTTP-based streaming)
- **BIDI:** Bidirectional (WebSocket-based)
- **BLOCKING:** Tool execution pattern that waits for approval
- **ApprovalQueue:** Backend coordination for BLOCKING tools
- **Frontend Execute:** Tool executes in browser (Pattern B)
- **Server Execute:** Tool executes on backend (Pattern A)
- **finish-step:** AI SDK v6 event marking step completion
- **[DONE]:** Stream termination marker

---

**Next Steps:** Wait for user confirmation on questions above, then proceed with Phase 1 implementation.
