# Protocol Implementation

**Last Updated:** 2025-12-29
**Status:** Phase 1-3 Complete (Text, Images, Audio I/O)

AI SDK v6 Data Stream Protocol implementation for ADK backend integration.

---

## 🚀 Quick Reference

**For Implementation**: See `stream_protocol.py` → `StreamProtocolConverter` class
**For Testing**: See `tests/unit/test_stream_protocol_comprehensive.py`
**For Architecture**: See [spec_ARCHITECTURE.md](spec_ARCHITECTURE.md)

**Protocol Spec**: [AI SDK v6 Stream Protocol](https://v6.ai-sdk.dev/docs/ai-sdk-ui/stream-protocol)
**ADK Events**: [ADK Live API Events](https://google.github.io/adk-docs/streaming/dev-guide/part5/)

---

## 📊 Implementation Status Summary

| Category | Status | Notes |
|----------|--------|-------|
| **Core Streaming** | ✅ Complete | Text, reasoning, tool execution |
| **Multimodal** | ✅ Complete | Images, audio I/O (Phase 1-3) |
| **Error Handling** | ✅ Complete | Error events |
| **Metadata** | ✅ Complete | Usage, finish reason, grounding, citations, cache, model version |
| **File References** | ❌ Not Implemented | Requires backend proxy for gs:// URLs |
| **Advanced Features** | ❌ Not Implemented | Logprobs, video metadata (low priority) |

---

## 🔄 ADK → AI SDK v6 Mapping

### Event-Level Fields

| ADK Field | Mapped To | Notes |
|-----------|-----------|-------|
| **Content** |
| `content.parts[]` | Multiple events | Processed per Part type |
| **Metadata** |
| `usage_metadata` | `finish` event `usage` | Token counts |
| `finish_reason` | `finish` event `finishReason` | Completion reason |
| `grounding_metadata` | `finish` event `messageMetadata.grounding` | RAG/web search sources |
| `citation_metadata` | `finish` event `messageMetadata.citations` | Citations |
| `cache_metadata` | `finish` event `messageMetadata.cache` | Context cache stats |
| `model_version` | `finish` event `messageMetadata.modelVersion` | Model version |
| **Live API** |
| `input_transcription` | `text-start/delta/end` | User speech → text (BIDI) |
| `output_transcription` | `text-start/delta/end` | Model speech → text (BIDI) |
| **Error** |
| `error_code`, `error_message` | `error` event | Error handling |

**Not Mapped** (ADK internal or not needed):

- `live_session_resumption_update`, `partial`, `turn_complete`, `interrupted`
- `avg_logprobs`, `logprobs_result` (debugging features)
- `invocation_id`, `author`, `actions`, `long_running_tool_ids`, `branch`, `id`, `timestamp`, `custom_metadata`

### Part-Level Fields

| ADK Part Field | Mapped To | Notes |
|----------------|-----------|-------|
| **Text** |
| `text` (thought=False) | `text-start/delta/end` | Regular text |
| `text` + `thought=True` | `reasoning-start/delta/end` | Thinking (Gemini 2.0) |
| **Tools** |
| `function_call` | `tool-input-start`, `tool-input-available` | Tool invocation |
| `function_response` | `tool-output-available` | Tool result |
| **Code** (Gemini 2.0) |
| `executable_code` | `data-executable-code` | Code execution request |
| `code_execution_result` | `data-code-execution-result` | Code output |
| **Multimodal** |
| `inline_data` (audio/pcm) | `data-pcm` | PCM audio (Live API) |
| `inline_data` (audio/*) | `data-audio` | Other audio |
| `inline_data` (image/*) | `data-image` | Images |

**Not Mapped**:

- `thought_signature` (cryptographic signature)
- `file_data` (requires gs:// URL proxy)
- `video_metadata`, `media_resolution` (Phase 4 - future)

---

## 🎯 AI SDK v6 Protocol Coverage

| Event Type | Status | ADK Source |
|------------|--------|------------|
| **Message Control** |
| `start` | ✅ | Auto-generated |
| `finish` | ✅ | `usage_metadata`, `finish_reason` |
| `[DONE]` | ✅ | Auto-generated |
| **Text** |
| `text-start/delta/end` | ✅ | `Part.text` (thought=False) |
| **Reasoning** (Gemini 2.0) |
| `reasoning-start/delta/end` | ✅ | `Part.text` + `thought=True` |
| **Tools** |
| `tool-input-start` | ✅ | `Part.function_call` |
| `tool-input-delta` | ⚠️ Not Implemented | ADK doesn't stream tool input incrementally |
| `tool-input-available` | ✅ | `Part.function_call` |
| `tool-output-available` | ✅ | `Part.function_response` |
| **Custom Data** |
| `data-pcm` | ✅ | `Part.inline_data` (audio/pcm) |
| `data-audio` | ✅ | `Part.inline_data` (audio/*) |
| `data-image` | ✅ | `Part.inline_data` (image/*) |
| `data-executable-code` | ✅ | `Part.executable_code` |
| `data-code-execution-result` | ✅ | `Part.code_execution_result` |
| **Error** |
| `error` | ✅ | Exception |
| **Not Implemented** |
| `source-url`, `source-document` | ❌ | ADK doesn't provide source metadata |
| `file` | ❌ | Use `data-*` instead |
| `start-step`, `finish-step` | ❌ | Not needed (ADK events are step-based) |

---

## 🎨 Custom Extensions

Custom `data-*` events for Gemini-specific features:

| Event | Status | Use Case |
|-------|--------|----------|
| `data-pcm` | ✅ | PCM audio streaming (BIDI mode, 24kHz) |
| `data-audio` | ✅ | Other audio formats (mp3, wav) |
| `data-image` | ✅ | Image data (png, jpeg, webp) |
| `data-executable-code` | ✅ | Code execution (Gemini 2.0) |
| `data-code-execution-result` | ✅ | Code results (Gemini 2.0) |

**Note**: Input/output transcriptions use standard `text-*` events (not custom `data-*`).

---

## 🚧 Multimodal Implementation Status

| Phase | Features | Status |
|-------|----------|--------|
| **Phase 1: Images** | Upload, display, bidirectional | ✅ Complete |
| **Phase 2: Audio Output** | PCM streaming, WAV playback, transcription | ✅ Complete |
| **Phase 3: Audio Input** | Microphone, push-to-talk, transcription | ✅ Complete |
| **Phase 4: Video** | Video streaming | ⬜ Planned |

---

## 🔍 Key Findings

### 1. Source References Not Available

**Events**: `source-url`, `source-document`
**Reason**: ADK/Gemini API doesn't provide source attribution metadata
**Impact**: None for current use cases

### 2. File References Need Proxy

**Field**: `Part.file_data` (gs:// URLs)
**Challenge**: Cloud Storage URIs require signed URLs or proxy
**Status**: Not implemented (low priority)

**Proposal** (if needed):

```python
# Backend proxy for gs:// URLs
{"type": "file", "url": "/api/files/proxy?uri=gs://...", "mediaType": "image/png"}
```

### 3. Tool Input Delta Not Streamed

**Event**: `tool-input-delta`
**Reason**: ADK provides `function_call` as complete object
**Impact**: Minor UX - tool calls appear instantly vs character-by-character
**Workaround**: Could artificially stream on frontend (cosmetic only)

### 4. Multi-Step Control Not Needed

**Events**: `start-step`, `finish-step`
**Reason**: ADK events are already step-based
**Impact**: None - AI SDK v6 processes stream correctly without explicit step markers

---

## 📝 Implementation Notes

### Complete Coverage

Our implementation provides **full AI SDK v6 Data Stream Protocol support** for all data exposed by ADK/Gemini API.

**Unimplemented events fall into 3 categories:**

1. **Not provided by ADK**: Source references, file metadata
2. **ADK limitation**: Tool input delta (not streamed incrementally)
3. **Not needed**: Multi-step control (ADK is step-based)

### Testing

All implemented events are tested in `tests/unit/test_stream_protocol_comprehensive.py` with **real ADK types** (no mocks) to ensure type safety and API contract compliance.

---

## 📚 References

**Specifications**:

- [AI SDK v6 Stream Protocol](https://v6.ai-sdk.dev/docs/ai-sdk-ui/stream-protocol)
- [ADK Documentation](https://google.github.io/adk-docs/)
- [ADK Live API Events](https://google.github.io/adk-docs/streaming/dev-guide/part5/)

**Related Docs**:

- [Architecture](spec_ARCHITECTURE.md) - Detailed architectural patterns
- [Multimodal Experiments](../experiments/2025-12-11_adk_bidi_multimodal_support.md) - Phase 1-3 implementation notes

---

**Last Review**: 2025-12-29
