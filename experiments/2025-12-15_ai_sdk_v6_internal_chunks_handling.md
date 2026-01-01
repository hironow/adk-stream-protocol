# AI SDK v6 Internal Chunks Handling

**Date:** 2025-12-15
**Status:** 🟢 Complete
**Objective:** Resolve 422 validation errors caused by AI SDK v6 internal chunk types during mode switching

## Background

When switching from Gemini Direct mode to ADK SSE mode with existing message history, the system was encountering 422 validation errors. The error indicated unknown part types like `step-start`, `start-step`, `finish-step` that AI SDK v6 adds internally.

## Problem Analysis

1. **Initial approach (Frontend filtering):**
   - Created filter-messages.ts to remove internal chunk types
   - However, investigation revealed these chunks weren't actually present in the test cases
   - The filter was working but was unnecessary overhead

2. **Root cause:**
   - Server-side Pydantic validation was too strict
   - Union type validation in ai_sdk_v6_compat.py couldn't handle unknown part types
   - Any part type not in the predefined union would cause validation failure

## Solution Implemented

### Server-Side Fix (ai_sdk_v6_compat.py)

1. **Added GenericPart class:**

```python
class GenericPart(BaseModel):
    """
    Generic part for AI SDK v6 internal chunks.

    This handles internal chunk types like 'step-start', 'start-step',
    'finish-step', etc. that AI SDK v6 adds internally but should be
    ignored during processing.
    """
    type: str
    # Allow any additional fields without validation
    model_config = {"extra": "allow"}
```

1. **Updated MessagePart union:**

```python
MessagePart = TextPart | ImagePart | FilePart | ToolUsePart | GenericPart
```

1. **Added warning logging for unknown types:**

```python
if isinstance(part, GenericPart):
    logger.warning(
        f"[AI SDK v6] Ignoring unknown part type: '{part.type}'. "
        f"Consider adding proper type definition for this part. "
        f"Full part data: {part.model_dump()}"
    )
    continue
```

### Frontend Cleanup

- Removed filter-messages.ts entirely
- Removed filtering logic from build-use-chat-options.ts
- Messages are now sent as-is to the backend

## Results

✅ **SUCCESS** - Complete resolution:

- 422 validation errors eliminated
- Message history properly preserved during mode switching
- Unknown part types are gracefully handled with warnings
- System is future-proof for new AI SDK v6 internal chunks
- Clean solution without unnecessary frontend filtering

## Key Learnings

1. **Server-side validation should be flexible:** Unknown types should be logged and ignored rather than causing failures
2. **Debugging before implementing:** The initial filter implementation worked but was unnecessary - proper investigation revealed the real issue
3. **Extension points matter:** Using GenericPart as a catch-all allows the system to adapt to future AI SDK changes
4. **Pydantic Union type order is critical:** GenericPart must be last in the union to act as a catch-all. Pydantic tries each type in order, so specific types must come before generic ones

## Testing Performed

1. ✅ Gemini Direct mode → ADK SSE mode switching with message history
2. ✅ Tool calling functionality preserved
3. ✅ Message content properly maintained
4. ✅ No 422 errors during mode transitions

## Future Recommendations

- Monitor warning logs for new part types from AI SDK v6
- Add proper type definitions for frequently seen internal chunks
- Consider contributing back to AI SDK v6 documentation about internal chunk types
