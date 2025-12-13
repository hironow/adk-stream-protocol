# Agent Tasks

This file tracks current and future implementation tasks for the ADK AI Data Protocol project.

## 📋 Implementation Phases

**Phase 1-3:** ✅ Complete (All core features implemented)

**Phase 4:** 🟢 Low Priority / Future Enhancements

---

## Phase 4: Low Priority Tasks

### [P4-T1] Interruption Signal Support (BIDI UX)

**Description:** Implement ADK `interrupted` event handling for better user interruption feedback

**Status:** Not Started

**Priority:** Low

**Related Experiments:** None

**Implementation:**
- Add `Event.interrupted` field handling in stream_protocol.py
- Map to appropriate UI feedback event
- Test interruption scenarios in BIDI mode

---

### [P4-T2] File References Support (Part.fileData)

**Description:** Implement `Part.fileData` for file references (documents, PDFs, etc.) beyond images

**Status:** Not Started

**Priority:** Medium

**Related Experiments:**
- `experiments/2025-12-12_adk_field_mapping_completeness.md`

**Current State:**
- Images supported via `Part.inlineData` → `file` event with data URLs
- File references (fileData) not yet implemented

**Implementation Tasks:**
1. Investigate ADK `Part.fileData` structure and use cases
2. Design AI SDK v6 mapping strategy (file event vs source-document)
3. Implement conversion in stream_protocol.py
4. Add frontend display support
5. Test with various file types (PDF, DOCX, etc.)

**Testing:**
- Add test cases for fileData in test_stream_protocol.py
- Create fixture with real ADK fileData responses

---

### [P4-T3] Advanced Metadata Features

**Description:** Implement low-priority ADK metadata fields

**Status:** Not Started

**Priority:** Low

**Related Experiments:**
- `experiments/2025-12-12_adk_field_mapping_completeness.md`

**Remaining Fields:**
- `Event.logprobsResult` - Token log probabilities
- `Event.avgLogprobs` - Average log probabilities
- `Event.liveSessionResumptionUpdate` - Session resumption state
- `Event.customMetadata` - User-defined metadata
- `Event.partial` - Partial response flag
- Other internal fields (invocationId, author, actions, etc.)

**Note:** These fields are low priority as they don't affect core functionality

---

### [P4-T4] Multimodal Integration Testing

**Description:** Comprehensive testing strategy for ADK multimodal features

**Status:** Partial

**Priority:** Medium

**Related Experiments:**
- `experiments/2025-12-13_lib_test_coverage_investigation.md`
- `experiments/2025-12-12_adk_field_mapping_completeness.md`

**Tasks:**

**T4.1: ADK Response Fixture Files**
- Create `tests/fixtures/adk_events/` directory
- Capture real ADK responses for different modes:
  - TEXT mode responses
  - AUDIO mode (native-audio) responses
  - Different models (gemini-2.0-flash-exp, etc.)
- Document expected event sequences

**T4.2: Field Coverage Test Updates**
- Update `tests/unit/test_field_coverage.py` with newly implemented fields:
  - Mark inputTranscription, groundingMetadata, citationMetadata as IMPLEMENTED
  - Mark errorCode, errorMessage, cacheMetadata, modelVersion as IMPLEMENTED
- Ensure test fails when new ADK fields are added

**T4.3: Integration Test TODO Comments**
- Update `lib/use-chat-integration.test.tsx:850, 853`
- Current TODOs reference Step 1-2 and Step 6-8
- Actual tests already exist at lines 139-183 and 185-265
- Action: Remove outdated TODOs or update with specific missing scenarios

**T4.4: Systematic Model/Mode Testing**
- Test each ADK model/mode combination:
  - TEXT vs AUDIO modality
  - Different model versions
  - SSE vs BIDI transport
- Verify all Event/Part fields are correctly mapped

---

### [P4-T5] Documentation Updates

**Description:** Document multimodal limitations and future work

**Status:** Not Started

**Priority:** Low

**Related Experiments:**
- `experiments/2025-12-11_adk_bidi_multimodal_support.md`

**Documentation Tasks:**
1. Document current multimodal support status:
   - ✅ Phase 1-3 Complete (Images, Audio Output, Audio Input)
   - ⬜ Phase 4 Future (Video)
2. Document known limitations:
   - WebSocket reconnection with unique session IDs (deferred)
   - No native Voice Activity Detection (CMD key workaround)
   - Cannot mix TEXT and AUDIO modalities in one session
3. Create architecture documentation:
   - How AudioWorklet PCM streaming works
   - Tool approval flow (frontend delegation pattern)
   - Per-connection state management pattern
4. Update README.md with current capabilities

---

### [P4-T6] lib/ Test Coverage Optional Improvements

**Description:** Address optional test coverage gaps (non-blocking)

**Status:** Optional

**Priority:** Low

**Related Experiments:**
- `experiments/2025-12-13_lib_test_coverage_investigation.md`

**Optional Tasks:**

**T6.1: Review Skipped Tests**
- `lib/websocket-chat-transport.test.ts:258` - Connection timeout behavior
- `lib/websocket-chat-transport.test.ts:788` - Connection failure handling
- **Note:** Not bugs - implementation-dependent behavior needing specification
- **Status:** Non-blocking, specification needed before implementation

**T6.2: Verify Integration Test Coverage**
- TODO comments in `lib/use-chat-integration.test.tsx` may be outdated
- Verify Step 1-2 and Step 6-8 scenarios are fully covered
- **Current State:** Tests exist but TODOs remain

---

## Future Work (Deferred / Nice-to-have)

### [FW-1] Progressive Audio Playback
- Implement Web Audio API progressive playback
- Replace current buffering approach

### [FW-2] Audio Visualization
- Add waveform display for audio streams
- Real-time visualization during playback

### [FW-3] Phase 4: Video Streaming Support
- Investigate ADK video streaming capabilities
- Design AI SDK v6 mapping for video
- Implement video player component

### [FW-4] Voice Activity Detection Enhancements
- Implement browser-based VAD
- Replace CMD key push-to-talk with automatic detection

### [FW-5] Production Deployment Guide
- Document production deployment best practices
- Security considerations
- Scaling recommendations

### [FW-6] Performance Benchmarking
- Compare streaming approaches (SSE vs WebSocket)
- Measure latency metrics
- Optimize audio buffering
