# Agent Tasks

This file tracks current and future implementation tasks for the ADK AI Data Protocol project.

## 🚨 Current Issues Blocking Functionality

### 🔴 PRIORITY 1: Gemini Model Name Configuration

**Issue:** Model `gemini-2.5-flash-native-audio-preview-09-2025` not found (404 NOT_FOUND)

**Impact:**
- ❌ Gemini Direct mode fails
- ❌ ADK SSE/BIDI modes fail (backend uses same model)

**Root Cause:** Model name no longer valid or requires different API version

**Required Actions:**

1. **Research correct model name:**
   - Reference: https://google.github.io/adk-docs/streaming/dev-guide/part4/#streamingmode-bidi-or-sse
   - Check ADK documentation for SSE/BIDI recommended models
   - Verify model availability in API version v1beta

2. **Update model names in:**
   - `server.py` - ADK backend agent configuration (lines 272-278)
   - `app/api/chat/route.ts` - Gemini Direct mode

3. **Recommended models to try:**
   - For SSE: `gemini-2.0-flash-exp` (text + vision)
   - For BIDI audio: `gemini-2.0-flash-exp` with AUDIO response modality
   - Fallback: `gemini-1.5-flash` (stable)

**Testing Requirements:**
- [ ] Gemini Direct mode works with new model
- [ ] ADK SSE mode works with new model
- [ ] ADK BIDI mode works with new model
- [ ] Image upload still works (vision capability)
- [ ] Tool calling still works

**Priority:** 🔴 HIGH - Blocks all functionality

---

### ⏱️ PRIORITY 2: WebSocket Timeout Investigation

**Issue:** WebSocket connection closes with "Deadline expired" error after successful PCM streaming

**Context:**
- 35 PCM audio chunks (111,360 bytes) sent successfully
- Connection closes before completion
- Error: `received 1011 (internal error) Deadline expired before operation could complete`

**Hypothesis:** ADK Live API deadline setting too short for audio streaming

**Required Investigation:**

1. **Check ADK deadline configuration:**
   - File: `server.py` (lines 469-578 - WebSocket /live endpoint)
   - Look for timeout/deadline parameters in:
     - `run_live()` configuration
     - `RunConfig` parameters
     - WebSocket connection settings
     - ADK session configuration

2. **Review ADK documentation:**
   - ADK Live API timeout/deadline docs
   - Default timeout values
   - Recommended settings for audio streaming
   - Session keep-alive mechanisms

3. **Test fixes:**
   - Increase deadline/timeout value
   - Add keep-alive mechanism
   - Verify connection stability with longer sessions

**Testing Requirements:**
- [ ] WebSocket connection stays open during full audio stream
- [ ] No deadline expiry errors
- [ ] Graceful connection close after completion
- [ ] Works with both short and long audio streams

**Priority:** 🟡 MEDIUM - Affects ADK BIDI mode audio streaming

---

## 📋 Current Sprint Tasks

### Task 4.4: Improve Type Safety with Real ADK Types (🟡 MEDIUM)

**Status:** ⚪ Not Started

**Issue:** Tests use Mock objects instead of real ADK types, reducing type safety

**Files:** `tests/unit/test_stream_protocol_comprehensive.py`

**Current Problem:**
```python
# Fragile: Uses Mock with manual attribute assignment
mock_part = Mock()
mock_part.text = "Hello"
mock_part.thought = False
mock_part.function_call = None
# ... many more attributes
```

**Impact:**
- Tests don't catch ADK API changes
- Type checker cannot verify correctness
- Mocks may not match real ADK behavior

**Implementation Plan:**

**Step 1: Research ADK type constructors**

Investigate how to create real `types.Part`, `types.Content`, `Event` objects:

```python
from google.genai import types
from google.adk.events import Event

# Try different construction methods
text_part = types.Part(text="Hello")
thought_part = types.Part(thought="Thinking...")
# etc.
```

**Step 2: Refactor test helper**

Replace `create_mock_part()` with real types:

```python
def create_text_part(text: str) -> types.Part:
    """Create real ADK Part with text content."""
    return types.Part(text=text)

def create_thought_part(thought: str) -> types.Part:
    """Create real ADK Part with thought content."""
    return types.Part(thought=thought)

def create_function_call_part(name: str, args: dict) -> types.Part:
    """Create real ADK Part with function call."""
    function_call = types.FunctionCall(name=name, args=args)
    return types.Part(function_call=function_call)
```

**Step 3: Gradually migrate tests**

Start with one test class at a time:
1. TestTextContentConversion
2. TestReasoningContentConversion
3. TestToolExecutionConversion
4. etc.

**Acceptance Criteria:**
- [ ] Research ADK type construction
- [ ] Create helper functions for real type creation
- [ ] Migrate at least one test class to real types
- [ ] All tests pass
- [ ] Type checker verifies correctness
- [ ] Commit with proper message

**Estimated Time:** 2 hours

**Priority:** 🟡 MEDIUM - Long-term quality improvement

---

## 📝 Future Tasks (Pending Current Issues Resolution)

### Complete Multimodal Integration Testing

**Prerequisites:**
- ⚠️ BLOCKED by Gemini model name fix (need vision-capable model)
- Server and frontend must be running
- Valid Gemini API key required

**Manual Test Checklist:**

**Test 1: Upload single image**
- [ ] Click file input, select PNG image
- [ ] Image preview displays
- [ ] Type text message "What's in this image?"
- [ ] Send message
- [ ] Backend receives image part (check logs)
- [ ] Agent analyzes image (Gemini vision)
- [ ] Agent response describes image content
- [ ] Response displays in UI

**Test 2: Upload multiple images**
- [ ] Select 2 images
- [ ] Both previews display
- [ ] Send message with both images
- [ ] Agent response references both images
- [ ] Images display in chat history

**Test 3: Image-only message (no text)**
- [ ] Select image without typing text
- [ ] Send image-only message
- [ ] Agent responds appropriately

**Test 4: Error handling**
- [ ] Try uploading file > 5MB → error message
- [ ] Try uploading non-image file → error message
- [ ] Try uploading unsupported format → error message

**Test 5: Backend mode switching**
- [ ] Test in Gemini Direct mode
- [ ] Test in ADK SSE mode
- [ ] Test in ADK BIDI mode
- [ ] All modes handle images correctly

**Test 6: Backward compatibility**
- [ ] Send text-only message → works as before
- [ ] Use tool calling → works as before

**Priority:** 🟢 LOW - Feature verification (not blocking existing functionality)

---

### Documentation Updates

**Pending integration testing completion**

**Task 1: Update experiment document**
- File: `experiments/2025-12-11_adk_bidi_multimodal_support.md`
- Add: Results section with test outcomes
- Add: Performance metrics
- Add: Limitations discovered

**Task 2: Update README.md**
- Add: Image support to Current Status section
- Add: Usage instructions for image upload
- Add: Troubleshooting section

**Task 3: Create architecture diagram**
- Add: Image upload flow diagram
- Add: Data format transformations
- Location: README.md or docs/multimodal-architecture.md

**Priority:** 🟢 LOW - Documentation (defer until features working)

---

## Recommended Implementation Order

**Phase 1: Unblock Current Functionality** 🔴
1. Fix Gemini model name (PRIORITY 1)
   - Research correct model name from ADK docs
   - Update server.py and app/api/chat/route.ts
   - Test all 3 backend modes

**Phase 2: Stability Improvements** 🟡
2. Investigate WebSocket timeout (PRIORITY 2)
   - Find ADK deadline configuration
   - Increase timeout for audio streaming
   - Test with long sessions

3. Complete Task 4.4: Type Safety (MEDIUM)
   - Research ADK type constructors
   - Refactor tests to use real types
   - Improve long-term maintainability

**Phase 3: Feature Completion** 🟢
4. Complete multimodal integration testing
   - Run manual test checklist
   - Fix bugs discovered during testing
   - Update experiment document

5. Update documentation
   - Add results to experiment notes
   - Update README with new features
   - Create architecture diagrams

---

## Quick Reference: Current System State

**Working:**
- ✅ AI SDK v6 endpoint switching (fixed with manual transport)
- ✅ Backend WebSocket infrastructure (/live endpoint)
- ✅ Frontend WebSocketChatTransport
- ✅ Backend image input/output support (code complete)
- ✅ Frontend image upload/display (code complete)
- ✅ Tool calling in all modes (when model works)
- ✅ Text streaming in all modes (when model works)
- ✅ Tool Call ID mapping fix (commit 5ff0822)
- ✅ Usage metadata support (commit 0ffef44)
- ✅ Code duplication reduction (commit efe6f38)

**Broken:**
- ❌ All modes (model name error blocks everything)
- ❌ ADK BIDI audio streaming (WebSocket timeout)

**Untested:**
- ⚠️ End-to-end image upload (blocked by model name)
- ⚠️ Image display in chat messages (blocked by model name)
- ⚠️ Multi-image messages (blocked by model name)

**Next Immediate Action:** Fix Gemini model name to unblock all functionality

---

## Completed Tasks (Recent History)

- ✅ Task 4.1: Tool Call ID Mapping (commit 5ff0822) - Fixed critical UI bug
- ✅ Task 4.2: Usage Metadata Support (commit 0ffef44) - Added token tracking
- ✅ Task 4.3: Code Duplication Reduction (commit efe6f38) - Improved maintainability
- ✅ Phase 1-3: ADK BIDI Integration - WebSocket, image support, comprehensive tests
- ✅ AI SDK v6 endpoint switching bug fix (commits ee4784a, 8bea94e)
- ✅ Files API migration for image uploads (commit c638026)
- ✅ Stream protocol fixes for AI SDK v6 compliance (commit 9b2a2ea)
