"""
Test for AI SDK v6 internal chunk handling.

This test validates that AI SDK v6 internal chunks are properly handled:
- Known step chunks (StepPart): start, step-start, start-step, finish-step
- Unknown chunks (GenericPart): any other type
"""

import pytest
from ai_sdk_v6_compat import ChatMessage, GenericPart, StepPart, TextPart
from pydantic import ValidationError


# ========== Parametrized Tests for Known Step Types ==========

@pytest.mark.parametrize("step_type", [
    "start",
    "step-start",
    "start-step",
    "finish-step",
])
def test_known_step_chunks_handled_as_step_part(step_type):
    """Test that known AI SDK v6 step chunks are handled as StepPart."""
    message_data = {
        "role": "assistant",
        "parts": [
            {"type": step_type}
        ]
    }

    message = ChatMessage(**message_data)

    assert message.role == "assistant"
    assert len(message.parts) == 1
    assert isinstance(message.parts[0], StepPart)
    assert message.parts[0].type == step_type


# ========== Parametrized Tests for Unknown/Generic Types ==========

@pytest.mark.parametrize("unknown_type", [
    "unknown-chunk",
    "custom-type",
    "finish",  # 'finish' without finishReason is treated as unknown
    "step-end",  # Not in our known list
    "step-middle",
    "random-internal-chunk",
])
def test_unknown_chunks_handled_as_generic_part(unknown_type):
    """Test that unknown chunk types are handled as GenericPart."""
    message_data = {
        "role": "assistant",
        "parts": [
            {"type": unknown_type}
        ]
    }

    message = ChatMessage(**message_data)

    assert message.role == "assistant"
    assert len(message.parts) == 1
    assert isinstance(message.parts[0], GenericPart)
    assert message.parts[0].type == unknown_type


# ========== Test Mixed Parts ==========

def test_chat_message_with_mixed_parts():
    """Test that ChatMessage correctly handles mix of text, step, and unknown parts."""
    message_data = {
        "role": "assistant",
        "parts": [
            {"type": "text", "text": "Hello"},
            {"type": "step-start"},  # Known step type -> StepPart
            {"type": "text", "text": "World"},
            {"type": "unknown-chunk"},  # Unknown type -> GenericPart
            {"type": "finish-step"},  # Known step type -> StepPart
        ]
    }

    message = ChatMessage(**message_data)

    assert message.role == "assistant"
    assert len(message.parts) == 5

    # Check first text part
    assert isinstance(message.parts[0], TextPart)
    assert message.parts[0].text == "Hello"

    # Check first step part
    assert isinstance(message.parts[1], StepPart)
    assert message.parts[1].type == "step-start"

    # Check second text part
    assert isinstance(message.parts[2], TextPart)
    assert message.parts[2].text == "World"

    # Check unknown part
    assert isinstance(message.parts[3], GenericPart)
    assert message.parts[3].type == "unknown-chunk"

    # Check second step part
    assert isinstance(message.parts[4], StepPart)
    assert message.parts[4].type == "finish-step"


# ========== Test to_adk_content Skips Both StepPart and GenericPart ==========

@pytest.mark.parametrize("parts_config", [
    # Test with known step types
    {
        "parts": [
            {"type": "text", "text": "First"},
            {"type": "start"},  # StepPart - should be skipped
            {"type": "step-start"},  # StepPart - should be skipped
            {"type": "text", "text": "Second"},
            {"type": "finish-step"},  # StepPart - should be skipped
        ],
        "expected_texts": ["First", "Second"]
    },
    # Test with unknown types
    {
        "parts": [
            {"type": "text", "text": "Begin"},
            {"type": "unknown-type"},  # GenericPart - should be skipped
            {"type": "custom-chunk"},  # GenericPart - should be skipped
            {"type": "text", "text": "End"},
        ],
        "expected_texts": ["Begin", "End"]
    },
    # Test with mixed step and unknown types
    {
        "parts": [
            {"type": "text", "text": "Alpha"},
            {"type": "start-step"},  # StepPart - should be skipped
            {"type": "unknown"},  # GenericPart - should be skipped
            {"type": "text", "text": "Beta"},
            {"type": "finish-step"},  # StepPart - should be skipped
            {"type": "random-chunk"},  # GenericPart - should be skipped
            {"type": "text", "text": "Gamma"},
        ],
        "expected_texts": ["Alpha", "Beta", "Gamma"]
    },
])
def test_to_adk_content_skips_step_and_generic_parts(parts_config):
    """Test that to_adk_content skips both StepPart and GenericPart instances."""
    message_data = {
        "role": "user",
        "parts": parts_config["parts"]
    }

    message = ChatMessage(**message_data)
    adk_content = message.to_adk_content()

    # Only text parts should be converted to ADK parts
    assert len(adk_content.parts) == len(parts_config["expected_texts"])
    for i, expected_text in enumerate(parts_config["expected_texts"]):
        assert adk_content.parts[i].text == expected_text


# ========== Test GenericPart Extra Fields ==========

def test_generic_part_allows_extra_fields():
    """Test that GenericPart accepts any additional fields."""
    part_data = {
        "type": "custom-chunk",  # Unknown type
        "stepId": "123",
        "timestamp": "2025-12-15T07:00:00Z",
        "arbitrary_field": "arbitrary_value",
        "nested": {"key": "value"}
    }

    part = GenericPart(**part_data)

    assert part.type == "custom-chunk"
    # Extra fields should be preserved
    dump = part.model_dump()
    assert dump["stepId"] == "123"
    assert dump["timestamp"] == "2025-12-15T07:00:00Z"
    assert dump["arbitrary_field"] == "arbitrary_value"
    assert dump["nested"] == {"key": "value"}


# ========== Test Step Parts Don't Accept Extra Fields by Default ==========

def test_step_part_basic_fields():
    """Test that StepPart handles basic fields correctly."""
    part_data = {
        "type": "step-start"
    }

    part = StepPart(**part_data)

    assert part.type == "step-start"
    assert part.model_dump() == {"type": "step-start"}


# ========== Edge Cases ==========

def test_empty_parts_array():
    """Test handling of message with empty parts array."""
    message_data = {
        "role": "user",
        "parts": []
    }

    message = ChatMessage(**message_data)
    adk_content = message.to_adk_content()

    assert len(adk_content.parts) == 0


def test_message_with_only_internal_chunks():
    """Test message containing only internal chunks (no actual content)."""
    message_data = {
        "role": "assistant",
        "parts": [
            {"type": "start"},
            {"type": "step-start"},
            {"type": "finish-step"},
            {"type": "unknown-internal"},
        ]
    }

    message = ChatMessage(**message_data)
    adk_content = message.to_adk_content()

    # All internal chunks should be skipped
    assert len(adk_content.parts) == 0


# ========== Test Invalid Types Still Raise Errors ==========

def test_invalid_part_structure_raises_error():
    """Test that truly invalid part structures still raise validation errors."""
    # parts is not an array
    message_data = {
        "role": "user",
        "parts": "not-an-array"  # Invalid: must be a list
    }

    with pytest.raises(ValidationError) as exc_info:
        ChatMessage(**message_data)

    # Should fail because parts must be a list
    assert "parts" in str(exc_info.value).lower() or "list" in str(exc_info.value).lower()


def test_text_type_without_text_field_becomes_generic():
    """Test that {"type": "text"} without text field becomes GenericPart."""
    # This is actually valid because GenericPart accepts any type
    message_data = {
        "role": "user",
        "parts": [
            {"type": "text"}  # Looks like TextPart but missing 'text' field
        ]
    }

    message = ChatMessage(**message_data)

    # It becomes GenericPart because TextPart validation fails
    assert len(message.parts) == 1
    assert isinstance(message.parts[0], GenericPart)
    assert message.parts[0].type == "text"


def test_text_without_type_field_uses_default():
    """Test that {"text": "hello"} uses default type="text" for TextPart."""
    # TextPart has default type="text", so this is valid
    message_data = {
        "role": "user",
        "parts": [
            {"text": "hello"}  # Missing 'type' but TextPart has default
        ]
    }

    message = ChatMessage(**message_data)

    # It becomes TextPart with default type="text"
    assert len(message.parts) == 1
    assert isinstance(message.parts[0], TextPart)
    assert message.parts[0].type == "text"
    assert message.parts[0].text == "hello"