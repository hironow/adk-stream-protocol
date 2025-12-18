# BIDI FunctionResponse Investigation

**Date:** 2025-12-18
**Objective:** Investigate why FunctionResponse from `adk_request_confirmation` doesn't reach ADK Live API in BIDI mode
**Status:** 🟡 In Progress

## Background

### Context
We implemented ADK tool confirmation flow for BIDI mode (WebSocket-based `/live` endpoint). The confirmation UI appears correctly, users can approve/deny, but the FunctionResponse from `adk_request_confirmation` never reaches the ADK Live API, causing an infinite loop.

### Current Implementation State
- ✅ Approval UI appears (confirmation event injection working)
- ✅ `adk_request_confirmation` tool executes → returns `{ confirmed: true }`
- ✅ `ChatMessage.to_adk_content()` converts to `FunctionResponse` correctly
- ✅ FunctionResponse isolated (sent alone, not mixed with text parts)
- ✅ `role="user"` set correctly for FunctionResponse
- ✅ `process_chat_message_for_bidi()` returns valid `text_content`
- ✅ `server.py:684` calls `live_request_queue.send_content(text_content)`
- ❌ **FunctionResponse never reaches ADK** (no `direction: "out"` in chunk logs)
- ❌ Infinite loop (AI keeps asking for confirmation)

### Code Location
- `/Users/nino/workspace/r/oss/adk-ai-data-protocol/ai_sdk_v6_compat.py:545-561` - FunctionResponse isolation logic
- `/Users/nino/workspace/r/oss/adk-ai-data-protocol/server.py:684` - `live_request_queue.send_content()` call

### Test Case
- `e2e/adk-confirmation-minimal-bidi.spec.ts:32` - Test 1: Normal Flow - Approve Once

### Server Logs Show
```python
[STEP 2] Processing 1 parts from last_msg
[STEP 2] Part type: ToolUsePart
[STEP 2] ADK content has 1 parts
[STEP 2] Including FunctionResponse: adk_request_confirmation
[STEP 3] ADK format: image_blobs=0, non_image_parts=1
[STEP 3] Text content role: user, parts: [Part(function_response=FunctionResponse(name='adk_request_confirmation', response={'confirmed': True}))]
```

### Evidence of Problem
- Backend chunk logs show no outgoing events (`direction: "out"`) after `send_content()` call
- Frontend chunk logs show AI continues to request confirmation
- UI stuck in "Thinking..." state
- `process_payment` tool stuck in "Executing..." state (never completes to "output-available")

## Hypothesis

### Primary Hypothesis
`LiveRequestQueue.send_content()` in ADK Live API may have undocumented constraints or requirements that reject FunctionResponse, or FunctionResponse may need to be sent through a different mechanism in BIDI mode.

### Alternative Hypotheses
1. FunctionResponse structure may be incorrect for BIDI mode (different from SSE mode)
2. ADK Live API may require different Content/Part format than documented
3. LiveRequestQueue may require specific metadata or headers for tool responses
4. BIDI mode may have a different mechanism for sending tool results vs SSE mode

## Experiment Design

### Research Phase (Using DeepWiki MCP)

#### Step 1: Research ADK Live API Documentation
- Use DeepWiki MCP to query official Google ADK repository
- Search for: "Live API FunctionResponse", "LiveRequestQueue", "tool response BIDI"
- Document official requirements for sending FunctionResponse

#### Step 2: Research LiveRequestQueue Implementation
- Query DeepWiki for `LiveRequestQueue` class implementation
- Understand `send_content()` method behavior and constraints
- Check for validation logic or filtering that might reject FunctionResponse

#### Step 3: Compare SSE vs BIDI Patterns
- Research how SSE mode handles FunctionResponse vs BIDI mode
- Check if there are different mechanisms for different modes
- Document any mode-specific requirements

#### Step 4: Investigate Content/Part Structure Requirements
- Query for ADK `types.Content` and `types.Part` structure requirements
- Verify if FunctionResponse needs specific wrapping or metadata
- Check role requirements ("user" vs "assistant")

### Verification Phase (After Research)

#### Step 5: Implement Findings
- Apply any discovered requirements from documentation
- Update `process_chat_message_for_bidi()` if needed
- Add additional logging to trace request path

#### Step 6: Test Implementation
- Run minimal BIDI test: `pnpm exec playwright test e2e/adk-confirmation-minimal-bidi.spec.ts:32`
- Verify FunctionResponse appears in backend chunk logs with `direction: "out"`
- Verify AI processes confirmation and completes tool execution

## Expected Results

### Before Research
- [ ] Clear understanding of LiveRequestQueue.send_content() requirements
- [ ] Documentation of FunctionResponse structure requirements for BIDI mode
- [ ] Identification of any missing metadata, headers, or structure elements

### After Implementation
- [ ] FunctionResponse successfully sent to ADK Live API
- [ ] Backend chunk logs show `direction: "out"` events with FunctionResponse
- [ ] AI processes confirmation and completes `process_payment` tool
- [ ] Test passes: "Thinking..." disappears, response text appears
- [ ] No infinite loop

## Results

### Research Findings

#### Finding 1: LiveRequestQueue.send_content() is for Text, Not Tool Results

From ADK documentation (Part 2 - Sending messages with LiveRequestQueue):

> **Function responses**: "ADK automatically handles the function calling loop - receiving function calls from the model, executing your registered functions, and sending responses back. **You don't manually construct these.**"

> **Supported content**: `send_content()` primarily handles **text-based content**. The `Content` container holds an array of `Part` objects.

**Implication**: We should NOT be manually sending FunctionResponse through `send_content()`.

#### Finding 2: SSE vs BIDI Architecture Difference

**SSE Mode** (WORKING):
```python
# server.py:463
message_content = _process_latest_message(request.messages[-1])  # Returns Content with FunctionResponse

# server.py:473-477
event_stream = sse_agent_runner.run_async(
    user_id=user_id,
    session_id=session.id,
    new_message=message_content,  # FunctionResponse passed to run_async
)
```

**BIDI Mode** (BROKEN):
```python
# server.py:675
image_blobs, text_content = process_chat_message_for_bidi(message_data)  # Returns Content with FunctionResponse

# server.py:684
live_request_queue.send_content(text_content)  # FunctionResponse sent to send_content() ❌
```

**Key Difference**:
- SSE uses `run_async(new_message=content)` which processes FunctionResponse in conversation context
- BIDI uses `LiveRequestQueue.send_content()` which is designed for text input, not tool results

#### Finding 3: FunctionResponse Requirements

From ADK documentation:
- FunctionResponse should be handled by ADK's automatic function calling loop
- For registered functions, ADK receives calls → executes → sends responses back
- Manual construction of FunctionResponse is discouraged

**Problem with Our Approach**:
- `adk_request_confirmation` is NOT a registered ADK function
- It's a meta-tool we inject for UI confirmation pattern
- We're trying to manually send its FunctionResponse back to ADK
- But `send_content()` isn't designed for this use case

#### Finding 4: The Correct Approach - session_service.append_event()

From ADK Session documentation:

> "State should always be updated as part of adding an Event to the session history using `session_service.append_event()`, which ensures changes are tracked, persistence works correctly, and updates are thread-safe."

**Event Construction** (from `tests/unit/test_stream_protocol.py:101`):
```python
from google.adk.events import Event

event = Event(author="user", content=types.Content(...))
session_service.append_event(session, event)
```

**Solution**:
Instead of using `LiveRequestQueue.send_content()` for FunctionResponse, we should:
1. Create Content with Function Response (already done by `ChatMessage.to_adk_content()`)
2. Wrap it in an Event object with `author="user"`
3. Use `bidi_agent_runner.session_service.append_event(session, event)`
4. This adds the FunctionResponse to the conversation history
5. ADK will process it in the ongoing conversation context (like SSE mode does via `run_async()`)

### Implementation Changes

**File**: `server.py`
**Line**: 684 (BIDI WebSocket handler)

**Before** (BROKEN):
```python
if text_content:
    live_request_queue.send_content(text_content)  # ❌ Wrong API for FunctionResponse
```

**After** (FIXED):
```python
if text_content:
    # Check if this is a FunctionResponse (tool confirmation)
    has_function_response = any(
        hasattr(part, "function_response") and part.function_response
        for part in (text_content.parts or [])
    )

    if has_function_response:
        # FunctionResponse must be added to session history, not sent via send_content()
        # This matches SSE mode behavior (run_async processes FunctionResponse in conversation context)
        from google.adk.events import Event

        event = Event(author="user", content=text_content)
        await bidi_agent_runner.session_service.append_event(session, event)
        logger.info("[BIDI] Added FunctionResponse to session history via append_event()")
    else:
        # Regular text messages go through LiveRequestQueue
        live_request_queue.send_content(text_content)
```

### Test Results

#### Attempt 1: session_service.append_event() Implementation

**Test Command:**
```bash
pnpm exec playwright test e2e/adk-confirmation-minimal-bidi.spec.ts:32 --timeout=60000
```

**Result:** ❌ FAILED (Different error pattern)

**Error:**
```
Error: models/gemini-live-2.5-flash-preview is not found for API version v1alpha,
or is not supported for bidiGenerateContent
```

**Analysis:**

Logs show contradictory model names:
- Server log: `[BIDI] Detected native-audio model: gemini-2.5-flash-native-audio-preview-12-2025`
- Error message: `models/gemini-live-2.5-flash-preview is not found`

The server is using the correct model (`gemini-2.5-flash-native-audio-preview-12-2025`), but ADK internally appears to be converting it to `gemini-live-2.5-flash-preview`.

**Hypothesis:**
1. ADK SDK may have internal model name mapping/aliasing
2. The native-audio model may require different configuration for BIDI mode
3. This could be an ADK SDK version issue

**Investigation Results:**

**Findings from Source Code Analysis:**
1. ✅ ADK SDK does NOT convert model names - confirmed by reading `.venv/.../google/adk/utils/model_name_utils.py`
2. ✅ Genai SDK defaults to `api_version="v1beta"` - confirmed in `.venv/.../google/genai/_interactions/_client.py:74`
3. ✅ Model name `gemini-2.5-flash-native-audio-preview-12-2025` IS supported for Live API (confirmed via Google documentation)
4. ❌ Error shows `v1alpha` being used, but SDK defaults to `v1beta`

**Conclusion:**
The error is **NOT related to session_service.append_event() implementation**. This is a separate API configuration issue.

**Root Cause Hypotheses:**
1. ADK SDK may be overriding API version to `v1alpha` for Live API specifically
2. The native-audio preview model may require special configuration
3. Google AI Studio API may have model name compatibility issues with `v1alpha`

**Next Steps:**
1. **Option A (Quick Test)**: Try a stable non-preview model to isolate the issue
   - Use `gemini-2.0-flash-exp` or `gemini-exp-1206`
   - If this works, the issue is model-specific, not append_event()-specific

2. **Option B (Investigation)**: Find where ADK overrides API version for Live API
   - Search ADK SDK for Live API client initialization
   - Check if there's a way to override API version

3. **Option C (Alternative Approach)**: Check if `change_bgm` (which worked in BIDI) used a different model
   - Review past logs for successful BIDI tests
   - Compare model configuration

## Conclusion

*(To be written after completing investigation and verification)*

---

## Investigation Log

### [2025-12-18] Starting Research Phase

**Queries to execute:**
1. DeepWiki: Search ADK repository for "Live API" and "FunctionResponse"
2. DeepWiki: Search ADK repository for "LiveRequestQueue" implementation
3. DeepWiki: Search for BIDI/SSE mode differences in tool handling
