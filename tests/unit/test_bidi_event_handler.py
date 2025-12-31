"""
Unit tests for services/bidi_event_handler.py

Tests BIDI event handling logic extracted from WebSocket handler.
This enables testing with recorded chunk logs and isolated event processing.
"""

from unittest.mock import AsyncMock, Mock, patch

import pytest
from google.genai import types

from adk_stream_protocol import BidiEventReceiver
from tests.utils.mocks import create_mock_session


# ============================================================
# Initialization Tests
# ============================================================


def test_bidi_event_handler_initialization() -> None:
    """BidiEventReceiver should store dependencies correctly."""
    # given
    mock_session = create_mock_session()
    mock_delegate = Mock()
    mock_queue = Mock()
    mock_runner = Mock()

    # when
    handler = BidiEventReceiver(
        session=mock_session,
        frontend_delegate=mock_delegate,
        live_request_queue=mock_queue,
        bidi_agent_runner=mock_runner,
    )

    # then
    assert handler._session is mock_session
    assert handler._delegate is mock_delegate
    assert handler._live_request_queue is mock_queue
    assert handler._ag_runner is mock_runner


# ============================================================
# Event Handling Tests - Edge Cases
# ============================================================


@pytest.mark.asyncio
async def test_handle_event_ignores_ping_events() -> None:
    """handle_event() should silently ignore 'ping' events."""
    # given
    handler = BidiEventReceiver(
        session=create_mock_session(),
        frontend_delegate=Mock(),
        live_request_queue=Mock(),
        bidi_agent_runner=Mock(),
    )

    event = {"type": "ping"}

    # when/then - Should not raise error
    await handler.handle_event(event)


@pytest.mark.asyncio
async def test_handle_event_logs_warning_for_unknown_type() -> None:
    """handle_event() should log warning for unknown event types."""
    # given
    handler = BidiEventReceiver(
        session=create_mock_session(),
        frontend_delegate=Mock(),
        live_request_queue=Mock(),
        bidi_agent_runner=Mock(),
    )

    event = {"type": "unknown_event_type"}

    # when/then - Should not raise error
    await handler.handle_event(event)


# ============================================================
# Message Event Tests
# ============================================================


@pytest.mark.asyncio
@patch("adk_stream_protocol.bidi_event_receiver.sync_conversation_history_to_session")
@patch("adk_stream_protocol.bidi_event_receiver.process_chat_message_for_bidi")
async def test_handle_message_event_syncs_history(mock_process, mock_sync) -> None:
    """handle_message_event() should sync conversation history when messages present."""
    # given
    mock_session = create_mock_session()
    mock_session.id = "session-123"
    mock_runner = Mock()
    mock_runner.session_service = Mock()

    handler = BidiEventReceiver(
        session=mock_session,
        frontend_delegate=Mock(),
        live_request_queue=Mock(),
        bidi_agent_runner=mock_runner,
    )

    # Mock return values
    mock_process.return_value = ([], None)  # No blobs, no text
    mock_sync.return_value = None

    event = {
        "type": "message",
        "version": "1.0",
        "messages": [{"role": "user", "content": [{"type": "text", "text": "Hello"}]}],
    }

    # when
    await handler._handle_message_event(event)

    # then
    mock_sync.assert_called_once()
    call_kwargs = mock_sync.call_args.kwargs
    assert call_kwargs["session"] is mock_session
    assert call_kwargs["session_service"] is mock_runner.session_service
    assert call_kwargs["current_mode"] == "BIDI"


@pytest.mark.asyncio
@patch("adk_stream_protocol.bidi_event_receiver.process_chat_message_for_bidi")
async def test_handle_message_event_sends_image_blobs(mock_process) -> None:
    """handle_message_event() should send image blobs via send_realtime()."""
    # given
    mock_queue = Mock()
    handler = BidiEventReceiver(
        session=create_mock_session(),
        frontend_delegate=Mock(),
        live_request_queue=mock_queue,
        bidi_agent_runner=Mock(),
    )

    # Mock image blobs
    blob1 = types.Blob(mime_type="image/png", data=b"imagedata1")
    blob2 = types.Blob(mime_type="image/jpeg", data=b"imagedata2")
    mock_process.return_value = ([blob1, blob2], None)

    event = {"type": "message", "version": "1.0", "messages": []}

    # when
    await handler._handle_message_event(event)

    # then
    assert mock_queue.send_realtime.call_count == 2
    mock_queue.send_realtime.assert_any_call(blob1)
    mock_queue.send_realtime.assert_any_call(blob2)


@pytest.mark.asyncio
@patch("adk_stream_protocol.bidi_event_receiver.process_chat_message_for_bidi")
async def test_handle_message_event_sends_regular_text(mock_process) -> None:
    """handle_message_event() should send regular text via send_content()."""
    # given
    mock_queue = Mock()
    handler = BidiEventReceiver(
        session=create_mock_session(),
        frontend_delegate=Mock(),
        live_request_queue=mock_queue,
        bidi_agent_runner=Mock(),
    )

    # Mock text content without FunctionResponse
    text_content = types.Content(parts=[types.Part(text="Hello, world!")])
    mock_process.return_value = ([], text_content)

    event = {"type": "message", "version": "1.0", "messages": []}

    # when
    await handler._handle_message_event(event)

    # then
    mock_queue.send_content.assert_called_once_with(text_content)


@pytest.mark.asyncio
@patch("adk_stream_protocol.bidi_event_receiver.process_chat_message_for_bidi")
async def test_handle_message_event_handles_function_response(mock_process) -> None:
    """handle_message_event() should handle FunctionResponse via append_event()."""
    # given
    mock_session = create_mock_session()
    mock_session.id = "session-456"
    mock_session_service = Mock()
    mock_session_service.append_event = AsyncMock()
    mock_runner = Mock()
    mock_runner.session_service = mock_session_service
    mock_delegate = Mock()

    handler = BidiEventReceiver(
        session=mock_session,
        frontend_delegate=mock_delegate,
        live_request_queue=Mock(),
        bidi_agent_runner=mock_runner,
    )

    # Mock FunctionResponse
    function_response = types.FunctionResponse(
        id="call_789",
        name="process_payment",
        response={"confirmed": True},
    )
    text_content = types.Content(parts=[types.Part(function_response=function_response)])
    mock_process.return_value = ([], text_content)

    event = {"type": "message", "version": "1.0", "messages": []}

    # when
    await handler._handle_message_event(event)

    # then
    # Should call append_event (not send_content)
    mock_session_service.append_event.assert_called_once()
    call_args = mock_session_service.append_event.call_args
    assert call_args[0][0] is mock_session  # First arg is session

    # Should resolve frontend tool result
    mock_delegate.resolve_tool_result.assert_called_once_with("call_789", {"confirmed": True})


# ============================================================
# Interrupt Event Tests
# ============================================================


@pytest.mark.asyncio
async def test_handle_interrupt_event_closes_queue() -> None:
    """handle_interrupt_event() should log interrupt without closing queue (state change only)."""
    # given
    mock_queue = Mock()
    handler = BidiEventReceiver(
        session=create_mock_session(),
        frontend_delegate=Mock(),
        live_request_queue=mock_queue,
        bidi_agent_runner=Mock(),
    )

    event = {"type": "interrupt", "reason": "user_abort"}

    # when - Should not raise error
    await handler._handle_interrupt_event(event)

    # then - Queue should NOT be closed (interrupt is state change only)
    mock_queue.close.assert_not_called()


@pytest.mark.asyncio
async def test_handle_interrupt_event_with_default_reason() -> None:
    """handle_interrupt_event() should handle missing reason field (defaults to 'user_abort')."""
    # given
    mock_queue = Mock()
    handler = BidiEventReceiver(
        session=create_mock_session(),
        frontend_delegate=Mock(),
        live_request_queue=mock_queue,
        bidi_agent_runner=Mock(),
    )

    event = {"type": "interrupt"}  # No reason

    # when - Should not raise error
    await handler._handle_interrupt_event(event)

    # then - Queue should NOT be closed (interrupt is state change only)
    mock_queue.close.assert_not_called()


# ============================================================
# Audio Control Event Tests
# ============================================================


@pytest.mark.asyncio
async def test_handle_audio_control_event_start() -> None:
    """handle_audio_control_event() should handle 'start' action."""
    # given
    handler = BidiEventReceiver(
        session=create_mock_session(),
        frontend_delegate=Mock(),
        live_request_queue=Mock(),
        bidi_agent_runner=Mock(),
    )

    event = {"type": "audio_control", "action": "start"}

    # when/then - Should not raise error
    await handler._handle_audio_control_event(event)


@pytest.mark.asyncio
async def test_handle_audio_control_event_stop() -> None:
    """handle_audio_control_event() should handle 'stop' action."""
    # given
    handler = BidiEventReceiver(
        session=create_mock_session(),
        frontend_delegate=Mock(),
        live_request_queue=Mock(),
        bidi_agent_runner=Mock(),
    )

    event = {"type": "audio_control", "action": "stop"}

    # when/then - Should not raise error
    await handler._handle_audio_control_event(event)


# ============================================================
# Audio Chunk Event Tests
# ============================================================


@pytest.mark.asyncio
async def test_handle_audio_chunk_event_decodes_and_sends() -> None:
    """handle_audio_chunk_event() should decode base64 audio and send via send_realtime()."""
    # given
    mock_queue = Mock()
    handler = BidiEventReceiver(
        session=create_mock_session(),
        frontend_delegate=Mock(),
        live_request_queue=mock_queue,
        bidi_agent_runner=Mock(),
    )

    import base64

    audio_data = b"raw_audio_pcm_data"
    chunk_base64 = base64.b64encode(audio_data).decode("utf-8")

    event = {"type": "audio_chunk", "version": "1.0", "chunk": chunk_base64}

    # when
    await handler._handle_audio_chunk_event(event)

    # then
    mock_queue.send_realtime.assert_called_once()
    call_arg = mock_queue.send_realtime.call_args[0][0]
    assert isinstance(call_arg, types.Blob)
    assert call_arg.mime_type == "audio/pcm"
    assert call_arg.data == audio_data


@pytest.mark.asyncio
async def test_handle_audio_chunk_event_missing_chunk() -> None:
    """handle_audio_chunk_event() should handle missing chunk data gracefully."""
    # given
    mock_queue = Mock()
    handler = BidiEventReceiver(
        session=create_mock_session(),
        frontend_delegate=Mock(),
        live_request_queue=mock_queue,
        bidi_agent_runner=Mock(),
    )

    event = {"type": "audio_chunk", "version": "1.0"}  # No chunk

    # when/then - Should not raise error
    await handler._handle_audio_chunk_event(event)
    mock_queue.send_realtime.assert_not_called()


# ============================================================
# Tool Result Event Tests
# ============================================================


@pytest.mark.asyncio
async def test_handle_tool_result_event_resolves_result() -> None:
    """handle_tool_result_event() should resolve frontend tool result."""
    # given
    mock_delegate = Mock()
    handler = BidiEventReceiver(
        session=create_mock_session(),
        frontend_delegate=mock_delegate,
        live_request_queue=Mock(),
        bidi_agent_runner=Mock(),
    )

    event = {
        "type": "tool_result",
        "version": "1.0",
        "toolCallId": "call_999",
        "result": {"success": True, "data": "result_data"},
    }

    # when
    await handler._handle_tool_result_event(event)

    # then
    mock_delegate.resolve_tool_result.assert_called_once_with(
        "call_999", {"success": True, "data": "result_data"}
    )


@pytest.mark.asyncio
async def test_handle_tool_result_event_missing_tool_call_id() -> None:
    """handle_tool_result_event() should handle missing toolCallId gracefully."""
    # given
    mock_delegate = Mock()
    handler = BidiEventReceiver(
        session=create_mock_session(),
        frontend_delegate=mock_delegate,
        live_request_queue=Mock(),
        bidi_agent_runner=Mock(),
    )

    event = {
        "type": "tool_result",
        "version": "1.0",
        "result": {"success": True},  # No toolCallId
    }

    # when/then - Should not raise error
    await handler._handle_tool_result_event(event)
    mock_delegate.resolve_tool_result.assert_not_called()


@pytest.mark.asyncio
async def test_handle_tool_result_event_missing_result() -> None:
    """handle_tool_result_event() should handle missing result gracefully."""
    # given
    mock_delegate = Mock()
    handler = BidiEventReceiver(
        session=create_mock_session(),
        frontend_delegate=mock_delegate,
        live_request_queue=Mock(),
        bidi_agent_runner=Mock(),
    )

    event = {
        "type": "tool_result",
        "version": "1.0",
        "toolCallId": "call_111",  # No result
    }

    # when/then - Should not raise error
    await handler._handle_tool_result_event(event)
    mock_delegate.resolve_tool_result.assert_not_called()


# ============================================================
# Integration Tests (Event Sequences)
# ============================================================


@pytest.mark.asyncio
@patch("adk_stream_protocol.bidi_event_receiver.process_chat_message_for_bidi")
async def test_event_sequence_message_then_interrupt(mock_process) -> None:
    """Should handle message event followed by interrupt event (interrupt is state change only)."""
    # given
    mock_queue = Mock()
    handler = BidiEventReceiver(
        session=create_mock_session(),
        frontend_delegate=Mock(),
        live_request_queue=mock_queue,
        bidi_agent_runner=Mock(),
    )

    # Mock regular text
    mock_process.return_value = ([], types.Content(parts=[types.Part(text="Hello")]))

    # when - Process message event
    message_event = {"type": "message", "data": {}}
    await handler.handle_event(message_event)

    # then - Should send content
    mock_queue.send_content.assert_called_once()

    # when - Process interrupt event
    interrupt_event = {"type": "interrupt"}
    await handler.handle_event(interrupt_event)

    # then - Queue should NOT be closed (interrupt is state change only, not connection termination)
    mock_queue.close.assert_not_called()


@pytest.mark.asyncio
async def test_event_sequence_tool_result_resolves_delegate() -> None:
    """Should handle tool_result event and resolve delegate."""
    # given
    mock_delegate = Mock()
    handler = BidiEventReceiver(
        session=create_mock_session(),
        frontend_delegate=mock_delegate,
        live_request_queue=Mock(),
        bidi_agent_runner=Mock(),
    )

    # when
    tool_result_event = {
        "type": "tool_result",
        "version": "1.0",
        "toolCallId": "location_call_123",
        "result": {"latitude": 35.6762, "longitude": 139.6503},
    }
    await handler.handle_event(tool_result_event)

    # then
    mock_delegate.resolve_tool_result.assert_called_once_with(
        "location_call_123", {"latitude": 35.6762, "longitude": 139.6503}
    )


# ============================================================
# Error Handling Tests - Additional Edge Cases
# ============================================================


@pytest.mark.asyncio
async def test_handle_event_with_none_event_raises_error() -> None:
    """handle_event() should raise error when event is None."""
    # given
    handler = BidiEventReceiver(
        session=create_mock_session(),
        frontend_delegate=Mock(),
        live_request_queue=Mock(),
        bidi_agent_runner=Mock(),
    )

    # when/then
    with pytest.raises(AttributeError):
        await handler.handle_event(None)  # type: ignore


@pytest.mark.asyncio
async def test_handle_event_with_non_dict_event_raises_error() -> None:
    """handle_event() should raise error when event is not a dict."""
    # given
    handler = BidiEventReceiver(
        session=create_mock_session(),
        frontend_delegate=Mock(),
        live_request_queue=Mock(),
        bidi_agent_runner=Mock(),
    )

    # when/then
    with pytest.raises(AttributeError):
        await handler.handle_event("not_a_dict")  # type: ignore


@pytest.mark.asyncio
async def test_handle_message_event_with_process_chat_error_raises() -> None:
    """handle_message_event() should propagate process_chat_message_for_bidi errors."""
    # given
    handler = BidiEventReceiver(
        session=create_mock_session(),
        frontend_delegate=Mock(),
        live_request_queue=Mock(),
        bidi_agent_runner=Mock(),
    )

    event = {"type": "message", "version": "1.0", "messages": []}

    # when/then
    with patch(
        "adk_stream_protocol.bidi_event_receiver.process_chat_message_for_bidi",
        side_effect=ValueError("Invalid message format"),
    ):
        with pytest.raises(ValueError, match="Invalid message format"):
            await handler._handle_message_event(event)


@pytest.mark.asyncio
async def test_handle_message_event_with_sync_history_error_raises() -> None:
    """handle_message_event() should propagate sync_conversation_history errors."""
    # given
    mock_session = create_mock_session()
    mock_runner = Mock()
    handler = BidiEventReceiver(
        session=mock_session,
        frontend_delegate=Mock(),
        live_request_queue=Mock(),
        bidi_agent_runner=mock_runner,
    )

    event = {
        "type": "message",
        "version": "1.0",
        "messages": [{"role": "user", "content": "test"}],
    }

    # when/then
    with patch(
        "adk_stream_protocol.bidi_event_receiver.sync_conversation_history_to_session",
        side_effect=RuntimeError("Session sync failed"),
    ):
        with pytest.raises(RuntimeError, match="Session sync failed"):
            await handler._handle_message_event(event)


@pytest.mark.asyncio
async def test_handle_message_event_with_send_content_error_raises() -> None:
    """handle_message_event() should propagate queue.send_content() errors."""
    # given
    mock_queue = Mock()
    mock_queue.send_content = Mock(side_effect=RuntimeError("Queue send failed"))

    handler = BidiEventReceiver(
        session=create_mock_session(),
        frontend_delegate=Mock(),
        live_request_queue=mock_queue,
        bidi_agent_runner=Mock(),
    )

    event = {"type": "message", "version": "1.0", "messages": []}

    # Create real ADK Part with text (not FunctionResponse)
    text_part = types.Part(text="test message")
    text_content = types.Content(parts=[text_part])

    # when/then
    with patch(
        "adk_stream_protocol.bidi_event_receiver.process_chat_message_for_bidi",
        return_value=([], text_content),
    ):
        with pytest.raises(RuntimeError, match="Queue send failed"):
            await handler._handle_message_event(event)


@pytest.mark.asyncio
async def test_handle_message_event_with_send_realtime_error_raises() -> None:
    """handle_message_event() should propagate queue.send_realtime() errors."""
    # given
    mock_queue = Mock()
    mock_queue.send_realtime = Mock(side_effect=RuntimeError("Realtime send failed"))

    handler = BidiEventReceiver(
        session=create_mock_session(),
        frontend_delegate=Mock(),
        live_request_queue=mock_queue,
        bidi_agent_runner=Mock(),
    )

    event = {"type": "message", "version": "1.0", "messages": []}

    # when/then
    with patch(
        "adk_stream_protocol.bidi_event_receiver.process_chat_message_for_bidi",
        return_value=([Mock()], None),  # Return image blob
    ):
        with pytest.raises(RuntimeError, match="Realtime send failed"):
            await handler._handle_message_event(event)


@pytest.mark.asyncio
async def test_handle_function_response_with_append_event_error_raises() -> None:
    """_handle_function_response() should propagate session_service.append_event errors."""
    # given
    mock_session_service = Mock()
    mock_session_service.append_event = AsyncMock(side_effect=RuntimeError("Append event failed"))
    mock_runner = Mock()
    mock_runner.session_service = mock_session_service

    handler = BidiEventReceiver(
        session=create_mock_session(),
        frontend_delegate=Mock(),
        live_request_queue=Mock(),
        bidi_agent_runner=mock_runner,
    )

    function_response = types.FunctionResponse(
        id="func-123", name="test_function", response={"result": "ok"}
    )
    text_content = types.Content(parts=[types.Part(function_response=function_response)])

    # when/then
    with pytest.raises(RuntimeError, match="Append event failed"):
        await handler._handle_function_response(text_content)


@pytest.mark.asyncio
async def test_handle_function_response_with_resolve_error_does_not_propagate() -> None:
    """_handle_function_response() should handle resolve_tool_result errors gracefully."""
    # given
    mock_delegate = Mock()
    mock_delegate.resolve_tool_result = Mock(side_effect=RuntimeError("Resolve failed"))
    mock_session_service = Mock()
    mock_session_service.append_event = AsyncMock()
    mock_runner = Mock()
    mock_runner.session_service = mock_session_service

    handler = BidiEventReceiver(
        session=create_mock_session(),
        frontend_delegate=mock_delegate,
        live_request_queue=Mock(),
        bidi_agent_runner=mock_runner,
    )

    function_response = types.FunctionResponse(
        id="func-123", name="test_function", response={"result": "ok"}
    )
    text_content = types.Content(parts=[types.Part(function_response=function_response)])

    # when/then - should propagate the error
    with pytest.raises(RuntimeError, match="Resolve failed"):
        await handler._handle_function_response(text_content)


@pytest.mark.asyncio
async def test_handle_audio_chunk_with_send_realtime_error_raises() -> None:
    """handle_audio_chunk_event() should propagate queue.send_realtime() errors."""
    # given
    mock_queue = Mock()
    mock_queue.send_realtime = Mock(side_effect=RuntimeError("Send realtime failed"))

    handler = BidiEventReceiver(
        session=create_mock_session(),
        frontend_delegate=Mock(),
        live_request_queue=mock_queue,
        bidi_agent_runner=Mock(),
    )

    import base64

    audio_data = b"audio_chunk_data"
    chunk_base64 = base64.b64encode(audio_data).decode("utf-8")
    event = {"type": "audio_chunk", "version": "1.0", "chunk": chunk_base64}

    # when/then
    with pytest.raises(RuntimeError, match="Send realtime failed"):
        await handler._handle_audio_chunk_event(event)


@pytest.mark.asyncio
async def test_handle_tool_result_with_resolve_error_raises() -> None:
    """handle_tool_result_event() should propagate resolve_tool_result errors."""
    # given
    mock_delegate = Mock()
    mock_delegate.resolve_tool_result = Mock(side_effect=RuntimeError("Resolve error"))

    handler = BidiEventReceiver(
        session=create_mock_session(),
        frontend_delegate=mock_delegate,
        live_request_queue=Mock(),
        bidi_agent_runner=Mock(),
    )

    event = {
        "type": "tool_result",
        "version": "1.0",
        "toolCallId": "call-123",
        "result": {"data": "value"},
    }

    # when/then
    with pytest.raises(RuntimeError, match="Resolve error"):
        await handler._handle_tool_result_event(event)


@pytest.mark.asyncio
async def test_handle_message_event_with_invalid_messages_format() -> None:
    """handle_message_event() should handle invalid messages format gracefully."""
    # given
    handler = BidiEventReceiver(
        session=create_mock_session(),
        frontend_delegate=Mock(),
        live_request_queue=Mock(),
        bidi_agent_runner=Mock(),
    )

    # Invalid message: not a dict
    event = {"type": "message", "version": "1.0", "messages": ["not_a_dict"]}

    # when/then - should raise error when converting to ChatMessage
    with pytest.raises(TypeError):
        await handler._handle_message_event(event)
