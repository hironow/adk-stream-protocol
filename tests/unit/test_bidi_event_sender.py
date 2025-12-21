"""
Unit tests for services/bidi_event_sender.py

Tests BIDI event sending logic for downstream communication (ADK → WebSocket).
This enables testing protocol conversion and WebSocket transmission in isolation.
"""

from unittest.mock import AsyncMock, Mock, patch

import pytest
from fastapi import WebSocketDisconnect

from adk_stream_protocol import BidiEventSender
from adk_stream_protocol.result import Error, Ok
from tests.utils.mocks import (
    create_mock_live_events,
    create_mock_live_request_queue,
    create_mock_session,
    create_mock_sse_stream,
    create_mock_websocket,
)


# ============================================================
# Initialization Tests
# ============================================================


def test_bidi_event_sender_initialization() -> None:
    """BidiEventSender should store dependencies correctly."""
    # given
    mock_websocket = Mock()
    mock_delegate = Mock()
    confirmation_tools = ["process_payment"]
    mock_session = create_mock_session()
    mock_live_request_queue = create_mock_live_request_queue()

    # when
    sender = BidiEventSender(
        websocket=mock_websocket,
        frontend_delegate=mock_delegate,
        confirmation_tools=confirmation_tools,
        session=mock_session,
        live_request_queue=mock_live_request_queue,
    )

    # then
    assert sender._ws is mock_websocket
    assert sender._delegate is mock_delegate
    assert sender._confirmation_tools == confirmation_tools
    assert sender._session is mock_session
    assert sender._live_request_queue is mock_live_request_queue


# ============================================================
# send_events() Tests - Normal Flow
# ============================================================


@pytest.mark.asyncio
async def test_send_events_wraps_events_with_confirmation_processing() -> None:
    """send_events() should wrap live_events with confirmation processing."""
    # given
    mock_websocket = create_mock_websocket()
    mock_delegate = Mock()
    confirmation_tools = ["process_payment", "delete_account"]
    mock_session = create_mock_session()
    mock_live_request_queue = create_mock_live_request_queue()

    sender = BidiEventSender(
        websocket=mock_websocket,
        frontend_delegate=mock_delegate,
        confirmation_tools=confirmation_tools,
        session=mock_session,
        live_request_queue=mock_live_request_queue,
    )

    # when
    with patch(
        "adk_stream_protocol.bidi_event_sender.stream_adk_to_ai_sdk",
        return_value=create_mock_sse_stream('data: {"type":"text-delta","text":"Hello"}\n\n'),
    ):
        await sender.send_events(create_mock_live_events(Mock()))

        # then - events are successfully wrapped and processed
        mock_websocket.send_text.assert_called_once()


@pytest.mark.asyncio
async def test_send_events_calls_stream_adk_to_ai_sdk_with_correct_params() -> None:
    """send_events() should call stream_adk_to_ai_sdk with correct parameters."""
    # given
    mock_websocket = create_mock_websocket()
    mock_delegate = Mock()
    confirmation_tools = ["process_payment"]
    mock_session = create_mock_session()
    mock_live_request_queue = create_mock_live_request_queue()

    sender = BidiEventSender(
        websocket=mock_websocket,
        frontend_delegate=mock_delegate,
        confirmation_tools=confirmation_tools,
        session=mock_session,
        live_request_queue=mock_live_request_queue,
    )

    async def mock_live_events():
        yield Mock()

    async def mock_stream():
        yield 'data: {"type":"text-delta","text":"Test"}\n\n'

    # when
    with patch(
        "adk_stream_protocol.bidi_event_sender.stream_adk_to_ai_sdk", return_value=mock_stream()
    ) as mock_stream_func:
        live_events = mock_live_events()
        await sender.send_events(live_events)

        # then
        # stream_adk_to_ai_sdk should be called with correct parameters
        # Confirmation is handled before this call by events_with_confirmation()
        mock_stream_func.assert_called_once()
        call_kwargs = mock_stream_func.call_args.kwargs
        assert call_kwargs["mode"] == "adk-bidi"
        # No more confirmation-related parameters (handled by BidiEventSender)


@pytest.mark.asyncio
async def test_send_events_sends_sse_events_to_websocket() -> None:
    """send_events() should send all SSE events to WebSocket."""
    # given
    mock_websocket = create_mock_websocket()
    mock_delegate = Mock()
    mock_session = create_mock_session()
    mock_live_request_queue = create_mock_live_request_queue()

    sender = BidiEventSender(
        websocket=mock_websocket,
        frontend_delegate=mock_delegate,
        confirmation_tools=[],
        session=mock_session,
        live_request_queue=mock_live_request_queue,
    )

    async def mock_live_events():
        yield Mock()
        yield Mock()

    async def mock_stream():
        yield 'data: {"type":"text-delta","text":"Hello"}\n\n'
        yield 'data: {"type":"text-delta","text":" World"}\n\n'

    # when
    with (
        patch("adk_stream_protocol.bidi_event_sender.ToolConfirmationInterceptor"),
        patch(
            "adk_stream_protocol.bidi_event_sender.stream_adk_to_ai_sdk", return_value=mock_stream()
        ),
    ):
        await sender.send_events(mock_live_events())

        # then
        assert mock_websocket.send_text.call_count == 2
        mock_websocket.send_text.assert_any_call('data: {"type":"text-delta","text":"Hello"}\n\n')
        mock_websocket.send_text.assert_any_call('data: {"type":"text-delta","text":" World"}\n\n')


# ============================================================
# send_events() Tests - Error Handling
# ============================================================


@pytest.mark.asyncio
async def test_send_events_handles_websocket_disconnect_gracefully() -> None:
    """send_events() should handle WebSocketDisconnect without raising."""
    # given
    mock_websocket = create_mock_websocket()
    mock_websocket.send_text = AsyncMock(side_effect=WebSocketDisconnect)
    mock_delegate = Mock()
    mock_session = create_mock_session()
    mock_live_request_queue = create_mock_live_request_queue()

    sender = BidiEventSender(
        websocket=mock_websocket,
        frontend_delegate=mock_delegate,
        confirmation_tools=[],
        session=mock_session,
        live_request_queue=mock_live_request_queue,
    )

    async def mock_live_events():
        yield Mock()

    async def mock_stream():
        yield 'data: {"type":"text-delta","text":"Test"}\n\n'

    # when/then - should not raise
    with (
        patch("adk_stream_protocol.bidi_event_sender.ToolConfirmationInterceptor"),
        patch(
            "adk_stream_protocol.bidi_event_sender.stream_adk_to_ai_sdk", return_value=mock_stream()
        ),
    ):
        await sender.send_events(mock_live_events())
        # No exception should be raised


@pytest.mark.asyncio
async def test_send_events_handles_session_resumption_error_silently() -> None:
    """send_events() should handle 'Transparent session resumption' ValueError silently."""
    # given
    mock_websocket = create_mock_websocket()
    mock_delegate = Mock()
    mock_session = create_mock_session()
    mock_live_request_queue = create_mock_live_request_queue()

    sender = BidiEventSender(
        websocket=mock_websocket,
        frontend_delegate=mock_delegate,
        confirmation_tools=[],
        session=mock_session,
        live_request_queue=mock_live_request_queue,
    )

    async def mock_live_events():
        yield Mock()

    async def mock_stream_generator():
        raise ValueError("Transparent session resumption error")
        yield  # Make it a generator (unreachable)

    # when
    with (
        patch("adk_stream_protocol.bidi_event_sender.ToolConfirmationInterceptor"),
        patch(
            "adk_stream_protocol.bidi_event_sender.stream_adk_to_ai_sdk",
            side_effect=lambda *args, **kwargs: mock_stream_generator(),
        ),
    ):
        with pytest.raises(ValueError, match="Transparent session resumption"):
            await sender.send_events(mock_live_events())


@pytest.mark.asyncio
async def test_send_events_raises_other_value_errors() -> None:
    """send_events() should raise ValueError if not session resumption error."""
    # given
    mock_websocket = create_mock_websocket()
    mock_delegate = Mock()
    mock_session = create_mock_session()
    mock_live_request_queue = create_mock_live_request_queue()

    sender = BidiEventSender(
        websocket=mock_websocket,
        frontend_delegate=mock_delegate,
        confirmation_tools=[],
        session=mock_session,
        live_request_queue=mock_live_request_queue,
    )

    async def mock_live_events():
        yield Mock()

    async def mock_stream_generator():
        raise ValueError("Some other error")
        yield  # Make it a generator (unreachable)

    # when/then
    with (
        patch("adk_stream_protocol.bidi_event_sender.ToolConfirmationInterceptor"),
        patch(
            "adk_stream_protocol.bidi_event_sender.stream_adk_to_ai_sdk",
            side_effect=lambda *args, **kwargs: mock_stream_generator(),
        ),
    ):
        with pytest.raises(ValueError, match="Some other error"):
            await sender.send_events(mock_live_events())


@pytest.mark.asyncio
async def test_send_events_raises_other_exceptions() -> None:
    """send_events() should raise other exceptions."""
    # given
    mock_websocket = create_mock_websocket()
    mock_delegate = Mock()
    mock_session = create_mock_session()
    mock_live_request_queue = create_mock_live_request_queue()

    sender = BidiEventSender(
        websocket=mock_websocket,
        frontend_delegate=mock_delegate,
        confirmation_tools=[],
        session=mock_session,
        live_request_queue=mock_live_request_queue,
    )

    async def mock_live_events():
        yield Mock()

    async def mock_stream_generator():
        raise RuntimeError("Unexpected error")
        yield  # Make it a generator (unreachable)

    # when/then
    with (
        patch("adk_stream_protocol.bidi_event_sender.ToolConfirmationInterceptor"),
        patch(
            "adk_stream_protocol.bidi_event_sender.stream_adk_to_ai_sdk",
            side_effect=lambda *args, **kwargs: mock_stream_generator(),
        ),
    ):
        with pytest.raises(RuntimeError, match="Unexpected error"):
            await sender.send_events(mock_live_events())


# ============================================================
# _send_sse_event() Tests - Event Processing
# ============================================================


@pytest.mark.asyncio
async def test_send_sse_event_registers_tool_input_available_id_mapping() -> None:
    """_send_sse_event() should register function_call.id for tool-input-available."""
    # given
    mock_websocket = create_mock_websocket()
    mock_delegate = Mock()
    mock_delegate.set_function_call_id = Mock(return_value=Ok(None))
    mock_session = create_mock_session()
    mock_live_request_queue = create_mock_live_request_queue()

    sender = BidiEventSender(
        websocket=mock_websocket,
        frontend_delegate=mock_delegate,
        confirmation_tools=[],
        session=mock_session,
        live_request_queue=mock_live_request_queue,
    )

    sse_event = (
        'data: {"type":"tool-input-available","toolName":"get_weather","toolCallId":"call-123"}\n\n'
    )

    # when
    await sender._send_sse_event(sse_event)

    # then
    mock_delegate.set_function_call_id.assert_called_once_with("get_weather", "call-123")
    mock_websocket.send_text.assert_called_once_with(sse_event)


@pytest.mark.asyncio
async def test_send_sse_event_handles_tool_approval_request() -> None:
    """_send_sse_event() should log tool-approval-request events."""
    # given
    mock_websocket = create_mock_websocket()
    mock_delegate = Mock()
    mock_session = create_mock_session()
    mock_live_request_queue = create_mock_live_request_queue()

    sender = BidiEventSender(
        websocket=mock_websocket,
        frontend_delegate=mock_delegate,
        confirmation_tools=["process_payment"],
        session=mock_session,
        live_request_queue=mock_live_request_queue,
    )

    sse_event = 'data: {"type":"tool-approval-request","toolName":"process_payment","toolCallId":"call-456"}\n\n'

    # when
    await sender._send_sse_event(sse_event)

    # then
    mock_websocket.send_text.assert_called_once_with(sse_event)


@pytest.mark.asyncio
async def test_send_sse_event_handles_non_data_events() -> None:
    """_send_sse_event() should handle events without 'data:' prefix."""
    # given
    mock_websocket = create_mock_websocket()
    mock_delegate = Mock()
    mock_session = create_mock_session()
    mock_live_request_queue = create_mock_live_request_queue()

    sender = BidiEventSender(
        websocket=mock_websocket,
        frontend_delegate=mock_delegate,
        confirmation_tools=[],
        session=mock_session,
        live_request_queue=mock_live_request_queue,
    )

    sse_event = "event: ping\n\n"

    # when
    await sender._send_sse_event(sse_event)

    # then
    mock_websocket.send_text.assert_called_once_with(sse_event)


@pytest.mark.asyncio
async def test_send_sse_event_handles_json_parse_errors_gracefully() -> None:
    """_send_sse_event() should handle JSON parse errors without raising."""
    # given
    mock_websocket = create_mock_websocket()
    mock_delegate = Mock()
    mock_session = create_mock_session()
    mock_live_request_queue = create_mock_live_request_queue()

    sender = BidiEventSender(
        websocket=mock_websocket,
        frontend_delegate=mock_delegate,
        confirmation_tools=[],
        session=mock_session,
        live_request_queue=mock_live_request_queue,
    )

    sse_event = "data: {invalid json}\n\n"

    # when - should not raise
    await sender._send_sse_event(sse_event)

    # then - should still send the event
    mock_websocket.send_text.assert_called_once_with(sse_event)


@pytest.mark.asyncio
async def test_send_sse_event_skips_id_mapping_when_tool_name_missing() -> None:
    """_send_sse_event() should skip ID mapping if toolName is missing."""
    # given
    mock_websocket = create_mock_websocket()
    mock_delegate = Mock()
    mock_delegate.set_function_call_id = Mock(return_value=Ok(None))
    mock_session = create_mock_session()
    mock_live_request_queue = create_mock_live_request_queue()

    sender = BidiEventSender(
        websocket=mock_websocket,
        frontend_delegate=mock_delegate,
        confirmation_tools=[],
        session=mock_session,
        live_request_queue=mock_live_request_queue,
    )

    sse_event = 'data: {"type":"tool-input-available","toolCallId":"call-123"}\n\n'

    # when
    await sender._send_sse_event(sse_event)

    # then
    mock_delegate.set_function_call_id.assert_not_called()
    mock_websocket.send_text.assert_called_once_with(sse_event)


@pytest.mark.asyncio
async def test_send_sse_event_skips_id_mapping_when_tool_call_id_missing() -> None:
    """_send_sse_event() should skip ID mapping if toolCallId is missing."""
    # given
    mock_websocket = create_mock_websocket()
    mock_delegate = Mock()
    mock_delegate.set_function_call_id = Mock(return_value=Ok(None))
    mock_session = create_mock_session()
    mock_live_request_queue = create_mock_live_request_queue()

    sender = BidiEventSender(
        websocket=mock_websocket,
        frontend_delegate=mock_delegate,
        confirmation_tools=[],
        session=mock_session,
        live_request_queue=mock_live_request_queue,
    )

    sse_event = 'data: {"type":"tool-input-available","toolName":"get_weather"}\n\n'

    # when
    await sender._send_sse_event(sse_event)

    # then
    mock_delegate.set_function_call_id.assert_not_called()
    mock_websocket.send_text.assert_called_once_with(sse_event)


# ============================================================
# Error Handling Tests - Additional Edge Cases
# ============================================================


@pytest.mark.asyncio
async def test_send_sse_event_with_websocket_send_error_raises() -> None:
    """_send_sse_event() should propagate websocket.send_text() errors (non-disconnect)."""
    # given
    mock_websocket = create_mock_websocket()
    mock_websocket.send_text = AsyncMock(side_effect=RuntimeError("WebSocket error"))
    mock_session = create_mock_session()
    mock_live_request_queue = create_mock_live_request_queue()

    sender = BidiEventSender(
        websocket=mock_websocket,
        frontend_delegate=Mock(),
        confirmation_tools=[],
        session=mock_session,
        live_request_queue=mock_live_request_queue,
    )

    sse_event = 'data: {"type":"text-delta","text":"test"}\n\n'

    # when/then
    with pytest.raises(RuntimeError, match="WebSocket error"):
        await sender._send_sse_event(sse_event)


@pytest.mark.asyncio
async def test_send_sse_event_with_set_function_call_id_error_handles_gracefully() -> None:
    """_send_sse_event() should handle set_function_call_id() errors gracefully (log and continue)."""
    # given
    mock_websocket = create_mock_websocket()
    mock_delegate = Mock()
    mock_delegate.set_function_call_id = Mock(return_value=Error("ID mapping error"))
    mock_session = create_mock_session()
    mock_live_request_queue = create_mock_live_request_queue()

    sender = BidiEventSender(
        websocket=mock_websocket,
        frontend_delegate=mock_delegate,
        confirmation_tools=[],
        session=mock_session,
        live_request_queue=mock_live_request_queue,
    )

    sse_event = (
        'data: {"type":"tool-input-available","toolName":"get_weather","toolCallId":"call-123"}\n\n'
    )

    # when - should not raise, just log debug message
    await sender._send_sse_event(sse_event)

    # then - should still send the event despite error
    mock_websocket.send_text.assert_called_once_with(sse_event)


@pytest.mark.asyncio
async def test_send_events_with_stream_error_after_first_event() -> None:
    """send_events() should propagate stream_adk_to_ai_sdk errors after partial success."""
    # given
    mock_websocket = Mock()
    mock_websocket.send_text = AsyncMock()
    mock_session = create_mock_session()
    mock_live_request_queue = create_mock_live_request_queue()

    sender = BidiEventSender(
        websocket=mock_websocket,
        frontend_delegate=Mock(),
        confirmation_tools=[],
        session=mock_session,
        live_request_queue=mock_live_request_queue,
    )

    async def mock_live_events():
        yield Mock()

    async def mock_stream_generator():
        yield 'data: {"type":"text-delta","text":"First"}\n\n'
        raise RuntimeError("Stream interrupted")
        yield  # Make it a generator (unreachable)

    # when/then
    with (
        patch("adk_stream_protocol.bidi_event_sender.ToolConfirmationInterceptor"),
        patch(
            "adk_stream_protocol.bidi_event_sender.stream_adk_to_ai_sdk",
            side_effect=lambda *args, **kwargs: mock_stream_generator(),
        ),
    ):
        with pytest.raises(RuntimeError, match="Stream interrupted"):
            await sender.send_events(mock_live_events())

        # Should have sent first event before error
        assert mock_websocket.send_text.call_count == 1


@pytest.mark.asyncio
async def test_send_sse_event_with_malformed_sse_format() -> None:
    """_send_sse_event() should handle malformed SSE format gracefully."""
    # given
    mock_websocket = Mock()
    mock_websocket.send_text = AsyncMock()
    mock_session = create_mock_session()
    mock_live_request_queue = create_mock_live_request_queue()

    sender = BidiEventSender(
        websocket=mock_websocket,
        frontend_delegate=Mock(),
        confirmation_tools=[],
        session=mock_session,
        live_request_queue=mock_live_request_queue,
    )

    # Malformed SSE: missing newlines
    sse_event = 'data: {"type":"text-delta","text":"test"}'

    # when - should not raise, just log debug message
    await sender._send_sse_event(sse_event)

    # then
    mock_websocket.send_text.assert_called_once_with(sse_event)


@pytest.mark.asyncio
async def test_send_sse_event_with_none_frontend_delegate_handles_gracefully() -> None:
    """_send_sse_event() should skip ID mapping when frontend_delegate is None."""
    # given
    mock_websocket = create_mock_websocket()
    mock_session = create_mock_session()
    mock_live_request_queue = create_mock_live_request_queue()

    sender = BidiEventSender(
        websocket=mock_websocket,
        frontend_delegate=None,  # type: ignore
        confirmation_tools=[],
        session=mock_session,
        live_request_queue=mock_live_request_queue,
    )

    sse_event = (
        'data: {"type":"tool-input-available","toolName":"get_weather","toolCallId":"call-123"}\n\n'
    )

    # when - should not raise
    await sender._send_sse_event(sse_event)

    # then
    mock_websocket.send_text.assert_called_once_with(sse_event)


@pytest.mark.asyncio
async def test_send_events_with_empty_live_events() -> None:
    """send_events() should handle empty live_events gracefully."""
    # given
    mock_websocket = create_mock_websocket()
    mock_session = create_mock_session()
    mock_live_request_queue = create_mock_live_request_queue()

    sender = BidiEventSender(
        websocket=mock_websocket,
        frontend_delegate=Mock(),
        confirmation_tools=[],
        session=mock_session,
        live_request_queue=mock_live_request_queue,
    )

    async def mock_live_events():
        # Empty generator
        return
        yield  # Make it a generator (unreachable)

    async def mock_stream():
        # Empty stream
        return
        yield  # Make it a generator (unreachable)

    # when
    with (
        patch("adk_stream_protocol.bidi_event_sender.ToolConfirmationInterceptor"),
        patch(
            "adk_stream_protocol.bidi_event_sender.stream_adk_to_ai_sdk",
            side_effect=lambda *args, **kwargs: mock_stream(),
        ),
    ):
        await sender.send_events(mock_live_events())

    # then - No events sent
    mock_websocket.send_text.assert_not_called()


@pytest.mark.asyncio
async def test_send_sse_event_with_very_large_payload() -> None:
    """_send_sse_event() should handle very large payloads."""
    # given
    mock_websocket = create_mock_websocket()
    mock_session = create_mock_session()
    mock_live_request_queue = create_mock_live_request_queue()

    sender = BidiEventSender(
        websocket=mock_websocket,
        frontend_delegate=Mock(),
        confirmation_tools=[],
        session=mock_session,
        live_request_queue=mock_live_request_queue,
    )

    # Create a large payload (100KB)
    large_text = "x" * 100000
    sse_event = f'data: {{"type":"text-delta","text":"{large_text}"}}\n\n'

    # when
    await sender._send_sse_event(sse_event)

    # then
    mock_websocket.send_text.assert_called_once_with(sse_event)


@pytest.mark.asyncio
async def test_send_sse_event_with_invalid_json_in_data() -> None:
    """_send_sse_event() should handle invalid JSON gracefully (already covered)."""
    # given
    mock_websocket = create_mock_websocket()
    mock_session = create_mock_session()
    mock_live_request_queue = create_mock_live_request_queue()

    sender = BidiEventSender(
        websocket=mock_websocket,
        frontend_delegate=Mock(),
        confirmation_tools=[],
        session=mock_session,
        live_request_queue=mock_live_request_queue,
    )

    # Invalid JSON
    sse_event = "data: {invalid: json}\n\n"

    # when - should not raise (logs debug message)
    await sender._send_sse_event(sse_event)

    # then
    mock_websocket.send_text.assert_called_once_with(sse_event)
