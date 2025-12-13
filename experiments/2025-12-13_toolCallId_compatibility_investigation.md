# toolCallId Compatibility Investigation

**Date:** 2025-12-13
**Status:** ✅ Investigation Complete - ADK ID Should Be Used

---

## Executive Summary

**Finding:** ADK's `function_call.id` is **fully compatible** with AI SDK v6's `toolCallId` and should be used directly instead of generating custom IDs.

**Impact:** Current stream_protocol.py implementation unnecessarily generates custom IDs, which can cause issues with multiple calls to the same tool.

---

## Investigation Results

### 1. ADK `function_call.id` Specification

**Source:** [Google ADK Documentation](https://google.github.io/adk-docs/)

**Field Definition:**
```python
class FunctionCall(_common.BaseModel):
    id: Optional[str] = Field(
        default=None,
        description="""The unique id of the function call. If populated, the client to execute the
        `function_call` and return the response with the matching `id`.""",
    )
```

**Format:**
- **Prefix:** `adk-`
- **UUID:** Standard UUID v4 format
- **Complete format:** `adk-{UUID}`
- **Example:** `adk-2b9230a6-4b92-4a1b-9a65-b708ff6c68b6`

**Availability:** Optional (can be None)

**Purpose:**
- Unique identifier for tracking tool invocations
- Correlating tool calls with their responses
- Useful when multiple tools are called in a single response

### 2. AI SDK v6 `toolCallId` Specification

**Source:** [AI SDK v6 Documentation](https://ai-sdk.dev/)

**Format Requirements:** **NONE** (no strict specification found)

**Observed Examples:**
- `call_fJdQDqnXeGxTmr4E3YPSR7Ar` (from official documentation)
- `call_5e4a50a2-0b51-451d-954d-962bdae2388d` (from GitHub discussion)
- `tool-123` (from Python implementation)
- `call-1`, `call-2`, `call-456` (from our frontend tests)

**Purpose:**
- Correlate tool results back to their calls
- Essential for streaming scenarios
- No regex pattern, required prefix, or length constraints documented

### 3. Compatibility Analysis

| Aspect | ADK | AI SDK v6 | Compatible? |
|--------|-----|-----------|-------------|
| Type | `Optional[str]` | `string` | ✅ Yes |
| Format | `adk-{UUID}` | No restriction | ✅ Yes |
| Uniqueness | Guaranteed (UUID) | Required (implementation-defined) | ✅ Yes |
| Purpose | Call-response matching | Call-response matching | ✅ Yes |

**Conclusion:** ✅ **Fully Compatible** - ADK's ID can be used directly as AI SDK v6's toolCallId

---

## Current Implementation Issues

### Issue 1: Unnecessary Custom ID Generation

**Location:** `stream_protocol.py:466`

**Current Code:**
```python
def _process_function_call(self, function_call: types.FunctionCall) -> list[str]:
    tool_call_id = self._generate_tool_call_id()  # ← Generates "call_0", "call_1", ...
    tool_name = function_call.name
    # function_call.id is IGNORED!
```

**Problem:**
- Ignores ADK's `function_call.id`
- Generates sequential IDs: "call_0", "call_1", "call_2"
- Uses tool_name-based mapping to track calls

### Issue 2: tool_name-Based Mapping Can Fail

**Location:** `stream_protocol.py:476`

**Current Code:**
```python
# Store mapping so function_response can use the same ID
self.tool_call_id_map[tool_name] = tool_call_id
```

**Problem:** When the same tool is called multiple times:

```python
# First call to "web_search"
self.tool_call_id_map["web_search"] = "call_0"

# Second call to "web_search" (overwrites!)
self.tool_call_id_map["web_search"] = "call_1"

# First tool's response arrives
# Looks up "web_search" → gets "call_1" (WRONG!)
```

**This breaks the call-response matching for concurrent tool calls.**

### Issue 3: Historical Context

**Commit:** `5ff0822` - "fix: Ensure tool call and result share the same toolCallId"

**What it fixed:**
- function_call and function_response were generating different toolCallIds
- Added tool_call_id_map to maintain consistency

**What it missed:**
- Did not consider using ADK's existing `function_call.id`
- Implemented workaround (tool_name mapping) instead of proper solution

---

## Proposed Solution

### Solution: Use ADK's function_call.id with Fallback

**Rationale:**
1. ADK already provides unique IDs
2. AI SDK v6 has no format restrictions
3. Eliminates custom ID generation complexity
4. Fixes concurrent tool call issue

**Implementation:**

```python
def _process_function_call(self, function_call: types.FunctionCall) -> list[str]:
    """Process function call into tool-input-* events (AI SDK v6 spec)."""

    # Use ADK's ID if available, otherwise generate fallback
    if function_call.id:
        tool_call_id = function_call.id  # e.g., "adk-2b9230a6-..."
    else:
        # Fallback for cases where ADK doesn't provide ID
        tool_call_id = self._generate_tool_call_id()  # "call_0", "call_1", ...
        logger.warning(
            f"[TOOL CALL] function_call.id is None for tool '{function_call.name}', "
            f"using fallback ID: {tool_call_id}"
        )

    tool_name = function_call.name
    tool_args = function_call.args

    # ... rest of implementation ...
```

### Benefits

1. **✅ Uses ADK's official ID** - Follows ADK's intended design
2. **✅ Handles concurrent calls** - Each call has unique UUID-based ID
3. **✅ No format conflicts** - `adk-{UUID}` is valid for AI SDK v6
4. **✅ Maintains fallback** - Handles edge case where ID is None
5. **✅ Simpler code** - No need for tool_call_id_map (can be removed eventually)

### Migration Strategy

**Phase 1:** Add ADK ID usage with fallback (keep existing map for compatibility)

```python
# Use ADK's ID if available
if function_call.id:
    tool_call_id = function_call.id
else:
    tool_call_id = self._generate_tool_call_id()

# Still store in map for function_response compatibility
self.tool_call_id_map[tool_name] = tool_call_id
```

**Phase 2:** Update function_response to use ADK's ID

```python
def _process_function_response(self, function_response: types.FunctionResponse) -> list[str]:
    # Try ADK's ID first (if available in FunctionResponse)
    if hasattr(function_response, 'id') and function_response.id:
        tool_call_id = function_response.id
    else:
        # Fallback to map lookup
        tool_call_id = self.tool_call_id_map.get(function_response.name)
```

**Phase 3:** (Future) Remove tool_call_id_map if ADK always provides IDs

---

## Testing Strategy

### Test 1: Verify ADK ID is used when available

```python
@pytest.mark.asyncio
async def test_stream_protocol_uses_adk_function_call_id():
    """Should use ADK's function_call.id instead of generating custom ID."""
    # given: ADK function_call with ID
    function_call = types.FunctionCall(
        name="change_bgm",
        id="adk-2b9230a6-4b92-4a1b-9a65-b708ff6c68b6",
        args={"track": 1},
    )

    # when: Convert to AI SDK v6 events
    events = converter._process_function_call(function_call)

    # then: Should use ADK's ID, not generated ID
    assert '"toolCallId":"adk-2b9230a6-4b92-4a1b-9a65-b708ff6c68b6"' in events[0]
    assert '"toolCallId":"call_0"' not in events[0]  # Not generated ID
```

### Test 2: Verify fallback when ID is None

```python
@pytest.mark.asyncio
async def test_stream_protocol_generates_id_when_adk_id_is_none():
    """Should generate fallback ID when ADK doesn't provide one."""
    # given: ADK function_call WITHOUT ID
    function_call = types.FunctionCall(
        name="change_bgm",
        id=None,  # No ID provided
        args={"track": 1},
    )

    # when: Convert to AI SDK v6 events
    events = converter._process_function_call(function_call)

    # then: Should generate fallback ID
    assert '"toolCallId":"call_0"' in events[0]
```

### Test 3: Verify concurrent tool calls work

```python
@pytest.mark.asyncio
async def test_stream_protocol_handles_concurrent_same_tool():
    """Should handle multiple concurrent calls to the same tool."""
    # given: Two calls to same tool
    call1 = types.FunctionCall(name="web_search", id="adk-111", args={"q": "AI"})
    call2 = types.FunctionCall(name="web_search", id="adk-222", args={"q": "ML"})

    # when: Process both
    events1 = converter._process_function_call(call1)
    events2 = converter._process_function_call(call2)

    # then: Each should have its own unique ID
    assert '"toolCallId":"adk-111"' in events1[0]
    assert '"toolCallId":"adk-222"' in events2[0]
```

---

## Impact Assessment

### 🟡 Severity: MEDIUM

**Current State:**
- Works for single tool calls
- Breaks for concurrent calls to same tool
- Unnecessary complexity (custom ID generation + mapping)

**After Fix:**
- ✅ Handles concurrent calls correctly
- ✅ Simpler implementation
- ✅ Uses ADK's intended design
- ✅ No breaking changes (both ID formats work with AI SDK v6)

### Backward Compatibility

**Breaking Changes:** None

- Old IDs: `"call_0"`, `"call_1"` → Still valid
- New IDs: `"adk-{UUID}"` → Also valid
- Frontend doesn't care about ID format, only uniqueness

**Migration Path:**
1. Deploy new stream_protocol (uses ADK IDs)
2. Existing sessions continue with old IDs
3. New sessions use ADK IDs
4. No client-side changes required

---

## Next Steps

1. ✅ Document investigation (this file)
2. ⏭️ Update stream_protocol.py to use ADK IDs (TDD approach)
3. ⏭️ Write RED tests for new behavior
4. ⏭️ Implement GREEN (use function_call.id)
5. ⏭️ Update integration tests
6. ⏭️ Verify all tests pass

---

## References

- ADK Documentation: https://google.github.io/adk-docs/
- AI SDK v6 Stream Protocol: https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol
- Commit 5ff0822: "fix: Ensure tool call and result share the same toolCallId"
- FunctionCall definition: `.venv/lib/python3.13/site-packages/google/genai/types.py:1169-1194`
- Frontend tests: `lib/use-chat-integration.test.tsx` (toolCallId usage examples)
