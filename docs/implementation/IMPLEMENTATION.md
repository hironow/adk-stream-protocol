# AI SDK v6 Data Stream Protocol Implementation Status

**Last Updated:** 2025-12-14
**Status:** Phase 1-3 Complete (Text, Images, Audio I/O)

This document tracks the implementation status of [AI SDK v6 Data Stream Protocol](https://v6.ai-sdk.dev/docs/ai-sdk-ui/stream-protocol) in our ADK-to-AI-SDK converter.

## References

- **AI SDK v6 Stream Protocol Specification**: https://v6.ai-sdk.dev/docs/ai-sdk-ui/stream-protocol
- **ADK Documentation**: https://google.github.io/adk-docs/
- **ADK Live API Events**: https://google.github.io/adk-docs/streaming/dev-guide/part5/
- **Implementation**: `stream_protocol.py` - `StreamProtocolConverter` class
- **Tests**: `tests/unit/test_stream_protocol_comprehensive.py`

---

## ADK Event/Part Fields → AI SDK v6 Data Stream Protocol Mapping

This section provides the mapping from **ADK perspective** (what ADK provides) to **AI SDK v6 Data Stream Protocol** (what we send to frontend).

### ADK Event-Level Fields

| ADK Event Field | Type | Mapped To | Implementation | Notes |
|-----------------|------|-----------|----------------|-------|
| **Content & Parts** |
| `content.parts[]` | Content | Multiple events | stream_protocol.py:125-179 | Processed per Part type (see Part mapping below) |
| **Metadata** |
| `usage_metadata` | UsageMetadata | `finish` event `usage` field | stream_protocol.py:690-711 | Token counts in finish event |
| `finish_reason` | FinishReason | ✅ Mapped | stream_protocol.py:392-395, 817-818 | Maps to `finishReason` field in finish event |
| `grounding_metadata` | GroundingMetadata | ✅ `finish` event `messageMetadata.grounding` | stream_protocol.py:714-732 | Search grounding sources (RAG, web search) |
| `citation_metadata` | CitationMetadata | ✅ `finish` event `messageMetadata.citations` | stream_protocol.py:735-751 | Citation information |
| `cache_metadata` | CacheMetadata | ✅ `finish` event `messageMetadata.cache` | stream_protocol.py:755-762 | Context cache hit/miss statistics |
| `model_version` | str | ✅ `finish` event `messageMetadata.modelVersion` | stream_protocol.py:767-769 | Model version string |
| **Live API Specific** |
| `input_transcription` | Transcription | ✅ `text-start/delta/end` events | stream_protocol.py:310-340 | User speech → text (Live API BIDI mode) |
| `output_transcription` | Transcription | ✅ `text-start/delta/end` events | stream_protocol.py:343-378 | Model speech → text (Live API BIDI mode) |
| `live_session_resumption_update` | SessionUpdate | ❌ Not mapped | N/A | Session resumption info (Live API) |
| **Error & Control** |
| `error_code` | str | `error` event | stream_protocol.py:383-384 | Error handling |
| `error_message` | str | `error` event | stream_protocol.py:383-384 | Error handling |
| `partial` | bool | ❌ Not used | N/A | Streaming state flag (handled implicitly) |
| `turn_complete` | bool | ❌ Not used | N/A | Turn completion flag (handled by finish event) |
| `interrupted` | bool | ❌ Not mapped | N/A | Interruption flag |
| **Advanced Features** |
| `avg_logprobs` | float | ❌ Not mapped | N/A | Average log probabilities |
| `logprobs_result` | LogprobsResult | ❌ Not mapped | N/A | Detailed log probabilities |
| **ADK Internal** |
| `invocation_id` | str | ❌ Not mapped | N/A | ADK internal tracking |
| `author` | str | ❌ Not used | N/A | Event author (always "model" in streaming) |
| `actions` | EventActions | ❌ Not used | N/A | ADK internal actions |
| `long_running_tool_ids` | set[str] | ❌ Not mapped | N/A | Long-running tool tracking |
| `branch` | str | ❌ Not mapped | N/A | Conversation branch tracking |
| `id` | str | ❌ Not used | N/A | Event ID (use our messageId instead) |
| `timestamp` | float | ❌ Not used | N/A | Event timestamp |
| `model_version` | str | ❌ Not mapped | N/A | Model version info |
| `custom_metadata` | dict | ❌ Not mapped | N/A | Custom metadata fields |

### ADK Part-Level Fields

| ADK Part Field | Type | Mapped To | Implementation | Notes |
|----------------|------|-----------|----------------|-------|
| **Text & Reasoning** |
| `text` (thought=False/None) | str | `text-start/delta/end` | stream_protocol.py:139-141, 210-212 | Regular text content |
| `text` + `thought=True` | str + bool | `reasoning-start/delta/end` | stream_protocol.py:130-137, 214-216 | Thinking/reasoning content (Gemini 2.0 Flash Thinking) |
| `thought_signature` | bytes | ❌ Not mapped | N/A | Cryptographic signature for thought authenticity |
| **Tool Execution** |
| `function_call` | FunctionCall | `tool-input-start`, `tool-input-available` | stream_protocol.py:144-146, 218-244 | Tool invocation |
| `function_response` | FunctionResponse | `tool-output-available` | stream_protocol.py:149-153, 246-270 | Tool execution result |
| **Code Execution** (Gemini 2.0 Flash) |
| `executable_code` | ExecutableCode | `data-executable-code` | stream_protocol.py:156-160, 272-280 | Code execution request |
| `code_execution_result` | CodeExecutionResult | `data-code-execution-result` | stream_protocol.py:163-169, 282-290 | Code execution output |
| **Multimodal Content** |
| `inline_data` (audio/pcm) | Blob | `data-pcm` | stream_protocol.py:299-328 | PCM audio streaming (Live API) |
| `inline_data` (audio/*) | Blob | `data-audio` | stream_protocol.py:331-344 | Other audio formats |
| `inline_data` (image/*) | Blob | `data-image` | stream_protocol.py:347-360 | Image data |
| `file_data` | FileData | ❌ Not mapped | N/A | File references (Cloud Storage URIs) - Not directly streamable |
| **Video Metadata** |
| `video_metadata` | VideoMetadata | ❌ Not mapped | N/A | Video metadata (frame timestamps, etc.) |
| `media_resolution` | MediaResolution | ❌ Not mapped | N/A | Media resolution info |

---

## AI SDK v6 Data Stream Protocol Coverage (Reverse View)

This section shows the AI SDK v6 protocol from **frontend perspective** (what AI SDK v6 defines) mapped back to **ADK sources**.

| Event Type | Status | Implementation | ADK Source | Notes |
|------------|--------|----------------|------------|-------|
| **Message Control** |
| `start` | ✅ Implemented | stream_protocol.py:119-122 | Auto-generated | Sent on first event |
| `finish` | ✅ Implemented | stream_protocol.py:387-405 | Event.usage_metadata, Event.finish_reason | Includes token usage and finishReason |
| `[DONE]` | ✅ Implemented | stream_protocol.py:407-408 | Auto-generated | Stream termination marker |
| **Text Streaming** |
| `text-start` | ✅ Implemented | stream_protocol.py:210-212 | Part.text (thought=False/None) | Start text block |
| `text-delta` | ✅ Implemented | stream_protocol.py:210-212 | Part.text (thought=False/None) | Text content |
| `text-end` | ✅ Implemented | stream_protocol.py:210-212 | Part.text (thought=False/None) | End text block |
| **Reasoning Streaming** |
| `reasoning-start` | ✅ Implemented | stream_protocol.py:259-265, 427-429 | Part.text + Part.thought=True | Start reasoning block (Gemini 2.0 Flash Thinking) |
| `reasoning-delta` | ✅ Implemented | stream_protocol.py:259-265, 427-429 | Part.text + Part.thought=True | Reasoning content |
| `reasoning-end` | ✅ Implemented | stream_protocol.py:259-265, 427-429 | Part.text + Part.thought=True | End reasoning block |
| **Tool Execution** |
| `tool-input-start` | ✅ Implemented | stream_protocol.py:218-244 | Part.function_call | Tool call begins |
| `tool-input-delta` | ⚠️ Not Implemented | N/A | N/A | ADK doesn't stream tool input incrementally |
| `tool-input-available` | ✅ Implemented | stream_protocol.py:218-244 | Part.function_call | Tool input complete |
| `tool-output-available` | ✅ Implemented | stream_protocol.py:246-270 | Part.function_response | Tool execution result |
| **Source References** |
| `source-url` | ❌ Not Implemented | N/A | N/A | ADK doesn't provide source metadata |
| `source-document` | ❌ Not Implemented | N/A | N/A | ADK doesn't provide source metadata |
| **File References** |
| `file` | ❌ Not Implemented | N/A | N/A | ADK doesn't provide file references |
| **Custom Data** |
| `data-pcm` | ✅ Implemented | stream_protocol.py:292-328 | Part.inline_data (audio/pcm) | PCM audio streaming (BIDI mode) |
| `data-audio` | ✅ Implemented | stream_protocol.py:330-344 | Part.inline_data (audio/*) | Other audio formats |
| `data-image` | ✅ Implemented | stream_protocol.py:346-360 | Part.inline_data (image/*) | Image data |
| `data-executable-code` | ✅ Implemented | stream_protocol.py:272-280 | Part.executable_code | Code execution (Gemini 2.0) |
| `data-code-execution-result` | ✅ Implemented | stream_protocol.py:282-290 | Part.code_execution_result | Code results (Gemini 2.0) |
| **Error Handling** |
| `error` | ✅ Implemented | stream_protocol.py:383-384 | Exception | Error messages |
| **Multi-Step Control** |
| `start-step` | ❌ Not Implemented | N/A | N/A | Not needed: ADK events are already step-based |
| `finish-step` | ❌ Not Implemented | N/A | N/A | Not needed: Each ADK event is a discrete step |

## Key Findings

### 1. Source References (`source-url`, `source-document`)

**Status**: ❌ Not Implemented

**Reason**: ADK/Gemini API does not provide source citation metadata. These events are part of AI SDK v6 specification but require backend LLM support for source attribution, which Gemini API currently does not expose.

**Impact**: None for current use cases. If source citations become available in future Gemini API versions, we can add support by mapping the new ADK event fields to these protocol events.

### 2. File References (`file`)

**Status**: ❌ Not Implemented

**Reason**: ADK/Gemini API does not provide file reference metadata as separate events. File uploads are handled as `inline_data` (images, audio) and converted to `data-image` or `data-pcm`/`data-audio` custom events instead.

**Impact**: None. The `data-*` pattern provides equivalent functionality for our use case.

### 3. Tool Input Delta (`tool-input-delta`)

**Status**: ⚠️ Not Implemented

**Reason**: ADK does not stream tool input incrementally. The `function_call` is provided as a complete object in a single event, so only `tool-input-start` and `tool-input-available` are sent.

**Impact**: Minor UX difference - tool calls appear instantly rather than streaming character-by-character. This is an ADK limitation, not an implementation gap.

**Workaround**: If incremental tool input display is critical, we could artificially stream the complete `function_call.args` on the frontend, but this would be cosmetic only.

### 4. Multi-Step Control (`start-step`, `finish-step`)

**Status**: ❌ Not Implemented

**Reason**: Not needed for ADK architecture. These events are designed for frameworks that make multiple sequential LLM API calls and need to demarcate steps. ADK's event stream is already step-based - each `Event` represents a discrete step in the agent's execution.

**Impact**: None. The AI SDK v6 `useChat` hook correctly processes our stream without explicit step markers.

## Conclusion

**Our implementation provides complete AI SDK v6 Data Stream Protocol support for all data that ADK/Gemini API exposes.**

The unimplemented events fall into three categories:

1. **Not provided by ADK**: `source-*`, `file` - Backend doesn't supply this metadata
2. **ADK design limitation**: `tool-input-delta` - Tool inputs aren't streamed incrementally
3. **Not needed for ADK**: `start-step`, `finish-step` - ADK events are already step-based

All implemented events are tested in `tests/unit/test_stream_protocol_comprehensive.py` with real ADK types (no mocks) to ensure type safety and API contract compliance.

## Custom Extensions

In addition to standard protocol events, we implement custom data events for Gemini-specific features:

- **`data-pcm`**: ✅ **IMPLEMENTED** - PCM audio streaming for BIDI mode (Gemini 2.0 Flash native-audio) - Phase 2 Complete
- **`data-audio`**: ✅ **IMPLEMENTED** - Other audio formats (mp3, wav, etc.)
- **`data-image`**: ✅ **IMPLEMENTED** - Image data (png, jpeg, webp) - Phase 1 Complete
- **`data-executable-code`**: ✅ **IMPLEMENTED** - Code execution requests (Gemini 2.0 code execution)
- **`data-code-execution-result`**: ✅ **IMPLEMENTED** - Code execution results (Gemini 2.0 code execution)

**Note on Transcriptions**: Input and output transcriptions use standard `text-start/delta/end` events (not custom `data-*` events) as they represent standard text content from Live API BIDI mode - Phase 2-3 Complete

These custom events follow the `data-*` pattern specified in the AI SDK v6 protocol and allow frontend handling of Gemini-specific capabilities.

### Multimodal Support Implementation Status

**Phase 1: Image Support** ✅ **COMPLETE**
- Image upload (PNG, JPEG, WebP) via `experimental_attachments`
- Image display with custom `ImageDisplay` component
- Bidirectional image support (user → AI, AI → user)
- Implementation: `stream_protocol.py:346-360`, `components/image-upload.tsx`, `components/image-display.tsx`

**Phase 2: Audio Output** ✅ **COMPLETE**
- PCM audio streaming (24kHz) via `data-pcm` events
- WAV format generation for browser playback
- Audio transcription (output speech-to-text)
- Implementation: `stream_protocol.py:292-328`, `components/audio-player.tsx`

**Phase 3: Audio Input** ✅ **COMPLETE**
- Microphone recording via AudioWorklet (16kHz PCM)
- Push-to-talk control (CMD/Ctrl key)
- Audio transcription (input speech-to-text)
- Implementation: `lib/audio-recorder.ts`, `components/chat.tsx`, `stream_protocol.py:310-340`

**Phase 4: Video Support** ⬜ **FUTURE**
- Planned similar approach to audio
- Requires `data-video-*` custom events

For detailed architecture and protocol flows, see `ARCHITECTURE.md`.

---

## Discussion: Important Unmapped ADK Fields

This section discusses ADK fields that are currently unmapped but may be valuable to implement.

### 1. File References (`file_data`)

**Status**: ❌ Not Mapped

**ADK Source**: `Part.file_data` - Cloud Storage URI references (gs:// URLs)

**Use Case**: Display file attachments that were uploaded to Cloud Storage

**AI SDK v6 Equivalent**: `file` event with URL and mediaType

**Challenge**:
- File URIs (gs://) require signed URLs or proxy for browser access
- Files are not streamable content - just references
- Need backend endpoint to serve/proxy Cloud Storage files

**Proposal**:
```python
# Convert gs:// to publicly accessible URL via backend proxy
{"type": "file", "url": "/api/files/proxy?uri=gs://...", "mediaType": "image/png"}
```

**Action Required**: Decision needed - Do we need to support file references?

---

### 2. Advanced Features (Low Priority)

**Fields**: `avg_logprobs`, `logprobs_result`, `interrupted`, `video_metadata`, `media_resolution`

**Status**: ❌ Not Mapped

**Rationale**:
- These are advanced/debugging features not typically displayed in chat UI
- `logprobs` - For model developers, not end users
- `interrupted` - Handled by frontend WebSocket disconnect
- `video_metadata`, `media_resolution` - Metadata for video frames (current implementation handles images only)

**Action Required**: Low priority - Implement only if specific use case arises

---

## Summary: Feature Parity Status

| Category | Status | Notes |
|----------|--------|-------|
| **Core Streaming** | ✅ Complete | Text, reasoning, tool execution, images, audio |
| **Error Handling** | ✅ Complete | Error events |
| **Token Usage** | ✅ Complete | Usage metadata in finish event |
| **Finish Reason** | ✅ Complete | All ADK FinishReasons mapped (17/17) |
| **Live API Transcriptions** | ✅ Complete | Implemented using standard `text-start/delta/end` events |
| **Grounding/Citations** | ✅ Complete | Implemented in finish event metadata (grounding, citations) |
| **Cache Metadata** | ✅ Complete | Implemented in finish event metadata (cache hits/misses) |
| **Model Version** | ✅ Complete | Implemented in finish event metadata |
| **File References** | ❌ Missing | Low priority - requires backend proxy for gs:// URLs |
| **Advanced Metadata** | ❌ Missing | Low priority - debugging/optimization info (logprobs, video metadata) |

**Recommendation**:
1. **Current Status**: All major Gemini API features are implemented (Phase 1-3 Complete)
2. **Multimodal Capabilities**: Images, Audio I/O fully functional
3. **Future Enhancements**:
   - Phase 4: Video support (similar to audio approach)
   - File reference proxy if gs:// URL support is needed

**See Also:**
- Architecture documentation: `ARCHITECTURE.md`
- Multimodal experiment notes: `experiments/2025-12-11_adk_bidi_multimodal_support.md`
