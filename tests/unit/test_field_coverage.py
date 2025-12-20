"""
Test to ensure all ADK Event/Part fields are accounted for.

This test should FAIL when ADK SDK adds new fields that we haven't reviewed.
This prevents fields from being added without conscious decision-making.

When this test fails:
1. Review new fields in ADK SDK documentation
2. Decide: Implement now, document as TODO, or mark as metadata
3. Update IMPLEMENTED_*, DOCUMENTED_*, or METADATA_* fields below
4. Update experiments/2025-12-12_adk_field_mapping_completeness.md
"""

import inspect

from google.adk.events import Event
from google.genai import types


# =============================================================================
# Event Fields
# =============================================================================

# Fields we actively process in stream_protocol.py
IMPLEMENTED_EVENT_FIELDS = {
    "cacheMetadata",  # Context cache stats - implemented 2025-12-13
    "citationMetadata",  # Citation info for RAG - implemented 2025-12-13
    "content",  # Core message content (text, tools, code, etc.)
    "errorCode",  # Error detection (immediate) - implemented 2025-12-12
    "errorMessage",  # Error details (immediate) - implemented 2025-12-12
    "finishReason",  # Why generation stopped
    "groundingMetadata",  # Grounding sources for RAG - implemented 2025-12-13
    "inputTranscription",  # User audio transcription - implemented 2025-12-13
    "modelVersion",  # Model version info - implemented 2025-12-13
    "outputTranscription",  # Native-audio transcription - implemented 2025-12-12
    "turnComplete",  # Signals end of turn
    "usageMetadata",  # Token usage stats
}

# Fields we know about but haven't implemented yet (with justification)
DOCUMENTED_EVENT_FIELDS = {
    "interrupted": "Medium priority: BIDI UX feature for user interruption",
}

# Internal/metadata fields (low priority, documented why skipped)
METADATA_EVENT_FIELDS = {
    "actions": "ADK-specific workflow actions (not in AI SDK v6)",
    "author": "Message author metadata (not displayed)",
    "avgLogprobs": "Advanced feature: average log probabilities",
    "branch": "ADK conversation branching (not in AI SDK v6)",
    "customMetadata": "User-defined metadata",
    "id": "Event ID (internal)",
    "interactionId": "Interactions API state management ID (added in ADK 1.21.0)",
    "invocationId": "Invocation tracking ID",
    "liveSessionResumptionUpdate": "Live session state sync",
    "logprobsResult": "Advanced feature: token log probabilities",
    "longRunningToolIds": "ADK long-running tool tracking",
    "partial": "Partial event flag (internal)",
    "timestamp": "Event timestamp (internal)",
}


# =============================================================================
# Part Fields
# =============================================================================

# Part fields we actively process
IMPLEMENTED_PART_FIELDS = {
    "codeExecutionResult",  # Code execution output
    "executableCode",  # Code to execute
    "functionCall",  # Tool invocation
    "functionResponse",  # Tool result
    "inlineData",  # Binary data (images, audio)
    "text",  # Text content
    "thought",  # Reasoning/thinking mode (Gemini 2.0)
}

# Part fields documented but not implemented
DOCUMENTED_PART_FIELDS = {
    "fileData": "Medium priority: Multi-modal file support (GCS URLs)",
    "videoMetadata": "Low priority: Video-specific metadata",
}

# Part metadata fields
METADATA_PART_FIELDS = {
    "mediaResolution": "Media resolution info (not forwarded)",
    "thoughtSignature": "Advanced: Thought verification signature",
    "value": "Unknown purpose - needs investigation",
}


# =============================================================================
# Tests
# =============================================================================


def test_event_field_coverage():
    """Verify all Event fields are either implemented or documented as TODO."""
    event_sig = inspect.signature(Event)
    all_fields = set(event_sig.parameters.keys())

    known_fields = (
        IMPLEMENTED_EVENT_FIELDS
        | set(DOCUMENTED_EVENT_FIELDS.keys())
        | set(METADATA_EVENT_FIELDS.keys())
    )
    unknown_fields = all_fields - known_fields

    assert not unknown_fields, (
        f"🚨 New ADK Event fields detected: {unknown_fields}\n"
        f"\n"
        f"Action required:\n"
        f"1. Review new fields in ADK SDK documentation\n"
        f"2. Decide: Implement now, document as TODO, or mark as metadata\n"
        f"3. Update IMPLEMENTED_EVENT_FIELDS, DOCUMENTED_EVENT_FIELDS, or METADATA_EVENT_FIELDS\n"
        f"4. Update experiments/2025-12-12_adk_field_mapping_completeness.md\n"
        f"\n"
        f"Total Event fields: {len(all_fields)}\n"
        f"Known fields: {len(known_fields)}\n"
    )


def test_part_field_coverage():
    """Verify all Part fields are either implemented or documented."""
    part_sig = inspect.signature(types.Part)
    all_fields = set(part_sig.parameters.keys())

    known_fields = (
        IMPLEMENTED_PART_FIELDS
        | set(DOCUMENTED_PART_FIELDS.keys())
        | set(METADATA_PART_FIELDS.keys())
    )
    unknown_fields = all_fields - known_fields

    assert not unknown_fields, (
        f"🚨 New ADK Part fields detected: {unknown_fields}\n"
        f"\n"
        f"Action required:\n"
        f"1. Review new fields in ADK SDK documentation\n"
        f"2. Decide: Implement now, document as TODO, or mark as metadata\n"
        f"3. Update IMPLEMENTED_PART_FIELDS, DOCUMENTED_PART_FIELDS, or METADATA_PART_FIELDS\n"
        f"4. Update experiments/2025-12-12_adk_field_mapping_completeness.md\n"
        f"\n"
        f"Total Part fields: {len(all_fields)}\n"
        f"Known fields: {len(known_fields)}\n"
    )


def test_coverage_stats():
    """Report current field coverage statistics."""
    event_sig = inspect.signature(Event)
    part_sig = inspect.signature(types.Part)

    total_event_fields = len(event_sig.parameters)
    total_part_fields = len(part_sig.parameters)

    implemented_event_count = len(IMPLEMENTED_EVENT_FIELDS)
    implemented_part_count = len(IMPLEMENTED_PART_FIELDS)

    event_coverage = (implemented_event_count / total_event_fields) * 100
    part_coverage = (implemented_part_count / total_part_fields) * 100

    print("\n📊 Field Coverage Statistics:")
    print(f"  Event: {implemented_event_count}/{total_event_fields} ({event_coverage:.1f}%)")
    print(f"  Part:  {implemented_part_count}/{total_part_fields} ({part_coverage:.1f}%)")
    print("\n✅ All fields accounted for (implemented, documented, or metadata)")
