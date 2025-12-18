# Primary Source Research: Live API + LongRunningFunctionTool Compatibility

**Date:** 2025-12-18
**Research Objective:** Determine if ADK's Live API (BIDI mode) supports LongRunningFunctionTool pause/resume for human-in-the-loop workflows
**Status:** 🟡 **INVESTIGATION COMPLETE - INCONCLUSIVE**

---

## Executive Summary

After comprehensive investigation of ADK Python primary sources (GitHub issues, PRs, documentation, release notes, and source code), **no explicit confirmation or denial** of Live API + LongRunningFunctionTool compatibility was found.

### Key Finding

**The absence of evidence is itself significant evidence:**
- No official documentation mentions Live API compatibility with LongRunningFunctionTool
- No test coverage combining these features
- No working examples in samples/
- Tool Confirmation docs explicitly silent on BIDI/Live API support
- Multiple issues about BIDI tool execution problems exist

### Recommendation

**POC (Proof of Concept) is MANDATORY** before committing to 8-12 hour implementation:
1. Create minimal LongRunningFunctionTool test with Live API
2. Verify pending status handling in WebSocket stream
3. Test function_response injection via WebSocket
4. Measure connection timeout behavior during pause

---

## Primary Sources Investigated

### 1. GitHub Issues

#### Issue #1851: "How to achieve proper human in the loop approval with long running function calls?"
- **URL:** https://github.com/google/adk-python/issues/1851
- **Status:** CLOSED as COMPLETED
- **Solution:** ADK team referenced "Tool Confirmation" feature (require_confirmation=True)
- **Critical Limitation:** "Tool Confirmation lacks support for Vertex AI session service and Database session service"
- **Live API Mention:** ❌ None

**Significance:** Official HITL solution explicitly excludes certain session services. Live API compatibility not mentioned.

---

#### Issue #1768: "Support tool callback for live(bidi)"
- **URL:** https://github.com/google/adk-python/issues/1768
- **Status:** CLOSED as COMPLETED (Oct 24, 2025)
- **Resolution:** "Supported now" via PR #1769 and PR #1774
- **Quotes:**
  - "Streaming(bidi/live) handling is going through a diff code path. So callbacks is not implemented for live/bidi."
  - Tool callbacks should be prioritized (easier than other callback types)

**Significance:** ✅ Tool callbacks NOW work in live/bidi mode (as of Oct 2025). This is positive for Option A feasibility.

---

#### Issue #1897: "Callbacks not getting executed with ADK Bidi-streaming [Audio to Audio conversation]"
- **URL:** https://github.com/google/adk-python/issues/1897
- **Status:** CLOSED as COMPLETED (Nov 8, 2025)
- **Problem:** before_agent/after_agent/before_model/after_model callbacks don't work in audio-to-audio
- **ADK Team Response:** "We only support before/after_tool_callback. For the other two, it's not supported yet."

**Significance:** Tool-level callbacks confirmed working. Agent-level callbacks still unsupported in BIDI.

---

#### Issue #3184: "Human in the loop within custom agent and SequentialAgent workflow does not pause execution"
- **URL:** https://github.com/google/adk-python/issues/3184
- **Status:** COMPLETED
- **Problem:** Custom agent with overridden `_run_async_impl` doesn't pause when sub-agent enters PAUSED state
- **Resolution:** PR #3224 introduced "backend blocking poll pattern" as alternative
- **Key Learning:** Backend blocking poll pattern allows "the parent agent to wait naturally" without resumability_config

**Significance:** Alternative HITL pattern exists (blocking poll) that doesn't require pause/resume cycle.

---

### 2. GitHub Discussions

#### Discussion #2739: "Issues with multiple consecutive Long Running Function Tools with HITL"
- **URL:** https://github.com/google/adk-python/discussions/2739
- **Problem:** Multiple chained LongRunningFunctionTool calls cause agent to get stuck
- **Root Cause:** "Missing client-side logic to handle pending states and resume"
- **Solution:**
  - State management via `EventActions.state_delta`
  - Use `InMemorySessionService` for state persistence
  - Implement dedicated endpoints for A2A state management
- **Limitation:** "Tool callbacks don't trigger after long-running tool responses"

**Significance:** LongRunningFunctionTool requires complex state management for multiple consecutive calls. Live API mention: ❌ None.

---

### 3. Official Documentation

#### Tool Confirmation Documentation
- **URL:** https://google.github.io/adk-docs/tools-custom/confirmation/
- **Availability:** ADK Python v1.14.0+
- **Status:** Experimental

**Supported Backends:**
- ✅ SSE (Server-Sent Events)
- ❌ DatabaseSessionService
- ❌ VertexAiSessionService

**Live API / BIDI Compatibility:**
- ❌ **No mention** in documentation

**Implementation:**
```python
# Boolean confirmation
FunctionTool(reimburse, require_confirmation=True)

# Dynamic confirmation with callable
def should_confirm_reimburse(amount: float) -> bool:
    return amount > 1000

FunctionTool(reimburse, require_confirmation=should_confirm_reimburse)

# Advanced with ToolContext
def reimburse(amount: float, tool_context: ToolContext):
    result = tool_context.request_confirmation(
        hint="Approve reimbursement?",
        payload={"amount": amount}
    )
```

**Significance:** Official confirmation mechanism silent on Live API. Explicit session service limitations suggest architectural constraints.

---

### 4. Code Samples

#### human_in_loop Sample
- **Location:** `contributing/samples/human_in_loop/`
- **Files:** README.md, agent.py, main.py, __init__.py

**Implementation Pattern:**
```python
# 1. Tool returns pending status
def _ask_for_approval_impl(task_description: str) -> dict[str, Any]:
    approval_id = f"approval-{uuid.uuid4().hex[:8]}"
    return {
        'status': 'pending',
        'approval_id': approval_id,
        'task': task_description
    }

ask_for_approval = LongRunningFunctionTool(func=_ask_for_approval_impl)

# 2. Agent naturally pauses after initial turn
async for event in runner.run_async(...):
    if event.long_running_tool_ids:
        long_running_function_call = extract_function_call(event)

# 3. External system simulates approval (minutes/hours/days later)
updated_response = types.FunctionResponse(
    id=long_running_function_call.id,
    name=long_running_function_call.name,
    response={"status": "approved"}  # or "denied"
)

# 4. Resume agent with updated response
async for event in runner.run_async(
    session_id=session.id,
    user_id=USER_ID,
    new_message=types.Content(
        parts=[types.Part(function_response=updated_response)],
        role='user'
    )
):
    # Agent continues execution
```

**Streaming Compatibility:**
- Uses `async for` iteration throughout (streaming-capable)
- Session-based architecture supports continuous dialog

**Live API Mention:** ❌ None. Sample doesn't specify mode compatibility.

**Significance:** Pattern is theoretically streaming-compatible, but no Live API testing evidence.

---

### 5. Pull Requests

#### PR #3224: "Backend blocking poll pattern for HITL workflows"
- **Status:** MERGED
- **Alternative Approach:** Internal polling instead of pause/resume

**Architectural Difference:**
- **LongRunningFunctionTool (Resumable):**
  1. Tool returns `{'status': 'pending'}`
  2. Agent pauses
  3. Client sends FunctionResponse later
  4. Agent resumes

- **Blocking Poll Pattern:**
  1. Tool "holds" until receiving final decision
  2. Agent waits automatically
  3. No manual 'continue' clicks needed
  4. Returns directly when ready

**Production Impact:**
- 93% reduction in LLM API calls vs agent-level polling
- Reduced manual interactions from "20+ 'continue' clicks" to zero
- Successfully handled 10-minute average approval durations

**When to Use Each:**
- **Blocking Poll:** Simple approvals, <10 min completion, poll-only systems (Jira, ServiceNow)
- **LongRunningFunctionTool:** Webhook-capable systems, progress updates, multi-step workflows, extended periods

**Significance:** Alternative pattern exists that avoids pause/resume complexity. May be more compatible with Live API.

---

### 6. Release Notes

#### Release v1.19.0 (Key Points)
- ✅ "Update conformance test CLI to handle long-running tool calls"
- ✅ "Updated Gemini Live model names in live bidi streaming sample"
- ✅ "Improved handling of partial and complete transcriptions in live calls"
- Bug fix: "Safely handle FunctionDeclaration without required attribute"

**Significance:** Conformance tests now cover long-running tools. Live API improvements ongoing but no explicit combination mentioned.

---

#### Release v1.20.0 (Key Points)
- ✅ "Support streaming function call arguments in progressive SSE streaming"
- ✅ **Critical:** "Fixes double response processing issue in base_llm_flow.py where, in Bidi-streaming (live) mode, the multi-agent structure causes duplicated responses after tool calling"

**Significance:** Tool calling in BIDI mode had bugs as recently as v1.20.0. This suggests ongoing maturity issues with BIDI + tools.

---

### 7. Source Code Investigation

#### gemini_llm_connection.py
- **Location:** `src/google/adk/models/gemini_llm_connection.py`
- **Finding:** No `_call_live` method found
- **Tool Handling:**
  - `send_content()`: Validates function_response parts
  - `receive()`: Detects tool invocations and yields LlmResponse
  - **No special handling for pending status or paused states visible**

**Significance:** Live API implementation details not accessible through this file. Mechanism for handling LongRunningFunctionTool in Live API unclear.

---

## Critical Evidence Gaps

### What We DON'T Have

1. **No Live API + LongRunningFunctionTool Examples**
   - No samples combining these features
   - No tests in ADK test suite
   - No working code snippets in discussions

2. **No Explicit Documentation**
   - Tool Confirmation docs silent on Live API
   - LongRunningFunctionTool docs don't mention streaming modes
   - Live API docs don't mention long-running tools

3. **No Source Code Confirmation**
   - `_call_live()` method not found/analyzed
   - Pending status handling in Live API unclear
   - WebSocket function_response injection path unknown

4. **No Success Stories**
   - No GitHub issues reporting "LongRunningFunctionTool works with Live API"
   - No community discussions sharing working implementations
   - No ADK team statements confirming compatibility

### What This Means

**The absence of evidence is evidence itself:**

In a mature, well-documented framework, we would expect:
- ✅ Official documentation covering feature combinations
- ✅ Sample code demonstrating best practices
- ✅ Test coverage validating behavior
- ✅ Community discussions sharing experiences

**The fact that NONE of these exist suggests:**
- Either the combination is untested/unsupported
- Or it's a known limitation that hasn't been explicitly documented

---

## Positive Signals (Reasons for Optimism)

1. **Tool Callbacks Now Supported in Live/BIDI** (Issue #1768, Oct 2025)
   - Shows ADK team actively improving Live API tool support
   - before_tool_callback and after_tool_callback confirmed working

2. **Conformance Test CLI for Long-Running Tools** (v1.19.0)
   - Framework has testing infrastructure for long-running tools
   - Suggests ongoing investment in this feature

3. **human_in_loop Sample Uses Async Iteration**
   - Streaming-compatible architecture
   - Session-based design supports continuous dialog

4. **v1.20.0 Fixed Tool Calling Bug in BIDI**
   - Shows ADK team fixing BIDI + tools issues
   - Tool execution in BIDI improving over time

5. **Backend Blocking Poll Pattern Exists**
   - Alternative HITL approach that may be more Live API-compatible
   - Already proven in production (93% API reduction, 10-min waits)

---

## Negative Signals (Risk Factors)

1. **Tool Confirmation Explicitly Excludes Session Services**
   - DatabaseSessionService: ❌ Not supported
   - VertexAiSessionService: ❌ Not supported
   - Live API session handling: ❓ Unknown

2. **Multiple BIDI Tool Execution Issues**
   - v1.20.0 fixed double response processing bug
   - Discussion #2739 reports multiple consecutive long-running tools get stuck
   - Issue #1897 showed callback limitations in BIDI

3. **No _call_live Source Code Analysis**
   - Can't verify pending status handling
   - Can't confirm WebSocket connection stays open during pause
   - Can't see function_response injection mechanism

4. **Tool Confirmation Docs Silent on BIDI**
   - If it worked, docs would likely mention it
   - Silence suggests either untested or known limitation

5. **Complex State Management Required**
   - Discussion #2739 requires EventActions.state_delta
   - InMemorySessionService needed for multiple calls
   - Dedicated A2A endpoints for state management
   - This complexity may not be Live API-compatible

---

## Technical Analysis: Theoretical Compatibility

### Why It MIGHT Work

**Architecture Alignment:**
```
LongRunningFunctionTool Pattern:
1. Tool invoked → returns {'status': 'pending', 'approval_id': '...'}
2. Agent processes pending status → emits event
3. Agent awaits function_response
4. Client sends function_response via Content(parts=[...], role='user')
5. Agent resumes

Live API WebSocket:
1. Bidirectional streaming channel always open
2. Client can send messages at any time
3. Server can emit events continuously
4. Tool calls and responses both flow over WebSocket
```

**Theoretical Flow:**
```
Frontend                  Backend (Live API)              ADK Agent
   |                            |                             |
   | --- User: "Pay $500" ----> |                             |
   |                            | --- Generate (streaming) -> |
   |                            |                             | Tool: process_payment_approval
   |                            |                             | Returns: {status: 'pending', id: 'xyz'}
   |                            | <-- Tool result ----------- |
   | <-- Tool: pending -------- |                             |
   | [UI shows approval button] |                             | [Waiting for function_response]
   |                            |                             |
   | --- Approve button ------> |                             |
   |  {type: 'resume_agent',    |                             |
   |   function_response: {...}}|                             |
   |                            | --- Content(parts=[...]) -> |
   |                            |                             | Receives function_response
   |                            |                             | Resumes execution
   |                            | <-- Generate (continues) -- |
   | <-- AI response ---------- |                             |
```

**Key Assumption:** Live API treats function_response in Content message same as non-Live API.

---

### Why It MIGHT NOT Work

**Architecture Mismatch:**

**Our Current BIDI Problem:**
```
inject_confirmation_for_bidi() (adk_compat.py:368-372)
   |
   | yield "data: [DONE]\n\n"  # Try to close stream
   |
   | await interceptor.execute_confirmation(...)  # BLOCKS HERE
   |
   | But ADK continues:
   | - reasoning-start
   | - reasoning-delta
   | - ... (stream reopens)
```

**LongRunningFunctionTool with Live API might have similar issue:**
```
LongRunningFunctionTool returns pending
   |
   | ADK processes pending status
   | ADK emits event with long_running_tool_ids
   |
   | Now what?
   | - Does ADK stop generating events?
   | - Or does it continue sending reasoning/thinking events?
   | - Does Live API WebSocket support "pause" state?
   | - How does it know to wait for function_response?
```

**Critical Unknown:** Does ADK + Live API have explicit PAUSED state that stops event generation?

**Without PAUSED state:**
- Live API might continue sending events during wait
- Frontend status="streaming" never becomes "awaiting-message"
- sendAutomaticallyWhen remains blocked
- Same deadlock as current approach

**With PAUSED state:**
- Live API stops generating events
- Frontend status becomes stable (not "streaming")
- Client can send function_response
- Agent resumes → this would work

**We don't know which scenario is true.**

---

## Comparison: Three HITL Approaches

### Approach 1: Tool Confirmation (require_confirmation=True)
**Current Status:**
- ✅ Works in SSE mode
- ❌ Doesn't work in BIDI mode (our investigation confirmed)
- ❌ Explicitly unsupported: DatabaseSessionService, VertexAiSessionService

**Advantages:**
- Native ADK feature
- Simple to use
- No custom code required

**Disadvantages:**
- BIDI incompatibility confirmed by our testing
- Session service limitations

---

### Approach 2: LongRunningFunctionTool (Option A - Current Plan)
**Current Status:**
- ✅ Works in non-streaming mode (confirmed by human_in_loop sample)
- ❓ Live API compatibility UNKNOWN

**Advantages:**
- Designed for HITL workflows
- Explicit pause/resume cycle
- Well-documented pattern

**Disadvantages:**
- Requires complex state management for multiple calls
- No Live API testing evidence
- POC mandatory to verify feasibility

**Implementation Effort:** 8-12 hours (if POC succeeds)

---

### Approach 3: Backend Blocking Poll Pattern (PR #3224)
**Current Status:**
- ✅ Production-proven (93% API reduction, 10-min waits)
- ✅ Handles long approval durations
- ❓ Live API compatibility UNKNOWN (but likely better than Approach 2)

**Advantages:**
- No pause/resume complexity
- Agent waits automatically
- Zero manual interactions
- Simpler architecture than LongRunningFunctionTool

**Disadvantages:**
- Requires custom tool implementation
- Polling-based (not webhook-driven)
- May not be suitable for very long waits (hours/days)

**Implementation Effort:** Unknown (PR code needs review)

---

## POC (Proof of Concept) Requirements

**Before committing to any implementation, we MUST test:**

### POC Test 1: Basic Pending Status
```python
# Create minimal long-running tool
def _approval_test(amount: float) -> dict[str, Any]:
    return {'status': 'pending', 'approval_id': 'test-123'}

approval_tool = LongRunningFunctionTool(func=_approval_test)

# BIDI agent with long-running tool
bidi_agent = Agent(
    name="poc_test_agent",
    model=bidi_model,
    tools=[approval_tool]
)

# Run in BIDI mode and observe:
# 1. Does ADK emit long_running_tool_ids event?
# 2. Does Live API stop generating events after pending?
# 3. Does WebSocket connection stay open?
# 4. Can we inject function_response via WebSocket?
```

### POC Test 2: Function Response Injection
```python
# After receiving pending status, send function_response
function_response = types.FunctionResponse(
    id='test-123',
    name='approval_test',
    response={'status': 'approved'}
)

# Inject via WebSocket message
websocket.send(json.dumps({
    'type': 'resume_agent',  # or whatever message format Live API expects
    'content': {
        'parts': [{'function_response': function_response}],
        'role': 'user'
    }
}))

# Observe:
# 1. Does agent resume execution?
# 2. Does it receive the function_response?
# 3. Does it continue generating output?
```

### POC Test 3: Connection Timeout
```python
# Return pending status and wait 2 minutes
# Observe:
# 1. Does WebSocket connection timeout?
# 2. Does Live API send keep-alive messages?
# 3. Can we still inject function_response after delay?
```

### Success Criteria
- ✅ Agent emits long_running_tool_ids event in BIDI
- ✅ Live API stops generating events after pending (not continuous reasoning)
- ✅ WebSocket connection stays open during wait
- ✅ function_response injection succeeds via WebSocket
- ✅ Agent resumes and continues execution
- ✅ No timeout errors during 2-minute wait

### Failure Criteria
- ❌ Live API continues generating events after pending (same as current problem)
- ❌ WebSocket connection times out
- ❌ function_response injection fails
- ❌ Agent doesn't recognize function_response
- ❌ Status stays "streaming" forever

---

## Recommendations

### Immediate Next Step: POC

**DO NOT proceed with 8-12 hour implementation without POC.**

**POC Phases:**
1. **Phase 1 (30 min):** Create minimal LongRunningFunctionTool with BIDI agent
2. **Phase 2 (30 min):** Test pending status handling and event stream behavior
3. **Phase 3 (30 min):** Test function_response injection via WebSocket
4. **Phase 4 (30 min):** Test connection timeout and keep-alive behavior

**Total POC Time:** 2 hours

**GO/NO-GO Decision:**
- If all success criteria met → Proceed with full implementation (8-12 hours)
- If any failure criteria met → Stop and pivot to alternative

---

### Alternative If POC Fails

**Option B-Revised: Accept SSE-Only Support**
- Document BIDI limitation clearly
- Disable BIDI confirmation features in UI
- Focus on improving SSE experience

**Option C: Backend Blocking Poll Pattern**
- Investigate PR #3224 implementation
- Test with Live API
- May be more compatible than pause/resume

**Option D: Hybrid Approach**
- SSE mode: Use Tool Confirmation (require_confirmation=True)
- BIDI mode: Use different approval mechanism (e.g., separate HTTP endpoint)
- Accept that BIDI can't do inline confirmation

---

## Conclusion

### What We Know (High Confidence)

1. ✅ LongRunningFunctionTool exists and works in non-streaming mode
2. ✅ Tool callbacks now supported in Live/BIDI mode (Oct 2025)
3. ✅ human_in_loop sample shows pause/resume pattern
4. ✅ Tool Confirmation doesn't support certain session services
5. ✅ BIDI + tools had bugs as recently as v1.20.0
6. ✅ Backend blocking poll pattern exists as alternative
7. ✅ SSE mode confirmation works perfectly (no regression)

### What We Don't Know (Must Test)

1. ❓ Does Live API support pending status with event stream pause?
2. ❓ Can function_response be injected via WebSocket during pause?
3. ❓ Does WebSocket connection stay open during long waits?
4. ❓ Does Live API continue generating events during pending (like our current problem)?
5. ❓ Is backend blocking poll pattern more Live API-compatible?

### Strategic Recommendation

**Execute POC before committing to implementation.**

The 2-hour POC investment will save potentially 8-12 hours of wasted implementation effort if Live API doesn't support the pause/resume pattern.

**Risk Level:** 🟡 MEDIUM-HIGH
- Positive signals exist (tool callbacks working, conformance tests, async pattern)
- But absence of documentation/examples is concerning
- Recent bugs in BIDI + tools suggest ongoing maturity issues

**Expected POC Outcome:** 60% chance of success, 40% chance of architectural limitation

**If POC succeeds:** Full implementation justified (8-12 hours well spent)
**If POC fails:** Pivot to Option B (SSE-only) or Option C (blocking poll) immediately

---

## References

### GitHub Issues
- #1851: How to achieve proper human in the loop approval
- #1768: Support tool callback for live(bidi) ✅ COMPLETED
- #1897: Callbacks not getting executed with ADK Bidi-streaming
- #3184: Human in the loop within custom agent doesn't pause

### GitHub Discussions
- #2739: Issues with multiple consecutive Long Running Function Tools with HITL

### Pull Requests
- #3224: Backend blocking poll pattern for HITL workflows
- #1769, #1774: Tool callback support in live mode

### Documentation
- https://google.github.io/adk-docs/tools-custom/confirmation/
- https://google.github.io/adk-docs/callbacks/
- https://github.com/google/adk-python/tree/main/contributing/samples/human_in_loop

### Release Notes
- v1.19.0: Conformance test CLI for long-running tools
- v1.20.0: Fixed double response processing in BIDI tool calling

### Source Code
- gemini_llm_connection.py: Live API connection (no _call_live found)
- contributing/samples/human_in_loop/main.py: HITL pattern example
