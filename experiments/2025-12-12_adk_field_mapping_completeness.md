# ADK to AI SDK v6 Field Mapping: Completeness Check

**Date:** 2025-12-12
**Objective:** Ensure comprehensive mapping of all ADK Event/Content/Part fields to AI SDK v6 Data Stream Protocol
**Status:** 🟡 In Progress

---

## Background

During implementation of `output_transcription` support, we discovered this field **by accident** through debug logging with `pformat()`. This raises concerns about **completeness**: Are there other ADK fields we're not handling?

This document provides a systematic completeness check based on:
1. **ADK Python SDK source code** (`google.adk.events.Event`, `google.genai.types`)
2. **ADK official documentation** (https://google.github.io/adk-docs/)
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
1. **RunConfig Reference**: https://google.github.io/adk-docs/runtime/runconfig/
   - Configuration options for transcription, modalities, etc.
   - Shows which features exist (even if not in Event structure)

2. **Python API Reference**: https://google.github.io/adk-docs/api-reference/python/
   - May not be complete (docs lag behind implementation)

3. **Gemini Live API Docs**: https://ai.google.dev/gemini-api/docs/live
   - ADK wraps Gemini Live API
   - Shows protocol-level features that become Event fields

**Documentation Gaps**:
- Official docs often **lag behind SDK releases**
- Not all Event fields are documented
- Example: `output_transcription` was configured via `AudioTranscriptionConfig` but Event field was not explicitly documented

#### Method 3: GitHub Repository Analysis

**ADK Python Repository**: https://github.com/google/adk-python

**What to Monitor**:
1. **Releases**: https://github.com/google/adk-python/releases
   - Check CHANGELOG for new fields
   - Breaking changes that add/remove fields

2. **Issues**: https://github.com/google/adk-python/issues
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

- **RunConfig**: https://google.github.io/adk-docs/runtime/runconfig/
  - `input_audio_transcription: AudioTranscriptionConfig()`
  - `output_audio_transcription: AudioTranscriptionConfig()`

- **Python API Reference**: https://google.github.io/adk-docs/api-reference/python/

- **GitHub Issue #697**: https://github.com/google/adk-python/issues/697
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
| `inputTranscription` | ❌ Not implemented | TBD | Medium | User audio transcription |
| `groundingMetadata` | ❌ Not implemented | TBD | Medium | Grounding sources/attributions |
| `citationMetadata` | ❌ Not implemented | TBD | Medium | Citation information |
| `logprobsResult` | ❌ Not implemented | TBD | Low | Token log probabilities |
| `avgLogprobs` | ❌ Not implemented | TBD | Low | Average log probabilities |
| `cacheMetadata` | ❌ Not implemented | TBD | Low | Context caching info |
| `liveSessionResumptionUpdate` | ❌ Not implemented | TBD | Low | Session resumption state |
| `errorCode` | ⚠️ Partial | `error` event (only via finalize) | Critical | Error signaling |
| `errorMessage` | ⚠️ Partial | `error` event (only via finalize) | Critical | Error details |
| `interrupted` | ❌ Not implemented | TBD | Medium | Interruption signal |
| `customMetadata` | ❌ Not implemented | TBD | Low | User-defined metadata |
| `modelVersion` | ❌ Not implemented | TBD | Low | Model version info |
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

3. **Event.groundingMetadata**
   - Grounding sources and attributions
   - Important for RAG/grounded generation transparency
   - Map to `message-annotations` or custom event?

4. **Event.citationMetadata**
   - Citation information
   - Important for academic/research use cases
   - Map to `message-annotations` or custom event?

5. **Part.fileData**
   - File references (images, documents, etc.)
   - Important for multi-modal support
   - Map to... `data` event? (needs investigation)

### Priority 3: Lower Priority

6. **Event.interrupted**
   - Interruption signaling for BIDI mode
   - Could map to custom event or `finish` with special reason

7. **Part.videoMetadata**
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

- **ADK Python SDK**: https://github.com/google/adk-python
  - Source of truth for Event/Content/Part structure
  - Check releases for new fields: https://github.com/google/adk-python/releases

- **ADK Documentation**: https://google.github.io/adk-docs/
  - RunConfig reference: https://google.github.io/adk-docs/runtime/runconfig/
  - API reference: https://google.github.io/adk-docs/api-reference/python/

- **AI SDK v6 Protocol**: https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol
  - Specification for all event types
  - Field naming conventions

### Related Issues

- **GitHub Issue #697**: https://github.com/google/adk-python/issues/697
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

3. **Implement `inputTranscription`** (if accessibility is important)
   - Similar to `outputTranscription` but for user input
   - Map to custom event or `message-annotations`

4. **Implement `groundingMetadata` / `citationMetadata`** (if RAG is important)
   - Map to `message-annotations` event
   - Display sources in UI

5. **Implement `fileData`** (if multi-modal file support needed)
   - Map to `data` event with file URL
   - Frontend fetches from GCS

6. **Map `Part.thought` to `reasoning-*` events** (optional)
   - Currently maps to custom `thought` event
   - Could also generate `reasoning-start/delta/end` for AI SDK v6 compatibility

---

## Changelog

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

### 2025-12-12 (Morning)

- **Initial version**: Created completeness matrix
- **Discovered**: `output_transcription` field (Event-level)
- **Implemented**: `output_transcription` → `text-start/delta/end` mapping
- **Tests**: 4 parameterized tests with real ADK data (all passing)
- **Documentation**: Identified gaps in Event/Part field handling
