# Agent Tasks

This file tracks current and future implementation tasks for the ADK AI Data Protocol project.

## ✅ Test Status (2025-12-18 After Session 5)

### Python Tests
- **Total Backend Tests:** ✅ 199/199 passing (100%)

### Frontend Tests
- **Total Frontend Tests:** ✅ 255/262 passing (97.3%)
  - 7 skipped (intentional - AudioContext init, timing-sensitive tests)

### E2E Tests
- **SSE Mode Tool Confirmation**: ✅ 1/1 passing (adk-confirmation-minimal Test 1)
- **BIDI Mode Tool Confirmation**: ❌ 0/1 passing (structurally impossible - see handsoff.md)
- **Chunk Logger Integration**: ✅ 8/8 passing (100%)

### Code Quality
- **Python Linting (ruff):** ✅ All checks pass
- **Python Type Checking (mypy):** ✅ All checks pass
- **Frontend Linting (biome):** ✅ All checks pass
- **Formatting:** ✅ All code formatted

---

## 📊 Active Tasks

### 🔴 BIDI Tool Confirmation - Decision Required
**Status:** 🔴 **BLOCKED** - Awaiting architectural decision
**Priority:** High
**Description:** BIDI mode tool confirmation proven structurally impossible with current approach

**Investigation Complete:**
- ✅ Root cause identified: ADK continuous event stream incompatible with sendAutomaticallyWhen
- ✅ Alternative investigated: LongRunningFunctionTool (requires major refactoring)
- ✅ SSE mode confirmed working (no regression)

**Options:**
1. **Option B (Recommended)**: Accept SSE-only limitation
   - Document in code and user docs
   - Disable BIDI confirmation in UI
   - Continue with other improvements
2. **Option A**: LongRunningFunctionTool architecture (major refactor)
3. **Option C**: Separate WebSocket channel (high complexity)

**Next Step:** User decision on approach

---

## 🎯 Future Tasks (Low Priority)

### 🟡 AI Response Text Investigation
**Status:** 🟡 **DEFERRED**
**Priority:** Medium
**Description:** AI response text not appearing after confirmation in some tests

**Symptoms:**
- "Thinking..." disappears correctly
- Tool state stuck in "Executing..." (not "output-available")
- Affects 4 tests in adk-tool-confirmation

**Estimated Effort:** 30-60 minutes of backend/SSE log analysis

### 🟡 E2E Coverage Expansion
**Status:** 🟡 **OPTIONAL**
**Priority:** Low
**Description:** Add coverage for underrepresented patterns

**Gaps:**
- get_location tests (SSE Deny, BIDI modes)
- get_weather tests (both modes)
- Chunk logger for change_bgm and get_location

---

## 📁 Key Documents

**Current Work:**
- `agents/handsoff.md` - Session 5 investigation results
- `confirmation_interceptor.py` - BIDI interceptor (limited)
- `adk_compat.py:368-372` - Early [DONE] attempt

**Historical:**
- `BUG-ADK-BIDI-TOOL-CONFIRMATION.md` - Original BIDI limitation
- `agents/chunk_logger_e2e_design_plan.md` - Chunk logger improvements
