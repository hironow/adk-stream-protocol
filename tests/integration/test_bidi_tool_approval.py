"""
Integration tests for BIDI mode tool approval flow.

Tests that BIDI mode (WebSocket /live endpoint) correctly processes tool outputs
from incoming messages via process_chat_message_for_bidi() -> process_tool_use_parts().

Related: experiments/2025-12-16_frontend_delegate_fix.md

Test Strategy:
- Focus on testing process_chat_message_for_bidi function
- Keep process_tool_use_parts and FrontendToolDelegate real (no mocking)
- Verify tool output processing happens correctly
"""

from __future__ import annotations

from ai_sdk_v6_compat import process_chat_message_for_bidi
from tool_delegate import FrontendToolDelegate


def test_bidi_processes_tool_outputs_from_message_data() -> None:
    """
    Should process tool outputs from message data.

    BIDI mode uses process_chat_message_for_bidi which calls process_tool_use_parts
    to handle tool output responses from the frontend.
    """
    from unittest.mock import patch

    # given: Message data with tool output (AI SDK v6 format via WebSocket)
    message_data = {
        "messages": [
            {
                "role": "assistant",
                "parts": [
                    {
                        "type": "tool-change_bgm",
                        "toolCallId": "bidi-test-id",
                        "state": "output-available",
                        "output": {
                            "success": True,
                            "current_track": 1,
                            "message": "BGM changed",
                        },
                    }
                ],
            }
        ]
    }

    # when: Process message with connection-specific delegate
    delegate = FrontendToolDelegate()
    with patch.object(delegate, "resolve_tool_result") as mock_resolve:
        image_blobs, text_content, approval_processed = process_chat_message_for_bidi(
            message_data, delegate
        )

        # then: Should process tool output
        assert mock_resolve.called, "resolve_tool_result should be called for output-available"
        assert image_blobs == [], "No images in this message"
        assert text_content is None, "No text content in this message"
        # Note: approval_processed is False for output-available (only True for approval-responded)


def test_bidi_resolves_delegate_future() -> None:
    """
    Should call delegate.resolve_tool_result() when processing tool outputs.

    Verifies the Future resolution path works in BIDI mode.
    """
    from unittest.mock import patch

    # given: Message data with tool output
    message_data = {
        "messages": [
            {
                "role": "assistant",
                "parts": [
                    {
                        "type": "tool-calculate",
                        "toolCallId": "calc-bidi-id",
                        "state": "output-available",
                        "output": {"result": 42},
                    }
                ],
            }
        ]
    }

    # when: Process message and spy on delegate
    delegate = FrontendToolDelegate()
    with patch.object(delegate, "resolve_tool_result") as mock_resolve:
        image_blobs, text_content, approval_processed = process_chat_message_for_bidi(
            message_data, delegate
        )

        # then: Should call resolve_tool_result
        assert mock_resolve.called, "resolve_tool_result should be called"
        mock_resolve.assert_called_once_with("calc-bidi-id", {"result": 42})
        # Note: approval_processed is False for output-available state


def test_bidi_handles_tool_name_derivation() -> None:
    """
    Should correctly validate tool parts without explicit toolName field.

    BIDI mode also benefits from the Pydantic fix for tool_name derivation.
    """
    # given: Tool output without toolName field
    message_data = {
        "messages": [
            {
                "role": "assistant",
                "parts": [
                    {
                        "type": "tool-get_location",  # No toolName
                        "toolCallId": "location-bidi-id",
                        "state": "output-available",
                        "output": {"lat": 35.6762, "lng": 139.6503},
                    }
                ],
            }
        ]
    }

    # when: Process message (should not raise validation error)
    from unittest.mock import patch

    delegate = FrontendToolDelegate()
    with patch.object(delegate, "resolve_tool_result") as mock_resolve:
        try:
            image_blobs, text_content, approval_processed = process_chat_message_for_bidi(
                message_data, delegate
            )
            validation_success = True
        except Exception:
            validation_success = False

        # then: Should validate successfully
        assert validation_success, "Should validate tool part without toolName field"
        assert mock_resolve.called, "Tool output should be processed"


def test_bidi_processes_multiple_tool_outputs() -> None:
    """
    Should process multiple tool outputs in a single message.

    Verifies that all tool parts are processed, not just the first one.
    """
    from unittest.mock import patch

    # given: Message with multiple tool outputs
    message_data = {
        "messages": [
            {
                "role": "assistant",
                "parts": [
                    {
                        "type": "tool-calculate",
                        "toolCallId": "calc-1-bidi",
                        "state": "output-available",
                        "output": {"result": 42},
                    },
                    {"type": "text", "text": "Processed calculation..."},
                    {
                        "type": "tool-get_weather",
                        "toolCallId": "weather-1-bidi",
                        "state": "output-available",
                        "output": {"temp": 20, "condition": "sunny"},
                    },
                ],
            }
        ]
    }

    # when: Process message
    delegate = FrontendToolDelegate()
    with patch.object(delegate, "resolve_tool_result") as mock_resolve:
        image_blobs, text_content, approval_processed = process_chat_message_for_bidi(
            message_data, delegate
        )

        # then: Should process both tool outputs
        assert mock_resolve.call_count == 2, "Should resolve both tool results"

        # Verify both tools were resolved
        calls = [call[0] for call in mock_resolve.call_args_list]
        tool_ids = {call[0] for call in calls}
        assert "calc-1-bidi" in tool_ids
        assert "weather-1-bidi" in tool_ids


def test_bidi_separates_images_and_text() -> None:
    """
    Should correctly separate images and text for ADK Live API.

    BIDI mode requires sending images via send_realtime() and text via send_content().
    """
    # given: Message with both text and image
    message_data = {
        "messages": [
            {
                "role": "user",
                "parts": [
                    {"type": "text", "text": "Hello"},
                    {
                        "type": "file",
                        "filename": "test.png",
                        "url": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
                        "mediaType": "image/png",
                    },
                ],
            }
        ]
    }

    # when: Process message
    delegate = FrontendToolDelegate()
    image_blobs, text_content, approval_processed = process_chat_message_for_bidi(
        message_data, delegate
    )

    # then: Should separate images and text
    assert len(image_blobs) == 1, "Should have one image blob"
    assert image_blobs[0].mime_type == "image/png"
    assert text_content is not None, "Should have text content"
    assert text_content.parts is not None, "Should have parts"
    assert len(text_content.parts) == 1
    assert text_content.parts[0].text == "Hello"
    assert approval_processed is False, "No tool approval in this message"
