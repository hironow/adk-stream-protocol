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
| 2025-12-13 | [Bidirectional Protocol Investigation](./2025-12-13_bidirectional_protocol_investigation.md) | 🟢 Complete | Phase 4 Tool Approval - Client-side tool execution with user approval | ✅ **SUCCESS** - Awaitable delegation pattern implemented, AI SDK v6 standard API integration |

## Critical Architecture Decisions

### Phase 4: Tool Approval Architecture (2025-12-13)

**CRITICAL UNDERSTANDING - DO NOT FORGET:**

#### Why `onToolCall` is NOT Used

**Frontend uses AI SDK v6 standard API:**
```typescript
const { messages, addToolOutput, addToolApprovalResponse } = useChat(useChatOptions);
```

**NOT:**
```typescript
const { onToolCall } = useChat({ ... }); // ❌ We don't use this
```

**Reason:**
- `onToolCall` is for **client-side local tool execution** (tools defined only in frontend)
- Our tools are defined in **backend (server.py)** for AI awareness
- Backend **delegates execution** to frontend, not frontend executing independently
- Tool call events come **from backend** → Frontend receives and executes → Sends results back

#### Data Flow (Data Stream Protocol)

```
1. Backend (server.py):
   - AI requests tool → ADK generates function_call
   - Tool function: await frontend_delegate.execute_on_frontend(...)
   - Awaits result from frontend (asyncio.Future)

2. Frontend (useChat):
   - Receives tool-call event (Data Stream Protocol)
   - Shows approval dialog
   - User approves → addToolApprovalResponse()
   - Executes browser API (AudioContext, Geolocation)
   - Sends result → addToolOutput()

3. Backend (server.py):
   - Receives tool-result event (Data Stream Protocol via WebSocket)
   - FrontendToolDelegate.resolve_tool_result()
   - Future resolves → Tool function returns result
   - ADK continues with result
```

#### Key Components

**Backend (server.py):**
- `FrontendToolDelegate`: Creates asyncio.Future, awaits frontend execution
- `change_bgm`, `get_location`: async tools with ToolContext
- WebSocket handler: Resolves Future when tool-result received

**Frontend:**
- Uses AI SDK v6 **standard functions**: `addToolOutput`, `addToolApprovalResponse`
- Does NOT use `onToolCall` callback
- Browser APIs execute after approval: `audioContext.switchTrack()`, `navigator.geolocation.getCurrentPosition()`

**Why This Works:**
- `addToolOutput()` sends Data Stream Protocol `tool-result` event
- Both ADK SSE and ADK BIDI use **same protocol format**
- Transport layer (HTTP SSE vs WebSocket) is abstracted
- Backend server.py processes events uniformly

**Reference:** experiments/2025-12-13_bidirectional_protocol_investigation.md

## Directory Structure

- `experiments/README.md` - This file
- `experiments/YYYY-MM-DD_{experiment_name}.md` - Experiment plan and results documents
- `experiments/run_{experiment_name}_*.sh` - Benchmark and test scripts
- `experiments/test_{experiment_name}*.py` - Test scripts for experiments

## Output Structure

Generated artifacts and results are stored in:
- `output/{experiment_note_name}/` - Generated outputs with parameter information
- `preprocessed/{experiment_note_name}/{resolution}/` - Preprocessed data (if applicable)
