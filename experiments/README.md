# Experiments

This directory contains research, preliminary experiments, and exploratory implementations for the ADK AI Data Protocol project.

## Experiment Index

### 🟡 In Progress

_No experiments in progress_

### ⚪ Planned

_No planned experiments_

### 🟢 Complete

| Date | Experiment | Status | Objective | Result |
|------|-----------|--------|-----------|--------|
| 2025-12-12 | [Audio Stream Completion Notification + Frontend Recording](./2025-12-12_audio_stream_completion_notification.md) | 🟢 Complete | Implement frontend notification when audio streaming completes + add audio recording for message replay ([ST-1]) | ✅ **SUCCESS** - Audio completion callback working, PCM buffering implemented, WAV conversion complete, HTML5 audio playback integrated |
| 2025-12-12 | [AudioWorklet Investigation](./2025-12-12_audio_worklet_investigation.md) | 🟢 Complete | Fix audio playback restart bug and implement low-latency PCM streaming | ✅ **SUCCESS** - AudioWorklet-based player with ring buffer, dual-path routing (audio + UI), WebSocket latency monitoring |
| 2025-12-12 | [ADK BIDI Message History & Function Calling](./2025-12-12_adk_bidi_message_history_and_function_calling.md) | 🟢 Complete | Investigate message history preservation and function calling response issues in BIDI mode | ✅ Message history working correctly, output_transcription support implemented, native-audio model behavior documented |
| 2025-12-12 | [ADK Field Mapping Completeness](./2025-12-12_adk_field_mapping_completeness.md) | 🟢 Complete | Systematic review of all ADK Event/Part fields and their mapping to AI SDK v6 protocol | ✅ 25 Event fields + 11 Part fields documented, completeness matrix created, test coverage strategy defined |
| 2025-12-11 | [E2E Test Timeout Investigation](./2025-12-11_e2e_test_timeout_investigation.md) | 🟢 Complete | Fix AI SDK v6 endpoint switching bug causing E2E test failures | ✅ **RESOLVED** - Manual DefaultChatTransport creation with prepareSendMessagesRequest hook |
| 2025-12-11 | [ADK BIDI Multimodal Support](./2025-12-11_adk_bidi_multimodal_support.md) | 🟢 Complete | Investigate and implement ADK BIDI mode's multimodal capabilities (images, audio, video) | ✅ **SUCCESS** - Image support complete, AudioWorklet PCM streaming working, dual-path routing implemented |
| 2025-12-11 | [ADK BIDI + AI SDK v6 Integration](./2025-12-11_adk_bidi_ai_sdk_v6_integration.md) | 🟢 Complete | Investigate compatibility between AI SDK v6 useChat and ADK BIDI mode for bidirectional streaming | ✅ **SUCCESS** - Full BIDI integration working with WebSocket transport, tool calling functional |

## Directory Structure

- `experiments/README.md` - This file
- `experiments/YYYY-MM-DD_{experiment_name}.md` - Experiment plan and results documents
- `experiments/run_{experiment_name}_*.sh` - Benchmark and test scripts
- `experiments/test_{experiment_name}*.py` - Test scripts for experiments

## Output Structure

Generated artifacts and results are stored in:
- `output/{experiment_note_name}/` - Generated outputs with parameter information
- `preprocessed/{experiment_note_name}/{resolution}/` - Preprocessed data (if applicable)
