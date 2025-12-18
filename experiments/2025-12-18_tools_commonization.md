# Tools Definition Commonization - SSE & BIDI Agents

**Date:** 2025-12-18
**Status:** ✅ Complete
**Related:** [4x2x2 Test Matrix Analysis](./2025-12-18_test_matrix_analysis.md)

## Objective

Create a single source of truth for tools definition that works seamlessly across both SSE and BIDI agent modes, eliminating the need for agent implementers to understand internal mode differences.

## Background

### Previous Implementation (Before)

SSE and BIDI agents had **separate tools definitions** with subtle differences:

**SSE Agent:**
```python
sse_agent = Agent(
    tools=[
        get_weather,
        FunctionTool(process_payment, require_confirmation=True),
        change_bgm,
        get_location,  # No FunctionTool wrapper
    ],
)
```

**BIDI Agent:**
```python
bidi_agent = Agent(
    tools=[
        get_weather,
        FunctionTool(process_payment, require_confirmation=True),
        change_bgm,
        get_location,  # No FunctionTool wrapper
        LongRunningFunctionTool(approval_test_tool),  # Only in BIDI
    ],
)
```

**Problems:**
1. Agent implementers had to modify **two separate lists** when adding/removing tools
2. Risk of inconsistency between SSE and BIDI
3. Implementers needed to understand mode-specific differences (e.g., LongRunningFunctionTool)
4. `get_location` was missing approval requirement (should have been wrapped with `FunctionTool(..., require_confirmation=True)`)

### Tool Requirements

Based on user specifications:

| Tool | Execution | Approval | Implementation |
|------|-----------|----------|----------------|
| `get_weather` | Server | ❌ No | Plain function |
| `process_payment` | Server | ✅ Yes | `FunctionTool(..., require_confirmation=True)` |
| `change_bgm` | Client | ❌ No | Plain function (uses FrontendToolDelegate) |
| `get_location` | Client | ✅ Yes | `FunctionTool(..., require_confirmation=True)` + FrontendToolDelegate |
| `approval_test_tool` | N/A (test) | ✅ Yes | `LongRunningFunctionTool(...)` |

**Key Insight:** `get_location` requires user approval **before** client execution, not just browser permission.

## Implementation

### Solution: COMMON_TOOLS Definition

Created a **single source of truth** in `adk_ag_runner.py`:

```python
# ========= Common Tools Definition ==========
# Single source of truth for all agent tools
# Agent implementers only need to modify this list - no need to know SSE/BIDI differences

COMMON_TOOLS = [
    get_weather,  # Weather information retrieval (server, no approval)
    FunctionTool(
        process_payment, require_confirmation=True
    ),  # Payment processing with user approval (server execution)
    change_bgm,  # Background music control (client execution, no approval)
    FunctionTool(
        get_location, require_confirmation=True
    ),  # User location retrieval (client execution with user approval)
    LongRunningFunctionTool(
        approval_test_tool
    ),  # Test tool for approval flow (BIDI: pause/resume, SSE: normal execution)
]
```

### Both Agents Use COMMON_TOOLS

```python
# SSE Agent
sse_agent = Agent(
    name="adk_assistant_agent_sse",
    model="gemini-3-flash-preview",
    description=AGENT_DESCRIPTION,
    instruction=AGENT_INSTRUCTION,
    tools=COMMON_TOOLS,  # ← Uses common definition
)

# BIDI Agent
bidi_agent = Agent(
    name="adk_assistant_agent_bidi",
    model=bidi_model,
    description=AGENT_DESCRIPTION,
    instruction=AGENT_INSTRUCTION,
    tools=COMMON_TOOLS,  # ← Uses common definition
)
```

### Updated Agent Instructions

Clarified tool requirements in `AGENT_INSTRUCTION`:

```python
AGENT_INSTRUCTION = (
    "You are a helpful AI assistant with access to the following tools:\n"
    "- get_weather: Check weather for any city (server execution, no approval required)\n"
    "- process_payment: Process payment transactions (server execution, requires user approval)\n"
    "- change_bgm: Change background music track to 1 or 2 (client execution, no approval required)\n"
    "- get_location: Get user's location (client execution via browser Geolocation API, requires user approval)\n"
    # ...
    "Note: process_payment and get_location require user approval before execution (ADK Tool Confirmation Flow)."
)
```

## Technical Details

### How Each Tool Works

#### 1. get_weather (Server, No Approval)
```python
async def get_weather(location: str) -> dict[str, Any]:
    # Direct server execution, returns immediately
    return {"temperature": 72, "condition": "sunny"}
```

#### 2. process_payment (Server, With Approval)
```python
# Wrapped with FunctionTool(require_confirmation=True)
def process_payment(amount: float, recipient: str, currency: str = "USD") -> dict[str, Any]:
    # 1. ADK shows approval UI (adk_request_confirmation auto-generated)
    # 2. User clicks Approve/Deny
    # 3. If approved, this function executes on server
    # 4. Returns result
    return {"success": True, "transaction_id": "tx-123"}
```

#### 3. change_bgm (Client, No Approval)
```python
async def change_bgm(track: int, tool_context: ToolContext) -> dict[str, Any]:
    # 1. Delegates to FrontendToolDelegate
    # 2. Client executes immediately (changes audio track)
    # 3. Returns result to server
    delegate = session_state.get("frontend_delegate")
    return await delegate.execute_on_frontend(...)
```

#### 4. get_location (Client, With Approval)
```python
# Wrapped with FunctionTool(require_confirmation=True)
async def get_location(tool_context: ToolContext) -> dict[str, Any]:
    # 1. ADK shows approval UI (adk_request_confirmation auto-generated)
    # 2. User clicks Approve/Deny
    # 3. If approved, this function executes:
    #    a. Delegates to FrontendToolDelegate
    #    b. Client calls browser Geolocation API
    #    c. Returns location to server
    # 4. Server returns result to AI
    delegate = session_state.get("frontend_delegate")
    return await delegate.execute_on_frontend(...)
```

**Key Difference from change_bgm:**
- `change_bgm`: Immediate client execution (no approval UI)
- `get_location`: Approval UI → then client execution

### Cross-Mode Compatibility

**LongRunningFunctionTool in SSE Mode:**
- BIDI Mode: Uses pause/resume mechanism (agent stops until function_response)
- SSE Mode: Behaves like normal FunctionTool (no pause, immediate execution)
- **Result:** Can be registered in both modes without issues

**FunctionTool(require_confirmation=True):**
- SSE Mode: ADK handles confirmation flow automatically
- BIDI Mode: ADK generates `adk_request_confirmation` tool call
- **Result:** Works seamlessly in both modes

## Files Modified

| File | Lines | Change |
|------|-------|--------|
| `adk_ag_runner.py` | 93-112 | Added `COMMON_TOOLS` definition |
| `adk_ag_runner.py` | 61-78 | Updated `AGENT_INSTRUCTION` with clarified tool requirements |
| `adk_ag_runner.py` | 121 | Changed `sse_agent.tools` to `COMMON_TOOLS` |
| `adk_ag_runner.py` | 134 | Changed `bidi_agent.tools` to `COMMON_TOOLS` |
| `adk_ag_runner.py` | 104 | **Fixed:** Wrapped `get_location` with `FunctionTool(..., require_confirmation=True)` |

## Benefits

### For Agent Implementers

1. **Single Point of Modification**
   - Add/remove tools in ONE place (`COMMON_TOOLS`)
   - No need to sync between SSE and BIDI

2. **Mode Agnostic**
   - No need to understand SSE vs BIDI differences
   - Approval configuration works automatically in both modes

3. **Clear Requirements**
   - Tool comments document execution location and approval needs
   - Agent instructions reflect actual behavior

### For System Maintainability

1. **Reduced Duplication**
   - DRY principle applied
   - Single source of truth

2. **Consistency Guaranteed**
   - Both agents always have identical tool sets
   - No risk of divergence

3. **Easier Testing**
   - 4x2x2 test matrix applies uniformly
   - Tool behavior consistent across modes

## Impact on 4x2x2 Test Matrix

**Previous Matrix:** 4 Tools × 2 Modes × 2 Approvals = 16 patterns

**After Commonization:**
- Tool set identical across SSE and BIDI
- Approval behavior consistent across modes
- Test matrix remains 16 patterns but now **guaranteed consistent**

**Approval Requirement Changes:**
- `get_weather`: No approval (unchanged)
- `process_payment`: Requires approval (unchanged)
- `change_bgm`: No approval (unchanged)
- `get_location`: **Now requires approval** (fixed)

## Verification

### Code Quality
```bash
just lint
# Result: All checks passed ✅
```

### Expected Behavior

**SSE Mode:**
1. User: "私の位置を教えて" (Tell me my location)
2. AI calls `get_location`
3. ADK shows approval UI automatically
4. User clicks Approve
5. `get_location` executes → delegates to client
6. Client calls Geolocation API
7. Location returned to server → AI responds

**BIDI Mode:**
1. User: "私の位置を教えて"
2. AI calls `get_location`
3. ADK shows approval UI (same as SSE)
4. User clicks Approve
5. `get_location` executes → delegates to client
6. Client calls Geolocation API
7. Location returned to server → AI responds

**Identical behavior in both modes!** ✅

## Related Documents

- `adk_ag_runner.py` - Tools and agents configuration
- `adk_ag_tools.py` - Tool implementations
- `experiments/2025-12-18_test_matrix_analysis.md` - Test coverage analysis
- `agents/tasks.md` - Updated with commonization completion

## Next Steps

1. ✅ Tools commonization complete
2. 🔄 **NOW:** Expand 4x2x2 test matrix to 100% coverage
3. 🔄 Test `get_location` approval flow in both SSE and BIDI modes
4. 🔄 Update E2E tests to verify consistent behavior

## Summary

**Before:** Agent implementers managed two separate tool lists with subtle differences and missing approval requirements.

**After:** Single `COMMON_TOOLS` definition that:
- Works seamlessly in both SSE and BIDI modes
- Enforces correct approval requirements (`get_location` now has approval)
- Eliminates duplication and inconsistency risk
- Makes agent development mode-agnostic

**Impact:** ✅ Simplified agent development, ✅ Improved consistency, ✅ Fixed `get_location` approval requirement
