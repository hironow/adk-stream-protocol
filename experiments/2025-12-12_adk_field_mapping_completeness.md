# ADK to AI SDK v6 Field Mapping: Completeness Check

**Date:** 2025-12-12
**Objective:** Ensure comprehensive mapping of all ADK Event/Content/Part fields to AI SDK v6 Data Stream Protocol
**Status:** 🟢 Complete (Investigation)

---

## Background

During implementation of `output_transcription` support, we discovered this field **by accident** through debug logging with `pformat()`. This raises concerns about **completeness**: Are there other ADK fields we're not handling?

This document provides a systematic completeness check based on:

1. **ADK Python SDK source code** (`google.adk.events.Event`, `google.genai.types`)
2. **ADK official documentation** (<https://google.github.io/adk-docs/>)
3. **Gemini API documentation** (ADK wraps Gemini API)

---

## Primary Information Sources

### How to Access and Extract Field Information

This section documents **exactly where and how** to find ADK field definitions to ensure completeness.

#### Method 1: ADK Python SDK Source Code (Most Reliable)

**Installation Location**:

```bash
# Find ADK installation path
python -c "import google.adk; print(google.adk.__file__)"
# Typically: .venv/lib/python3.x/site-packages/google/adk/__init__.py

python -c "import google.genai; print(google.genai.__file__)"
# Typically: .venv/lib/python3.x/site-packages/google/genai/__init__.py
```

**Key Files to Inspect**:

1. **Event Structure**: `google/adk/events.py` or `google/adk/events/__init__.py`
   - Class: `Event`
   - Contains all Event-level fields

2. **Content/Part Types**: `google/genai/types.py` or `google/genai/types/__init__.py`
   - Class: `Content` - Message content structure
   - Class: `Part` - Individual content parts (text, function_call, etc.)
   - Class: `Transcription` - Audio transcription structure

3. **Metadata Types**: `google/genai/types.py`
   - `GroundingMetadata`, `CitationMetadata`, `UsageMetadata`, etc.

**Automated Extraction Script**:

```python
import inspect
from google.adk.events import Event
from google.genai import types

# Extract Event fields
event_signature = inspect.signature(Event)
event_fields = {
    param_name: param.annotation
    for param_name, param in event_signature.parameters.items()
}

# Extract Part fields
part_signature = inspect.signature(types.Part)
part_fields = {
    param_name: param.annotation
    for param_name, param in part_signature.parameters.items()
}

print("Event fields:", event_fields.keys())
print("Part fields:", part_fields.keys())
```

#### Method 2: ADK Official Documentation

**Key Documentation Pages**:

1. **RunConfig Reference**: <https://google.github.io/adk-docs/runtime/runconfig/>
   - Configuration options for transcription, modalities, etc.
   - Shows which features exist (even if not in Event structure)

2. **Python API Reference**: <https://google.github.io/adk-docs/api-reference/python/>
   - May not be complete (docs lag behind implementation)

3. **Gemini Live API Docs**: <https://ai.google.dev/gemini-api/docs/live>
   - ADK wraps Gemini Live API
   - Shows protocol-level features that become Event fields

**Documentation Gaps**:

- Official docs often **lag behind SDK releases**
- Not all Event fields are documented
- Example: `output_transcription` was configured via `AudioTranscriptionConfig` but Event field was not explicitly documented

#### Method 3: GitHub Repository Analysis

**ADK Python Repository**: <https://github.com/google/adk-python>

**What to Monitor**:

1. **Releases**: <https://github.com/google/adk-python/releases>
   - Check CHANGELOG for new fields
   - Breaking changes that add/remove fields

2. **Issues**: <https://github.com/google/adk-python/issues>
   - Feature requests may reveal upcoming fields
   - Bug reports may reveal undocumented fields
   - Example: Issue #697 documented transcription handling quirks

3. **Pull Requests**: Watch for type definition changes
   - Changes to `events.py`, `types.py`

4. **Source Code**: Browse latest `main` branch
   - More up-to-date than installed package
   - May show unreleased fields

#### Method 4: Runtime Inspection (Our Discovery Method)

**How We Found `output_transcription`**:

```python
from pprint import pformat

# In stream_protocol.py convert_event()
event_attrs = vars(event) if hasattr(event, "__dict__") else {}
logger.debug(f"Event attributes:\n{pformat(event_attrs, width=120, depth=3)}")
```

**Strategy**:

1. Use `pformat()` to log complete Event structure
2. Collect logs from various scenarios (audio, text, tools, errors)
3. Manually inspect for unexpected fields
4. Compare against known fields

**Limitations**:

- Only finds fields that are **actually populated**
- Depends on testing various ADK features
- May miss rarely-used fields

---

### 1. ADK Python SDK Type Signatures

```python
# google.adk.events.Event
Event(
    modelVersion: Optional[str] = None,
    content: Optional[google.genai.types.Content] = None,
    groundingMetadata: Optional[google.genai.types.GroundingMetadata] = None,
    partial: Optional[bool] = None,
    turnComplete: Optional[bool] = None,
    finishReason: Optional[google.genai.types.FinishReason] = None,
    errorCode: Optional[str] = None,
    errorMessage: Optional[str] = None,
    interrupted: Optional[bool] = None,
    customMetadata: Optional[dict[str, Any]] = None,
    usageMetadata: Optional[google.genai.types.GenerateContentResponseUsageMetadata] = None,
    liveSessionResumptionUpdate: Optional[google.genai.types.LiveServerSessionResumptionUpdate] = None,
    inputTranscription: Optional[google.genai.types.Transcription] = None,
    outputTranscription: Optional[google.genai.types.Transcription] = None,  # ← Found by accident!
    avgLogprobs: Optional[float] = None,
    logprobsResult: Optional[google.genai.types.LogprobsResult] = None,
    cacheMetadata: Optional[google.adk.models.cache_metadata.CacheMetadata] = None,
    citationMetadata: Optional[google.genai.types.CitationMetadata] = None,
    invocationId: str = '',
    author: str,
    actions: google.adk.events.event_actions.EventActions = <factory>,
    longRunningToolIds: Optional[set[str]] = None,
    branch: Optional[str] = None,
    id: str = '',
    timestamp: float = <factory>
)

# google.genai.types.Content
Content(
    parts: Optional[list[google.genai.types.Part]] = None,
    role: Optional[str] = None
)

# google.genai.types.Part
Part(
    videoMetadata: Optional[google.genai.types.VideoMetadata] = None,
    thought: Optional[bool] = None,
    inlineData: Optional[google.genai.types.Blob] = None,
    fileData: Optional[google.genai.types.FileData] = None,
    thoughtSignature: Optional[bytes] = None,
    functionCall: Optional[google.genai.types.FunctionCall] = None,
    codeExecutionResult: Optional[google.genai.types.CodeExecutionResult] = None,
    executableCode: Optional[google.genai.types.ExecutableCode] = None,
    functionResponse: Optional[google.genai.types.FunctionResponse] = None,
    text: Optional[str] = None,
    mediaResolution: Optional[google.genai.types.PartMediaResolution] = None
)

# google.genai.types.Transcription
Transcription(
    text: Optional[str] = None,
    finished: Optional[bool] = None
)
```

### 2. Official Documentation

- **RunConfig**: <https://google.github.io/adk-docs/runtime/runconfig/>
    - `input_audio_transcription: AudioTranscriptionConfig()`
    - `output_audio_transcription: AudioTranscriptionConfig()`

- **Python API Reference**: <https://google.github.io/adk-docs/api-reference/python/>

- **GitHub Issue #697**: <https://github.com/google/adk-python/issues/697>
    - "Streamline Transcription Handling"
    - Notes differences in transcription handling between Live API and ADK

---

## Completeness Matrix

### Event-Level Fields

| ADK Field | Current Status | AI SDK v6 Mapping | Priority | Notes |
|-----------|---------------|-------------------|----------|-------|
| `content` | ✅ Implemented | `start` → parts processing | Critical | Core message content |
| `turnComplete` | ✅ Implemented | `finish` event | Critical | Signals end of turn |
| `usageMetadata` | ✅ Implemented | `finish.messageMetadata.usage` | High | Token usage stats |
| `finishReason` | ✅ Implemented | `finish.finishReason` | High | Why generation stopped |
| `outputTranscription` | ✅ Implemented (2025-12-12) | `text-start/delta/end` | High | Native-audio model transcription |
| `inputTranscription` | ✅ Implemented (2025-12-13) | `text-start/delta/end` | Medium | User audio transcription (stream_protocol.py:308-349) |
| `groundingMetadata` | ✅ Implemented (2025-12-13) | `finish.messageMetadata.grounding` | Medium | Grounding sources/attributions (stream_protocol.py:744-762) |
| `citationMetadata` | ✅ Implemented (2025-12-13) | `finish.messageMetadata.citations` | Medium | Citation information (stream_protocol.py:763-781) |
| `logprobsResult` | ❌ Not implemented | TBD | Low | Token log probabilities |
| `avgLogprobs` | ❌ Not implemented | TBD | Low | Average log probabilities |
| `cacheMetadata` | ✅ Implemented (2025-12-13) | `finish.messageMetadata.cache` | Low | Context caching info (components/message.tsx:506-529) |
| `liveSessionResumptionUpdate` | ❌ Not implemented | TBD | Low | Session resumption state |
| `errorCode` | ✅ Implemented (2025-12-13) | `error` event (immediate detection) | Critical | Error signaling (stream_protocol.py:181-187) |
| `errorMessage` | ✅ Implemented (2025-12-13) | `error` event (immediate detection) | Critical | Error details (stream_protocol.py:181-187) |
| `interrupted` | ❌ Not implemented | TBD | Medium | Interruption signal |
| `customMetadata` | ❌ Not implemented | TBD | Low | User-defined metadata |
| `modelVersion` | ✅ Implemented (2025-12-13) | `finish.messageMetadata.modelVersion` | Low | Model version info (components/message.tsx:531-548) |
| `partial` | ❌ Not implemented | TBD | Low | Partial response flag |
| `invocationId` | ❌ Not implemented | TBD | Low | Request tracking |
| `author` | ❌ Not implemented | TBD | Low | Event author |
| `actions` | ❌ Not implemented | TBD | Low | ADK-specific actions |
| `longRunningToolIds` | ❌ Not implemented | TBD | Low | Async tool tracking |
| `branch` | ❌ Not implemented | TBD | Low | Branching logic |
| `id` | ❌ Not implemented | TBD | Low | Event ID |
| `timestamp` | ❌ Not implemented | TBD | Low | Event timestamp |

### Part-Level Fields (Content.parts)

| ADK Field | Current Status | AI SDK v6 Mapping | Priority | Notes |
|-----------|---------------|-------------------|----------|-------|
| `text` | ✅ Implemented | `text-start/delta/end` | Critical | Text content streaming |
| `thought` | ✅ Implemented | Custom event `thought` | High | Reasoning/thinking mode |
| `functionCall` | ✅ Implemented | `tool-input-start/available` | Critical | Tool invocation |
| `functionResponse` | ✅ Implemented | `tool-output-available` | Critical | Tool result |
| `executableCode` | ✅ Implemented | `code-delta` | High | Code execution |
| `codeExecutionResult` | ✅ Implemented | `code-delta` | High | Execution output |
| `inlineData` | ✅ Implemented | `data-pcm` (audio) | High | Binary data (PCM audio) |
| `fileData` | ❌ Not implemented | TBD | Medium | File references |
| `videoMetadata` | ❌ Not implemented | TBD | Low | Video metadata |
| `thoughtSignature` | ❌ Not implemented | TBD | Low | Thought verification |
| `mediaResolution` | ❌ Not implemented | TBD | Low | Media resolution info |

---

## AI SDK v6 Data Stream Protocol Events

For reference, here are the event types in AI SDK v6 protocol that we currently generate:

| Event Type | Source | Purpose |
|------------|--------|---------|
| `start` | converter.has_started | Message start with messageId |
| `text-start` | Part.text, Event.outputTranscription | Begin text block |
| `text-delta` | Part.text, Event.outputTranscription | Text chunk |
| `text-end` | Part.text, Event.outputTranscription | End text block |
| `thought` | Part.thought | Reasoning/thinking |
| `tool-input-start` | Part.functionCall | Tool invocation start |
| `tool-input-available` | Part.functionCall | Tool arguments |
| `tool-output-available` | Part.functionResponse | Tool result |
| `code-delta` | Part.executableCode, Part.codeExecutionResult | Code execution |
| `data-pcm` | Part.inlineData (audio/pcm) | PCM audio chunk |
| `finish` | Event.turnComplete | Turn completion |
| `error` | finalize(error) | Error signaling |

**Missing event types** that AI SDK v6 supports:

- `message-annotations` - For metadata/annotations
- `data` - For arbitrary data (we use `data-pcm` for audio)
- `data-stream-part` - For streamed binary data
- `tool-call` - Alternative tool calling format
- `tool-result` - Alternative tool result format

---

## Key Findings from output_transcription Discovery

### What We Learned

1. **Location**: `output_transcription` exists at **Event top-level**, NOT in `Content.parts`

   ```python
   # ❌ WRONG - We were only checking content.parts
   for part in event.content.parts:
       if hasattr(part, "transcription"):  # This doesn't exist!

   # ✅ CORRECT - Check at Event level
   if hasattr(event, "output_transcription") and event.output_transcription:
       text = event.output_transcription.text
       finished = event.output_transcription.finished
   ```

2. **Configuration**: `AudioTranscriptionConfig()` was already configured in server.py:785-786
   - We weren't missing configuration
   - We were missing **processing** of the transcription data

3. **Model-specific**: Only `gemini-2.5-flash-native-audio-preview-09-2025` with AUDIO modality generates this
   - Not all ADK responses will have `output_transcription`
   - Behavior is non-deterministic (sometimes generates audio response, sometimes doesn't)

4. **AI SDK v6 Protocol Mapping**:
   - Must use `delta` field (NOT `textDelta`) per v6 spec
   - Requires `id` field for text block tracking
   - Needs `text-start` before first `text-delta`
   - Optionally sends `text-end` when `finished=True`

---

---

## Automated Completeness Checking

### Strategy: Test-Based Field Coverage Verification

To prevent missing fields like `output_transcription` in the future, we need **automated checks** that fail when:

1. ADK SDK adds new fields
2. Our implementation doesn't handle them

#### Approach 1: Field Enumeration Test

**Concept**: Automatically extract all Event/Part fields and verify each is documented/implemented.

**Implementation**: `tests/unit/test_field_completeness.py`

```python
"""
Test to ensure all ADK Event/Part fields are accounted for.
This test should FAIL when ADK SDK adds new fields.
"""
import inspect
from google.adk.events import Event
from google.genai import types

# Known fields we handle (update when implementing new fields)
HANDLED_EVENT_FIELDS = {
    "content", "turnComplete", "usageMetadata", "finishReason",
    "outputTranscription", "inputTranscription", "errorCode", "errorMessage",
    # ... complete list
}

DOCUMENTED_BUT_NOT_IMPLEMENTED = {
    "groundingMetadata", "citationMetadata", "logprobsResult",
    # ... fields we know about but haven't implemented yet
}

def test_event_field_coverage():
    """Verify all Event fields are either implemented or documented as TODO."""
    event_sig = inspect.signature(Event)
    all_fields = set(event_sig.parameters.keys())

    known_fields = HANDLED_EVENT_FIELDS | DOCUMENTED_BUT_NOT_IMPLEMENTED
    unknown_fields = all_fields - known_fields

    assert not unknown_fields, (
        f"New ADK Event fields detected: {unknown_fields}\n"
        f"Update stream_protocol.py to handle these fields, or add to "
        f"DOCUMENTED_BUT_NOT_IMPLEMENTED with justification."
    )

def test_part_field_coverage():
    """Verify all Part fields are accounted for."""
    # Similar pattern for Part fields
    ...
```

**Benefit**: CI fails immediately when ADK SDK updates add new fields.

#### Approach 2: Runtime Field Detection

**Concept**: During testing, log all Event fields we see, compare against known list.

**Implementation**: Add to `stream_protocol.py`

```python
# Development/debugging mode flag
DETECT_UNKNOWN_FIELDS = os.getenv("ADK_DETECT_UNKNOWN_FIELDS", "false").lower() == "true"

KNOWN_EVENT_FIELDS = {
    "content", "turnComplete", "usageMetadata", ...
}

async def convert_event(self, event):
    if DETECT_UNKNOWN_FIELDS:
        actual_fields = set(vars(event).keys())
        unknown = actual_fields - KNOWN_EVENT_FIELDS
        if unknown:
            logger.warning(f"⚠️ UNKNOWN EVENT FIELDS: {unknown}")

    # ... normal processing
```

**Usage**: Run with `ADK_DETECT_UNKNOWN_FIELDS=true` during exploratory testing.

#### Approach 3: Version-Based Alerts

**Concept**: Monitor ADK SDK version, alert on updates.

**Implementation**: `scripts/check_adk_version.py`

```python
"""Check installed ADK SDK version against known-good version."""
import google.adk
import sys

KNOWN_GOOD_VERSION = "0.9.0"  # Version we've fully mapped

current_version = google.adk.__version__
if current_version != KNOWN_GOOD_VERSION:
    print(f"⚠️ ADK SDK version changed: {KNOWN_GOOD_VERSION} → {current_version}")
    print("Run field completeness check to detect new fields.")
    sys.exit(1)
```

**CI Integration**: Run in pre-test checks, fail CI to force manual review.

### Maintenance Workflow

**When ADK SDK Updates**:

1. ✅ CI fails with "ADK SDK version changed" warning
2. 🔍 Run field extraction script to get new field list
3. 📊 Update completeness matrix with new fields
4. 💬 Discuss AI SDK v6 mapping strategy for new fields
5. ✅ Implement high-priority fields
6. 📝 Document deferred fields with justification
7. ✅ Update `KNOWN_GOOD_VERSION` and field lists
8. ✅ CI passes again

---

## Detailed Mapping Strategy Discussion

This section discusses **how to map** each unmapped ADK field to AI SDK v6 protocol.

### High-Priority Unmapped Fields

#### 1. `Event.inputTranscription` - User Audio Transcription

**ADK Structure**:

```python
event.input_transcription = Transcription(
    text="ユーザーが話した内容",
    finished=True
)
```

**Purpose**: Transcription of user's audio input (configured via `input_audio_transcription=AudioTranscriptionConfig()`).

**AI SDK v6 Mapping Options**:

**Option A: Custom Event** (Recommended)

```typescript
{
  type: "input-transcription-delta",
  delta: "ユーザーが話した内容",
  finished: true
}
```

- Pros: Clear separation from assistant output
- Cons: Not part of AI SDK v6 spec (custom extension)

**Option B: message-annotations**

```typescript
{
  type: "message-annotations",
  annotations: {
    inputTranscription: {
      text: "ユーザーが話した内容",
      finished: true
    }
  }
}
```

- Pros: Uses standard AI SDK v6 event type
- Cons: May not be displayed by UI by default

**Option C: Don't Map** (Client Already Has User Input)

- Reasoning: Frontend already knows what user said (sent the audio)
- Transcription is just confirmation/validation
- May be useful for accessibility or logging, but not critical for UI

**Recommendation**: **Option C** for now (defer until clear use case emerges).

---

#### 2. `Event.groundingMetadata` - RAG/Grounding Sources

**ADK Structure**:

```python
event.grounding_metadata = GroundingMetadata(
    grounding_chunks=[
        GroundingChunk(
            web=WebGroundingChunk(
                uri="https://example.com/source",
                title="Source Title"
            )
        )
    ],
    grounding_supports=[...]
)
```

**Purpose**: Sources used for grounded generation (RAG, web search, etc.).

**AI SDK v6 Mapping Options**:

**Option A: message-annotations** (Recommended)

```typescript
{
  type: "message-annotations",
  annotations: {
    grounding: {
      sources: [
        { uri: "https://example.com/source", title: "Source Title" }
      ]
    }
  }
}
```

- Pros: Standard AI SDK v6 event type
- Cons: UI may not render grounding sources by default

**Option B: Custom Event**

```typescript
{
  type: "grounding-sources",
  sources: [...]
}
```

- Pros: Clear semantic meaning
- Cons: Requires custom UI handling

**Recommendation**: **Option A** (message-annotations) - AI SDK v6 supports this, and modern UIs can render source citations.

---

#### 3. `Event.citationMetadata` - Citation Information

**ADK Structure**:

```python
event.citation_metadata = CitationMetadata(
    citation_sources=[
        CitationSource(
            start_index=0,
            end_index=100,
            uri="https://example.com",
            license="..."
        )
    ]
)
```

**Purpose**: Citations for generated content (academic, research).

**AI SDK v6 Mapping**: Same as `groundingMetadata` (Option A: message-annotations).

---

#### 4. `Event.errorCode` / `Event.errorMessage` - Error Detection

**Current Issue**: Only checked in `finalize()` (after event stream ends).

**Problem**: Mid-stream errors (e.g., quota exceeded, model error) may be missed.

**Fix Required**: Check in `convert_event()` BEFORE processing content.

**Implementation**:

```python
async def convert_event(self, event):
    # Check for errors FIRST (before any other processing)
    if hasattr(event, "error_code") and event.error_code:
        error_message = getattr(event, "error_message", "Unknown error")
        logger.error(f"[ERROR] ADK error: {event.error_code} - {error_message}")

        # Send error event immediately
        yield self._format_sse_event({
            "type": "error",
            "error": {
                "code": event.error_code,
                "message": error_message
            }
        })
        return  # Stop processing this event

    # ... normal content processing
```

**Recommendation**: **Implement immediately** (critical for error handling).

---

#### 5. `Part.fileData` - File References

**ADK Structure**:

```python
part.file_data = FileData(
    mime_type="image/jpeg",
    file_uri="gs://bucket/image.jpg"
)
```

**Purpose**: References to files (images, documents) stored in Google Cloud.

**AI SDK v6 Mapping Options**:

**Option A: data Event with URL**

```typescript
{
  type: "data",
  data: {
    mimeType: "image/jpeg",
    url: "https://storage.googleapis.com/bucket/image.jpg"
  }
}
```

**Option B: Fetch and Convert to Inline Data**

- Download file from GCS
- Convert to base64
- Send as inline data

**Recommendation**: **Option A** (simpler, no download overhead) - requires frontend to handle GCS URLs.

---

### Lower-Priority Fields

#### `Event.interrupted` - Interruption Signal

**Purpose**: BIDI mode - user interrupted assistant mid-speech.

**AI SDK v6 Mapping**:

- Custom event: `{ type: "interrupted" }`
- Or extend `finish` event with `interruptedReason`

**Priority**: Medium (useful for BIDI UX, but not critical).

---

#### `Event.cacheMetadata` - Context Caching Info

**Purpose**: Token count breakdown (cached vs new tokens).

**AI SDK v6 Mapping**: Include in `finish.messageMetadata.usage`

**Priority**: Low (optimization metric, not functional).

---

#### `Event.logprobsResult` / `avgLogprobs` - Token Probabilities

**Purpose**: Advanced AI analysis (token-level confidence scores).

**AI SDK v6 Mapping**: message-annotations or custom event.

**Priority**: Low (specialized use case).

---

### Summary Table: Mapping Recommendations

| ADK Field | AI SDK v6 Mapping | Priority | Implementation Effort |
|-----------|-------------------|----------|----------------------|
| `inputTranscription` | Defer (client has input) | Low | Low |
| `groundingMetadata` | message-annotations | High | Medium |
| `citationMetadata` | message-annotations | High | Medium |
| `errorCode/errorMessage` | error event (in convert_event) | **Critical** | Low |
| `fileData` | data event with URL | Medium | Low |
| `interrupted` | Custom event | Medium | Low |
| `cacheMetadata` | finish.usage extension | Low | Low |
| `logprobsResult` | message-annotations | Low | Medium |

---

## Recommended Next Steps

### Priority 1: Critical Missing Fields

1. **Event.errorCode / Event.errorMessage**
   - Currently only handled in `finalize(error)`
   - Should check Event-level errors in `convert_event()`
   - Map to `error` event immediately when detected

2. **Event.inputTranscription**
   - User audio transcription (reverse of `outputTranscription`)
   - Should map to... what in AI SDK v6? (needs discussion)
   - May be useful for accessibility/debugging

### Priority 2: High-Value Fields

1. **Event.groundingMetadata**
   - Grounding sources and attributions
   - Important for RAG/grounded generation transparency
   - Map to `message-annotations` or custom event?

2. **Event.citationMetadata**
   - Citation information
   - Important for academic/research use cases
   - Map to `message-annotations` or custom event?

3. **Part.fileData**
   - File references (images, documents, etc.)
   - Important for multi-modal support
   - Map to... `data` event? (needs investigation)

### Priority 3: Lower Priority

1. **Event.interrupted**
   - Interruption signaling for BIDI mode
   - Could map to custom event or `finish` with special reason

2. **Part.videoMetadata**
   - Video-specific metadata
   - Depends on video support needs

---

## Investigation Questions

### For Discussion

1. **inputTranscription mapping**: Where should user audio transcription go in AI SDK v6 protocol?
   - Option A: Custom event type (like `input-transcription-delta`)
   - Option B: Include in `message-annotations`
   - Option C: Not needed (client already has user input)

2. **groundingMetadata / citationMetadata**: Best practice for RAG/grounded gen metadata?
   - Current AI SDK v6 supports `message-annotations`
   - Should we use that, or create custom events?

3. **Error handling**: Should we check `Event.errorCode` in `convert_event()`?
   - Currently only in `finalize(error)`
   - ADK might send error Events mid-stream

4. **fileData / videoMetadata**: Do we need multi-modal file support?
   - Depends on use case
   - May need new event types

---

## Testing Strategy

### Completeness Testing Approach

1. **Real ADK Data Collection**
   - ✅ Already doing: Save logs with `pformat()` output
   - ✅ Already doing: Create tests with real Event data
   - 🆕 **TODO**: Systematically test each ADK model/mode combination
     - TEXT modality vs AUDIO modality
     - Different models (Gemini 2.0 Flash, Pro, etc.)
     - Different features (grounding, citations, code execution)

2. **Parameterized Tests**
   - ✅ Already done: `test_output_transcription_real_response.py`
   - 🆕 **TODO**: Create fixture files with real ADK responses
     - `tests/fixtures/adk_events/grounding_metadata.json`
     - `tests/fixtures/adk_events/citation_metadata.json`
     - `tests/fixtures/adk_events/input_transcription.json`
     - etc.

3. **Field Coverage Tracking**
   - 🆕 **TODO**: Add test that verifies all Event/Part fields are documented
   - 🆕 **TODO**: CI check: fail if new ADK SDK version adds fields we don't handle

---

## References

### Primary Sources

- **ADK Python SDK**: <https://github.com/google/adk-python>
    - Source of truth for Event/Content/Part structure
    - Check releases for new fields: <https://github.com/google/adk-python/releases>

- **ADK Documentation**: <https://google.github.io/adk-docs/>
    - RunConfig reference: <https://google.github.io/adk-docs/runtime/runconfig/>
    - API reference: <https://google.github.io/adk-docs/api-reference/python/>

- **AI SDK v6 Protocol**: <https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol>
    - Specification for all event types
    - Field naming conventions

### Related Issues

- **GitHub Issue #697**: <https://github.com/google/adk-python/issues/697>
    - "Streamline Transcription Handling"
    - Notes ADK vs Live API differences

### Implementation

- **stream_protocol.py**: Current implementation
    - Lines 242-276: `output_transcription` processing
    - Lines 512-522: `finalize()` text block cleanup

- **test_output_transcription_real_response.py**: Real data tests
    - Uses actual Kyoto weather query response
    - Demonstrates parameterized testing with real ADK data

---

---

## Automated Coverage Analysis (2025-12-12)

### Methodology

We created a unified automated script to analyze actual implementation code instead of relying on hardcoded lists:

**`scripts/check-coverage.py`** (Unified Coverage Checker)

- **Class-based architecture** with clear separation of concerns:
    - `ADKExtractor`: Extract ADK type definitions from Python SDK using `inspect.signature()`
    - `AISdkExtractor`: Extract AI SDK v6 event types from TypeScript definitions
    - `ADKAnalyzer`: Detect ADK field usage in `stream_protocol.py`
    - `AISdkAnalyzer`: Detect AI SDK event generation/handling in implementation code
    - `Reporter`: Format and display coverage reports
    - `CoverageChecker`: Orchestrate all operations

**ADK Coverage Analysis**:

- Analyzes `stream_protocol.py` to detect which ADK fields are actually processed
- Uses regex pattern matching to find `hasattr(event, "field")` and `event.field` accesses
- Converts snake_case (Python) to camelCase (ADK type definitions) for comparison
- Compares detected fields against ADK SDK type signatures extracted via reflection

**AI SDK Coverage Analysis**:

- Analyzes `stream_protocol.py` (backend event generation)
- Analyzes `lib/websocket-chat-transport.ts` (frontend event handling)
- Uses regex to find event type strings in code
- Compares against AI SDK v6 type definitions from `node_modules/ai/dist/index.d.ts`

**Commands**:

```bash
# Coverage check with summary
just check-coverage

# Coverage check with detailed report (shows implemented fields)
just check-coverage-verbose

# Extract type definitions only
just extract-adk-types          # ADK types as markdown
just extract-adk-types-json     # ADK types as JSON
just extract-ai-sdk-types       # AI SDK types as markdown
just extract-all-types          # Both ADK and AI SDK types
```

---

### Results: ADK Field Coverage (From Code Analysis)

**Analyzed**: `stream_protocol.py` (actual implementation)

#### Event Field Coverage: 5/25 (20.0%)

**✅ Implemented Event Fields**:

- `content` - Core message content
- `finishReason` - Why generation stopped
- `outputTranscription` - Native-audio model transcription (added 2025-12-12)
- `turnComplete` - Signals end of turn
- `usageMetadata` - Token usage stats

**❌ Missing Event Fields (20)**:
`actions`, `author`, `avgLogprobs`, `branch`, `cacheMetadata`, `citationMetadata`, `customMetadata`, `errorCode`, `errorMessage`, `groundingMetadata`, `id`, `inputTranscription`, `interrupted`, `invocationId`, `liveSessionResumptionUpdate`, `logprobsResult`, `longRunningToolIds`, `modelVersion`, `partial`, `timestamp`

#### Part Field Coverage: 7/12 (58.3%)

**✅ Implemented Part Fields**:

- `codeExecutionResult` - Code execution output
- `executableCode` - Code to execute
- `functionCall` - Tool invocation
- `functionResponse` - Tool result
- `inlineData` - Binary data (PCM audio)
- `text` - Text content
- `thought` - Reasoning/thinking mode

**❌ Missing Part Fields (5)**:
`fileData`, `mediaResolution`, `thoughtSignature`, `value`, `videoMetadata`

#### Total ADK Coverage: 12/37 (32.4%)

---

### Results: AI SDK v6 Event Coverage (From Code Analysis)

**Analyzed**:

- Backend: `stream_protocol.py` (event generation)
- Frontend: `lib/websocket-chat-transport.ts` (event handling)

#### Backend Event Generation: 14/30 (46.7%)

**✅ Generated Event Types**:
`data-audio`, `data-code-execution-result`, `data-executable-code`, `data-image`, `data-pcm` (custom), `error`, `finish`, `start`, `text-delta`, `text-end`, `text-start`, `tool-input-available`, `tool-input-start`, `tool-output-available`

**❌ Not Generated (16)**:
`abort`, `file`, `finish-step`, `message-metadata`, `raw`, `reasoning-delta`, `reasoning-end`, `reasoning-start`, `source`, `source-document`, `source-url`, `start-step`, `tool-approval-request`, `tool-call`, `tool-error`, `tool-input-delta`, `tool-input-end`, `tool-input-error`, `tool-output-denied`, `tool-output-error`, `tool-result`

#### Frontend Event Handling: 5/30 (16.7%)

**✅ Handled Event Types**:
`data-pcm`, `ping` (custom), `tool-input-available`, `tool-output-available`, `tool-result`

**Note**: Low frontend coverage (16.7%) is **expected** because most events (`start`, `text-delta`, `finish`, etc.) are handled internally by AI SDK's `useChat` hook, not in our custom WebSocket transport code. The transport only needs to handle custom events and tool-related callbacks.

#### ⚠️ Generated but Not Explicitly Consumed (11 events)

These events are generated by backend but not explicitly handled in our WebSocket transport:
`data-audio`, `data-code-execution-result`, `data-executable-code`, `data-image`, `error`, `finish`, `start`, `text-delta`, `text-end`, `text-start`, `tool-input-start`

**Analysis**: These events are forwarded to AI SDK's `useChat` hook via the stream, which handles them internally. This is correct behavior - we don't need custom handling for standard AI SDK events.

#### Custom Extensions (Not in AI SDK Spec)

- `data-pcm` - PCM audio chunks (backend generates, frontend handles)
- `ping` - WebSocket keep-alive (frontend handles)

---

### Key Insights from Coverage Analysis

#### 1. **ADK Field Coverage is Low (32.4%)**

**Critical Missing Fields**:

- `errorCode` / `errorMessage` - Currently only checked in `finalize()`, should be checked in `convert_event()` for immediate error detection
- `inputTranscription` - User audio transcription (similar to `outputTranscription` but for user input)
- `groundingMetadata` / `citationMetadata` - RAG/grounded generation sources

**Why Low Coverage is Acceptable**:

- Many fields are **metadata** that don't directly affect streaming (`author`, `id`, `timestamp`, `invocationId`)
- Some fields are **advanced features** we haven't needed yet (`logprobsResult`, `avgLogprobs`, `cacheMetadata`)
- Some fields are **ADK-specific** and don't map cleanly to AI SDK v6 (`actions`, `branch`, `longRunningToolIds`)

**Priority for Implementation**:

1. **Critical**: `errorCode`/`errorMessage` immediate detection
2. **High**: `inputTranscription` (for accessibility), `groundingMetadata`/`citationMetadata` (for RAG)
3. **Medium**: `fileData` (multi-modal support), `interrupted` (BIDI UX)
4. **Low**: Metadata fields, advanced features

#### 2. **Part Field Coverage is Better (58.3%)**

We've implemented the **core content types**:

- ✅ Text (`text`)
- ✅ Tools (`functionCall`, `functionResponse`)
- ✅ Code (`executableCode`, `codeExecutionResult`)
- ✅ Audio (`inlineData`)
- ✅ Thinking (`thought`)

**Missing Part fields are specialized**:

- `fileData` - File references (GCS URLs)
- `videoMetadata` - Video-specific metadata
- `thoughtSignature` - Thought verification (advanced)
- `mediaResolution` - Media resolution info
- `value` - Unknown purpose (needs investigation)

#### 3. **AI SDK v6 Event Generation is Good (46.7%)**

We generate **all essential streaming events**:

- ✅ Message lifecycle: `start`, `finish`, `error`
- ✅ Text streaming: `text-start`, `text-delta`, `text-end`
- ✅ Tool calling: `tool-input-start`, `tool-input-available`, `tool-output-available`
- ✅ Code execution: `data-executable-code`, `data-code-execution-result`
- ✅ Audio: `data-audio`, `data-pcm` (custom)

**Not generated events fall into categories**:

- **Multi-step flows**: `start-step`, `finish-step` (ADK doesn't support)
- **Reasoning**: `reasoning-start/delta/end` (could map from Part.thought)
- **Tool alternatives**: `tool-call`, `tool-result` (we use different format)
- **Grounding**: `source`, `source-document`, `source-url` (needs ADK field implementation)
- **Advanced**: `abort`, `raw`, `file`, `message-metadata`

#### 4. **Frontend Event Handling is Minimal (16.7%) - This is Correct**

**Why low coverage is expected**:

- AI SDK's `useChat` hook handles most events internally (`start`, `text-delta`, `finish`, `error`)
- Our WebSocket transport only needs to:
  1. Forward standard events to `useChat` stream
  2. Handle **custom extensions** (`data-pcm`, `ping`)
  3. Handle **tool callbacks** (`tool-input-available`, `tool-output-available`)

**Current implementation is correct**: We implement exactly what we need without duplicating AI SDK's built-in event handling.

#### 5. **Code Analysis Prevents Missing Fields**

**Success Story**:

- `output_transcription` was discovered **by accident** through debug logging
- With automated code analysis, we can now **systematically detect** which fields we're using

**Benefit**:

- When ADK SDK updates and adds new fields, our coverage scripts will show them as "missing"
- We can proactively decide whether to implement or document as "not needed"
- No more accidental discoveries

#### 6. **snake_case vs camelCase Handled**

**Challenge**: ADK Python SDK uses camelCase in type definitions but Python code uses snake_case

- Type definition: `outputTranscription`, `usageMetadata`, `turnComplete`
- Python code: `output_transcription`, `usage_metadata`, `turn_complete`

**Solution**: Implemented `snake_to_camel()` conversion in coverage script

- Converts detected snake_case field names to camelCase before comparison
- Now correctly identifies fields like `turnComplete` (was `turn_complete` in code)

---

### Recommendations from Coverage Analysis

#### Immediate Actions (Priority 1)

1. **Implement immediate error detection** (stream_protocol.py:180)

   ```python
   # Check for errors FIRST before processing content
   if hasattr(event, "error_code") and event.error_code:
       error_message = getattr(event, "error_message", "Unknown error")
       yield self._format_sse_event({"type": "error", "error": {...}})
       return
   ```

2. **Add field coverage test** (tests/unit/test_field_coverage.py)
   - Automatically extract all Event/Part fields from ADK SDK
   - Compare against KNOWN_IMPLEMENTED + DOCUMENTED_NOT_IMPLEMENTED sets
   - Fail if unknown fields detected (forces manual review)

#### Future Enhancements (Priority 2-3)

1. **Implement `inputTranscription`** (if accessibility is important)
   - Similar to `outputTranscription` but for user input
   - Map to custom event or `message-annotations`

2. **Implement `groundingMetadata` / `citationMetadata`** (if RAG is important)
   - Map to `message-annotations` event
   - Display sources in UI

3. **Implement `fileData`** (if multi-modal file support needed)
   - Map to `data` event with file URL
   - Frontend fetches from GCS

4. **Map `Part.thought` to `reasoning-*` events** (optional)
   - Currently maps to custom `thought` event
   - Could also generate `reasoning-start/delta/end` for AI SDK v6 compatibility

---

## Changelog

### 2025-12-12 (Night) - Google ADK 1.21.0 Upgrade & Field Detection

- **Upgrade**: google-adk 1.20.0 → 1.21.0
    - google-genai: 1.54.0 → 1.55.0
    - fastapi: 0.118.3 → 0.123.10
    - starlette: 0.48.0 → 0.50.0
- **Field Coverage Test Success**: 🎉 Automated detection worked perfectly!
    - Test detected new field: `interactionId` (Optional[str])
    - Total Event fields: 25 → 26
    - Test failed as designed with actionable error message
- **New Field Analysis**: `interactionId`
    - **Purpose**: Related to new Interactions API for state management
    - **Description**: Allows server-side conversation history management via `previous_interaction_id`
    - **Classification**: Metadata field (similar to `invocationId`)
    - **Decision**: Mark as METADATA_EVENT_FIELDS (not user-facing, internal tracking)
    - **Reference**: [Building agents with the ADK and the new Interactions API](https://developers.googleblog.com/building-agents-with-the-adk-and-the-new-interactions-api/)
- **Impact**:
    - Field coverage test prevented silent addition of new field
    - Forced conscious review and classification decision
    - Updated test_field_coverage.py to include `interactionId` in METADATA_EVENT_FIELDS

### 2025-12-12 (Night) - [P2-T4] Field Coverage Testing Implementation

- **Feature**: Automated field coverage testing (`tests/unit/test_field_coverage.py`, 167 lines)
    - Automatically detects new ADK Event/Part fields when SDK updates
    - Requires conscious decision for each field: Implement, Document as TODO, or Mark as metadata
    - Prevents accidental field omissions (example: `outputTranscription` discovered by accident)
- **Test Structure**:
    - `test_event_field_coverage()`: Validates all Event fields are accounted for
    - `test_part_field_coverage()`: Validates all Part fields are accounted for
    - `test_coverage_stats()`: Reports current coverage statistics
- **Field Categories** (Event: 25 fields total):
    - **IMPLEMENTED_EVENT_FIELDS** (7): content, errorCode, errorMessage, finishReason, outputTranscription, turnComplete, usageMetadata
    - **DOCUMENTED_EVENT_FIELDS** (4): citationMetadata, groundingMetadata, inputTranscription, interrupted
    - **METADATA_EVENT_FIELDS** (14): author, id, timestamp, invocationId, branch, actions, etc.
- **Field Categories** (Part: 12 fields total):
    - **IMPLEMENTED_PART_FIELDS** (7): codeExecutionResult, executableCode, functionCall, functionResponse, inlineData, text, thought
    - **DOCUMENTED_PART_FIELDS** (2): fileData, videoMetadata
    - **METADATA_PART_FIELDS** (3): mediaResolution, thoughtSignature, value
- **Validation**: Tested by temporarily removing "content" field - test correctly failed with actionable error message
- **Coverage Statistics**:
    - Event: 7/25 (28.0%)
    - Part: 7/12 (58.3%)
    - All fields accounted for: ✅
- **Impact**:
    - **Before**: New fields added to ADK SDK without detection
    - **After**: CI fails immediately when new fields appear, forcing review and decision

### 2025-12-12 (Night) - [P2-T3] Immediate Error Detection Implementation

- **Feature**: Implemented `errorCode`/`errorMessage` immediate detection (`stream_protocol.py:121-131`)
    - Error checking now happens **FIRST** in `convert_event()` before any other processing
    - Errors are logged with `logger.error()` for visibility
    - Error event is sent immediately to frontend with proper format: `{"type": "error", "error": {"code": "...", "message": "..."}}`
    - Processing stops after error event (no start, no content processing)
- **Tests**: Added 3 comprehensive tests (`tests/unit/test_stream_protocol.py`)
    - `test_error_detection_with_error_code_and_message`: Both errorCode and errorMessage present
    - `test_error_detection_with_error_code_only`: errorCode only (uses default "Unknown error" message)
    - `test_no_error_when_error_code_is_none`: Normal processing when no error
    - All tests pass ✅
- **TDD Approach**: Followed RED-GREEN cycle
    - ✅ RED: Wrote failing tests first
    - ✅ GREEN: Implemented minimal code to pass tests
    - Code quality: Passed ruff checks
- **Impact**:
    - **Before**: Errors were only checked in `finalize()`, detected too late
    - **After**: Errors detected immediately, users see error messages instantly
    - ADK Event coverage improved: `errorCode` and `errorMessage` fields now utilized (5/25 → 7/25, 20.0% → 28.0%)

### 2025-12-12 (Late Evening) - Script Unification

- **Refactoring**: Unified all coverage scripts into single `scripts/check-coverage.py`
    - **Deleted obsolete scripts**:
        - `scripts/extract-adk-types.py`
        - `scripts/extract-ai-sdk-types.ts`
        - `scripts/check-adk-coverage-from-code.py`
        - `scripts/check-ai-sdk-coverage-from-code.ts`
    - **New unified script** (`scripts/check-coverage.py`, 636 lines):
        - Class-based architecture: Extractors, Analyzers, Reporter, Orchestrator
        - Multi-mode support: Coverage check (default), Extract-only (adk/ai-sdk/all)
        - Output formats: Markdown (default), JSON
        - Single Python script handles both ADK and AI SDK analysis
    - **Simplified justfile commands**:
        - `just check-coverage` / `just check-coverage-verbose`
        - `just extract-adk-types` / `just extract-adk-types-json`
        - `just extract-ai-sdk-types` / `just extract-all-types`
- **Validation**: Coverage numbers remain identical (confirming correct implementation)

### 2025-12-12 (Evening)

- **Coverage Analysis**: Automated code-based coverage checking implemented
    - Created `scripts/check-adk-coverage-from-code.py` (Python)
    - Created `scripts/check-ai-sdk-coverage-from-code.ts` (TypeScript)
    - Added justfile commands: `check-adk-coverage-from-code-verbose`, `check-ai-sdk-coverage-from-code-verbose`
- **Results**:
    - ADK Event coverage: 5/25 (20.0%)
    - ADK Part coverage: 7/12 (58.3%)
    - AI SDK backend generation: 14/30 (46.7%)
    - AI SDK frontend handling: 5/30 (16.7%) - expected due to `useChat` internal handling
- **Insights**:
    - Identified critical missing fields: `errorCode`/`errorMessage` immediate detection
    - Confirmed custom extensions: `data-pcm`, `ping`
    - Validated that low frontend coverage is correct (AI SDK handles most events)
    - Discovered 11 events generated but forwarded to AI SDK (not consumed by custom code)

### 2025-12-12 (Late Night) - Phase 2 Coverage Improvements Completed

Completed 4 high-priority coverage improvement tasks identified from coverage analysis:

#### [P2-T5] Tool Error Handling ✅

- **Feature**: Implemented tool execution error detection and proper error events
    - Added error detection in `_process_function_response()` (`stream_protocol.py:402-425`)
    - Pattern 1: `success=false` (common in tool implementations)
    - Pattern 2: `error` field present without `result` field
    - Generates `tool-output-error` event with `errorText` field
    - Errors logged with `logger.error()` for debugging
- **Tests**: Added 3 comprehensive tests (`tests/unit/test_stream_protocol.py:800-982`)
    - `test_tool_execution_error_with_success_false`: Tests success=false pattern
    - `test_tool_execution_error_with_error_field`: Tests error field pattern
    - `test_tool_success_response_unchanged`: Ensures success case still works
    - All tests pass ✅
- **TDD Approach**: Followed RED-GREEN cycle
    - ✅ RED: Wrote failing tests first
    - ✅ GREEN: Implemented error detection logic
    - Code quality: Passed ruff checks
- **Impact**: Users now see tool errors immediately with proper error messages

#### [P2-T6] Unify Image Events to `file` Type ✅

- **Feature**: Changed image output from custom `data-image` to standard AI SDK v6 `file` event
    - Updated `_process_inline_data_part()` (`stream_protocol.py:511-524`)
    - **Before**: `{"type": "data-image", "data": {"mediaType": "...", "content": "..."}}`
    - **After**: `{"type": "file", "url": "data:image/png;base64,...", "mediaType": "image/png"}`
    - Uses data URL format for inline base64 content
- **Tests**: Updated 2 existing image tests
    - Changed assertions to expect `file` event type
    - Verified data URL format: `data:image/png;base64,...`
    - All tests pass ✅
- **Impact**:
    - Symmetric input/output format (both use `file` event)
    - Better AI SDK v6 protocol compliance
    - Simpler frontend handling

#### [P2-T7] Audio Completion Signaling ✅

- **Feature**: Implemented explicit audio streaming completion signal
    - Uncommented `finalize()` call (`stream_protocol.py:666-669`)
    - Added audio metadata to `finalize()` method (`stream_protocol.py:582-607`)
    - Metadata includes: chunks, bytes, sampleRate, duration
    - Duration calculation: `bytes / (sampleRate * 2)` for PCM16
- **Tests**: Fixed 3 previously failing tests
    - `test_complete_stream_flow`: Now receives finish event
    - `test_stream_with_error`: Finish event sent on error
    - `test_stream_with_usage_metadata`: Finish event includes metadata
    - All tests pass ✅
- **Impact**:
    - Frontend receives explicit signal when audio streaming completes
    - Audio statistics available in `messageMetadata.audio`
    - Proper stream termination with finish event

#### [P2-T8] message-metadata Event Implementation ✅

- **Feature**: Forward ADK metadata fields to frontend via `messageMetadata`
    - Extended `finalize()` signature with 4 new parameters (`stream_protocol.py:532-541`):
        - `grounding_metadata`: RAG sources, web search results
        - `citation_metadata`: Citation information
        - `cache_metadata`: Context cache statistics
        - `model_version`: Model version string
    - Implemented metadata extraction logic (`stream_protocol.py:609-655`):
        - Grounding sources → `metadata["grounding"]["sources"]`
        - Citations → `metadata["citations"]`
        - Cache stats → `metadata["cache"]["hits/misses"]`
        - Model version → `metadata["modelVersion"]`
    - Updated `stream_adk_to_ai_sdk()` to collect metadata (`stream_protocol.py:689-754`)
- **Tests**: Added 4 new comprehensive tests (`tests/unit/test_stream_protocol.py:984-1167`)
    - `test_message_metadata_with_grounding`: Grounding sources extraction
    - `test_message_metadata_with_citations`: Citation information extraction
    - `test_message_metadata_with_cache`: Cache statistics extraction
    - `test_message_metadata_with_model_version`: Model version forwarding
    - All tests pass ✅
- **TDD Approach**: Followed RED-GREEN-REFACTOR cycle
    - ✅ RED: Wrote failing tests first
    - ✅ GREEN: Implemented metadata collection and forwarding
    - ✅ REFACTOR: Cleaned up unused variables, fixed linting issues
    - Code quality: Passed ruff checks (All checks passed)
- **Impact**:
    - Frontend can access grounding sources for RAG transparency
    - Citations available for attribution display
    - Cache statistics for performance monitoring
    - Model version for debugging and telemetry

#### Summary

- **Total Tests**: 26 tests passing (added 7 new tests)
- **Code Quality**: All ruff checks passed
- **Coverage Improvements**:
    - Tool error handling: NEW capability
    - Image events: Better protocol compliance
    - Audio completion: Explicit signaling
    - Metadata forwarding: 4 new metadata types
- **AI SDK v6 Compliance**: Improved protocol adherence
    - Standard `file` events for images
    - Proper `tool-output-error` events
    - Rich `messageMetadata` in finish events

### 2025-12-12 (Late Night Part 3) - FinishReason Enum Refactoring + Coverage Automation ✅

**Objective**: Refactor FinishReason mapping to use Enums + Add automated coverage checking

#### Refactoring

**Problem**: FinishReason mapping used string literals, making it error-prone:

- `reason_map` used string keys/values ("STOP": "stop")
- No type safety
- No autocomplete
- Risk of typos

**Solution**: Use Enum-based mapping

1. Created `AISdkFinishReason` Enum (`stream_protocol.py:31-45`)
   - Defines AI SDK v6 finish reason values as Enum
   - `STOP`, `LENGTH`, `CONTENT_FILTER`, `TOOL_CALLS`, `ERROR`, `OTHER`
2. Updated `reason_map` to use Enums (`stream_protocol.py:70-95`)
   - `types.FinishReason.STOP: AISdkFinishReason.STOP`
   - Full type safety with ADK and AI SDK Enums
   - IDE autocomplete support
3. Updated tests to use real `types.FinishReason` enum
   - Removed 18 Mock-based tests
   - Kept 3 tests using real Enum values (57 tests total)

#### Coverage Automation

**Added FinishReason checking to `scripts/check-coverage.py`**:

1. **ADK Extractor** (`scripts/check-coverage.py:104-134`)
   - `extract_finish_reasons()`: Extract all `types.FinishReason` enum values
   - `get_finish_reasons()`: Return as set for coverage checking

2. **AI SDK Extractor** (`scripts/check-coverage.py:201-230`)
   - `extract_finish_reasons()`: Extract AI SDK v6 FinishReason values from type definitions
   - Falls back to known values: stop, length, content-filter, tool-calls, error, other

3. **ADK Analyzer** (`scripts/check-coverage.py:293-315`)
   - `analyze_finish_reasons()`: Parse Enum-based `reason_map` from `stream_protocol.py`
   - Pattern: `types.FinishReason.NAME: AISdkFinishReason.VALUE`

4. **Reporter** (`scripts/check-coverage.py:610-690`)
   - `print_finish_reason_coverage()`: Comprehensive coverage report
   - Shows mapped/missing ADK FinishReasons
   - Validates AI SDK target values
   - Detects unknown values in mapping

5. **Coverage Checker** (`scripts/check-coverage.py:747-753`)
   - Integrated FinishReason check into main coverage workflow

#### Coverage Report

```
# FinishReason Mapping Coverage Report

**Analyzed**:
- ADK: `types.FinishReason` enum (source)
- Implementation: `stream_protocol.py` reason_map (mapping)
- AI SDK v6: FinishReason type (target)

## ADK FinishReason Coverage

**Coverage**: 17/17 (100.0%) ✅

## ⚠️ AI SDK FinishReasons Not Produced

These AI SDK finish reasons are defined but not produced by mapping:

- `tool-calls`

## Summary

- **ADK FinishReason values**: 17
- **Mapped in reason_map**: 17
- **AI SDK target values**: 6
- **Unique mapped values**: 5
```

#### Impact

- **Type Safety**: Full Enum-based mapping prevents typos and provides IDE support
- **Automated Detection**: Script detects new ADK FinishReason values automatically
- **Maintainability**: Future ADK SDK updates will be caught by coverage check
- **Test Quality**: Real Enum tests (57 tests passing) instead of Mock tests

### 2025-12-12 (Late Night Part 2) - Complete FinishReason Coverage ✅

**Objective**: Achieve 100% coverage for all `types.FinishReason` enum values

#### Discovery

Discovered that `google.genai.types.FinishReason` is an actual Python Enum with 17 values:

- Original implementation covered: 8/17 (47%)
- Missing values: 9 (FINISH_REASON_UNSPECIFIED, IMAGE_*, LANGUAGE, MALFORMED_FUNCTION_CALL, NO_IMAGE, UNEXPECTED_TOOL_CALL)

#### Implementation (TDD Approach)

**Phase 1 (RED)**: Added failing tests

- Extended parameterized test with 9 new FinishReason values (`tests/unit/test_stream_protocol_comprehensive.py:1256-1310`)
- Added integration test using real `types.FinishReason` enum (`test_finish_reason_with_real_types_finish_reason_enum`)
- Total: 21 tests (11 existing + 10 new)

**Phase 2 (GREEN)**: Updated implementation

- Completed `reason_map` in `stream_protocol.py:55-80` with all 17 enum values
- Improved type annotation: `Any` → `types.FinishReason | None`
- Enhanced documentation with complete mapping table

**Phase 3 (REFACTOR)**: Verified quality

- All 75 unit tests passing ✅ (65 → 75)
- Ruff checks: All passed ✅
- 100% FinishReason coverage verified ✅

#### FinishReason Mapping Table

Complete mapping from ADK `types.FinishReason` to AI SDK v6:

| ADK FinishReason | AI SDK v6 | Category |
|------------------|-----------|----------|
| STOP | "stop" | Normal completion |
| FINISH_REASON_UNSPECIFIED | "stop" | Default/unspecified |
| MAX_TOKENS | "length" | Token limit |
| SAFETY | "content-filter" | Text content filter |
| RECITATION | "content-filter" | Text content filter |
| BLOCKLIST | "content-filter" | Text content filter |
| PROHIBITED_CONTENT | "content-filter" | Text content filter |
| SPII | "content-filter" | Text content filter |
| IMAGE_SAFETY | "content-filter" | Image content filter |
| IMAGE_RECITATION | "content-filter" | Image content filter |
| IMAGE_PROHIBITED_CONTENT | "content-filter" | Image content filter |
| LANGUAGE | "content-filter" | Language restriction |
| OTHER | "other" | Other reasons |
| IMAGE_OTHER | "other" | Image-related other |
| MALFORMED_FUNCTION_CALL | "error" | Tool call error |
| UNEXPECTED_TOOL_CALL | "error" | Tool call error |
| NO_IMAGE | "error" | Missing requirement |

#### Coverage Verification

```
=== Complete FinishReason Coverage Check ===

Total FinishReason enum values: 17

✅ Explicit: BLOCKLIST                           → "content-filter"
✅ Explicit: FINISH_REASON_UNSPECIFIED           → "stop"
✅ Explicit: IMAGE_OTHER                         → "other"
✅ Explicit: IMAGE_PROHIBITED_CONTENT            → "content-filter"
✅ Explicit: IMAGE_RECITATION                    → "content-filter"
✅ Explicit: IMAGE_SAFETY                        → "content-filter"
✅ Explicit: LANGUAGE                            → "content-filter"
✅ Explicit: MALFORMED_FUNCTION_CALL             → "error"
✅ Explicit: MAX_TOKENS                          → "length"
✅ Explicit: NO_IMAGE                            → "error"
⚠️  Fallback: OTHER                               → "other"
✅ Explicit: PROHIBITED_CONTENT                  → "content-filter"
✅ Explicit: RECITATION                          → "content-filter"
✅ Explicit: SAFETY                              → "content-filter"
✅ Explicit: SPII                                → "content-filter"
⚠️  Fallback: STOP                                → "stop"
✅ Explicit: UNEXPECTED_TOOL_CALL                → "error"

All 17 FinishReason enum values are handled! ✅
```

#### Impact

- **100% FinishReason Coverage**: All 17 `types.FinishReason` enum values correctly mapped
- **Type Safety**: Changed from `Any` to `types.FinishReason | None` for better type checking
- **Better Error Handling**: New "error" category for tool call and requirement failures
- **Image Content Filtering**: Proper handling of image-specific finish reasons
- **Maintainability**: Complete mapping prevents unexpected fallback behavior

### 2025-12-12 (Late Night Part 1) - Test Coverage Completion ✅

**Objective**: Achieve 100% test coverage for all public APIs in `stream_protocol.py`

#### Test Coverage Analysis

Analyzed `stream_protocol.py` public API:

- ✅ `StreamProtocolConverter` class - tested
- ✅ `StreamProtocolConverter.convert_event()` - tested
- ✅ `StreamProtocolConverter.finalize()` - tested
- ✅ `stream_adk_to_ai_sdk()` function - tested
- ❌ `map_adk_finish_reason_to_ai_sdk()` function - **NOT TESTED**

#### Implementation

**Added TestFinishReasonMapping class** (`tests/unit/test_stream_protocol_comprehensive.py:1253-1331`)

Added 11 comprehensive tests covering all mappings:

1. **Parameterized test (10 cases)**: `test_finish_reason_mapping()`
   - None/empty → "stop" (default)
   - STOP → "stop"
   - MAX_TOKENS → "length"
   - SAFETY → "content-filter"
   - RECITATION → "content-filter"
   - OTHER → "other"
   - BLOCKLIST → "content-filter"
   - PROHIBITED_CONTENT → "content-filter"
   - SPII → "content-filter"
   - UNKNOWN_REASON → "unknown_reason" (lowercase fallback)

2. **Edge case test**: `test_finish_reason_without_name_attribute_uses_string_conversion()`
   - Tests fallback to `str()` when object lacks `.name` attribute
   - Example: Custom object → lowercase conversion

**Test Results**: All 65 unit tests passing ✅

- 54 existing tests
- 11 new finish reason mapping tests

**Coverage Verification**:

```
=== Test Coverage for stream_protocol.py Public API ===

✅ map_adk_finish_reason_to_ai_sdk
✅ StreamProtocolConverter
✅ StreamProtocolConverter.convert_event
✅ StreamProtocolConverter.finalize
✅ stream_adk_to_ai_sdk

✅ All public APIs are tested!
```

#### Impact

- **100% Public API Coverage**: All public functions, classes, and methods in `stream_protocol.py` now have test coverage
- **Better Protocol Reliability**: Finish reason mapping is now validated for all ADK enum values
- **Edge Case Handling**: Tests verify fallback behavior for unknown/custom reasons
- **Maintainability**: Future changes to finish reason mappings will be caught by tests

### 2025-12-12 (Late Night Part 3) - Input Transcription Support ✅

**Objective**: Implement `input_transcription` handling following the `output_transcription` pattern for BIDI mode

**Background**: In BIDI mode, user audio input is transcribed to text by ADK and sent via `event.input_transcription`. This needs to be converted to AI SDK v6 text events for client display.

#### Implementation (TDD Approach)

**Phase 1 (RED)**: Created test file `tests/unit/test_input_transcription.py`

Added 4 comprehensive tests covering all scenarios:

1. **Parameterized test (2 cases)**: `test_input_transcription_conversion()`
   - Input text not finished → text-start, text-delta
   - Input text finished → text-start, text-delta, text-end

2. **Multi-chunk test**: `test_input_transcription_multiple_chunks()`
   - Scenario: User says "京都の天気は？" in 3 chunks
   - Verifies: text-start → 3 deltas → text-end sequence

3. **Backward compatibility test**: `test_no_input_transcription()`
   - Events without input_transcription should not generate transcription events

**Phase 2 (GREEN)**: Implementation in `stream_protocol.py`

1. **Separated text block tracking** (lines 135-140):

   ```python
   # Track input transcription text blocks (user audio input in BIDI mode)
   self._input_text_block_id: str | None = None
   self._input_text_block_started = False
   # Track output transcription text blocks (AI audio response)
   self._output_text_block_id: str | None = None
   self._output_text_block_started = False
   ```

2. **Added input_transcription handler** (lines 303-337):
   - Check `event.input_transcription` at Event level
   - Generate text-start/delta/end events with `_input_text` ID prefix
   - Track finished state separately from output transcription

3. **Updated finalize() method** (lines 645-661):
   - Close both input and output text blocks if open
   - Ensures proper cleanup on stream end

**Phase 3 (VERIFY)**: All tests passing

- **Input transcription tests**: 4/4 passing ✅
- **Comprehensive tests**: 40/40 passing ✅
- **All unit tests**: 61/61 passing ✅
- **Ruff linting**: All checks passed ✅

#### Key Design Decisions

1. **Separate State Tracking**: Input and output transcription use separate text block IDs and started flags
   - Prevents collision when both are present in same event
   - Allows independent lifecycle management

2. **ID Naming Convention**:
   - Input: `{message_id}_input_text`
   - Output: `{message_id}_output_text`
   - Clearly distinguishes source of transcription

3. **Processing Order**: Input transcription processed before output transcription
   - Logical flow: user input → AI response
   - Consistent with Event structure

#### Coverage Impact

- **New Test File**: `tests/unit/test_input_transcription.py` (4 tests)
- **Total Unit Tests**: 57 → 61 (4 new tests)
- **Event Fields Covered**: `input_transcription` now handled alongside `output_transcription`
- **BIDI Mode Support**: User audio input transcription now fully supported

#### Files Modified

1. `stream_protocol.py:135-140` - Separate state tracking variables
2. `stream_protocol.py:303-337` - Input transcription handler
3. `stream_protocol.py:645-661` - Updated finalize() for both blocks
4. `tests/unit/test_input_transcription.py` - New test file (complete)

### 2025-12-12 (Late Night Part 4) - ADK Event ID Investigation 🔍

**Objective**: Investigate if ADK Event ID fields (`id`, `interactionId`, `invocationId`) can be used for text block IDs instead of self-generated UUIDs

**Motivation**: Using ADK-provided IDs would make the converter more "pure" - transforming ADK data without adding synthetic identifiers

#### Investigation Summary

**ID Fields Available**:

1. **`event.id`**: `str` (required, default: `""`)
   - Event-level unique identifier
   - Generated by ADK for each Event

2. **`event.interactionId`**: `Optional[str]`
   - Interaction-level identifier (spans multiple events)
   - Shared across events in the same conversation turn
   - Newly discovered field (added 2025-12-12)

3. **`event.invocationId`**: `str` (required, default: `""`)
   - Invocation-level identifier
   - Likely unique per API call/session

4. **`event.longRunningToolIds`**: `Optional[set[str]]`
   - Tool-specific identifiers
   - Not relevant for transcription

#### Analysis

**Current Implementation**:

```python
# StreamProtocolConverter.__init__
self.message_id = message_id or str(uuid.uuid4())

# In convert_event()
self._input_text_block_id = f"{self.message_id}_input_text"
self._output_text_block_id = f"{self.message_id}_output_text"
```

**Potential ADK ID Usage**:

```python
# Option 1: Use event.id directly
self._input_text_block_id = f"{event.id}_input"
self._output_text_block_id = f"{event.id}_output"

# Option 2: Use interactionId for consistency across events
self._input_text_block_id = f"{event.interactionId}_input"
self._output_text_block_id = f"{event.interactionId}_output"

# Option 3: Combine event.id + transcription type
self._input_text_block_id = event.id  # If event.id is already unique
```

#### Risks & Concerns ⚠️

1. **ID Uniqueness**:
   - `event.id` may not be unique if ADK reuses IDs across events
   - `interactionId` is intentionally shared (not unique per event)
   - Need to verify ID uniqueness in real BIDI sessions

2. **ID Availability**:
   - Fields may be empty strings (default values)
   - `interactionId` is Optional - may be None
   - Requires fallback logic when IDs are missing

3. **ID Collision**:
   - If multiple events have same ID but different transcription types
   - Input and output transcription in same event would need suffixes
   - Current approach (`_input_text`, `_output_text`) still needed

4. **Protocol Coupling**:
   - Tighter coupling to ADK internal ID generation
   - Changes in ADK ID format would affect client

5. **Multi-Event Transcription**:
   - Transcription can span multiple events (streaming)
   - Need stable ID across event chunks
   - `event.id` changes per event → would break text block continuity

#### Critical Finding: Event ID Changes Per Chunk ❌

**Problem**: Input/output transcription streams across **multiple events**:

```
Event 1: input_transcription="京都の" (finished=False) - event.id="evt-001"
Event 2: input_transcription="天気は" (finished=False) - event.id="evt-002"
Event 3: input_transcription="？" (finished=True) - event.id="evt-003"
```

If we use `event.id`, each chunk would get a **different** text block ID:

```
text-start: id="evt-001_input"  ❌
text-delta: id="evt-002_input"  ❌ Different ID!
text-delta: id="evt-003_input"  ❌ Different ID!
text-end: id="evt-003_input"
```

**Client breaks** because text block IDs must be **stable** across chunks!

#### Recommendation: ❌ Do NOT use Event IDs

**Conclusion**: ADK Event IDs (`id`, `interactionId`, `invocationId`) are **not suitable** for text block IDs because:

1. **Transcription spans multiple events** - need stable ID across chunks
2. **Event IDs change per event** - would break text block continuity
3. **Current approach is correct** - converter-generated message_id is stable for entire message
4. **Converter responsibility** - text block tracking is a protocol conversion concern, not ADK data

**Current Implementation Status**: ✅ **KEEP AS-IS**

- Use converter-generated `message_id` (UUID)
- Append `_input_text` / `_output_text` suffixes
- Maintain text block ID stability across multi-event streams

#### Alternative: Use invocationId as Message ID?

**Potential Improvement** (Lower Priority):

```python
# StreamProtocolConverter.__init__
def __init__(self, message_id: str | None = None, invocation_id: str | None = None):
    # Prefer invocationId from ADK if available
    self.message_id = invocation_id or message_id or str(uuid.uuid4())
```

**Benefits**:

- Aligns message ID with ADK invocation tracking
- More deterministic (same invocationId → same message_id)

**Risks**:

- `invocationId` may be empty string
- Need to verify `invocationId` is unique per message (not per event)
- Would need testing with real BIDI sessions

**Status**: 📋 Investigation item for future work

### 2025-12-12 (Late Night Part 5) - Test Utils Refactoring ✅

**Objective**: Eliminate duplicate test utility code following DRY principle

**Changes**:

1. Created `tests/utils/sse.py` with shared utilities
2. Moved `parse_sse_event` from 3 files → 1 centralized location
3. Moved `MockTranscription` from 2 files → 1 centralized location
4. Updated all test files to import from `tests.utils`

**Files Modified**:

- `tests/utils/__init__.py` (new)
- `tests/utils/sse.py` (new)
- `tests/unit/test_input_transcription.py` (import update)
- `tests/unit/test_output_transcription.py` (import update)
- `tests/unit/test_stream_protocol_comprehensive.py` (import update)

**Quality**:

- ✅ All 61 tests passing
- ✅ Ruff checks passed
- ✅ Follows project structure guidelines

**Change Type**: STRUCTURAL (no behavior change)

### 2025-12-12 (Late Night Part 6) - ID Stability Regression Guards ✅

**Objective**: Add explicit tests to prevent accidental use of `event.id` for text block IDs

**Motivation**: Investigation showed that using ADK Event IDs would break multi-event transcription. Need tests to catch such mistakes before they reach production.

#### Problem Recap

**Critical Requirement**: Text block IDs must be **stable** across multiple events

```
Event 1: transcription="京都の" (finished=False) - event.id="evt-001"
Event 2: transcription="天気は" (finished=False) - event.id="evt-002"
Event 3: transcription="？" (finished=True) - event.id="evt-003"

✅ CORRECT: All use same text block ID (e.g., "msg-123_input_text")
❌ WRONG: Different IDs per event (e.g., "evt-001_input", "evt-002_input", ...)
```

#### Tests Added

**1. Enhanced existing multi-chunk tests** (`test_input_transcription.py`, `test_output_transcription.py`):

```python
# CRITICAL: Verify ID stability across multiple events
text_events = [e for e in parsed_events if e["type"] in ["text-start", "text-delta", "text-end"]]
unique_ids = {e["id"] for e in text_events}
assert len(unique_ids) == 1, (
    f"Text block ID must be stable across multiple events. "
    f"Got {len(unique_ids)} different IDs: {unique_ids}. "
    f"This likely means event.id is being used instead of converter.message_id"
)
```

**2. New regression guard tests**:

- `test_text_block_id_must_not_use_event_id` (input transcription)
- `test_text_block_id_must_not_use_event_id` (output transcription)

**Test Characteristics**:

- Explicitly sets **different** `event.id` values (e.g., "event-001", "event-002")
- Verifies text block ID is the **same** despite different event IDs
- Comprehensive error messages explaining **why** and **what went wrong**
- Includes documentation comments explaining the anti-pattern

#### Example Error Message (if test fails)

```
AssertionError: Text block IDs must be stable across events with different event.id.
Expected 1 unique ID, got 2: {'event-001_input', 'event-002_input'}.
Event IDs were: event-001, event-002.
If you see 2 different text block IDs, event.id is likely being used (WRONG!)
```

#### Test Coverage

**Total Unit Tests**: 61 → 63 (2 new regression guards)

- ✅ Input transcription: 4 → 5 tests (+1 regression guard)
- ✅ Output transcription: 4 → 5 tests (+1 regression guard)
- ✅ All 63 tests passing
- ✅ Ruff checks passed

#### Impact

**Protection Added**:

- ❌ Prevents accidental use of `event.id` for text block IDs
- ❌ Prevents accidental use of `interactionId` (multi-message scope)
- ✅ Enforces converter-generated `message_id` usage
- ✅ Clear error messages guide developers to correct implementation

**Developer Experience**:

- Tests fail **immediately** if someone uses wrong ID source
- Error messages explain **exactly** what's wrong and how to fix it
- Documentation comments in test code explain **why** the requirement exists

**Files Modified**:

- `tests/unit/test_input_transcription.py` (enhanced + new test)
- `tests/unit/test_output_transcription.py` (enhanced + new test)

**Change Type**: Structural (test enhancement, no production code changes)

### 2025-12-12 (Morning)

- **Initial version**: Created completeness matrix
- **Discovered**: `output_transcription` field (Event-level)
- **Implemented**: `output_transcription` → `text-start/delta/end` mapping
- **Tests**: 4 parameterized tests with real ADK data (all passing)
- **Documentation**: Identified gaps in Event/Part field handling
