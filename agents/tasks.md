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

### 🟡 BIDI Tool Confirmation - LongRunningFunctionTool Implementation
**Status:** 🟡 **PLANNING** - Implementation plan created, POC needed
**Priority:** High
**Description:** Implement BIDI mode tool confirmation using ADK's LongRunningFunctionTool pattern

**Background:**
- ✅ Root cause identified: Current approach (sendAutomaticallyWhen) incompatible with ADK continuous event stream
- ✅ Alternative selected: **Option A - LongRunningFunctionTool**
- ✅ SSE mode confirmed working (no regression)
- ✅ Comprehensive implementation plan created

**Implementation Plan:**
- Document: [experiments/2025-12-18_bidi_longrunning_tool_plan.md](../experiments/2025-12-18_bidi_longrunning_tool_plan.md)
- Key Approach: Explicit agent pause/resume cycle with `status: 'pending'` pattern
- Architecture: Wrapper tool (`process_payment_approval`) → User approval → Actual tool (`process_payment`)

**Next Steps:**
1. **POC (Critical)**: Test LongRunningFunctionTool with BIDI Live API
   - Verify pause/resume works in WebSocket mode
   - Check connection stays open during pause
   - **GO/NO-GO Decision Point**
2. **If GO**: Follow 4-phase implementation (8-12 hours estimate)
3. **If NO-GO**: Document as architectural limitation, accept SSE-only support

**Risks:**
- Live API pause/resume support unknown (needs POC verification)
- WebSocket connection timeout during pause
- Duplicate tool execution on resume
- LLM instruction complexity for multi-step workflow

**Success Criteria:**
- BIDI approval UI displays for pending payments
- User can approve/deny via WebSocket
- Agent resumes after approval decision
- Actual payment executes only after approval

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
