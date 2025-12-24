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

## ✅ Recently Completed (2025-12-25)

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
