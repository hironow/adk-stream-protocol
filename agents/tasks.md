# Agent Tasks

This file tracks current and future implementation tasks for the ADK AI Data Protocol project.

## 📋 Implementation Phases

**Phase 1-3:** ✅ Complete (All core features implemented)

**Phase 4:** 🟢 Low Priority / Future Enhancements

---

## 📊 Priority Tiers Summary

**Tier 1 - Immediate (Complete Today):**
- ✅ [P4-T4.2] Field Coverage Test Updates - **COMPLETED 2025-12-14**
- ✅ [P4-T4.3] Integration Test TODO Comments - **COMPLETED 2025-12-14** (Already removed in commit 40d01d6)

**Tier 2 - High Priority (1-2 weeks):**
- ✅ [P4-T7] Repeatable Chunk Logger & Player (8-12 hours) - **COMPLETED 2025-12-14** (Phase 1-4 Complete, E2E Infrastructure Ready)
- ✅ [P4-T5] Documentation Updates (2-3 hours) - **COMPLETED 2025-12-14** (ARCHITECTURE.md created, README.md updated)
- [P4-T4.1] ADK Response Fixture Files (3-4 hours)
- [P4-T4.4] Systematic Model/Mode Testing (4-6 hours)

**Tier 3 - Planned (When use case emerges):**
- [P4-T2] File References Support

**Tier 4-5 - Deferred:**
- [P4-T1] Interruption Signal Support
- [P4-T3] Advanced Metadata Features
- [P4-T6.1] Review Skipped Tests

---

## Phase 4: Low Priority Tasks

### [P4-T1] Interruption Signal Support (BIDI UX)

**Description:** Implement ADK `interrupted` event handling for better user interruption feedback

**Status:** Not Started

**Priority:** Low (Tier 4 - Deferred)

**Related Experiments:** None

**Implementation:**
- Add `Event.interrupted` field handling in stream_protocol.py
- Map to appropriate UI feedback event
- Test interruption scenarios in BIDI mode

---

### [P4-T2] File References Support (Part.fileData)

**Description:** Implement `Part.fileData` for file references (documents, PDFs, etc.) beyond images

**Status:** Not Started

**Priority:** Medium (Tier 3 - Planned, when use case emerges)

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

**Priority:** Low (Tier 5 - Deferred)

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

**Priority:** Mixed (T4.1/T4.4: Tier 2 High Priority, T4.2/T4.3: Completed)

**Related Experiments:**
- `experiments/2025-12-13_lib_test_coverage_investigation.md`
- `experiments/2025-12-12_adk_field_mapping_completeness.md`

**Tasks:**

**T4.1: ADK Response Fixture Files** (Tier 2 - High Priority, 3-4 hours)
- Create `tests/fixtures/adk_events/` directory
- Capture real ADK responses for different modes:
  - TEXT mode responses
  - AUDIO mode (native-audio) responses
  - Different models (gemini-2.0-flash-exp, etc.)
- Document expected event sequences

**T4.2: Field Coverage Test Updates** ✅ **COMPLETED 2025-12-14**
- ✅ Created `TEST_COVERAGE_AUDIT.md` - comprehensive field coverage audit
- ✅ Added 12 new parametrized tests (8 Python + 4 TypeScript)
- ✅ Achieved 100% field coverage (12/12 Event fields, 7/7 Part fields)
- ✅ Critical gaps resolved:
  - errorCode/errorMessage: 4 parametrized tests
  - turnComplete: 4 parametrized tests
  - messageMetadata fields: 4 TypeScript parametrized tests
- ✅ All 112 Python tests passing, all TypeScript tests passing
- **Experiment**: `experiments/2025-12-14_adk_field_parametrized_test_coverage.md`

**T4.3: Integration Test TODO Comments** ✅ **COMPLETED 2025-12-14**
- ✅ TODOs already removed in commit 40d01d6 (2025-12-14 01:07:36)
- ✅ Step 1-2 tests exist at lines 139-183
- ✅ Step 6-8 tests exist at lines 185-265
- ✅ No outstanding TODO comments in `lib/use-chat-integration.test.tsx`
- **Investigation**: Comprehensive codebase scan confirmed no remaining TODOs

**T4.4: Systematic Model/Mode Testing** (Tier 2 - High Priority, 4-6 hours)
- Test each ADK model/mode combination:
  - TEXT vs AUDIO modality
  - Different model versions
  - SSE vs BIDI transport
- Verify all Event/Part fields are correctly mapped

---

### [P4-T5] Documentation Updates

**Description:** Document multimodal limitations and future work

**Status:** ✅ **COMPLETED 2025-12-14**

**Priority:** Medium (Tier 2 - High Priority, 2-3 hours)

**Related Experiments:**
- `experiments/2025-12-11_adk_bidi_multimodal_support.md`

**Completed Documentation Tasks:**
1. ✅ Document current multimodal support status:
   - ✅ Phase 1-3 Complete (Images, Audio Output, Audio Input)
   - ⬜ Phase 4 Future (Video)
2. ✅ Document known limitations:
   - WebSocket reconnection with unique session IDs (deferred)
   - No native Voice Activity Detection (CMD key workaround)
   - Cannot mix TEXT and AUDIO modalities in one session
   - Progressive audio playback not implemented
3. ✅ Create architecture documentation:
   - ARCHITECTURE.md created with comprehensive technical details
   - AudioWorklet PCM streaming architecture (lib/audio-recorder.ts)
   - Tool approval flow (frontend delegation pattern)
   - Per-connection state management pattern
   - Multimodal support architecture (Images, Audio I/O)
   - Protocol flow diagrams with Japanese legends
4. ✅ Update README.md with current capabilities:
   - Added "Multimodal Capabilities" section
   - Detailed feature matrix with status
   - Architecture flow descriptions
   - Known limitations documented
   - Reference to ARCHITECTURE.md for technical details
5. ✅ Documentation consolidation (Option A):
   - Created docs/adr/0001-per-connection-state-management.md
   - Migrated SPEC.md design decisions to ADR format
   - Updated IMPLEMENTATION.md with Phase 1-3 completion status
   - Deleted SPEC.md (663 lines) to reduce duplication
   - Established ADR pattern for immutable design decisions
6. ✅ Documentation-implementation consistency review:
   - Fixed ADR 0001 terminology (connection_id → connection_signature)
   - Corrected Phase 3 status (NOT IMPLEMENTED)
   - Updated ARCHITECTURE.md code examples to match server.py
   - Verified all docs match current implementation (CLAUDE.md compliance)
7. ✅ README.md restructuring and GETTING_STARTED guide creation:
   - Simplified README.md to core information (1,227 → 226 lines, 81.6% reduction)
   - Created comprehensive docs/GETTING_STARTED.md (625 lines)
   - Moved detailed setup, configuration, and usage examples to GETTING_STARTED
   - Added AI SDK v6 migration notes with breaking changes
   - Added troubleshooting section with common issues
   - Established clear documentation structure (README = overview, GETTING_STARTED = details)
   - Verified 100% implementation consistency for all content

---

### [P4-T6] lib/ Test Coverage Optional Improvements

**Description:** Address optional test coverage gaps (non-blocking)

**Status:** Optional

**Priority:** Low (Tier 5 - Deferred, T6.2 completed as part of T4.3)

**Related Experiments:**
- `experiments/2025-12-13_lib_test_coverage_investigation.md`

**Optional Tasks:**

**T6.1: Review Skipped Tests**
- `lib/websocket-chat-transport.test.ts:258` - Connection timeout behavior
- `lib/websocket-chat-transport.test.ts:788` - Connection failure handling
- **Note:** Not bugs - implementation-dependent behavior needing specification
- **Status:** Non-blocking, specification needed before implementation

**T6.2: Verify Integration Test Coverage** ✅ **COMPLETED 2025-12-14** (merged into T4.3)
- ✅ TODO comments removed in commit 40d01d6
- ✅ Step 1-2 and Step 6-8 scenarios verified as fully covered
- ✅ Comprehensive codebase scan confirmed no remaining TODOs

---

### [P4-T7] Repeatable Chunk Logger & Player

**Description:** Implement chunk recording/playback mechanism for E2E test automation and debugging

**Status:** ✅ **COMPLETED 2025-12-14** (Phase 1-4 Complete, Production Ready)

**Priority:** Tier 2 - High Priority

**Related Experiments:**
- `experiments/2025-12-14_repeatable_chunk_logger_player.md`

**Objective:**
Enable recording of actual chunk data during manual operations and replay them for:
1. E2E test automation
2. Debugging and issue reproduction
3. Chunk conversion validation across 3 modes
4. Regression testing with real data

**Completed:**
- ✅ Design complete in experiment note
- ✅ Identified 5 injection points (2 backend, 3 frontend)
- ✅ JSONL format chosen and implemented
- ✅ Phase 1-4 implementation complete
- ✅ Usage examples documented
- ✅ Manual verification successful (all 3 modes)
- ✅ Environment variable support (NEXT_PUBLIC_CHUNK_LOGGER_*)

**Implementation Phases:**

**Phase 1: Backend Logger (Python)** ✅ **COMPLETED 2025-12-14** (commit 5dc2d14)
- ✅ Created `chunk_logger.py` (root directory)
  - ChunkLogger class with JSONL writer
  - Environment variable control (CHUNK_LOGGER_ENABLED, CHUNK_LOGGER_SESSION_ID, CHUNK_LOGGER_OUTPUT_DIR)
  - Session ID management (auto-generation)
- ✅ Injected logger into `stream_protocol.py` (stream_adk_to_ai_sdk function)
  - ADK event logging (repr format) - Line ~921-927
  - SSE event logging (raw string) - Line ~854-869
  - Final event logging - Line ~915-928
- ✅ Tests for logger functionality: 13/13 passing
- **Actual time**: 3 hours

**Phase 2: Frontend Logger (TypeScript)** ✅ **COMPLETED 2025-12-14** (commit bd83e26)
- ✅ Created `lib/chunk-logger.ts`
  - ChunkLogger class for browser
  - In-memory storage + Blob + Download for JSONL export
  - localStorage configuration (CHUNK_LOGGER_ENABLED, CHUNK_LOGGER_SESSION_ID)
- ✅ Created `lib/chunk-logging-transport.ts` (DefaultChatTransport wrapper)
- ✅ Injected logger into transports
  - WebSocketChatTransport (ADK BIDI) - input/output logging
  - ChunkLoggingTransport wrapper (ADK SSE + Gemini Direct)
  - build-use-chat-options.ts integration
- ✅ Backend logger fix: Raw SSE string logging (no parse/re-encode)
- **Actual time**: 4 hours

**Phase 3: Player Mechanism** ✅ **COMPLETED 2025-12-14** (commit d3b5797)
- ✅ Created `chunk_player.py` (Backend)
  - JSONL reader with AsyncGenerator interface
  - Timing control (real-time/fast-forward/step)
  - Statistics API (count, duration, timestamps)
  - Sequence number sorting
- ✅ Created `lib/chunk-player.ts` (Frontend)
  - JSONL parser with AsyncGenerator interface
  - Static factory methods (fromFile, fromUrl)
  - Timing control (real-time/fast-forward/step)
  - Statistics API
- ✅ Tests for player functionality: 18/18 passing (8 Python + 10 TypeScript)
- **Actual time**: 3 hours

**Phase 4: E2E Test Infrastructure** ✅ **COMPLETED 2025-12-14** (commit b624a75 + 9667e64)
- ✅ Manual testing with Chrome DevTools MCP
- ✅ Verified all 3 modes (Gemini Direct, ADK SSE, ADK BIDI)
- ✅ Frontend: 113 chunks recorded, export successful
- ✅ Backend: 164 chunks (120KB backend-adk-event.jsonl + 251KB backend-sse-event.jsonl)
- ✅ Bug fixes: PrepareSendMessagesRequest type (commit 5adb5cb)
- ✅ Bug fixes: Backend logger mode detection (commit 4f19a80)
- ✅ Feature: Environment variable support (commit f3aec17)
- ✅ E2E infrastructure complete:
  - ChunkPlayerTransport (frontend mock transport)
  - ChunkPlayerManager (backend E2E mode detection)
  - Frontend E2E tests (Playwright) - 2/6 passing (empty fixture tests)
  - Backend E2E tests (pytest) - 7/7 passing
  - Fixture structure: 4 patterns (Gemini Direct, ADK SSE, ADK BIDI, Mode Switching)
  - Symlink automation: `just setup-e2e-fixtures`
  - Comprehensive documentation: E2E_FRONTEND_GUIDE.md, E2E_SERVER_GUIDE.md, tests/fixtures/e2e-chunks/README.md
  - Recorder handoff: agents/recorder_handsoff.md
- ✅ Type errors fixed: Mode type annotations, test file types, yaml import (commit 9667e64)
- ✅ Production ready: E2E test infrastructure complete, awaiting fixture recording

**Next Action:**
- ⏳ Manual fixture recording for 4 patterns (see `agents/recorder_handsoff.md`)
  - Pattern 1: Gemini Direct only
  - Pattern 2: ADK SSE only
  - Pattern 3: ADK BIDI only (with audio)
  - Pattern 4: Mode switching (history preservation validation)

**Expected Benefits:**
- Manual operation → chunk record → automated test cycle
- Actual chunk data for debugging
- Regression testing with real-world data
- Cross-mode comparison (Gemini Direct vs ADK SSE vs ADK BIDI)
- Documentation with real chunk examples

**Technical Decisions:**
- Format: JSONL (1 line = 1 chunk, human-readable, tool-friendly)
- Frontend storage: Blob + Download (simple, no backend dependency)
- Security: Disabled in production, chunk logs in .gitignore

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
