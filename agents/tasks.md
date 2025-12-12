# Agent Tasks

This file tracks current and future implementation tasks for the ADK AI Data Protocol project.

## 📋 Implementation Phases

**Phase 1: 即座に対応（機能ブロック解消）** - ✅ Complete
- No blocking issues remaining (finishReason implemented)

**Phase 2: アーキテクチャ安定化** - 🟡 In Progress
- [P2-T1] WebSocket Timeout Investigation
- [P2-T2] WebSocket Bidirectional Communication
- [P2-T3] Immediate Error Detection (errorCode/errorMessage) - 🔴 High Priority
- [P2-T4] Field Coverage Testing (Automated CI Checks) - 🔴 High Priority

**Phase 3: 新機能検討（UI設計判断待ち）** - ⏸️ Awaiting Decision
- [P3-T1] Live API Transcriptions
- [P3-T2] Grounding & Citation Metadata

**Phase 4: その他** - 🟢 Low Priority
- [P4-T1] Interruption Signal Support (BIDI UX)
- [P4-T2] File References Support
- [P4-T3] Advanced Metadata Features
- [P4-T4] Multimodal Integration Testing
- [P4-T5] Documentation Updates

---

## Phase 2: アーキテクチャ安定化

### [P2-T1] WebSocket Timeout Investigation

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

### [P2-T2] WebSocket Bidirectional Communication Inconsistency

**Issue:** Communication format is inconsistent between directions

**Current Behavior:**

**Backend → Frontend:** ✅ SSE format over WebSocket
```python
# stream_protocol.py:_format_sse_event()
return f"data: {json.dumps(event_data)}\n\n"
```

**Frontend → Backend:** ❌ Raw JSON (not SSE format)
```typescript
// lib/websocket-chat-transport.ts:249
this.ws?.send(JSON.stringify(toolResult));
// → {"type": "tool-result", "toolCallId": "...", "result": {...}}
```

**Problems:**

1. **Protocol Asymmetry:**
   - Backend sends: `data: {...}\n\n` (SSE format)
   - Frontend sends: `{...}` (raw JSON)
   - Violates "SSE format over WebSocket" architecture

2. **Backend doesn't handle tool-result:**
   - `server.py` `/live` endpoint only handles:
     - `"messages" in message_data` - Initial message history
     - `"role" in message_data` - Single message
   - **No handler for `"type": "tool-result"`**

3. **Unused toolCallCallback:**
   - `lib/build-use-chat-options.ts:74-78` returns `{handled: "backend"}`
   - But backend cannot receive frontend tool results

**Required Actions:**

1. **Decision:** Choose bidirectional protocol format
   - **Option A:** SSE format both ways (consistent with "SSE over WebSocket" design)
   - **Option B:** JSON both ways (simpler, but breaks current architecture)
   - **Recommendation:** Option A for consistency

2. **If Option A (SSE format both ways):**
   - Frontend: Wrap tool results in SSE format before send
     ```typescript
     const sseMessage = `data: ${JSON.stringify(toolResult)}\n\n`;
     this.ws?.send(sseMessage);
     ```
   - Backend: Parse SSE format from client messages
     ```python
     if data.startswith("data: "):
         json_str = data[6:]  # Remove "data: " prefix
         message_data = json.loads(json_str)
     ```

3. **Add tool-result handling in server.py:**
   - Extract toolCallId and result
   - Send to ADK via appropriate mechanism
   - Need to investigate: How does ADK receive tool results in BIDI mode?

**Testing Requirements:**
- [ ] Bidirectional SSE format over WebSocket works
- [ ] Backend receives and parses SSE-formatted messages from frontend
- [ ] Tool execution round-trip works (if tools move to frontend)

**Priority:** 🟡 MEDIUM - Currently not blocking (tools run on backend), but architecture inconsistency

**Reference:** README.md - "SSE format over WebSocket" design rationale

---

### [P2-T3] Immediate Error Detection (errorCode/errorMessage)

**Issue:** Error detection happens too late in stream processing

**Current Behavior:**
- `errorCode` and `errorMessage` only checked in `finalize()` method
- Called at **end of stream** or when exception occurs
- Mid-stream errors (quota exceeded, model errors) may not be detected immediately

**Problem:**
```python
# stream_protocol.py - Current flow
async def stream_adk_to_ai_sdk():
    try:
        async for event in event_stream:
            async for sse_event in converter.convert_event(event):  # ← errorCode NOT checked here
                yield sse_event
    finally:
        async for final_event in converter.finalize(error=error):  # ← errorCode checked here (too late)
            yield final_event
```

**Required Fix:**

Add error detection at the **start** of `convert_event()`:

```python
# stream_protocol.py:~180 (in convert_event method)
async def convert_event(self, event: Event) -> AsyncGenerator[str, None]:
    # Check for errors FIRST (before any other processing)
    if hasattr(event, "error_code") and event.error_code:
        error_message = getattr(event, "error_message", "Unknown error")
        logger.error(f"[ERROR] ADK error detected: {event.error_code} - {error_message}")

        # Send error event immediately
        yield self._format_sse_event({
            "type": "error",
            "error": {
                "code": event.error_code,
                "message": error_message
            }
        })
        return  # Stop processing this event

    # ... rest of convert_event processing
```

**Testing Requirements:**
- [ ] Test with simulated ADK error event (error_code set)
- [ ] Verify error event sent immediately (not delayed until finalize)
- [ ] Verify subsequent events after error are handled correctly
- [ ] Add unit test: `test_convert_event_with_error_code()`

**Priority:** 🔴 HIGH - Critical for proper error handling

**Impact:** Users will see errors immediately instead of waiting for stream to finish

**Reference:**
- experiments/2025-12-12_adk_field_mapping_completeness.md - Section "Immediate Actions (Priority 1)"
- Coverage analysis: errorCode/errorMessage marked as "⚠️ Partial" (only in finalize)

---

### [P2-T4] Field Coverage Testing (Automated CI Checks)

**Issue:** New ADK fields may be added without detection (example: `output_transcription` was discovered by accident)

**Goal:** Automatically detect when ADK SDK adds new fields that we're not handling

**Implementation:** Create `tests/unit/test_field_coverage.py`

**Test Strategy:**

```python
"""
Test to ensure all ADK Event/Part fields are accounted for.
This test should FAIL when ADK SDK adds new fields.
"""
import inspect
from google.adk.events import Event
from google.genai import types

# Known fields we handle (update when implementing new fields)
IMPLEMENTED_EVENT_FIELDS = {
    "content", "turnComplete", "usageMetadata", "finishReason",
    "outputTranscription",
}

# Fields we know about but haven't implemented yet (with justification)
DOCUMENTED_EVENT_FIELDS = {
    "errorCode": "TODO: Add immediate detection in convert_event()",
    "errorMessage": "TODO: Add immediate detection in convert_event()",
    "inputTranscription": "Low priority: Client already has user input",
    "groundingMetadata": "Awaiting UI design decision",
    "citationMetadata": "Awaiting UI design decision",
    "interrupted": "Medium priority: BIDI UX feature",
    # ... complete list with justifications
}

# Internal/metadata fields (low priority, document why skipped)
METADATA_FIELDS = {
    "author", "id", "timestamp", "invocationId", "branch",
    "actions", "longRunningToolIds", "partial", "modelVersion",
    "avgLogprobs", "logprobsResult", "cacheMetadata",
    "liveSessionResumptionUpdate", "customMetadata"
}

def test_event_field_coverage():
    """Verify all Event fields are either implemented or documented as TODO."""
    event_sig = inspect.signature(Event)
    all_fields = set(event_sig.parameters.keys())

    known_fields = IMPLEMENTED_EVENT_FIELDS | set(DOCUMENTED_EVENT_FIELDS.keys()) | METADATA_FIELDS
    unknown_fields = all_fields - known_fields

    assert not unknown_fields, (
        f"🚨 New ADK Event fields detected: {unknown_fields}\n"
        f"Action required:\n"
        f"1. Review new fields in ADK SDK documentation\n"
        f"2. Decide: Implement now, document as TODO, or mark as metadata\n"
        f"3. Update IMPLEMENTED_EVENT_FIELDS, DOCUMENTED_EVENT_FIELDS, or METADATA_FIELDS\n"
        f"4. Update experiments/2025-12-12_adk_field_mapping_completeness.md\n"
    )

def test_part_field_coverage():
    """Verify all Part fields are accounted for."""
    # Similar pattern for Part fields
    part_sig = inspect.signature(types.Part)
    all_fields = set(part_sig.parameters.keys())

    # ... similar logic for Part fields
```

**CI Integration:**

Add to `.github/workflows/test.yaml` (or equivalent):
```yaml
- name: Check ADK field coverage
  run: |
    uv run pytest tests/unit/test_field_coverage.py -v
```

**Maintenance Workflow:**

When test fails (ADK SDK updated):
1. ✅ CI fails with "New ADK fields detected" message
2. 🔍 Review new fields in ADK documentation
3. 📊 Update coverage analysis in experiments/2025-12-12_adk_field_mapping_completeness.md
4. 💬 Discuss AI SDK v6 mapping strategy
5. ✅ Implement high-priority fields OR
6. 📝 Document as TODO with justification
7. ✅ Update test field lists
8. ✅ CI passes again

**Testing Requirements:**
- [ ] Test passes with current ADK SDK version
- [ ] Test fails when unknown field added (simulate by removing field from known list)
- [ ] Error message is clear and actionable
- [ ] Similar test for Part fields
- [ ] CI integration working

**Priority:** 🔴 HIGH - Prevents missing fields in future updates

**Impact:** Proactive detection of new ADK features instead of accidental discovery

**Reference:**
- experiments/2025-12-12_adk_field_mapping_completeness.md - Section "Automated Completeness Checking"
- scripts/check-adk-coverage-from-code.py - Current coverage detection (32.4%)

---

## ✅ Completed Tasks (Phase 1)

#### Task 4.4: Improve Type Safety with Real ADK Types

**Status:** ✅ Completed

**Completed Actions:**
- Created helper functions for real ADK types
- Migrated 10 tests to use real types (text, reasoning, tool execution)
- Fixed reasoning/thinking content handling bug (dead code detection)
- All 31 unit tests passing

**Commits:**
- dd8f2b7 - refactor: Migrate tests to use real ADK types
- a319581 - fix: Correct reasoning/thinking content handling

---

#### Fix Tool Event Names to Match AI SDK v6 Specification

**Status:** ✅ Completed

**Completed Actions:**
- Fixed incorrect event names to match official AI SDK v6 spec
  - `tool-call-start` → `tool-input-start`
  - `tool-call-available` → `tool-input-available`
  - `tool-result-available` → `tool-output-available`
- Updated stream_protocol.py implementation
- Updated lib/websocket-chat-transport.ts
- Updated all test expectations (2 test files)
- All tool-related tests passing (7/47 tests)

**Commits:**
- 3ebe567 - fix: Update tool event names to match AI SDK v6 specification

**Reference:** https://v6.ai-sdk.dev/docs/ai-sdk-ui/stream-protocol

---

#### Comprehensive ADK Event Mapping Documentation

**Status:** ✅ Completed

**Completed Actions:**
- Created IMPLEMENTATION.md with bidirectional mapping tables
  - ADK Event/Part Fields → AI SDK v6 Data Stream Protocol
  - AI SDK v6 Protocol → ADK Sources (reverse view)
  - 25 Event-level fields documented
  - 11 Part-level fields documented
- Added discussion section for unmapped fields with prioritization
- Clarified "Gemini 2.0" labeling → specific feature names
- Identified finishReason and WebSocket bidirectional issues

**Commits:**
- f0ad1a0 - docs: Add comprehensive ADK Event mapping to AI SDK v6 protocol

**References:**
- https://google.github.io/adk-docs/
- https://google.github.io/adk-docs/streaming/dev-guide/part5/

---

#### Add finishReason to finish Event

**Status:** ✅ Completed

**Completed Actions:**
- Updated `finalize()` method to accept `finish_reason` parameter
- Added `finishReason` field to finish event using existing `map_adk_finish_reason_to_ai_sdk()` function
- Updated `stream_adk_to_ai_sdk()` to extract and pass `event.finish_reason`
- Updated test expectations to verify `finishReason` mapping (MAX_TOKENS → "length")

**Files Modified:**
- `stream_protocol.py` - Added finish_reason handling in finalize() and stream_adk_to_ai_sdk()
- `tests/unit/test_stream_protocol.py` - Updated test_stream_with_usage_metadata

**Impact:**
- ✅ Frontend can now distinguish between completion types (stop, length, content-filter)
- ✅ AI SDK v6 Data Stream Protocol compliance improved

**Reference:** IMPLEMENTATION.md - Section "1. `finish_reason` → `finishReason` field"

---

## Phase 3: 新機能検討（UI設計判断待ち）

### [P3-T1] Live API Transcriptions Support

**ADK Fields**:
- ✅ `Event.output_transcription` - **IMPLEMENTED** (2025-12-12)
- ❌ `Event.input_transcription` - Not implemented

**Status:** Partially complete

**Completed:**
- ✅ `output_transcription` → `text-start/delta/end` events
- ✅ Native-audio model audio responses are transcribed to text
- ✅ UI displays transcribed text (no longer stuck on "Thinking...")
- ✅ Tests: `test_output_transcription_real_response.py` (4 tests passing)

**Remaining Work:**

**1. Input Transcription (`Event.input_transcription`)**

**Use Case**: Display user's speech as text (accessibility, confirmation)

**Proposal Options:**
- **Option A**: Custom event `input-transcription-delta` (clear separation)
- **Option B**: `message-annotations` (AI SDK v6 standard)
- **Option C**: Don't implement (client already has user input)

**Decision Needed**: Which option to implement? (Leaning toward Option C)

**2. UI Design for Input Transcription Display**
- Where to show user's speech transcription?
- Real-time updates vs final transcription?
- Accessibility features integration?

**Priority:** 🟢 LOW - output_transcription (critical) is done, input_transcription (nice-to-have) deferred

**Reference:**
- IMPLEMENTATION.md - Section "1. Live API Transcriptions"
- experiments/2025-12-12_adk_bidi_message_history_and_function_calling.md - Section "RESOLUTION: output_transcription Support Implemented"
- experiments/2025-12-12_adk_field_mapping_completeness.md - inputTranscription marked as "Low priority"

---

### [P3-T2] Grounding & Citation Metadata Support

**ADK Fields**: `Event.grounding_metadata`, `Event.citation_metadata`

**Use Case**: Display sources and citations (like Perplexity.ai, ChatGPT search)

**Proposal**: Use custom `data-*` events for grounding sources

**Challenge**: Complex metadata structure, needs UI design

**Priority:** 🟡 MEDIUM - Requires UI design decision

**Reference:** IMPLEMENTATION.md - Section "2. Grounding & Citation Metadata"

---

## Phase 4: その他

### [P4-T1] Interruption Signal Support (BIDI UX)

**ADK Field**: `Event.interrupted`

**Use Case**: Handle user interruptions during assistant speech in BIDI mode

**Scenario**:
1. User asks question
2. Assistant starts speaking (audio response streaming)
3. User interrupts mid-sentence with new question
4. System should:
   - Stop current response
   - Signal UI that response was interrupted
   - Start processing new question

**Current Behavior**: Unknown if ADK sends `interrupted` events

**Proposal**: Map to AI SDK v6 event
- **Option A**: Custom event `{ type: "interrupted" }`
- **Option B**: Extend finish event: `{ type: "finish", finishReason: "interrupted" }`
- **Recommendation**: Option B (uses existing finish event with new reason)

**Implementation:**

```python
# stream_protocol.py:~180 (in convert_event)
if hasattr(event, "interrupted") and event.interrupted:
    logger.info("[INTERRUPTED] User interrupted assistant response")
    # Could send finish event with special reason
    yield self._format_sse_event({
        "type": "finish",
        "finishReason": "interrupted",  # Custom reason
        "messageMetadata": {...}
    })
    return
```

**Testing Requirements:**
- [ ] Test with real ADK BIDI mode interruption
- [ ] Verify UI handles interrupted state
- [ ] Verify new message starts cleanly after interruption

**Priority:** 🟡 MEDIUM - BIDI UX improvement (not critical)

**Reference:**
- experiments/2025-12-12_adk_field_mapping_completeness.md - interrupted marked as "Medium priority: BIDI UX feature"

---

### [P4-T2] File References Support

**ADK Fields**: `Part.file_data`

**Use Case**: Display file attachments from Cloud Storage (gs:// URLs)

**Proposal**: Use `file` event with backend proxy for signed URLs

**Challenge**:
- File URIs (gs://) require signed URLs or proxy for browser access
- Need backend endpoint to serve/proxy Cloud Storage files

**Priority:** 🟢 LOW - Requires backend proxy implementation

**Reference:** IMPLEMENTATION.md - Section "3. File References"

---

### [P4-T3] Advanced Metadata Features

**ADK Fields**: `avg_logprobs`, `logprobs_result`, `cache_metadata`, `interrupted`, `video_metadata`, `media_resolution`

**Use Case**: Advanced debugging and optimization features

**Challenge**: These are advanced features not typically displayed in chat UI

**Priority:** 🟢 LOW - Implement only if specific use case arises

**Reference:** IMPLEMENTATION.md - Section "4. Advanced Features"

---

### [P4-T4] Multimodal Integration Testing

**Prerequisites:**
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

### [P4-T5] Documentation Updates

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
- ❌ ADK BIDI audio streaming (WebSocket timeout)

**Untested:**
- ⚠️ End-to-end image upload
- ⚠️ Image display in chat messages
- ⚠️ Multi-image messages

**Current Focus:** Phase 2 - Architecture stabilization ([P2-T1], [P2-T2])

---

## Completed Tasks (Recent History)

- ✅ Task 4.1: Tool Call ID Mapping (commit 5ff0822) - Fixed critical UI bug
- ✅ Task 4.2: Usage Metadata Support (commit 0ffef44) - Added token tracking
- ✅ Task 4.3: Code Duplication Reduction (commit efe6f38) - Improved maintainability
- ✅ Phase 1-3: ADK BIDI Integration - WebSocket, image support, comprehensive tests
- ✅ AI SDK v6 endpoint switching bug fix (commits ee4784a, 8bea94e)
- ✅ Files API migration for image uploads (commit c638026)
- ✅ Stream protocol fixes for AI SDK v6 compliance (commit 9b2a2ea)
