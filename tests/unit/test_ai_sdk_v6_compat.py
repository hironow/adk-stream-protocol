"""
Unit tests for ai_sdk_v6_compat module.

Tests the AI SDK v6 compatibility layer, focusing on:
- process_tool_use_parts: Tool approval/rejection handling
- process_chat_message_for_bidi: BIDI mode message processing
"""

from unittest.mock import MagicMock, patch

import pytest

from ai_sdk_v6_compat import (
    ChatMessage,
    FilePart,
    TextPart,
    ToolApproval,
    ToolCallState,
    ToolUsePart,
    process_chat_message_for_bidi,
    process_tool_use_parts,
)


class TestProcessToolUseParts:
    """Tests for process_tool_use_parts function."""

    def test_process_tool_use_parts_empty_message(self):
        """Should handle messages without parts gracefully."""
        # given
        message = ChatMessage(role="user", content="test")
        delegate = MagicMock()

        # when
        process_tool_use_parts(message, delegate)

        # then
        delegate.reject_tool_call.assert_not_called()
        delegate.resolve_tool_result.assert_not_called()

    def test_process_tool_use_parts_no_tool_parts(self):
        """Should ignore non-tool parts."""
        # given
        message = ChatMessage(
            role="assistant",
            parts=[
                TextPart(type="text", text="Hello"),
                FilePart(
                    type="file",
                    filename="image.png",
                    url="data:image/png;base64,abc123",
                    media_type="image/png",
                ),
            ],
        )
        delegate = MagicMock()

        # when
        process_tool_use_parts(message, delegate)

        # then
        delegate.reject_tool_call.assert_not_called()
        delegate.resolve_tool_result.assert_not_called()

    def test_process_tool_use_parts_approval_rejected(self):
        """Should call reject_tool_call when approval is rejected."""
        # given
        tool_call_id = "test_tool_123"
        rejection_reason = "User denied location access"
        message = ChatMessage(
            role="assistant",
            parts=[
                ToolUsePart(
                    type="tool-use",
                    tool_call_id=tool_call_id,
                    tool_name="get_location",
                    state=ToolCallState.APPROVAL_RESPONDED,
                    approval=ToolApproval(
                        id="approval_123",
                        approved=False,
                        reason=rejection_reason,
                    ),
                )
            ],
        )
        delegate = MagicMock()

        # when
        process_tool_use_parts(message, delegate)

        # then
        delegate.reject_tool_call.assert_called_once_with(tool_call_id, rejection_reason)
        delegate.resolve_tool_result.assert_not_called()

    def test_process_tool_use_parts_approval_rejected_no_reason(self):
        """Should use default reason when rejection has no reason."""
        # given
        tool_call_id = "test_tool_456"
        message = ChatMessage(
            role="assistant",
            parts=[
                ToolUsePart(
                    type="tool-use",
                    tool_call_id=tool_call_id,
                    tool_name="change_bgm",
                    state=ToolCallState.APPROVAL_RESPONDED,
                    approval=ToolApproval(
                        id="approval_456",
                        approved=False,
                        reason=None,  # No reason provided
                    ),
                )
            ],
        )
        delegate = MagicMock()

        # when
        process_tool_use_parts(message, delegate)

        # then
        delegate.reject_tool_call.assert_called_once_with(tool_call_id, "User denied permission")

    def test_process_tool_use_parts_approval_accepted(self):
        """Should NOT call delegate when approval is accepted."""
        # given
        message = ChatMessage(
            role="assistant",
            parts=[
                ToolUsePart(
                    type="tool-use",
                    tool_call_id="test_tool_789",
                    tool_name="change_bgm",
                    state=ToolCallState.APPROVAL_RESPONDED,
                    approval=ToolApproval(
                        id="approval_789",
                        approved=True,  # Approved
                    ),
                )
            ],
        )
        delegate = MagicMock()

        # when
        process_tool_use_parts(message, delegate)

        # then: Should not trigger delegate (tool execution happens on backend)
        delegate.reject_tool_call.assert_not_called()
        delegate.resolve_tool_result.assert_not_called()

    def test_process_tool_use_parts_output_available(self):
        """Should call resolve_tool_result when output is available."""
        # given
        tool_call_id = "test_tool_999"
        tool_output = {"success": True, "data": "BGM changed to track 1"}
        message = ChatMessage(
            role="assistant",
            parts=[
                ToolUsePart(
                    type="tool-use",
                    tool_call_id=tool_call_id,
                    tool_name="change_bgm",
                    state=ToolCallState.OUTPUT_AVAILABLE,
                    output=tool_output,
                )
            ],
        )
        delegate = MagicMock()

        # when
        process_tool_use_parts(message, delegate)

        # then
        delegate.resolve_tool_result.assert_called_once_with(tool_call_id, tool_output)
        delegate.reject_tool_call.assert_not_called()

    def test_process_tool_use_parts_output_available_none(self):
        """Should not call delegate when output is None."""
        # given
        message = ChatMessage(
            role="assistant",
            parts=[
                ToolUsePart(
                    type="tool-use",
                    tool_call_id="test_tool_null",
                    tool_name="calculate",
                    state=ToolCallState.OUTPUT_AVAILABLE,
                    output=None,  # No output
                )
            ],
        )
        delegate = MagicMock()

        # when
        process_tool_use_parts(message, delegate)

        # then
        delegate.resolve_tool_result.assert_not_called()
        delegate.reject_tool_call.assert_not_called()

    def test_process_tool_use_parts_multiple_tools(self):
        """Should process multiple tool-use parts in a single message."""
        # given
        message = ChatMessage(
            role="assistant",
            parts=[
                ToolUsePart(
                    type="tool-use",
                    tool_call_id="tool_1",
                    tool_name="get_location",
                    state=ToolCallState.APPROVAL_RESPONDED,
                    approval=ToolApproval(
                        id="approval_1", approved=False, reason="Privacy concern"
                    ),
                ),
                TextPart(type="text", text="Processing..."),
                ToolUsePart(
                    type="tool-use",
                    tool_call_id="tool_2",
                    tool_name="calculate",
                    state=ToolCallState.OUTPUT_AVAILABLE,
                    output={"result": 42},
                ),
                ToolUsePart(
                    type="tool-use",
                    tool_call_id="tool_3",
                    tool_name="change_bgm",
                    state=ToolCallState.APPROVAL_RESPONDED,
                    approval=ToolApproval(id="approval_3", approved=True),  # Approved, no action
                ),
            ],
        )
        delegate = MagicMock()

        # when
        process_tool_use_parts(message, delegate)

        # then
        # Should reject tool_1
        assert delegate.reject_tool_call.call_count == 1
        delegate.reject_tool_call.assert_any_call("tool_1", "Privacy concern")

        # Should resolve tool_2
        assert delegate.resolve_tool_result.call_count == 1
        delegate.resolve_tool_result.assert_any_call("tool_2", {"result": 42})

        # tool_3 (approved=True) should not trigger any action

    def test_process_tool_use_parts_other_states(self):
        """Should ignore tool-use parts with other states."""
        # given
        message = ChatMessage(
            role="assistant",
            parts=[
                ToolUsePart(
                    type="tool-use",
                    tool_call_id="input_tool",
                    tool_name="get_weather",
                    state=ToolCallState.INPUT_AVAILABLE,
                ),
                ToolUsePart(
                    type="tool-use",
                    tool_call_id="requested_tool",
                    tool_name="calculate",
                    state=ToolCallState.APPROVAL_REQUESTED,
                ),
                ToolUsePart(
                    type="tool-use",
                    tool_call_id="call_tool",
                    tool_name="get_current_time",
                    state=ToolCallState.CALL,
                ),
            ],
        )
        delegate = MagicMock()

        # when
        process_tool_use_parts(message, delegate)

        # then: Should not trigger delegate for these states
        delegate.reject_tool_call.assert_not_called()
        delegate.resolve_tool_result.assert_not_called()


class TestProcessChatMessageForBidi:
    """Tests for process_chat_message_for_bidi function."""

    def test_process_chat_message_for_bidi_text_only(self):
        """Should extract text content from text-only message."""
        # given
        message_data = {
            "messages": [{"role": "user", "parts": [{"type": "text", "text": "Hello, world!"}]}]
        }
        delegate = MagicMock()

        # when
        image_blobs, text_content, approval_processed = process_chat_message_for_bidi(
            message_data, delegate
        )

        # then
        assert len(image_blobs) == 0
        assert text_content.role == "user"
        assert len(text_content.parts) == 1
        assert text_content.parts[0].text == "Hello, world!"

        # Should not process tool-use parts since there are none
        delegate.reject_tool_call.assert_not_called()
        delegate.resolve_tool_result.assert_not_called()

    def test_process_chat_message_for_bidi_with_image(self):
        """Should separate image blobs from text parts."""
        # given
        image_data = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=="
        message_data = {
            "messages": [
                {
                    "role": "user",
                    "parts": [
                        {"type": "text", "text": "Look at this image:"},
                        {
                            "type": "file",
                            "filename": "image.png",
                            "url": image_data,
                            "mediaType": "image/png",
                        },
                        {"type": "text", "text": "What do you see?"},
                    ],
                }
            ]
        }
        delegate = MagicMock()

        # when
        with patch("ai_sdk_v6_compat.base64.b64decode") as mock_decode:
            mock_decode.return_value = b"fake_image_data"
            image_blobs, text_content, approval_processed = process_chat_message_for_bidi(
                message_data, delegate
            )

        # then
        # Should have one image blob
        assert len(image_blobs) == 1
        assert image_blobs[0].data == b"fake_image_data"
        assert image_blobs[0].mime_type == "image/png"

        # Should have text parts without the image
        assert text_content.role == "user"
        assert len(text_content.parts) == 2  # Two text parts
        assert text_content.parts[0].text == "Look at this image:"
        assert text_content.parts[1].text == "What do you see?"

    def test_process_chat_message_for_bidi_with_tool_approval(self):
        """Should process tool approval responses."""
        # given
        message_data = {
            "messages": [
                {
                    "role": "user",
                    "content": "Continue",
                },
                {
                    "role": "assistant",
                    "parts": [
                        {
                            "type": "tool-use",
                            "toolCallId": "bgm_123",
                            "toolName": "change_bgm",
                            "state": "approval-responded",
                            "approval": {
                                "id": "approval_bgm",
                                "approved": False,
                                "reason": "Too loud",
                            },
                        }
                    ],
                },
            ]
        }
        delegate = MagicMock()

        # when
        image_blobs, text_content, approval_processed = process_chat_message_for_bidi(
            message_data, delegate
        )

        # then
        # Should process tool rejection
        delegate.reject_tool_call.assert_called_once_with("bgm_123", "Too loud")

        # No text parts, so text_content should be None
        assert text_content is None

    def test_process_chat_message_for_bidi_with_file_part(self):
        """Should handle file parts (skip them for BIDI)."""
        # given
        message_data = {
            "messages": [
                {
                    "role": "user",
                    "parts": [
                        {"type": "text", "text": "Here's a file:"},
                        {
                            "type": "file",
                            "name": "document.pdf",
                            "url": "https://example.com/doc.pdf",
                            "size": 1024,
                            "mime_type": "application/pdf",
                        },
                        {"type": "text", "text": "Please review it."},
                    ],
                }
            ]
        }
        delegate = MagicMock()

        # when
        image_blobs, text_content, approval_processed = process_chat_message_for_bidi(
            message_data, delegate
        )

        # then
        # No image blobs (file parts are skipped)
        assert len(image_blobs) == 0

        # Text parts should be preserved
        assert len(text_content.parts) == 2
        assert text_content.parts[0].text == "Here's a file:"
        assert text_content.parts[1].text == "Please review it."

    def test_process_chat_message_for_bidi_invalid_image(self):
        """Should handle invalid image data gracefully."""
        # given
        message_data = {
            "messages": [
                {
                    "role": "user",
                    "parts": [
                        {
                            "type": "file",
                            "filename": "image.png",
                            "url": "invalid_data_url",
                            "mediaType": "image/png",
                        },
                        {"type": "text", "text": "This image is broken"},
                    ],
                }
            ]
        }
        delegate = MagicMock()

        # when
        image_blobs, text_content, approval_processed = process_chat_message_for_bidi(
            message_data, delegate
        )

        # then
        # Should skip invalid image
        assert len(image_blobs) == 0

        # Text should still be processed
        assert len(text_content.parts) == 1
        assert text_content.parts[0].text == "This image is broken"

    def test_process_chat_message_for_bidi_empty_messages(self):
        """Should handle empty messages list."""
        # given
        message_data = {"messages": []}
        delegate = MagicMock()

        # when
        image_blobs, text_content, approval_processed = process_chat_message_for_bidi(
            message_data, delegate
        )

        # then: Should return empty blobs and None content
        assert image_blobs == []
        assert text_content is None

    def test_process_chat_message_for_bidi_tool_output(self):
        """Should process tool output results."""
        # given
        tool_result = {"success": True, "location": {"lat": 35.6762, "lng": 139.6503}}
        message_data = {
            "messages": [
                {
                    "role": "assistant",
                    "parts": [
                        {
                            "type": "tool-use",
                            "tool_call_id": "location_456",
                            "tool_name": "get_location",
                            "state": "output-available",
                            "output": tool_result,
                        }
                    ],
                }
            ]
        }
        delegate = MagicMock()

        # when
        image_blobs, text_content, approval_processed = process_chat_message_for_bidi(
            message_data, delegate
        )

        # then
        # Should resolve tool result
        delegate.resolve_tool_result.assert_called_once_with("location_456", tool_result)

    def test_process_chat_message_for_bidi_mixed_content(self):
        """Should handle complex message with text, images, and tool parts."""
        # given
        message_data = {
            "messages": [
                {
                    "role": "assistant",
                    "parts": [
                        {"type": "text", "text": "Processing your request..."},
                        {
                            "type": "tool-use",
                            "toolCallId": "calc_1",
                            "toolName": "calculate",
                            "state": "output-available",
                            "output": {"result": 42},
                        },
                        {"type": "text", "text": "Here's the result:"},
                        {
                            "type": "file",
                            "filename": "photo.jpg",
                            "url": "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
                            "mediaType": "image/jpeg",
                        },
                        {
                            "type": "tool-use",
                            "toolCallId": "bgm_2",
                            "toolName": "change_bgm",
                            "state": "approval-responded",
                            "approval": {
                                "id": "approval_bgm_2",
                                "approved": False,
                                "reason": "Not now",
                            },
                        },
                    ],
                }
            ]
        }
        delegate = MagicMock()

        # when
        with patch("ai_sdk_v6_compat.base64.b64decode") as mock_decode:
            mock_decode.return_value = b"jpeg_data"
            image_blobs, text_content, approval_processed = process_chat_message_for_bidi(
                message_data, delegate
            )

        # then
        # Should process tool parts
        delegate.resolve_tool_result.assert_called_once_with("calc_1", {"result": 42})
        delegate.reject_tool_call.assert_called_once_with("bgm_2", "Not now")

        # Should have one image blob
        assert len(image_blobs) == 1
        assert image_blobs[0].mime_type == "image/jpeg"

        # Should have text parts
        assert len(text_content.parts) == 2
        assert text_content.parts[0].text == "Processing your request..."
        assert text_content.parts[1].text == "Here's the result:"


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

    def test_adk_request_confirmation_with_original_function_call_in_output(self):
        """Should convert adk_request_confirmation with originalFunctionCall in output.

        This is the STANDARD behavior - frontend includes originalFunctionCall in output
        via lib/adk_compat.ts createAdkConfirmationOutput function.
        """
        # given
        message = ChatMessage(
            role="assistant",
            parts=[
                ToolUsePart(
                    type="tool-adk_request_confirmation",
                    tool_call_id="adk-confirmation-123",
                    tool_name="adk_request_confirmation",
                    args=None,  # Frontend doesn't set args
                    state=ToolCallState.OUTPUT_AVAILABLE,
                    output={
                        "originalFunctionCall": {
                            "id": "adk-payment-456",
                            "name": "process_payment",
                            "args": {"amount": 50, "recipient": "Hanako", "currency": "USD"},
                        },
                        "toolConfirmation": {"confirmed": True},
                    },
                )
            ],
        )

        # when
        adk_content = message.to_adk_content()

        # then
        # Should have one FunctionResponse part for the original payment tool
        assert len(adk_content.parts) == 1
        function_response = adk_content.parts[0].function_response
        assert function_response is not None
        assert function_response.id == "adk-payment-456"  # Original tool call ID
        assert function_response.name == "adk_request_confirmation"
        assert function_response.response == {"confirmed": True}


    def test_adk_request_confirmation_with_args_none_and_no_original_in_output_should_skip(self):
        """Should gracefully handle adk_request_confirmation missing originalFunctionCall entirely.

        This is the error case - neither args nor output contain originalFunctionCall.
        The conversion should skip creating FunctionResponse to prevent errors.
        """
        # given
        message = ChatMessage(
            role="assistant",
            parts=[
                ToolUsePart(
                    type="tool-adk_request_confirmation",
                    tool_call_id="adk-confirmation-error",
                    tool_name="adk_request_confirmation",
                    args=None,  # No args
                    state=ToolCallState.OUTPUT_AVAILABLE,
                    output={"toolConfirmation": {"confirmed": True}},  # No originalFunctionCall
                )
            ],
        )

        # when
        adk_content = message.to_adk_content()

        # then
        # Should have 0 parts (skipped due to missing originalFunctionCall)
        assert len(adk_content.parts) == 0

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
                    args=None,  # Frontend doesn't set args
                    state=ToolCallState.OUTPUT_AVAILABLE,
                    output={
                        "originalFunctionCall": {
                            "id": "adk-location-999",
                            "name": "get_location",
                            "args": {},
                        },
                        "toolConfirmation": {"confirmed": False},
                    },
                )
            ],
        )

        # when
        adk_content = message.to_adk_content()

        # then
        assert len(adk_content.parts) == 1
        function_response = adk_content.parts[0].function_response
        assert function_response is not None
        assert function_response.id == "adk-location-999"
        assert function_response.response == {"confirmed": False}

    def test_adk_request_confirmation_missing_original_function_call_id(self):
        """Should skip when originalFunctionCall.id is missing."""
        # given
        message = ChatMessage(
            role="assistant",
            parts=[
                ToolUsePart(
                    type="tool-adk_request_confirmation",
                    tool_call_id="adk-confirmation-bad",
                    tool_name="adk_request_confirmation",
                    args={
                        "originalFunctionCall": {
                            # Missing 'id' field
                            "name": "process_payment",
                            "args": {"amount": 100},
                        }
                    },
                    state=ToolCallState.OUTPUT_AVAILABLE,
                    output={"toolConfirmation": {"confirmed": True}},
                )
            ],
        )

        # when
        adk_content = message.to_adk_content()

        # then
        # Should skip creating FunctionResponse when ID is missing
        assert len(adk_content.parts) == 0

    def test_adk_request_confirmation_with_process_payment_pending(self):
        """Should handle confirmation alongside pending tool (process_payment still waiting).

        This is the EXACT scenario causing infinite loop:
        - process_payment is INPUT_AVAILABLE (waiting for confirmation)
        - adk_request_confirmation is OUTPUT_AVAILABLE (user approved)
        - But args=None, so no FunctionResponse is created
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
                    args=None,  # BUG: Missing originalFunctionCall
                    state=ToolCallState.OUTPUT_AVAILABLE,
                    output={"toolConfirmation": {"confirmed": True}},
                ),
            ],
        )

        # when
        adk_content = message.to_adk_content()

        # then
        # Should have 0 parts:
        # - process_payment is skipped (INPUT_AVAILABLE state)
        # - adk_request_confirmation is skipped (args=None)
        # This results in "parts=0" log message and infinite loop
        assert len(adk_content.parts) == 0
