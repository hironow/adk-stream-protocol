# Agent Tasks

This file tracks current and future implementation tasks for the ADK AI Data Protocol project.

## ✅ Test Status (2025-12-16 Evening Update)

### Python Tests
- **Total Backend Tests:** ✅ 27/27 passing (100%)

### Frontend Tests
- **Total Frontend Tests:** ⚠️ 201/220 passing (91.4%)
- **Failures:** 19 tests in `lib/use-chat-integration.test.tsx` (tool approval auto-submit logic)

### Code Quality
- **Python Linting (ruff):** ✅ All checks pass
- **Python Type Checking (mypy):** ✅ All checks pass
- **Frontend Linting (biome):** ✅ All checks pass
- **Formatting:** ✅ All code formatted

---

## 📊 Active Tasks

### Frontend Test Failures Investigation
**Status:** Not Started
**Priority:** High
**Description:** 19 failing tests in `lib/use-chat-integration.test.tsx` related to tool approval auto-submit logic
- All failures expect `sendMessages` to be called but it's not triggering
- May require review of `buildUseChatOptions` and `sendAutomaticallyWhen` configuration

### BIDI Mode History Persistence (E2E)
**Status:** Blocked
**Priority:** Medium
**Description:** BIDI mode E2E tests (0/3 passing) - conversation history persists across test runs
- SSE mode does NOT have this issue
- BIDI-specific state management investigation needed

---

## 📋 Planned Tasks

### [P4-T4] Multimodal Integration Testing
**Status:** Partial (T4.1-T4.3 Complete, T4.4 Pending)
**Priority:** Medium
**Description:** Comprehensive testing strategy for ADK multimodal features
- ✅ T4.1: E2E Chunk Fixture Recording - Complete (4 patterns recorded)
- ✅ T4.2: Field Coverage Test Updates - Complete
- ✅ T4.3: Integration Test TODO Comments - Complete
- ⏳ T4.4: Systematic Model/Mode Testing - Partial (10/22 tests passing, BUG-006 found)
**Related:** `experiments/2025-12-15_systematic_model_mode_testing.md`

---

## 📋 Completed Tasks (Recent)

### ✅ Linting and Type Checking Compliance (2025-12-16)
- Fixed all Python and TypeScript linting errors
- Resolved all mypy type checking errors
- Python tests: 27/27 passing
- See `agents/add_tests.md` for detailed problem resolution

### ✅ E2E Test Simplification (2025-12-16)
- Created helper functions (67% code reduction)
- SSE mode tests: 3/3 passing
- BIDI mode tests: 0/3 failing (history persistence issue)

### ✅ Manual Send Tool Approval (2025-12-16)
- Implemented workaround for AI SDK v6 bug
- Tool approval flow working in all modes

---

## 📂 Documentation
- `agents/add_tests.md` - Detailed test problem resolution log
- `agents/handsoff.md` - Session summary and handoff notes
- `experiments/README.md` - Experiment tracking
