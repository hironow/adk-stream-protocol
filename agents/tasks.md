# Agent Tasks

This file tracks current and future implementation tasks for the ADK AI Data Protocol project.

## 📋 Implementation Phases

**Phase 1: 即座に対応（機能ブロック解消）** - ✅ Complete
- No blocking issues remaining (finishReason implemented)

**Phase 2: アーキテクチャ安定化** - 🟡 In Progress
- [P2-T1] WebSocket Timeout Investigation
- [P2-T2] WebSocket Bidirectional Communication
- [P2-T3] Immediate Error Detection (errorCode/errorMessage) - ✅ Complete
- [P2-T4] Field Coverage Testing (Automated CI Checks) - ✅ Complete
- [P2-T5] Tool Error Handling - 🔴 High Priority
- [P2-T6] Unify Image Events to `file` Type - ✅ Complete
- [P2-T7] Audio Completion Signaling - 🔴 High Priority
- [P2-T8] message-metadata Event Implementation - 🟡 Medium Priority

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
- scripts/check-coverage.py - Current coverage detection (34.2%)

---

### [P2-T5] Tool Error Handling

**Issue:** Tool execution errors are not properly communicated to frontend

**Current Behavior:**
- Only `tool-input-start`, `tool-input-available`, `tool-output-available` events are generated
- No error events when tool execution fails
- ADK tool errors are not caught and converted to AI SDK v6 error events

**Missing Event Types:**
- `tool-input-error` - Tool input validation failed
- `tool-output-error` - Tool execution failed
- `tool-error` - Generic tool error (TextStreamPart type)

**Required Implementation:**

**1. Add tool error detection in `_process_function_response()`:**

```python
# stream_protocol.py:380-410 (in _process_function_response)
def _process_function_response(
    self, function_response: types.FunctionResponse
) -> list[str]:
    """Process function response into tool-output-available or tool-output-error event."""
    tool_name = function_response.name
    tool_call_id = self.tool_call_id_map.get(tool_name)

    if not tool_call_id:
        logger.warning(f"[TOOL] No tool_call_id found for function: {tool_name}")
        return []

    # Check if function response contains error
    # ADK tool errors often have { "error": "...", "success": false } structure
    output = function_response.response

    # Detect error in response
    is_error = False
    error_message = None

    if isinstance(output, dict):
        if output.get("success") is False:
            is_error = True
            error_message = output.get("error", "Unknown tool error")
        elif "error" in output and output.get("result") is None:
            is_error = True
            error_message = output.get("error", "Unknown tool error")

    # Send error event if error detected
    if is_error:
        event = self._format_sse_event({
            "type": "tool-output-error",
            "toolCallId": tool_call_id,
            "errorText": str(error_message),
        })
        logger.error(f"[TOOL ERROR] {tool_name}: {error_message}")
        return [event]

    # Normal success response
    event = self._format_sse_event({
        "type": "tool-output-available",
        "toolCallId": tool_call_id,
        "output": output,
    })
    return [event]
```

**2. Add exception handling in `stream_adk_to_ai_sdk()`:**

```python
# stream_protocol.py:564-616 (in stream_adk_to_ai_sdk)
try:
    async for event in event_stream:
        try:
            async for sse_event in converter.convert_event(event):
                yield sse_event
        except Exception as convert_error:
            # Log conversion error but continue stream
            logger.error(f"[CONVERT ERROR] Failed to convert event: {convert_error}")
            # Send error event to frontend
            yield converter._format_sse_event({
                "type": "error",
                "error": f"Event conversion failed: {str(convert_error)}"
            })
except Exception as e:
    # ... existing error handling
```

**Testing Requirements:**
- [ ] Test with tool that returns error response (`{ "success": false, "error": "..." }`)
- [ ] Test with tool that raises exception
- [ ] Verify `tool-output-error` event is sent to frontend
- [ ] Verify UI displays tool error appropriately
- [ ] Add unit test: `test_tool_execution_error()`

**Priority:** 🔴 HIGH - Critical for proper tool error UX

**Impact:** Users will see tool errors immediately instead of silent failures

---

### [P2-T6] Unify Image Events to `file` Type

**Status:** ✅ Complete (Implemented 2025-12-12)

**Implementation:**

**1. Backend (stream_protocol.py:608-620):**
```python
# Process image data
if mime_type.startswith("image/"):
    # Convert bytes to base64 string
    base64_content = base64.b64encode(inline_data.data).decode("utf-8")

    # Use AI SDK v6 standard 'file' event with data URL
    # This matches the input format (symmetric input/output)
    event = self._format_sse_event({
        "type": "file",
        "url": f"data:{mime_type};base64,{base64_content}",
        "mediaType": mime_type,
    })
    logger.debug(f"[IMAGE OUTPUT] mime_type={mime_type}, size={len(inline_data.data)} bytes")
    return [event]
```

**2. Frontend (message.tsx:221-235):**
```typescript
// File content - Image (AI SDK v6 file part)
if (part.type === "file" && part.mediaType?.startsWith("image/")) {
  return (
    <img
      key={index}
      src={part.url}
      alt={part.filename || "Image"}
      style={{ maxWidth: "100%", borderRadius: "8px", margin: "0.5rem 0" }}
    />
  );
}
```

**3. Coverage Verification:**
- ✅ Backend generates `file` events (confirmed by `just check-coverage-verbose`)
- ✅ Frontend handles `file` events (confirmed by coverage report)

**Results:**
- ✅ Symmetric input/output format achieved
- ✅ AI SDK v6 standard compliance
- ✅ Backward compatibility maintained (legacy `data-image` handling still present)

**Commit:** 05161a7 (Dec 12, 2025)

---

### [P2-T7] Audio Completion Signaling - Frontend Integration

**Status:** ⚠️ Partially Complete (Backend ✅, Frontend ❌)

**Current Implementation:**

**Backend (✅ Complete):**
- ✅ `finalize()` method sends `finish` event with `messageMetadata.audio` (stream_protocol.py:684-701)
- ✅ Metadata includes: chunks, bytes, sampleRate, duration
- ✅ Logs completion: "[AUDIO COMPLETE] chunks=654, bytes=111360, sampleRate=24000, duration=14.50s"
- ✅ Works correctly in BIDI mode with turn_complete events

**Frontend (❌ Incomplete):**
- ✅ WebSocket transport receives `finish` event (lib/websocket-chat-transport.ts:402-412)
- ✅ Logs metadata to console: "[Audio Stream] Audio streaming completed"
- ❌ **Does NOT notify AudioContext** - no callback to voiceChannel
- ❌ **Does NOT update UI** - no visual indication of completion

**Missing Implementation:**

**1. Add completion callback to AudioContext (lib/audio-context.tsx):**

```typescript
interface AudioContextValue {
  voiceChannel: {
    isPlaying: boolean;
    chunkCount: number;
    sendChunk: (chunk: PCMChunk) => void;
    reset: () => void;
    onComplete: (metadata: AudioMetadata) => void;  // ← ADD THIS
  };
}

interface AudioMetadata {
  chunks: number;
  bytes: number;
  sampleRate: number;
  duration: number;
}
```

**2. Update WebSocket transport to call callback (lib/websocket-chat-transport.ts):**

```typescript
// Line 402-412 (existing code)
if (chunk.type === "finish" && chunk.messageMetadata?.audio) {
  const metadata = chunk.messageMetadata.audio;

  console.log("[Audio Stream] Audio streaming completed");
  // ... existing logs ...

  // NEW: Notify AudioContext
  if (this.config.audioContext?.voiceChannel?.onComplete) {
    this.config.audioContext.voiceChannel.onComplete(metadata);
  }
}
```

**3. Display completion in UI (components/message.tsx or components/chat.tsx):**

```typescript
// Option A: Show in message component
{audioInfo && (
  <div>
    <div>🔊 Audio: {audioInfo.duration.toFixed(2)}s ({audioInfo.chunks} chunks)</div>
  </div>
)}

// Option B: Show in chat status area
{mode === "adk-bidi" && audioContext.voiceChannel.lastCompletion && (
  <div>✓ Audio completed: {audioContext.voiceChannel.lastCompletion.duration}s</div>
)}
```

**Testing Requirements:**
- [ ] Verify AudioContext.onComplete() is called when audio finishes
- [ ] Verify UI shows completion status
- [ ] Verify metadata (chunks, bytes, duration) is displayed correctly
- [ ] Test with multiple audio responses in same session
- [ ] Verify no memory leaks from completion callbacks

**Priority:** 🔴 HIGH - Critical for BIDI audio UX completion

**Impact:** Users can see when audio playback has finished, better UX feedback

**Related:** [ST-1] Frontend Audio Recording (agents/sub_tasks.md) - uses this completion signal

**Reference:**
- stream_protocol.py:684-701 (backend implementation ✅)
- lib/websocket-chat-transport.ts:402-412 (frontend reception ✅)
- Experiment: 2025-12-12_audio_stream_completion_notification.md

---

### [P2-T8] message-metadata Event Implementation

**Issue:** ADK metadata fields (grounding, citations, cache, etc.) are not forwarded to frontend

**Goal:** Implement `message-metadata` event to forward ADK metadata fields

**Current Missing Fields:**
- `groundingMetadata` - RAG sources, web search results
- `citationMetadata` - Citation information
- `cacheMetadata` - Context cache statistics
- `modelVersion` - Model version used
- `customMetadata` - User-defined metadata
- `inputTranscription` - User audio transcription
- `logprobsResult`, `avgLogprobs` - Token probabilities

**Implementation Strategy:**

**Phase 1: Add metadata to `finish` event (Priority 1)**

```python
# stream_protocol.py:507-560 (extend finalize method)
async def finalize(
    self,
    usage_metadata: Any | None = None,
    error: Exception | None = None,
    finish_reason: Any | None = None,
    grounding_metadata: Any | None = None,  # NEW
    citation_metadata: Any | None = None,   # NEW
    cache_metadata: Any | None = None,      # NEW
    model_version: str | None = None,       # NEW
) -> AsyncGenerator[str, None]:
    # ... existing code ...

    # Build messageMetadata
    metadata: dict[str, Any] = {}

    # Add usage
    if usage_metadata:
        metadata["usage"] = { ... }

    # Add audio stats
    if self.pcm_chunk_count > 0:
        metadata["audio"] = { ... }

    # Add grounding sources (NEW)
    if grounding_metadata:
        sources = []
        for chunk in grounding_metadata.grounding_chunks or []:
            if hasattr(chunk, 'web'):
                sources.append({
                    "type": "web",
                    "uri": chunk.web.uri,
                    "title": chunk.web.title,
                })
        if sources:
            metadata["grounding"] = {"sources": sources}

    # Add citations (NEW)
    if citation_metadata:
        citations = []
        for source in citation_metadata.citation_sources or []:
            citations.append({
                "startIndex": source.start_index,
                "endIndex": source.end_index,
                "uri": source.uri,
                "license": source.license,
            })
        if citations:
            metadata["citations"] = citations

    # Add cache metadata (NEW)
    if cache_metadata:
        metadata["cache"] = {
            "hits": getattr(cache_metadata, "cache_hits", 0),
            "misses": getattr(cache_metadata, "cache_misses", 0),
        }

    # Add model version (NEW)
    if model_version:
        metadata["modelVersion"] = model_version

    if metadata:
        finish_event["messageMetadata"] = metadata

    yield self._format_sse_event(finish_event)
```

**Phase 2: Collect metadata from events (Priority 1)**

```python
# stream_protocol.py:564-616 (update stream_adk_to_ai_sdk)
async def stream_adk_to_ai_sdk(event_stream):
    # ... existing code ...

    # Track metadata from events
    grounding_metadata = None
    citation_metadata = None
    cache_metadata = None
    model_version = None

    try:
        async for event in event_stream:
            # Collect metadata fields
            if hasattr(event, "grounding_metadata") and event.grounding_metadata:
                grounding_metadata = event.grounding_metadata
            if hasattr(event, "citation_metadata") and event.citation_metadata:
                citation_metadata = event.citation_metadata
            if hasattr(event, "cache_metadata") and event.cache_metadata:
                cache_metadata = event.cache_metadata
            if hasattr(event, "model_version") and event.model_version:
                model_version = event.model_version

            # ... existing conversion logic ...
    finally:
        # Send finalize with all collected metadata
        async for final_event in converter.finalize(
            usage_metadata=usage_metadata,
            error=error,
            finish_reason=finish_reason,
            grounding_metadata=grounding_metadata,
            citation_metadata=citation_metadata,
            cache_metadata=cache_metadata,
            model_version=model_version,
        ):
            yield final_event
```

**Phase 3: Standalone message-metadata events (Priority 2)**

For streaming updates during generation (optional):

```python
# stream_protocol.py:convert_event (add metadata event generation)
async def convert_event(self, event: Event) -> AsyncGenerator[str, None]:
    # ... existing error check ...

    # Send grounding metadata as standalone event (if mid-stream)
    if hasattr(event, "grounding_metadata") and event.grounding_metadata:
        # Only send as standalone if not in finalize (to avoid duplication)
        if not hasattr(event, "turn_complete") or not event.turn_complete:
            sources = [...]  # Extract sources
            if sources:
                yield self._format_sse_event({
                    "type": "message-metadata",
                    "messageMetadata": {
                        "grounding": {"sources": sources}
                    }
                })
```

**Testing Requirements:**
- [ ] Test with ADK response containing groundingMetadata
- [ ] Test with ADK response containing citationMetadata
- [ ] Test with ADK response containing cacheMetadata
- [ ] Verify `finish` event includes messageMetadata
- [ ] Verify frontend can access metadata
- [ ] Add unit tests for metadata extraction

**Priority:** 🟡 MEDIUM - Enhances transparency, not critical for basic functionality

**Impact:** Frontend can display grounding sources, citations, cache stats

**Reference:**
- experiments/2025-12-12_adk_field_mapping_completeness.md - Section "High-Value Fields"
- AI SDK v6 UIMessageChunk type (message-metadata event)

---
