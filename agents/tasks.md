# Agent Tasks

This file tracks current and future implementation tasks for the ADK AI Data Protocol project.

## 📋 Implementation Phases

**Phase 1: 即座に対応（機能ブロック解消）** - ✅ Complete
- No blocking issues remaining (finishReason implemented)

**Phase 2: アーキテクチャ安定化** - 🟡 In Progress
- [P2-T1] WebSocket Timeout Investigation
- [P2-T2] WebSocket Bidirectional Communication

**Phase 3: 新機能検討（UI設計判断待ち）** - ⏸️ Awaiting Decision
- [P3-T1] Live API Transcriptions
- [P3-T2] Grounding & Citation Metadata

**Phase 4: その他** - 🟢 Low Priority
- [P4-T1] Multimodal Integration Testing
- [P4-T2] File References Support
- [P4-T3] Advanced Metadata Features
- [P4-T4] Documentation Updates

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

**ADK Fields**: `Event.input_transcription`, `Event.output_transcription`

**Use Case**: Display real-time speech-to-text during voice conversations

**Proposal**: Use custom `data-*` events
- `data-input-transcription` - User speech → text
- `data-output-transcription` - Model speech → text

**Challenge**: Need UI design decision for transcription display

**Priority:** 🟡 MEDIUM - Requires UI design decision

**Reference:** IMPLEMENTATION.md - Section "1. Live API Transcriptions"

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

### [P4-T1] Multimodal Integration Testing

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

### [P4-T4] Documentation Updates

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
