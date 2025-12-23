"""
Integration tests for BidiEventReceiver with progressively fewer mocks.

Strategy: Start with all mocks, then progressively replace with real components
to isolate integration issues.

Test Levels:
1. Level 1: All mocked (same as unit test, baseline)
2. Level 2: FrontendToolDelegate real, others mocked
3. Level 3: FrontendToolDelegate + ADKVercelIDMapper real
4. Level 4: Session components real (close to E2E)
"""

import asyncio
import base64
import binascii
from typing import Any
from unittest.mock import AsyncMock, Mock, patch

import pytest
from google.genai import types

from adk_stream_protocol import ADKVercelIDMapper, BidiEventReceiver, FrontendToolDelegate
from tests.utils.bidi import (
    create_bidi_event_handler,
    create_frontend_delegate_with_mapper,
    create_mock_bidi_components,
    simulate_pending_tool_call,
)


# ============================================================
# Level 2: Real FrontendToolDelegate
# ============================================================


@pytest.mark.asyncio
async def test_level2_message_event_with_real_frontend_delegate() -> None:
    """
    Level 2: Use real FrontendToolDelegate, mock Session and LiveRequestQueue.

    Tests FrontendToolDelegate integration with BidiEventReceiver.
    """
    # given
    mock_session = Mock()
    mock_session.id = "session-123"
    mock_session_service = Mock()
    mock_session_service.append_event = AsyncMock()
    mock_runner = Mock()
    mock_runner.session_service = mock_session_service
    mock_queue = Mock()

    # Real FrontendToolDelegate with real ADKVercelIDMapper
    id_mapper = ADKVercelIDMapper()
    id_mapper.register("process_payment", "function-call-456")
    frontend_delegate = FrontendToolDelegate(id_mapper=id_mapper)

    handler = BidiEventReceiver(
        session=mock_session,
        frontend_delegate=frontend_delegate,
        live_request_queue=mock_queue,
        bidi_agent_runner=mock_runner,
    )

    # Mock process_chat_message_for_bidi to return FunctionResponse
    function_response = types.FunctionResponse(
        id="function-call-456",
        name="process_payment",
        response={"confirmed": True, "amount": 100},
    )
    text_content = types.Content(parts=[types.Part(function_response=function_response)])

    with patch(
        "adk_stream_protocol.bidi_event_receiver.process_chat_message_for_bidi",
        return_value=([], text_content),
    ):
        event = {"type": "message", "version": "1.0", "messages": []}

        # when
        await handler._handle_message_event(event)

        # then
        # Should call append_event
        mock_session_service.append_event.assert_called_once()

        # Verify the Event was created correctly
        call_args = mock_session_service.append_event.call_args[0]
        event_arg = call_args[1]  # Second argument is the Event
        assert event_arg.author == "user"
        assert event_arg.content == text_content


@pytest.mark.asyncio
async def test_level2_tool_result_event_with_real_frontend_delegate() -> None:
    """
    Level 2: Use real FrontendToolDelegate for tool_result event handling.

    Tests that tool results properly resolve through real FrontendToolDelegate.
    """
    # given - Use utils for common setup

    mock_session, mock_queue, mock_runner, _ = create_mock_bidi_components()
    frontend_delegate, _ = create_frontend_delegate_with_mapper({"get_location": "call-789"})

    handler = create_bidi_event_handler(
        session=mock_session,
        frontend_delegate=frontend_delegate,
        live_request_queue=mock_queue,
        bidi_agent_runner=mock_runner,
    )

    # Simulate pending request using utils
    pending_future = simulate_pending_tool_call(frontend_delegate, "call-789")

    event = {
        "type": "tool_result",
        "version": "1.0",
        "toolCallId": "call-789",
        "result": {"latitude": 35.6762, "longitude": 139.6503},
    }

    # when
    await handler._handle_tool_result_event(event)

    # then
    # Should resolve the pending future
    assert pending_future.done()
    assert pending_future.result() == {"latitude": 35.6762, "longitude": 139.6503}


@pytest.mark.asyncio
async def test_level2_confirmation_flow_with_real_delegate() -> None:
    """
    Level 2: Test full confirmation flow with real FrontendToolDelegate.

    Simulates user approval through FrontendToolDelegate.
    """
    # given
    mock_session = Mock()
    mock_session.id = "session-confirm"
    mock_session_service = Mock()
    mock_session_service.append_event = AsyncMock()
    mock_runner = Mock()
    mock_runner.session_service = mock_session_service
    mock_queue = Mock()

    # Real FrontendToolDelegate
    id_mapper = ADKVercelIDMapper()
    id_mapper.register("process_payment", "payment-call-001")
    frontend_delegate = FrontendToolDelegate(id_mapper=id_mapper)

    handler = BidiEventReceiver(
        session=mock_session,
        frontend_delegate=frontend_delegate,
        live_request_queue=mock_queue,
        bidi_agent_runner=mock_runner,
    )

    # Mock FunctionResponse for confirmation
    function_response = types.FunctionResponse(
        id="payment-call-001",
        name="process_payment",
        response={"confirmed": True},
    )
    text_content = types.Content(parts=[types.Part(function_response=function_response)])

    # Simulate pending confirmation request
    pending_future: asyncio.Future[dict[str, Any]] = asyncio.Future()
    frontend_delegate._pending_calls["payment-call-001"] = pending_future

    with patch(
        "adk_stream_protocol.bidi_event_receiver.process_chat_message_for_bidi",
        return_value=([], text_content),
    ):
        event = {"type": "message", "version": "1.0", "messages": []}

        # when
        await handler._handle_message_event(event)

        # then
        # Should resolve pending request
        assert pending_future.done()
        assert pending_future.result() == {"confirmed": True}

        # Should call append_event
        mock_session_service.append_event.assert_called_once()


# ============================================================
# Level 3: Real Session Components
# ============================================================


@pytest.mark.asyncio
async def test_level3_interrupt_event_with_real_queue() -> None:
    """
    Level 3: Use real LiveRequestQueue behavior (close operation).

    Tests interrupt handling with actual queue closing.
    """
    # given
    mock_session = Mock()
    mock_runner = Mock()

    # Real FrontendToolDelegate
    frontend_delegate = FrontendToolDelegate()

    # Mock LiveRequestQueue with close method
    mock_queue = Mock()
    mock_queue.close = Mock()

    handler = BidiEventReceiver(
        session=mock_session,
        frontend_delegate=frontend_delegate,
        live_request_queue=mock_queue,
        bidi_agent_runner=mock_runner,
    )

    event = {"type": "interrupt", "reason": "user_abort"}

    # when
    await handler._handle_interrupt_event(event)

    # then
    mock_queue.close.assert_called_once()


@pytest.mark.asyncio
async def test_level3_audio_chunk_with_real_blob_creation() -> None:
    """
    Level 3: Use real Blob creation from ADK.

    Tests audio chunk handling with actual ADK Blob instantiation.
    """
    # given
    mock_session = Mock()
    mock_runner = Mock()
    frontend_delegate = FrontendToolDelegate()

    mock_queue = Mock()
    mock_queue.send_realtime = Mock()

    handler = BidiEventReceiver(
        session=mock_session,
        frontend_delegate=frontend_delegate,
        live_request_queue=mock_queue,
        bidi_agent_runner=mock_runner,
    )

    audio_data = b"raw_pcm_audio_16bit_16khz_mono"
    chunk_base64 = base64.b64encode(audio_data).decode("utf-8")

    event = {"type": "audio_chunk", "version": "1.0", "chunk": chunk_base64}

    # when
    await handler._handle_audio_chunk_event(event)

    # then
    mock_queue.send_realtime.assert_called_once()
    call_arg = mock_queue.send_realtime.call_args[0][0]

    # Verify it's a real ADK Blob
    assert isinstance(call_arg, types.Blob)
    assert call_arg.mime_type == "audio/pcm"
    assert call_arg.data == audio_data


# ============================================================
# Level 4: Near E2E Integration
# ============================================================


@pytest.mark.asyncio
async def test_level4_complete_message_flow() -> None:
    """
    Level 4: Test complete message flow with minimal mocking.

    Only mocks: Session, LiveRequestQueue, Runner
    Real: FrontendToolDelegate, ADKVercelIDMapper, Message processing
    """
    # given
    mock_session = Mock()
    mock_session.id = "session-complete"
    mock_session_service = Mock()
    mock_session_service.append_event = AsyncMock()
    mock_runner = Mock()
    mock_runner.session_service = mock_session_service
    mock_queue = Mock()
    mock_queue.send_content = Mock()
    mock_queue.send_realtime = Mock()

    # Real components
    id_mapper = ADKVercelIDMapper()
    id_mapper.register("get_weather", "weather-call-999")
    frontend_delegate = FrontendToolDelegate(id_mapper=id_mapper)

    handler = BidiEventReceiver(
        session=mock_session,
        frontend_delegate=frontend_delegate,
        live_request_queue=mock_queue,
        bidi_agent_runner=mock_runner,
    )

    # Simulate text message (not FunctionResponse)
    text_content = types.Content(parts=[types.Part(text="What's the weather like in Tokyo?")])

    with patch(
        "adk_stream_protocol.bidi_event_receiver.process_chat_message_for_bidi",
        return_value=([], text_content),
    ):
        event = {"type": "message", "version": "1.0", "messages": []}

        # when
        await handler._handle_message_event(event)

        # then
        # Should send content to queue (not append_event, since it's not FunctionResponse)
        mock_queue.send_content.assert_called_once_with(text_content)


@pytest.mark.asyncio
async def test_level4_sequential_events() -> None:
    """
    Level 4: Test sequential event handling with real components.

    Simulates realistic event sequence: message → tool_result → message
    """
    # given
    mock_session = Mock()
    mock_session.id = "session-seq"
    mock_session_service = Mock()
    mock_session_service.append_event = AsyncMock()
    mock_runner = Mock()
    mock_runner.session_service = mock_session_service
    mock_queue = Mock()
    mock_queue.send_content = Mock()

    # Real components
    id_mapper = ADKVercelIDMapper()
    id_mapper.register("get_location", "loc-call-123")
    frontend_delegate = FrontendToolDelegate(id_mapper=id_mapper)

    handler = BidiEventReceiver(
        session=mock_session,
        frontend_delegate=frontend_delegate,
        live_request_queue=mock_queue,
        bidi_agent_runner=mock_runner,
    )

    # Step 1: Initial message
    text_content_1 = types.Content(parts=[types.Part(text="Where am I?")])
    with patch(
        "adk_stream_protocol.bidi_event_receiver.process_chat_message_for_bidi",
        return_value=([], text_content_1),
    ):
        event_1 = {"type": "message", "data": {"messages": []}}
        await handler._handle_message_event(event_1)

    # Step 2: Tool result comes back
    pending_future: asyncio.Future[dict[str, Any]] = asyncio.Future()
    frontend_delegate._pending_calls["loc-call-123"] = pending_future

    event_2 = {
        "type": "tool_result",
        "version": "1.0",
        "toolCallId": "loc-call-123",
        "result": {"city": "Tokyo", "country": "Japan"},
    }
    await handler._handle_tool_result_event(event_2)

    # Step 3: FunctionResponse message
    function_response = types.FunctionResponse(
        id="loc-call-123",
        name="get_location",
        response={"city": "Tokyo", "country": "Japan"},
    )
    text_content_3 = types.Content(parts=[types.Part(function_response=function_response)])
    with patch(
        "adk_stream_protocol.bidi_event_receiver.process_chat_message_for_bidi",
        return_value=([], text_content_3),
    ):
        event_3 = {"type": "message", "data": {"messages": []}}
        await handler._handle_message_event(event_3)

    # then
    # Verify sequence
    assert mock_queue.send_content.call_count == 1  # Only first message
    assert mock_session_service.append_event.call_count == 1  # FunctionResponse
    assert pending_future.done()


# ============================================================
# Error Cases with Real Components
# ============================================================


@pytest.mark.asyncio
async def test_level2_missing_tool_result_with_real_delegate() -> None:
    """
    Level 2: Test error handling with real FrontendToolDelegate.

    When tool_result arrives for non-existent request.
    """
    # given
    mock_session = Mock()
    mock_queue = Mock()
    mock_runner = Mock()

    # Real FrontendToolDelegate (no pending requests)
    frontend_delegate = FrontendToolDelegate()

    handler = BidiEventReceiver(
        session=mock_session,
        frontend_delegate=frontend_delegate,
        live_request_queue=mock_queue,
        bidi_agent_runner=mock_runner,
    )

    event = {
        "type": "tool_result",
        "version": "1.0",
        "toolCallId": "non-existent-call",
        "result": {"data": "value"},
    }

    # when
    await handler._handle_tool_result_event(event)

    # then
    # Should handle gracefully (no exception)
    # Real FrontendToolDelegate logs warning but doesn't raise
    assert "non-existent-call" not in frontend_delegate._pending_calls


@pytest.mark.asyncio
async def test_level3_malformed_audio_chunk() -> None:
    """
    Level 3: Test malformed audio chunk handling with real Blob creation.
    """
    # given
    mock_session = Mock()
    mock_runner = Mock()
    frontend_delegate = FrontendToolDelegate()
    mock_queue = Mock()

    handler = BidiEventReceiver(
        session=mock_session,
        frontend_delegate=frontend_delegate,
        live_request_queue=mock_queue,
        bidi_agent_runner=mock_runner,
    )

    # Malformed base64
    event = {"type": "audio_chunk", "version": "1.0", "chunk": "!!!invalid_base64!!!"}

    # when/then
    with pytest.raises(binascii.Error):  # base64 decode error
        await handler._handle_audio_chunk_event(event)
