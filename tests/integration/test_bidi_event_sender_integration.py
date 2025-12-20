"""
Integration tests for BidiEventSender with progressively fewer mocks.

Strategy: Start with all mocks, then progressively replace with real components
to isolate integration issues.

Test Levels:
1. Level 2: Real FrontendToolDelegate for ID mapping
2. Level 3: Real WebSocket communication
3. Level 4: Complete event flow with protocol conversion
"""

from unittest.mock import AsyncMock, Mock, patch

import pytest
from fastapi import WebSocketDisconnect
from google.adk.agents import LiveRequestQueue
from google.adk.sessions import Session

from adk_vercel_id_mapper import ADKVercelIDMapper
from services.bidi_event_sender import BidiEventSender
from services.frontend_tool_service import FrontendToolDelegate


# ============================================================
# Level 2: Real FrontendToolDelegate
# ============================================================


@pytest.mark.asyncio
async def test_level2_real_frontend_delegate_id_mapping() -> None:
    """
    Level 2: Use real FrontendToolDelegate for ID mapping integration.

    Tests that tool-input-available events properly register function_call.id.
    """
    # given
    mock_websocket = Mock()
    mock_websocket.send_text = AsyncMock()
    mock_session = Mock(spec=Session)
    mock_live_request_queue = Mock(spec=LiveRequestQueue)

    # Real FrontendToolDelegate with real ADKVercelIDMapper
    id_mapper = ADKVercelIDMapper()
    frontend_delegate = FrontendToolDelegate(id_mapper=id_mapper)

    sender = BidiEventSender(
        websocket=mock_websocket,
        frontend_delegate=frontend_delegate,
        confirmation_tools=[],
        session=mock_session,
        live_request_queue=mock_live_request_queue,
    )

    # SSE event with tool-input-available
    sse_event = 'data: {"type":"tool-input-available","toolName":"get_weather","toolCallId":"weather-123"}\n\n'

    # when
    await sender._send_sse_event(sse_event)

    # then
    # Should register the mapping in the real FrontendToolDelegate
    assert id_mapper.resolve_tool_result("weather-123") == "get_weather"
    mock_websocket.send_text.assert_called_once_with(sse_event)


@pytest.mark.asyncio
async def test_level2_real_frontend_delegate_multiple_tools() -> None:
    """
    Level 2: Test ID mapping for multiple tools through real FrontendToolDelegate.
    """
    # given
    mock_websocket = Mock()
    mock_websocket.send_text = AsyncMock()
    mock_session = Mock(spec=Session)
    mock_live_request_queue = Mock(spec=LiveRequestQueue)

    # Real components
    id_mapper = ADKVercelIDMapper()
    frontend_delegate = FrontendToolDelegate(id_mapper=id_mapper)

    sender = BidiEventSender(
        websocket=mock_websocket,
        frontend_delegate=frontend_delegate,
        confirmation_tools=[],
        session=mock_session,
        live_request_queue=mock_live_request_queue,
    )

    # when - send multiple tool-input-available events
    await sender._send_sse_event(
        'data: {"type":"tool-input-available","toolName":"get_weather","toolCallId":"call-1"}\n\n'
    )
    await sender._send_sse_event(
        'data: {"type":"tool-input-available","toolName":"get_location","toolCallId":"call-2"}\n\n'
    )
    await sender._send_sse_event(
        'data: {"type":"tool-input-available","toolName":"process_payment","toolCallId":"call-3"}\n\n'
    )

    # then
    assert id_mapper.resolve_tool_result("call-1") == "get_weather"
    assert id_mapper.resolve_tool_result("call-2") == "get_location"
    assert id_mapper.resolve_tool_result("call-3") == "process_payment"
    assert mock_websocket.send_text.call_count == 3


# ============================================================
# Level 3: WebSocket Communication
# ============================================================


@pytest.mark.asyncio
async def test_level3_websocket_disconnect_during_send() -> None:
    """
    Level 3: Test WebSocket disconnect handling during event sending.
    """
    # given
    mock_websocket = Mock()
    # First call succeeds, second raises disconnect
    mock_websocket.send_text = AsyncMock(side_effect=[None, WebSocketDisconnect(), None])
    mock_session = Mock(spec=Session)
    mock_live_request_queue = Mock(spec=LiveRequestQueue)

    frontend_delegate = FrontendToolDelegate()

    sender = BidiEventSender(
        websocket=mock_websocket,
        frontend_delegate=frontend_delegate,
        confirmation_tools=[],
        session=mock_session,
        live_request_queue=mock_live_request_queue,
    )

    async def mock_live_events():
        yield Mock()
        yield Mock()
        yield Mock()

    async def mock_stream():
        yield 'data: {"type":"text-delta","text":"Hello"}\n\n'
        yield 'data: {"type":"text-delta","text":" World"}\n\n'
        yield 'data: {"type":"text-delta","text":"!"}\n\n'

    # when - WebSocketDisconnect should be caught gracefully
    with (
        patch("services.bidi_event_sender.ToolConfirmationInterceptor"),
        patch(
            "services.bidi_event_sender.stream_adk_to_ai_sdk",
            side_effect=lambda *args, **kwargs: mock_stream(),
        ),
    ):
        await sender.send_events(mock_live_events())

    # then - should have tried to send first event, then caught disconnect
    assert mock_websocket.send_text.call_count == 2


# ============================================================
# Level 4: Event Flow Integration
# ============================================================


@pytest.mark.asyncio
async def test_level4_complete_event_stream_with_confirmation_tools() -> None:
    """
    Level 4: Test complete event stream with confirmation tools setup.

    Uses real FrontendToolDelegate and tests the full flow.
    """
    # given
    mock_websocket = Mock()
    mock_websocket.send_text = AsyncMock()
    mock_session = Mock(spec=Session)
    mock_live_request_queue = Mock(spec=LiveRequestQueue)

    # Real components
    id_mapper = ADKVercelIDMapper()
    frontend_delegate = FrontendToolDelegate(id_mapper=id_mapper)
    confirmation_tools = ["process_payment", "delete_account"]

    sender = BidiEventSender(
        websocket=mock_websocket,
        frontend_delegate=frontend_delegate,
        confirmation_tools=confirmation_tools,
        session=mock_session,
        live_request_queue=mock_live_request_queue,
    )

    async def mock_live_events():
        yield Mock()
        yield Mock()

    async def mock_stream():
        # Simulate events including tool-input-available
        yield 'data: {"type":"text-delta","text":"Processing payment"}\n\n'
        yield 'data: {"type":"tool-input-available","toolName":"process_payment","toolCallId":"payment-456"}\n\n'
        yield 'data: {"type":"tool-approval-request","toolName":"process_payment","toolCallId":"payment-456"}\n\n'

    # when
    with patch(
        "services.bidi_event_sender.stream_adk_to_ai_sdk",
        side_effect=lambda *args, **kwargs: mock_stream(),
    ):
        await sender.send_events(mock_live_events())

        # then
        # All events should be sent
        assert mock_websocket.send_text.call_count == 3

        # ID mapping should be registered
        assert id_mapper.resolve_tool_result("payment-456") == "process_payment"

        # Confirmation tools should be set on sender
        assert sender.confirmation_tools == confirmation_tools


@pytest.mark.asyncio
async def test_level4_mixed_event_types() -> None:
    """
    Level 4: Test mixed event types (text, tool, error) in single stream.
    """
    # given
    mock_websocket = Mock()
    mock_websocket.send_text = AsyncMock()
    mock_session = Mock(spec=Session)
    mock_live_request_queue = Mock(spec=LiveRequestQueue)

    frontend_delegate = FrontendToolDelegate()

    sender = BidiEventSender(
        websocket=mock_websocket,
        frontend_delegate=frontend_delegate,
        confirmation_tools=[],
        session=mock_session,
        live_request_queue=mock_live_request_queue,
    )

    async def mock_live_events():
        yield Mock()

    async def mock_stream():
        yield 'data: {"type":"text-delta","text":"Hello"}\n\n'
        yield 'data: {"type":"tool-input-available","toolName":"get_weather","toolCallId":"w-1"}\n\n'
        yield 'data: {"type":"tool-result","toolCallId":"w-1","result":{"temp":20}}\n\n'
        yield 'data: {"type":"text-delta","text":"The temperature is 20 degrees"}\n\n'
        yield 'data: {"type":"finish","finishReason":"stop"}\n\n'

    # when
    with (
        patch("services.bidi_event_sender.ToolConfirmationInterceptor"),
        patch(
            "services.bidi_event_sender.stream_adk_to_ai_sdk",
            side_effect=lambda *args, **kwargs: mock_stream(),
        ),
    ):
        await sender.send_events(mock_live_events())

    # then
    assert mock_websocket.send_text.call_count == 5
    # Verify event order
    calls = [call[0][0] for call in mock_websocket.send_text.call_args_list]
    assert "text-delta" in calls[0]
    assert "tool-input-available" in calls[1]
    assert "tool-result" in calls[2]
    assert "text-delta" in calls[3]
    assert "finish" in calls[4]


# ============================================================
# Error Cases with Real Components
# ============================================================


@pytest.mark.asyncio
async def test_level2_skips_id_mapping_with_none_frontend_delegate() -> None:
    """
    Level 2: Test that ID mapping is skipped when frontend_delegate is None.
    """
    # given
    mock_websocket = Mock()
    mock_websocket.send_text = AsyncMock()
    mock_session = Mock(spec=Session)
    mock_live_request_queue = Mock(spec=LiveRequestQueue)

    sender = BidiEventSender(
        websocket=mock_websocket,
        frontend_delegate=None,  # type: ignore
        confirmation_tools=[],
        session=mock_session,
        live_request_queue=mock_live_request_queue,
    )

    sse_event = (
        'data: {"type":"tool-input-available","toolName":"get_weather","toolCallId":"w-123"}\n\n'
    )

    # when - should not raise
    await sender._send_sse_event(sse_event)

    # then
    mock_websocket.send_text.assert_called_once_with(sse_event)
