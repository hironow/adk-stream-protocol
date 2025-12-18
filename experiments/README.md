# Experiments

This directory contains research, preliminary experiments, and exploratory implementations for the ADK AI Data Protocol project.

## Experiment Index

### 🟡 In Progress

| Date | Experiment | Status | Objective | Current Progress |
|------|-----------|--------|-----------|------------------|
| 2025-12-18 | [Tool Architecture & BIDI Confirmation Investigation](./2025-12-17_tool_architecture_refactoring.md) | ⚠️ **SSE Complete, BIDI Structurally Impossible** | Align tool architecture with AI SDK v6 standard patterns | ✅ Phases 1-4 complete. ✅ Phase 5 SSE mode complete (ADK native confirmation). ❌ **Phase 5 BIDI mode**: Tool confirmation structurally impossible (ADK continuous event stream incompatible with sendAutomaticallyWhen). Investigation complete, see `agents/handsoff.md` Session 5 |

### 🟢 Complete

| Date | Experiment | Status | Objective | Result |
|------|-----------|--------|-----------|--------|
| 2025-12-17 | [Chunk Logger Integration Testing](./agents/insights.md) | 🟢 Complete | Verify chunk logger consistency across 3 log sources | ✅ All 8 integration tests passing. Fixed 8 issues: audio modal, session ID, metadata extraction, log accumulation, serial execution, session reuse, file handle caching, multiple deny buttons |
| 2025-12-16 | [Backend Session Persistence Fix](./2025-12-16_backend_session_persistence_fix.md) | 🟢 Complete | Fix E2E test isolation by clearing backend session state | ✅ Fixed with `chunk_logger.close()` in `/clear-sessions` endpoint. Root cause: cached file handles become invalid after deletion |
| 2025-12-16 | [E2E Test Simplification](./2025-12-16_frontend_delegate_e2e_test_simplification.md) | 🟢 Complete (SSE), ⚠️ Partial (BIDI) | Simplify E2E tests using helper functions | ✅ 67% code reduction, 4 helper functions, SSE 3/3 passing, BIDI 0/3 failing |
| 2025-12-16 | [Manual Send Tool Approval](./2025-12-16_manual_send_tool_approval_design.md) | 🟢 Complete | Workaround for AI SDK v6 sendAutomaticallyWhen bug | ✅ Manual send implemented, tool approval working in all modes |
| 2025-12-16 | [Frontend Delegate Fix](./2025-12-16_frontend_delegate_fix.md) | 🟢 Complete | Fix frontend delegate tool approval flow | ✅ Tool approval flow verified |
| 2025-12-15 | [Systematic Model/Mode Testing](./2025-12-15_systematic_model_mode_testing.md) | 🟢 Complete | Test all mode/model combinations | ✅ 10/22 tests passing, found BUG-006 |
| 2025-12-15 | [E2E Chunk Logger & Player](./2025-12-15_e2e_chunk_logger_player_testing.md) | 🟢 Complete | Record and test all E2E patterns | ✅ All 4 patterns recorded (282 chunks), 6/6 E2E tests passing |
| 2025-12-15 | [Critical Bug Fixes](./2025-12-15_critical_bug_fixes.md) | 🟢 Complete | Fix 4 critical bugs | ✅ All 4 bugs fixed |
| 2025-12-15 | [WebSocket Payload Size](./2025-12-15_websocket_payload_size_issue.md) | 🟢 Phase 1 Complete | Implement payload size management | ✅ Size checking/logging, 8-test suite complete |
| 2025-12-15 | [AI SDK v6 Internal Chunks](./2025-12-15_ai_sdk_v6_internal_chunks_handling.md) | 🟢 Complete | Resolve 422 validation errors | ✅ GenericPart fallback implemented |
| 2025-12-14 | [Test Coverage Improvement](./2025-12-14_p4_t9_t10_test_coverage_improvement.md) | 🟢 Complete | Complete test coverage for P4-T9 & P4-T10 | ✅ 100% coverage achieved |
| 2025-12-14 | [Chunk Logger & Player](./2025-12-14_repeatable_chunk_logger_player.md) | 🟢 Complete | Implement chunk recording/playback | ✅ Phase 1-4 complete, production ready |
| 2025-12-14 | [ADK Field Parametrized Tests](./2025-12-14_adk_field_parametrized_test_coverage.md) | 🟢 Complete | 100% field coverage testing | ✅ 12/12 Event fields, 7/7 Part fields |
| 2025-12-13 | [lib/ Test Coverage](./2025-12-13_lib_test_coverage_investigation.md) | 🟢 Complete | Systematic gap analysis for lib/ tests | ✅ 163 tests passing |
| 2025-12-13 | [Bidirectional Protocol](./2025-12-13_bidirectional_protocol_investigation.md) | 🟢 Complete | Tool approval with delegation pattern | ✅ Awaitable delegation implemented |
| 2025-12-13 | [Tool Approval AI SDK Native](./2025-12-13_tool_approval_ai_sdk_native_handling.md) | 🟢 Complete | Investigate AI SDK v6 native handling | ✅ Removed custom callback |
| 2025-12-13 | [Per-Connection State](./2025-12-13_per_connection_state_management_investigation.md) | 🟢 Complete | ADK per-user/connection state patterns | ✅ Connection-specific FrontendToolDelegate |
| 2025-12-12 | [Audio Completion + Recording](./2025-12-12_audio_stream_completion_notification.md) | 🟢 Complete | Audio completion notification + recording | ✅ PCM buffering, WAV conversion |
| 2025-12-12 | [AudioWorklet Investigation](./2025-12-12_audio_worklet_investigation.md) | 🟢 Complete | Fix audio playback restart bug | ✅ AudioWorklet with ring buffer |
| 2025-12-12 | [ADK Field Mapping](./2025-12-12_adk_field_mapping_completeness.md) | 🟡 In Progress | Systematic ADK field mapping review | 4/5 Priority fields complete |
| 2025-12-12 | [BIDI Message History](./2025-12-12_adk_bidi_message_history_and_function_calling.md) | 🟢 Complete | Message history in BIDI mode | ✅ History working, native-audio behavior documented |
| 2025-12-11 | [E2E Test Timeout](./2025-12-11_e2e_test_timeout_investigation.md) | 🟢 Complete | Fix endpoint switching bug | ✅ Manual transport creation |
| 2025-12-11 | [BIDI Multimodal Support](./2025-12-11_adk_bidi_multimodal_support.md) | 🟢 Complete | Implement multimodal capabilities | ✅ Image, AudioWorklet PCM streaming |
| 2025-12-11 | [BIDI + AI SDK v6 Integration](./2025-12-11_adk_bidi_ai_sdk_v6_integration.md) | 🟢 Complete | BIDI compatibility with useChat | ✅ WebSocket transport, tool calling |

## Directory Structure

- `experiments/README.md` - This file
- `experiments/YYYY-MM-DD_{experiment_name}.md` - Experiment documents
- `output/{experiment_name}/` - Generated outputs
