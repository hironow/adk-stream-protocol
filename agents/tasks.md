# Agent Tasks

Current active task tracking for the ADK AI Data Protocol project.

## 📊 Current Test Status (2025-12-20 Session 10)

### Unit Tests
- ✅ **22/22 passing** (100%)
- All tests passing after removing `inject_confirmation_for_bidi`
- **Execution time**: ~2s

### Integration Tests
- ✅ **28/28 passing** (100%)
- Includes 4 RED tests for missing tool-input events bug
- **Execution time**: ~22s (includes 5s timeouts in RED tests)

### E2E Tests (Scenario-5)
- 🔴 **3/11 passing** (27%)
- **SSE Mode**: 3/6 ✅
- **BIDI Mode**: 0/5 ❌
- **Root Cause**: Missing tool-input events for original tool in confirmation flow

---

## 🔴 Active Task: Missing Tool-Input Events Bug Fix

**Status**: 🟡 **RED PHASE COMPLETE** - 4 RED tests created, ready for GREEN phase
**Priority**: CRITICAL
**Branch**: `hironow/fix-confirm`

### Problem

Both BIDI and SSE confirmation flows fail to send `tool-input-start` and `tool-input-available` events for the **original tool** before sending the tool execution result.

**E2E Test Results** (scenario-5):
```
BIDI Mode: 0/5 passing
SSE Mode: 3/6 passing
Total: 8 failed, 3 passed
```

**Frontend Error**:
```
Error: no tool invocation found for tool call function-call-9656672104687609647
```

### Root Cause

**What's Missing**:
```
Expected event sequence:
1. tool-input-start (original tool ID: function-call-123)     ← MISSING
2. tool-input-available (original tool ID: function-call-123) ← MISSING
3. tool-input-start (confirmation ID: confirmation-function-call-123)
4. tool-input-available (confirmation ID: confirmation-function-call-123)
5. tool-output-available (confirmation ID)
6. tool-output-available (original tool ID: function-call-123)

Current behavior:
- ✅ Sends confirmation UI events (lines 3-5)
- ❌ Does NOT send original tool-input events (lines 1-2)
- ✅ Sends tool execution result (line 6)
```

**Why Frontend Fails**:
- Frontend receives `tool-output-available` with `function-call-123`
- But frontend never received `tool-input-available` for `function-call-123`
- Frontend has no record of this tool call ID
- Error: "no tool invocation found"

**Affected Code**:
- `services/bidi_event_sender.py:_handle_confirmation_if_needed()`
- `services/sse_event_streamer.py:_handle_confirmation_if_needed()`

### RED Tests Created

**BIDI Mode** (`tests/integration/test_bidi_confirmation_tool_input_events.py`):
- ❌ `test_bidi_confirmation_should_send_tool_input_events_for_original_tool`
- ❌ `test_bidi_confirmation_event_sequence`

**SSE Mode** (`tests/integration/test_sse_confirmation_tool_input_events.py`):
- ❌ `test_sse_confirmation_should_send_tool_input_events_for_original_tool`
- ❌ `test_sse_confirmation_event_sequence`

**Test Results**:
```
BIDI: 2 failed in 11.10s (expected - RED tests)
SSE:  2 failed in 11.14s (expected - RED tests)
```

All RED tests properly document the missing tool-input events and fail as expected.

### Analysis of All Scenarios

Confirmed the same bug pattern across all E2E scenarios:
- ✅ Normal flow (approve)
- ✅ Denial flow (deny)
- ✅ Sequential flow (approve twice)
- ✅ Error handling
- ✅ Mixed scenarios (deny then approve)

**Common pattern in all scenarios**:
- Confirmation events sent with `confirmation-{id}` prefix
- Tool results sent with original ID
- But NO tool-input events sent for original ID

### Next Steps (GREEN Phase)

**1. Fix BIDI confirmation flow** (services/bidi_event_sender.py):
- Add `tool-input-start` and `tool-input-available` events for original tool
- Send BEFORE creating confirmation UI events

**2. Fix SSE confirmation flow** (services/sse_event_streamer.py):
- Same fix as BIDI (parallel structure)

**3. Verify all tests pass**:
- RED tests should turn GREEN (4 tests)
- E2E tests should pass (8 failed → 11 passed)

---

## 📁 Key Files

**Modified (Session 10)**:
- `stream_protocol.py` - Added `SseFormattedEvent` type alias, extracted `format_sse_event()`
- `services/bidi_event_sender.py` - Confirmation events use pre-converted SSE format strings
- `services/sse_event_streamer.py` - Confirmation events use pre-converted SSE format strings
- `adk_compat.py` - Deleted deprecated `inject_confirmation_for_bidi` function

**Deleted**:
- `tests/unit/test_inject_confirmation_for_bidi.py`
- `tests/integration/test_bidi_confirmation_function_response.py`
- `tests/integration/test_four_component_sse_bidi_integration.py`

**Created (RED Tests)**:
- `tests/integration/test_bidi_confirmation_tool_input_events.py` - NEW (205 lines)
- `tests/integration/test_sse_confirmation_tool_input_events.py` - NEW (186 lines)

**Log Directories**:
- `chunk_logs/scenario-5/frontend/` - E2E logs showing missing tool-input events
- `chunk_logs/scenario-5/backend-adk-event.jsonl` - Backend ADK events
- `chunk_logs/scenario-5/backend-sse-event.jsonl` - Backend SSE events

---

## 🎯 Completed (Session 10)

### ✅ Type-Based Conversion State Pattern
- **Added**: `SseFormattedEvent` type alias for pre-converted SSE format strings
- **Simplified**: `stream_adk_to_ai_sdk()` to use type-based distinction
- **Pattern**: `Event | SseFormattedEvent` where `str` = pre-converted, `Event` = needs conversion

### ✅ Code Reusability - format_sse_event()
- **Extracted**: Module-level `format_sse_event()` function from `StreamProtocolConverter._format_sse_event()`
- **Usage**: BidiEventSender, SseEventStreamer, StreamProtocolConverter
- **Benefit**: Prevents copy-paste bugs, ensures consistent SSE formatting

### ✅ Deprecated Code Removal
- **Deleted**: `inject_confirmation_for_bidi()` function (lines 271-554)
- **Deleted**: 3 test files related to old confirmation injection
- **Updated**: `test_adk_compat.py` to remove related tests (lines 824-1010)

### ✅ Integration Test Fixes
- **Fixed**: 6 failing tests by adding `live_request_queue` parameter
- **Result**: 28/28 integration tests passing

### ✅ RED Test Creation
- **Created**: 4 RED tests documenting missing tool-input events bug
- **Coverage**: Both BIDI and SSE modes
- **Evidence**: All RED tests fail as expected, properly documenting the bug

---

## 📝 Notes

### Architecture Improvements (Session 10)

**Type-Based Conversion State**:
- Services layer yields pre-converted SSE strings for confirmation events
- Protocol layer uses `isinstance(event, str)` to detect pre-converted events
- Type system enforces conversion state without identity checks

**Responsibility Separation**:
- Services: Generate confirmation events as SSE format strings
- Protocol: Convert ADK events, pass-through pre-converted strings
- No mixing of conversion concerns

### Test Strategy

**RED-GREEN-REFACTOR**:
1. ✅ RED: Created failing tests documenting expected behavior
2. 🟡 GREEN: Fix implementation to make tests pass (next step)
3. ⏸️ REFACTOR: Clean up if needed (after GREEN)

**Test Coverage**:
- Unit tests: Basic component behavior
- Integration tests: Multi-component interaction with mocks
- E2E tests: Full system with real browser
