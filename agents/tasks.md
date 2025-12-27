# Agent Tasks

Current active task tracking for the ADK AI Data Protocol project.

---

## 🔴 Active Tasks

### 1. Record E2E Fixture Files (Backend)

**Status**: ⚪ Not Started
**Priority**: Medium
**Branch**: `main` or feature branch

**Description**:
6 E2E tests are skipped because fixture files are empty (0 bytes). Need to manually record these fixtures.

**Affected Tests** (tests/e2e/test_server_chunk_player.py):

1. `TestPattern2ADKSSEOnly::test_replays_chunks_in_fast_forward_mode` - SKIPPED
2. `TestPattern2ADKSSEOnly::test_contains_tool_invocation_chunks` - SKIPPED
3. `TestPattern3ADKBIDIOnly::test_replays_chunks_in_fast_forward_mode` - SKIPPED
4. `TestPattern3ADKBIDIOnly::test_contains_audio_chunks` - SKIPPED
5. `TestPattern4ModeSwitching::test_replays_chunks_from_multiple_modes` - SKIPPED
6. `TestPattern4ModeSwitching::test_preserves_chunk_order_across_mode_switches` - SKIPPED

**Required Fixtures** (all 0 bytes):

- `fixtures/backend/pattern2-backend.jsonl`
- `fixtures/backend/pattern2-frontend.jsonl`
- `fixtures/backend/pattern3-backend.jsonl`
- `fixtures/backend/pattern3-frontend.jsonl`
- `fixtures/backend/pattern4-backend.jsonl`
- `fixtures/backend/pattern4-frontend.jsonl`

**Recording Procedure**:
See `fixtures/README.md` "Recording Procedure" section:

1. Enable Chunk Logger: `export CHUNK_LOGGER_ENABLED=true`
2. Set output directory: `export CHUNK_LOGGER_OUTPUT_DIR=./fixtures/backend`
3. Set session ID: `export CHUNK_LOGGER_SESSION_ID=pattern2` (or pattern3, pattern4)
4. Execute test scenario for each pattern
5. Verify recording: Check file sizes
6. Rename output files to match expected names
7. Remove `@pytest.mark.skip` decorators from tests

**Reference**: `fixtures/README.md` lines 165-193

---

## ✅ Recently Completed (2025-12-27)

### SSE Mode Pattern A for Frontend-Delegated Tools

**Completed**: 2025-12-27 15:45 JST

**Summary**: Implemented Pattern A (1-request) support for frontend-delegated tools in SSE mode with pre-resolution cache, mode detection, and full E2E test coverage.

**Key Components**:

1. **Architecture Decision (ADR-0008)**
   - Documented Pattern A only support for SSE mode
   - Pattern B (2-request) not supported due to SSE invocation lifecycle
   - BIDI mode continues to support both patterns

2. **Pre-Resolution Cache Pattern**
   - Handles timing where tool results arrive before Future creation
   - `_pre_resolved_results` dict in FrontendToolDelegate
   - Ensures no results lost in Pattern A flow

3. **Mode Detection Strategy**
   - Backend tools check `confirmation_delegate` in session.state
   - BIDI: Has confirmation_delegate → delegates to frontend via Future
   - SSE: No confirmation_delegate → returns immediate success

4. **Frontend Tool Execution**
   - Implemented in `components/tool-invocation.tsx`
   - `get_location`: Uses browser Geolocation API
   - `change_bgm`: Returns success response (TODO: AudioContext implementation)
   - Both approval + result sent in single request via AI SDK v6

5. **Test Coverage with AI Non-Determinism Handling**
   - All 6 SSE E2E tests passing (100% success rate)
   - Strict event count validation: exactly 9 (with text) or 6 (without text)
   - Handles Gemini 2.0 Flash non-deterministic text generation

**Files Modified**:
- `docs/adr/0008-sse-mode-pattern-a-only-for-frontend-tools.md` (NEW)
- `adk_stream_protocol/frontend_tool_service.py` (pre-resolution cache)
- `adk_stream_protocol/adk_ag_tools.py` (mode detection)
- `components/tool-invocation.tsx` (frontend execution)
- `tests/e2e/backend_fixture/test_change_bgm_sse_baseline.py`
- `tests/e2e/backend_fixture/test_get_weather_sse_baseline.py`

**Test Results**:
- ✅ `test_change_bgm_sse_baseline` - PASSED
- ✅ `test_get_location_approved_sse_baseline` - PASSED
- ✅ `test_get_location_denied_sse_baseline` - PASSED
- ✅ `test_get_weather_sse_baseline` - PASSED
- ✅ `test_process_payment_approved_sse_baseline` - PASSED
- ✅ `test_process_payment_denied_sse_baseline` - PASSED

**Branch**: `hironow/fix-confirm`

---

### Minimal Integration Test for Deferred Approval Flow (Phase 10)

**Completed**: 2025-12-27 20:30 JST

**Summary**: Created minimal integration test to verify deferred approval pattern in BIDI mode with ADK's `run_live()` and `LiveRequestQueue.send_content()`.

**Test Architecture**:

1. **Minimal Test Agent**
   - Created dedicated `test_agent` with single tool for isolation
   - `test_approval_tool`: Returns pending status to signal approval requirement
   - Wrapped with `LongRunningFunctionTool` (ADK pattern)
   - Avoids interference from production tools (process_payment, get_location)

2. **ApprovalQueue Class**
   - Queue-based approval mechanism supporting concurrent approvals
   - Methods: `request_approval()`, `submit_approval()`, `wait_for_approval()`
   - Detailed logging with ✓/✗ symbols for execution order visibility

3. **Deferred Execution Pattern**
   - `deferred_tool_execution()` runs in separate async task (non-blocking)
   - Waits for approval without blocking `run_live()` event loop
   - Executes tool logic if approved, rejection message if denied
   - Sends final result via `LiveRequestQueue.send_content()`

4. **Test Cases**
   - Approval flow: Simulates 2-second delay → approval → execution
   - Rejection flow: Simulates 2-second delay → denial → rejection message

**Test Results**:
- ✅ `test_deferred_approval_flow_approved` - PASSED (57 events)
- ✅ `test_deferred_approval_flow_rejected` - PASSED (59 events)

**Verified Behaviors**:
1. ✅ Tool returns pending status, ADK generates FunctionResponse
2. ✅ `deferred_tool_execution` runs without blocking event loop
3. ✅ Approval/denial correctly triggers execution or rejection
4. ✅ Final result sent via `send_content()` reaches ADK
5. ✅ turn_complete event received after deferred execution

**Known Limitation**:
- LLM continues referencing "pending" status in final events
- Final result sent successfully but not used by LLM for updated response
- Aligns with Phase 9 findings: Live API architectural limitation
- Same tool_call_id cannot effectively receive multiple FunctionResponses

**Files Modified**:
- `tests/integration/test_deferred_approval_flow.py` (NEW)
- `agents/my-understanding.md` (Phase 10 documentation)

**Branch**: `hironow/fix-confirm`

---

## ✅ Previously Completed (2025-12-25)

### Fixture Consolidation & SSE Confirmation Flow

- **Completed**: Test fixture reorganization to root-level `fixtures/` directory
- **Completed**: MSW helper consolidation (`setupMswServer()`)
- **Completed**: SSE confirmation flow implementation matching BIDI pattern
- **Completed**: All quality checks passing (format, lint, typecheck, semgrep)
- **Completed**: Removed redundant SSE confirmation integration tests (covered by frontend E2E)
- **Completed**: Cleaned up agents/ directory (removed 6 obsolete files)
- **Result**:
  - Backend: 391 passed, 6 skipped (fixture recording pending)
  - Frontend: 458 passed, 0 skipped
- **Commit**: `084d553` "refactor: consolidate test fixtures and implement SSE confirmation flow"

---

## 📝 Notes

### Test Skip Policy

- **Intentional Skips**: Acceptable for fixture recording pending
- **Temporary Skips**: Should have GitHub issues or task tracking
- **Document**: All skips must have clear skip reasons in test decorators
- **Redundant Tests**: Remove if fully covered by other test suites (e.g., frontend E2E)
