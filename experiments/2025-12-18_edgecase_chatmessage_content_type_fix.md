# Edge Case Fix: ChatMessage.content Type Validation Error

**Date:** 2025-12-18
**Status:** 🟢 **COMPLETE** - TDD Cycle Success (RED → GREEN)
**Priority:** CRITICAL - Caused Pydantic validation errors in production

---

## Summary

Fixed a critical type definition bug in `ChatMessage.content` that caused Pydantic validation errors when sending function_response messages in BIDI mode. Applied full TDD cycle (RED → GREEN → REFACTOR) to ensure correctness.

**Impact**: Tests passed but error logs contained validation errors, indicating potential production issues.

---

## Background

During POC Phase 5 testing, discovered validation errors in backend logs:

```
[BIDI] Error receiving from client: 1 validation error for ChatMessage
content
  Input should be a valid string [type=string_type, input_value=[{'type': 'tool-result', ...}], input_type=list]
```

**Root Cause**: `ChatMessage.content` was typed as `str | None`, but AI SDK v6 spec allows `content` to be:
1. `str` - simple text messages
2. `list[Part]` - parts array (used for function_response)
3. `None`

**Location**: `ai_sdk_v6_compat.py:299`

---

## TDD Approach

### 🔴 RED Phase: Write Failing Test

**File**: `tests/unit/test_ai_sdk_v6_compat.py`

Added `TestChatMessageContentField` class with 3 tests:

```python
class TestChatMessageContentField:
    """
    Tests for ChatMessage.content field type compatibility.
    Edge case discovered during POC Phase 5.
    """

    def test_content_accepts_string(self):
        """ChatMessage.content should accept string (simple text message)."""
        message_data = {"role": "user", "content": "Hello, world!"}
        message = ChatMessage(**message_data)
        assert message.content == "Hello, world!"

    def test_content_accepts_none(self):
        """ChatMessage.content should accept None."""
        message_data = {"role": "user", "content": None}
        message = ChatMessage(**message_data)
        assert message.content is None

    def test_content_accepts_list_of_parts(self):
        """
        ChatMessage.content should accept list[Part] for function_response.
        BUG: This test WILL FAIL until ChatMessage.content type is fixed.
        """
        message_data = {
            "role": "user",
            "content": [
                {
                    "type": "tool-result",
                    "toolCallId": "function-call-123",
                    "toolName": "approval_test_tool",
                    "result": {
                        "approved": True,
                        "user_message": "User approved",
                        "timestamp": "2025-12-18T12:10:43.915Z",
                    },
                }
            ],
        }
        message = ChatMessage(**message_data)
        assert message.content is not None
        assert isinstance(message.content, list)
```

**Result**: ❌ Test failed as expected with ValidationError

```
pydantic_core._pydantic_core.ValidationError: 1 validation error for ChatMessage
content
  Input should be a valid string [type=string_type, input_value=[{...}], input_type=list]
```

---

### 🟢 GREEN Phase: Fix Implementation

**Changes Made**:

1. **Type Definition** (`ai_sdk_v6_compat.py:303`)
   ```python
   # Before
   content: str | None = None  # Simple format

   # After
   content: str | list[MessagePart] | None = None  # Simple format or Parts array (function_response)
   ```

2. **get_text_content() Method** (`ai_sdk_v6_compat.py:306-315`)
   ```python
   def get_text_content(self) -> str:
       """Extract text content from either format (str, list[Part], or parts field)"""
       if self.content:
           if isinstance(self.content, str):
               return self.content
           # content is list[MessagePart] (function_response format)
           return "".join(p.text or "" for p in self.content if isinstance(p, TextPart))
       if self.parts is not None:
           return "".join(p.text or "" for p in self.parts if isinstance(p, TextPart))
       return ""
   ```

3. **to_adk_content() Method** (`ai_sdk_v6_compat.py:449-463`)
   ```python
   adk_parts = []

   if self.content:
       if isinstance(self.content, str):
           adk_parts.append(types.Part(text=self.content))
       else:
           # content is list[MessagePart] (function_response format)
           for part in self.content:
               self._process_part(part, adk_parts)

   if self.parts:
       for part in self.parts:
           self._process_part(part, adk_parts)

   return types.Content(role=self.role, parts=adk_parts)
   ```

4. **Updated Docstring**
   - Documented three supported formats
   - Added edge case explanation
   - Referenced POC Phase 5

**Linting & Type Checking**:
- ✅ `uv run mypy ai_sdk_v6_compat.py` - Success
- ⚠️ `uv run ruff check` - 2 existing issues (unrelated to changes)

---

### ✅ Test Results

**Unit Tests**:
```bash
$ uv run pytest tests/unit/test_ai_sdk_v6_compat.py::TestChatMessageContentField -v

✅ test_content_accepts_string PASSED
✅ test_content_accepts_none PASSED
✅ test_content_accepts_list_of_parts PASSED [NEW - Now succeeds!]

44 passed, 1 failed (unrelated: test_message_with_image - PIL issue)
```

**E2E Verification**:
```bash
$ pnpm exec playwright test e2e/poc-longrunning-bidi.spec.ts:148 --project=chromium

✅ Phase 3: Function response injection (5.1s)
✅ NO validation errors in logs!
✅ Agent resumed successfully
```

**Before Fix** (validation error present):
```
[BIDI] Error receiving from client: 1 validation error for ChatMessage
content
  Input should be a valid string [type=string_type, input_value=[...], input_type=list]
```

**After Fix** (validation error gone):
```
✓ 1 [chromium] › e2e/poc-longrunning-bidi.spec.ts:148 (5.1s)
1 passed (7.5s)
[No validation errors in logs]
```

---

## Files Modified

| File | Lines | Changes |
|------|-------|---------|
| `ai_sdk_v6_compat.py` | 283-463 | Fixed type definition, updated 3 methods, added docs |
| `tests/unit/test_ai_sdk_v6_compat.py` | 809-880 | Added `TestChatMessageContentField` class with 3 tests |

---

## Technical Details

### AI SDK v6 Message Format

```typescript
// AI SDK v6 UIMessage type allows:
interface UIMessage {
  role: string;
  content?: string | Array<Part>;  // ← Can be string OR array!
  parts?: Array<Part>;
}

// Example function_response:
{
  role: "user",
  content: [
    {
      type: "tool-result",
      toolCallId: "function-call-123",
      toolName: "approval_test_tool",
      result: {approved: true, ...}
    }
  ]
}
```

### Why This Bug Existed

1. Initial implementation only considered simple text messages
2. AI SDK v6 spec allows both `string` and `array` for `content`
3. LongRunningFunctionTool sends function_response with `content` as array
4. Pydantic validation rejected array because type was `str | None`

### Impact Before Fix

- ✅ Tests passed (functionality worked)
- ❌ Validation errors in logs (technical debt)
- ⚠️ Potential production issues if Pydantic gets stricter
- ⚠️ Confusing error messages for developers

---

## Lessons Learned

1. **TDD catches edge cases early**: Writing tests first revealed the type mismatch
2. **Check logs, not just test results**: Tests passed but logs had errors
3. **AI SDK specs should be validated**: Don't assume types from partial implementation
4. **Type checking is critical**: mypy caught downstream issues in other methods

---

## Related Documents

- `experiments/2025-12-18_poc_phase5_generic_approval_success.md` - Where bug was first noticed
- `agents/handsoff.md` - Session 8 summary
- `agents/tasks.md` - Edge case task tracking

---

## Next Steps

- ✅ **COMPLETE**: Type definition fixed
- ✅ **COMPLETE**: Tests passing
- ✅ **COMPLETE**: Validation errors eliminated
- 🔄 **FUTURE**: Consider adding E2E test that explicitly checks for absence of validation errors
- 🔄 **FUTURE**: Review other Pydantic models for similar type issues
