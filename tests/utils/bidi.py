"""BIDI (Bidirectional WebSocket) test utilities.

This module provides helper functions and factory methods for testing
BIDI mode event handling and WebSocket communication.
"""

import asyncio
from typing import Any
from unittest.mock import AsyncMock, Mock

from adk_stream_protocol import BidiEventReceiver, FrontendToolDelegate
from adk_stream_protocol.protocol.id_mapper import ADKVercelIDMapper


def create_mock_bidi_components() -> tuple[Mock, Mock, Mock, Mock]:
    """Create mock components for BidiEventReceiver testing.

    Returns:
        Tuple of (session, queue, runner, session_service) mocks

    Examples:
        >>> session, queue, runner, session_service = create_mock_bidi_components()
        >>> session.id = "test-session-123"
    """
    mock_session = Mock()
    mock_session.id = "mock-session-id"
    mock_session.state = {}

    mock_queue = Mock()
    mock_queue.send_realtime = Mock()
    mock_queue.send_content = Mock()
    mock_queue.close = Mock()

    mock_session_service = Mock()
    mock_session_service.append_event = AsyncMock()

    mock_runner = Mock()
    mock_runner.session_service = mock_session_service

    return mock_session, mock_queue, mock_runner, mock_session_service


def create_bidi_event_handler(
    session: Mock | None = None,
    frontend_delegate: FrontendToolDelegate | Mock | None = None,
    live_request_queue: Mock | None = None,
    bidi_agent_runner: Mock | None = None,
) -> BidiEventReceiver:
    """Create BidiEventReceiver with optional custom components.

    Args:
        session: Optional session mock (creates default if None)
        frontend_delegate: Optional delegate (creates mock if None)
        live_request_queue: Optional queue mock (creates default if None)
        bidi_agent_runner: Optional runner mock (creates default if None)

    Returns:
        Configured BidiEventReceiver instance

    Examples:
        >>> handler = create_bidi_event_handler()
        >>> # With custom session
        >>> session = Mock()
        >>> session.id = "custom-id"
        >>> handler = create_bidi_event_handler(session=session)
    """
    if session is None or live_request_queue is None or bidi_agent_runner is None:
        mock_session, mock_queue, mock_runner, _ = create_mock_bidi_components()
        session = session or mock_session
        live_request_queue = live_request_queue or mock_queue
        bidi_agent_runner = bidi_agent_runner or mock_runner

    if frontend_delegate is None:
        frontend_delegate = Mock(spec=FrontendToolDelegate)

    return BidiEventReceiver(
        session=session,
        frontend_delegate=frontend_delegate,
        live_request_queue=live_request_queue,
        bidi_agent_runner=bidi_agent_runner,
    )


def create_frontend_delegate_with_mapper(
    tool_mappings: dict[str, str] | None = None,
) -> tuple[FrontendToolDelegate, ADKVercelIDMapper]:
    """Create real FrontendToolDelegate with IDMapper for integration tests.

    Args:
        tool_mappings: Optional dict of tool_name -> function_call_id mappings
                      Example: {"process_payment": "call-123"}

    Returns:
        Tuple of (FrontendToolDelegate, ADKVercelIDMapper) instances

    Examples:
        >>> delegate, mapper = create_frontend_delegate_with_mapper({
        ...     "process_payment": "payment-call-001",
        ...     "get_location": "location-call-002"
        ... })
    """
    id_mapper = ADKVercelIDMapper()

    # Register tool mappings if provided
    if tool_mappings:
        for tool_name, function_call_id in tool_mappings.items():
            id_mapper.register(tool_name, function_call_id)

    frontend_delegate = FrontendToolDelegate(id_mapper=id_mapper)

    return frontend_delegate, id_mapper


def simulate_pending_tool_call(
    frontend_delegate: FrontendToolDelegate,
    tool_call_id: str,
) -> asyncio.Future[dict[str, Any]]:
    """Simulate a pending frontend tool call by creating Future in delegate.

    Args:
        frontend_delegate: FrontendToolDelegate instance
        tool_call_id: Tool call ID to register

    Returns:
        The created Future object that can be awaited or resolved

    Examples:
        >>> delegate, _ = create_frontend_delegate_with_mapper()
        >>> future = simulate_pending_tool_call(delegate, "call-123")
        >>> # Later in test
        >>> delegate.resolve_tool_result("call-123", {"result": "data"})
        >>> assert future.done()
    """
    pending_future: asyncio.Future[dict[str, Any]] = asyncio.Future()
    frontend_delegate._pending_calls[tool_call_id] = pending_future
    return pending_future
