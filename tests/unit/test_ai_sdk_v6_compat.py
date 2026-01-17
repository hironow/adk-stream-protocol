"""
Unit tests for ai_sdk_v6_compat module.

Tests the AI SDK v6 compatibility layer, focusing on:
- process_chat_message_for_bidi: BIDI mode message processing (image/text separation)
- Tool use part validation
- ADK request confirmation conversion (Phase 5)
"""

from unittest.mock import patch

import pytest
from pydantic import ValidationError

from adk_stream_protocol import (
    ChatMessage,
    TextPart,
    ToolUsePart,
)
from adk_stream_protocol.ai_sdk_v6_compat import (
    GenericPart,
    StepPart,
    ToolCallState,
    process_chat_message_for_bidi,
)


class TestProcessChatMessageForBidi:
    """Tests for process_chat_message_for_bidi function (Phase 5 - simplified)."""

    def test_text_only_message(self):
        """Should extract text content from text-only message."""
        # given
        message_data = {
            "messages": [{"role": "user", "parts": [{"type": "text", "text": "Hello!"}]}]
        }

        # when
        image_blobs, text_content = process_chat_message_for_bidi(message_data)

        # then
        assert len(image_blobs) == 0
        assert text_content is not None
        assert text_content.role == "user"
        assert len(text_content.parts) == 1
        assert text_content.parts[0].text == "Hello!"

    def test_message_with_image(self):
        """Should separate image blobs from text parts."""
        from unittest.mock import MagicMock

        # given
        image_data = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=="
        message_data = {
            "messages": [
                {
                    "role": "user",
                    "parts": [
                        {"type": "text", "text": "Look:"},
                        {
                            "type": "file",
                            "filename": "image.png",
                            "url": image_data,
                            "mediaType": "image/png",
                        },
                    ],
                }
            ]
        }

        # when - mock both base64 decoding and PIL Image.open
        with (
            patch("adk_stream_protocol.ai_sdk_v6_compat.base64.b64decode") as mock_decode,
            patch("adk_stream_protocol.ai_sdk_v6_compat.Image.open") as mock_image_open,
        ):
            mock_decode.return_value = b"fake_image_data"

            # Mock PIL Image object with size and format attributes
            mock_img = MagicMock()
            mock_img.size = (1, 1)  # 1x1 pixel
            mock_img.format = "PNG"
            mock_img.__enter__ = MagicMock(return_value=mock_img)
            mock_img.__exit__ = MagicMock(return_value=False)
            mock_image_open.return_value = mock_img

            image_blobs, text_content = process_chat_message_for_bidi(message_data)

        # then
        assert len(image_blobs) == 1
        assert image_blobs[0].data == b"fake_image_data"
        assert image_blobs[0].mime_type == "image/png"
        assert text_content is not None
        assert len(text_content.parts) == 1
        assert text_content.parts[0].text == "Look:"

    def test_empty_messages(self):
        """Should handle empty messages gracefully."""
        # given
        message_data = {"messages": []}

        # when
        image_blobs, text_content = process_chat_message_for_bidi(message_data)

        # then
        assert len(image_blobs) == 0
        assert text_content is None

    def test_process_chat_message_for_bidi_processes_last_message_only(self):
        """Should process only the last message (verifying BIDI behavior)."""
        # given - message data with 3 messages in parts-based format
        message_data = {
            "messages": [
                {"role": "user", "parts": [{"type": "text", "text": "Hello"}]},
                {"role": "assistant", "parts": [{"type": "text", "text": "Hi there"}]},
                {"role": "user", "parts": [{"type": "text", "text": "How are you?"}]},
            ]
        }

        # when - process the messages
        _image_blobs, text_content = process_chat_message_for_bidi(message_data)

        # then - should have content from last user message only
        assert text_content is not None
        assert text_content.role == "user"
        assert len(text_content.parts) == 1
        assert text_content.parts[0].text == "How are you?"


class TestToolUsePartValidation:
    """Tests for ToolUsePart Pydantic model validation.

    These tests verify the fix for frontend delegate issue where frontend
    sends tool parts without explicit 'toolName' field.

    Related: experiments/2025-12-16_frontend_delegate_fix.md
    """

    def test_tool_use_part_with_explicit_tool_name(self):
        """Should validate successfully when tool_name is explicitly provided."""
        # given
        tool_data = {
            "type": "tool-change_bgm",
            "toolCallId": "adk-123",
            "toolName": "change_bgm",  # Explicitly provided
            "state": "output-available",
            "output": {"success": True},
        }

        # when
        tool_part = ToolUsePart(**tool_data)  # type: ignore[arg-type]  # Pydantic handles camelCase aliases

        # then
        assert tool_part.tool_name == "change_bgm"
        assert tool_part.type == "tool-change_bgm"
        assert tool_part.tool_call_id == "adk-123"

    def test_tool_use_part_without_tool_name_derives_from_type(self):
        """Should auto-derive tool_name from type when not provided.

        This is the critical fix: frontend sends type='tool-change_bgm' but
        no toolName field. We need to extract 'change_bgm' from the type.
        """
        # given
        tool_data = {
            "type": "tool-change_bgm",
            "toolCallId": "adk-456",
            # toolName is intentionally missing
            "state": "output-available",
            "output": {"success": True, "current_track": 1},
        }

        # when
        tool_part = ToolUsePart(**tool_data)  # type: ignore[arg-type]  # Pydantic handles camelCase aliases

        # then
        assert tool_part.tool_name == "change_bgm"  # Auto-derived from type
        assert tool_part.type == "tool-change_bgm"

    @pytest.mark.parametrize(
        "type_value,expected_tool_name",
        [
            ("tool-change_bgm", "change_bgm"),
            ("tool-get_location", "get_location"),
            ("tool-calculate", "calculate"),
            ("tool-get_weather", "get_weather"),
            ("tool-get_current_time", "get_current_time"),
        ],
    )
    def test_tool_use_part_derives_tool_name_from_various_types(
        self, type_value: str, expected_tool_name: str
    ):
        """Should correctly extract tool name from various type formats."""
        # given
        tool_data = {
            "type": type_value,
            "toolCallId": "test-id",
            "state": "output-available",
            "output": {},
        }

        # when
        tool_part = ToolUsePart(**tool_data)  # type: ignore[arg-type]  # Pydantic handles camelCase aliases

        # then
        assert tool_part.tool_name == expected_tool_name

    def test_tool_use_part_type_without_tool_prefix(self):
        """Should leave tool_name as None when type lacks 'tool-' prefix.

        In practice, frontend always sends type='tool-{name}' format, but
        we should handle edge cases gracefully.
        """
        # given
        tool_data = {
            "type": "change_bgm",  # No 'tool-' prefix
            "toolCallId": "test-id",
            "state": "output-available",
            "output": {},
        }

        # when
        tool_part = ToolUsePart(**tool_data)  # type: ignore[arg-type]  # Pydantic handles camelCase aliases

        # then
        # Without 'tool-' prefix, tool_name stays None
        assert tool_part.tool_name is None
        assert tool_part.type == "change_bgm"

    def test_tool_use_part_in_message_without_tool_name(self):
        """Should validate tool-use part in a message without toolName field.

        This simulates the exact scenario from the bug: frontend sends a
        message with tool output, but no toolName field.
        """
        # given
        message_data = {
            "role": "assistant",
            "parts": [
                {
                    "type": "tool-change_bgm",
                    "toolCallId": "adk-789",
                    # No toolName field
                    "state": "output-available",
                    "output": {
                        "success": True,
                        "previous_track": 0,
                        "current_track": 1,
                        "message": "BGM changed to track 1",
                    },
                }
            ],
        }

        # when
        message = ChatMessage(**message_data)

        # then
        assert len(message.parts) == 1
        tool_part = message.parts[0]
        assert isinstance(tool_part, ToolUsePart)
        assert tool_part.tool_name == "change_bgm"  # Auto-derived
        assert tool_part.state == ToolCallState.OUTPUT_AVAILABLE
        assert tool_part.output["success"] is True

    def test_tool_use_part_explicit_tool_name_takes_precedence(self):
        """Should use explicit toolName even if type has 'tool-' prefix."""
        # given
        tool_data = {
            "type": "tool-change_bgm",
            "toolCallId": "test-id",
            "toolName": "override_name",  # Explicit name different from type
            "state": "output-available",
            "output": {},
        }

        # when
        tool_part = ToolUsePart(**tool_data)  # type: ignore[arg-type]  # Pydantic handles camelCase aliases

        # then
        # Explicit toolName should take precedence
        assert tool_part.tool_name == "override_name"


class TestAdkRequestConfirmationConversion:
    """Tests for Phase 5: ADK Tool Confirmation Flow.

    Tests the conversion of `adk_request_confirmation` tool outputs
    from AI SDK v6 format to ADK FunctionResponse format.

    Related: experiments/2025-12-17_tool_architecture_refactoring.md (Phase 5)
    """

    def test_adk_request_confirmation_approved(self):
        """Should convert adk_request_confirmation with simplified output format.

        Simplified Phase 5 behavior: Use tool_call_id directly, no originalFunctionCall needed.
        Frontend sends: output={"confirmed": true}
        Backend uses: part.tool_call_id as the ID
        """
        # given
        message = ChatMessage(
            role="assistant",
            parts=[
                ToolUsePart(
                    type="tool-adk_request_confirmation",
                    tool_call_id="adk-confirmation-123",
                    tool_name="adk_request_confirmation",
                    args=None,
                    state=ToolCallState.OUTPUT_AVAILABLE,
                    output={"confirmed": True},  # Simplified format
                )
            ],
        )

        # when
        adk_content = message.to_adk_content()

        # then
        assert len(adk_content.parts) == 1
        function_response = adk_content.parts[0].function_response
        assert function_response is not None
        assert function_response.id == "adk-confirmation-123"  # Uses tool_call_id
        assert function_response.name == "adk_request_confirmation"
        assert function_response.response == {"confirmed": True}

    def test_adk_request_confirmation_with_invalid_output_should_skip(self):
        """Should gracefully handle adk_request_confirmation with invalid output format.

        If output doesn't have the expected "confirmed" field, skip creating FunctionResponse.
        """
        # given
        message = ChatMessage(
            role="assistant",
            parts=[
                ToolUsePart(
                    type="tool-adk_request_confirmation",
                    tool_call_id="adk-confirmation-error",
                    tool_name="adk_request_confirmation",
                    args=None,
                    state=ToolCallState.OUTPUT_AVAILABLE,
                    output={},  # Invalid: missing "confirmed" field
                )
            ],
        )

        # when
        adk_content = message.to_adk_content()

        # then
        # Should create FunctionResponse with confirmed=False (default value)
        assert len(adk_content.parts) == 1
        function_response = adk_content.parts[0].function_response
        assert function_response is not None
        assert function_response.id == "adk-confirmation-error"
        assert function_response.response == {"confirmed": False}  # Default value

    def test_adk_request_confirmation_denied(self):
        """Should handle denied confirmation (confirmed=False)."""
        # given
        message = ChatMessage(
            role="assistant",
            parts=[
                ToolUsePart(
                    type="tool-adk_request_confirmation",
                    tool_call_id="adk-confirmation-deny",
                    tool_name="adk_request_confirmation",
                    args=None,
                    state=ToolCallState.OUTPUT_AVAILABLE,
                    output={"confirmed": False},  # Simplified format
                )
            ],
        )

        # when
        adk_content = message.to_adk_content()

        # then
        assert len(adk_content.parts) == 1
        function_response = adk_content.parts[0].function_response
        assert function_response is not None
        assert function_response.id == "adk-confirmation-deny"  # Uses tool_call_id
        assert function_response.name == "adk_request_confirmation"
        assert function_response.response == {"confirmed": False}

    def test_adk_request_confirmation_with_none_output_should_skip(self):
        """Should skip when output is None."""
        # given
        message = ChatMessage(
            role="assistant",
            parts=[
                ToolUsePart(
                    type="tool-adk_request_confirmation",
                    tool_call_id="adk-confirmation-no-output",
                    tool_name="adk_request_confirmation",
                    args=None,
                    state=ToolCallState.OUTPUT_AVAILABLE,
                    output=None,  # No output at all
                )
            ],
        )

        # when
        adk_content = message.to_adk_content()

        # then
        # Should skip creating FunctionResponse when output is None
        assert len(adk_content.parts) == 0

    def test_adk_request_confirmation_with_process_payment_pending(self):
        """Should handle confirmation alongside pending tool (process_payment still waiting).

        With simplified approach:
        - process_payment is INPUT_AVAILABLE (waiting) → skipped
        - adk_request_confirmation is OUTPUT_AVAILABLE (user approved) → creates FunctionResponse
        - Uses part.tool_call_id directly (no originalFunctionCall needed)
        """
        # given
        message = ChatMessage(
            role="assistant",
            parts=[
                ToolUsePart(
                    type="tool-process_payment",
                    tool_call_id="adk-payment-pending",
                    tool_name="process_payment",
                    args=None,  # AI SDK v6 doesn't populate args for pending tools
                    state=ToolCallState.INPUT_AVAILABLE,  # Still waiting
                ),
                ToolUsePart(
                    type="tool-adk_request_confirmation",
                    tool_call_id="adk-confirmation-approved",
                    tool_name="adk_request_confirmation",
                    args=None,
                    state=ToolCallState.OUTPUT_AVAILABLE,
                    output={"confirmed": True},  # Simplified format
                ),
            ],
        )

        # when
        adk_content = message.to_adk_content()

        # then
        # Should have 1 part:
        # - process_payment is skipped (INPUT_AVAILABLE state)
        # - adk_request_confirmation creates FunctionResponse with tool_call_id
        assert len(adk_content.parts) == 1
        function_response = adk_content.parts[0].function_response
        assert function_response is not None
        assert function_response.id == "adk-confirmation-approved"
        assert function_response.name == "adk_request_confirmation"
        assert function_response.response == {"confirmed": True}

    def test_adk_request_confirmation_conversion_called_exactly_once(self):
        """Should call _process_part exactly once for confirmation conversion (spy test for duplicate send prevention)."""
        from unittest.mock import patch

        # given
        message = ChatMessage(
            role="assistant",
            parts=[
                ToolUsePart(
                    type="tool-adk_request_confirmation",
                    tool_call_id="adk-confirmation-123",
                    tool_name="adk_request_confirmation",
                    args=None,
                    state=ToolCallState.OUTPUT_AVAILABLE,
                    output={"confirmed": True},
                )
            ],
        )

        # when - spy on _process_part to verify it's called exactly once
        with patch.object(
            message, "_process_part", wraps=message._process_part
        ) as spy_process_part:
            adk_content = message.to_adk_content()

            # then - verify _process_part was called exactly once (no duplicates)
            assert spy_process_part.call_count == 1, (
                f"Expected _process_part to be called exactly once, "
                f"but was called {spy_process_part.call_count} times"
            )

            # Verify the call arguments were correct
            call_args = spy_process_part.call_args
            assert call_args is not None
            called_part = call_args[0][0]  # First positional arg
            assert isinstance(called_part, ToolUsePart)
            assert called_part.tool_call_id == "adk-confirmation-123"

            # Verify output is correct
            assert len(adk_content.parts) == 1
            function_response = adk_content.parts[0].function_response
            assert function_response is not None
            assert function_response.id == "adk-confirmation-123"
            assert function_response.response == {"confirmed": True}

    def test_multiple_parts_conversion_called_correct_number_of_times(self):
        """Should call _process_part for each part (spy test for ensuring all parts are processed)."""
        from unittest.mock import patch

        # given - message with text part and confirmation part
        message = ChatMessage(
            role="assistant",
            parts=[
                TextPart(type="text", text="I need your confirmation."),
                ToolUsePart(
                    type="tool-adk_request_confirmation",
                    tool_call_id="adk-confirmation-456",
                    tool_name="adk_request_confirmation",
                    args=None,
                    state=ToolCallState.OUTPUT_AVAILABLE,
                    output={"confirmed": False},
                ),
            ],
        )

        # when - spy on _process_part to verify it's called for each part
        with patch.object(
            message, "_process_part", wraps=message._process_part
        ) as spy_process_part:
            adk_content = message.to_adk_content()

            # then - verify _process_part was called exactly twice (once per part)
            assert spy_process_part.call_count == 2, (
                f"Expected _process_part to be called 2 times (once per part), "
                f"but was called {spy_process_part.call_count} times"
            )

            # Verify output has both parts
            assert len(adk_content.parts) == 2
            assert adk_content.parts[0].text == "I need your confirmation."
            assert adk_content.parts[1].function_response is not None
            assert adk_content.parts[1].function_response.id == "adk-confirmation-456"


# ========================================================================
# Internal Chunk Handling Tests
# ========================================================================
# These tests validate that AI SDK v6 internal chunks are properly handled:
# - Known step chunks (StepPart): start, step-start, start-step, finish-step
# - Unknown chunks (GenericPart): any other type
# ========================================================================


class TestInternalChunkHandling:
    """Tests for AI SDK v6 internal chunk handling (StepPart and GenericPart)."""

    # ========== Parametrized Tests for Known Step Types ==========

    @pytest.mark.parametrize(
        "step_type",
        [
            "start",
            "step-start",
            "start-step",
            "finish-step",
        ],
    )
    def test_known_step_chunks_handled_as_step_part(self, step_type):
        """Should handle known AI SDK v6 step chunks as StepPart."""
        # given
        message_data = {"role": "assistant", "parts": [{"type": step_type}]}

        # when
        message = ChatMessage(**message_data)

        # then
        assert message.role == "assistant"
        assert len(message.parts) == 1
        assert isinstance(message.parts[0], StepPart)
        assert message.parts[0].type == step_type

    # ========== Parametrized Tests for Unknown/Generic Types ==========

    @pytest.mark.parametrize(
        "unknown_type",
        [
            "unknown-chunk",
            "custom-type",
            "finish",  # 'finish' without finishReason is treated as unknown
            "step-end",  # Not in our known list
            "step-middle",
            "random-internal-chunk",
        ],
    )
    def test_unknown_chunks_handled_as_generic_part(self, unknown_type):
        """Should handle unknown chunk types as GenericPart."""
        # given
        message_data = {"role": "assistant", "parts": [{"type": unknown_type}]}

        # when
        message = ChatMessage(**message_data)

        # then
        assert message.role == "assistant"
        assert len(message.parts) == 1
        assert isinstance(message.parts[0], GenericPart)
        assert message.parts[0].type == unknown_type

    # ========== Test Mixed Parts ==========

    def test_chat_message_with_mixed_parts(self):
        """Should correctly handle mix of text, step, and unknown parts."""
        # given
        message_data = {
            "role": "assistant",
            "parts": [
                {"type": "text", "text": "Hello"},
                {"type": "step-start"},  # Known step type → StepPart
                {"type": "text", "text": "World"},
                {"type": "unknown-chunk"},  # Unknown type → GenericPart
                {"type": "finish-step"},  # Known step type → StepPart
            ],
        }

        # when
        message = ChatMessage(**message_data)

        # then
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

    @pytest.mark.parametrize(
        "parts_config",
        [
            # Test with known step types
            {
                "parts": [
                    {"type": "text", "text": "First"},
                    {"type": "start"},  # StepPart - should be skipped
                    {"type": "step-start"},  # StepPart - should be skipped
                    {"type": "text", "text": "Second"},
                    {"type": "finish-step"},  # StepPart - should be skipped
                ],
                "expected_texts": ["First", "Second"],
            },
            # Test with unknown types
            {
                "parts": [
                    {"type": "text", "text": "Begin"},
                    {"type": "unknown-type"},  # GenericPart - should be skipped
                    {"type": "custom-chunk"},  # GenericPart - should be skipped
                    {"type": "text", "text": "End"},
                ],
                "expected_texts": ["Begin", "End"],
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
                "expected_texts": ["Alpha", "Beta", "Gamma"],
            },
        ],
    )
    def test_to_adk_content_skips_step_and_generic_parts(self, parts_config):
        """Should skip both StepPart and GenericPart when converting to ADK."""
        # given
        message_data = {"role": "user", "parts": parts_config["parts"]}

        # when
        message = ChatMessage(**message_data)
        adk_content = message.to_adk_content()

        # then: Only text parts should be converted to ADK parts
        assert len(adk_content.parts) == len(parts_config["expected_texts"])
        for i, expected_text in enumerate(parts_config["expected_texts"]):
            assert adk_content.parts[i].text == expected_text

    # ========== Test GenericPart Extra Fields ==========

    def test_generic_part_allows_extra_fields(self):
        """Should allow GenericPart to accept any additional fields."""
        # given
        part_data = {
            "type": "custom-chunk",  # Unknown type
            "stepId": "123",
            "timestamp": "2025-12-15T07:00:00Z",
            "arbitrary_field": "arbitrary_value",
            "nested": {"key": "value"},
        }

        # when
        part = GenericPart(**part_data)

        # then
        assert part.type == "custom-chunk"
        # Extra fields should be preserved
        dump = part.model_dump()
        assert dump["stepId"] == "123"
        assert dump["timestamp"] == "2025-12-15T07:00:00Z"
        assert dump["arbitrary_field"] == "arbitrary_value"
        assert dump["nested"] == {"key": "value"}

    # ========== Test Step Parts Don't Accept Extra Fields by Default ==========

    def test_step_part_basic_fields(self):
        """Should handle StepPart basic fields correctly."""
        # given
        part_data = {"type": "step-start"}

        # when
        part = StepPart(**part_data)

        # then
        assert part.type == "step-start"
        assert part.model_dump() == {"type": "step-start"}

    # ========== Edge Cases ==========

    def test_empty_parts_array(self):
        """Should handle message with empty parts array."""
        # given
        message_data = {"role": "user", "parts": []}

        # when
        message = ChatMessage(**message_data)
        adk_content = message.to_adk_content()

        # then
        assert len(adk_content.parts) == 0

    def test_message_with_only_internal_chunks(self):
        """Should skip all internal chunks when message contains only internal chunks."""
        # given
        message_data = {
            "role": "assistant",
            "parts": [
                {"type": "start"},
                {"type": "step-start"},
                {"type": "finish-step"},
                {"type": "unknown-internal"},
            ],
        }

        # when
        message = ChatMessage(**message_data)
        adk_content = message.to_adk_content()

        # then: All internal chunks should be skipped
        assert len(adk_content.parts) == 0

    # ========== Test Invalid Types Still Raise Errors ==========

    def test_invalid_part_structure_raises_error(self):
        """Should raise validation error for truly invalid part structures."""
        # given: parts is not an array
        message_data = {
            "role": "user",
            "parts": "not-an-array",  # Invalid: must be a list
        }

        # when/then: Should fail because parts must be a list
        with pytest.raises(ValidationError) as exc_info:
            ChatMessage(**message_data)

        assert "parts" in str(exc_info.value).lower() or "list" in str(exc_info.value).lower()

    def test_text_type_without_text_field_becomes_generic(self):
        """Should treat {"type": "text"} without text field as GenericPart."""
        # given: Looks like TextPart but missing 'text' field
        message_data = {"role": "user", "parts": [{"type": "text"}]}

        # when
        message = ChatMessage(**message_data)

        # then: It becomes GenericPart because TextPart validation fails
        assert len(message.parts) == 1
        assert isinstance(message.parts[0], GenericPart)
        assert message.parts[0].type == "text"

    def test_text_without_type_field_uses_default(self):
        """Should use default type="text" for {"text": "hello"} creating TextPart."""
        # given: Missing 'type' but TextPart has default
        message_data = {"role": "user", "parts": [{"text": "hello"}]}

        # when
        message = ChatMessage(**message_data)

        # then: It becomes TextPart with default type="text"
        assert len(message.parts) == 1
        assert isinstance(message.parts[0], TextPart)
        assert message.parts[0].type == "text"
        assert message.parts[0].text == "hello"


class TestChatMessageContentField:
    """
    Tests for ChatMessage.content field type compatibility.

    Edge case discovered during POC Phase 5:
    - function_response messages use content as list[Part] (AI SDK v6 spec)
    - ChatMessage.content was typed as str | None (incomplete)
    - Result: Pydantic validation error in BIDI mode

    Reference: experiments/2025-12-18_poc_phase5_generic_approval_success.md
    """

    def test_content_accepts_string(self):
        """ChatMessage.content should accept string (simple text message)."""
        # given
        message_data = {"role": "user", "content": "Hello, world!"}

        # when
        message = ChatMessage(**message_data)

        # then
        assert message.content == "Hello, world!"
        assert message.parts is None

    def test_content_accepts_list_of_parts(self):
        """
        ChatMessage.content should accept list[Part] for function_response.

        This test captures the edge case bug found in POC Phase 5:
        - BIDI mode sends function_response with content as list
        - Example: content=[{"type": "tool-result", "toolCallId": "...", ...}]
        - Current type: str | None → Pydantic validation error
        - Expected type: str | list[Part] | None

        BUG: This test WILL FAIL until ChatMessage.content type is fixed.
        """
        # given: function_response message from LongRunningFunctionTool
        message_data = {
            "role": "user",
            "content": [
                {
                    "type": "tool-result",
                    "toolCallId": "function-call-123",
                    "toolName": "approval_test_tool",
                    "result": {
                        "approved": True,
                        "user_message": "User approved approval_test_tool execution",
                        "timestamp": "2025-12-18T12:10:43.915Z",
                    },
                }
            ],
        }

        # when
        message = ChatMessage(**message_data)

        # then
        assert message.content is not None
        assert isinstance(message.content, list)
        assert len(message.content) == 1
