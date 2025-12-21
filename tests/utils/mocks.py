"""Common mock factories for Python tests.

This module provides reusable mock objects and factory functions to reduce
duplication across unit and integration tests.
"""

import json
from typing import Any
from unittest.mock import AsyncMock, Mock

from fastapi import WebSocket
from google.adk.sessions import Session


# ============================================================
# WebSocket Mocks
# ============================================================


def create_mock_websocket(
    receive_data: dict[str, Any] | str | None = None,
    send_side_effect: Any = None,
) -> Mock:
    """Create a mock WebSocket with common configuration.

    Args:
        receive_data: Data to return from receive_text(). Can be dict or JSON string.
                     If dict, it will be JSON-encoded automatically.
        send_side_effect: Optional side effect for send_text (e.g., exception)

    Returns:
        Mock WebSocket with AsyncMock methods configured

    Examples:
        >>> # Basic WebSocket mock
        >>> ws = create_mock_websocket()
        >>> await ws.send_text('{"type": "pong"}')

        >>> # With receive data
        >>> ws = create_mock_websocket(receive_data={"type": "ping"})
        >>> data = await ws.receive_text()

        >>> # With send error
        >>> from fastapi import WebSocketDisconnect
        >>> ws = create_mock_websocket(send_side_effect=WebSocketDisconnect())
    """
    mock_ws = Mock(spec=WebSocket)

    # Configure send_text
    if send_side_effect:
        mock_ws.send_text = AsyncMock(side_effect=send_side_effect)
    else:
        mock_ws.send_text = AsyncMock()

    # Configure receive_text
    if receive_data is not None:
        if isinstance(receive_data, dict):
            receive_data = json.dumps(receive_data)
        mock_ws.receive_text = AsyncMock(return_value=receive_data)
    else:
        mock_ws.receive_text = AsyncMock()

    return mock_ws


# ============================================================
# Session Mocks
# ============================================================


def create_mock_session(
    session_id: str = "test-session-123",
    initial_state: dict[str, Any] | None = None,
) -> Mock:
    """Create a mock Session object.

    Args:
        session_id: Session ID to use
        initial_state: Initial state dict (default: empty dict)

    Returns:
        Mock Session with id and state configured

    Examples:
        >>> session = create_mock_session()
        >>> assert session.id == "test-session-123"

        >>> session = create_mock_session(
        ...     session_id="custom-id",
        ...     initial_state={"frontend_delegate": delegate}
        ... )
    """
    mock_session = Mock(spec=Session)
    mock_session.id = session_id
    mock_session.state = initial_state or {}
    return mock_session


def create_mock_session_service() -> Mock:
    """Create a mock SessionService with AsyncMock append_event.

    Returns:
        Mock SessionService

    Examples:
        >>> service = create_mock_session_service()
        >>> await service.append_event(session, event)
        >>> service.append_event.assert_called_once()
    """
    mock_service = Mock()
    mock_service.append_event = AsyncMock()
    return mock_service


# ============================================================
# ToolContext Mocks
# ============================================================


def create_mock_tool_context(
    invocation_id: str = "call-123",
    session: Mock | None = None,
    session_state: dict[str, Any] | None = None,
    session_id: str = "session-123",
) -> Mock:
    """Create a mock ToolContext for tool function testing.

    Args:
        invocation_id: Tool invocation ID (function_call_id)
        session: Optional Session mock (creates default if None)
        session_state: Session state dict (default: empty dict)
        session_id: Session ID (ignored if session is provided)

    Returns:
        Mock ToolContext with invocation_id and session configured

    Examples:
        >>> # Basic usage
        >>> ctx = create_mock_tool_context()
        >>> assert ctx.invocation_id == "call-123"

        >>> # With custom session
        >>> session = create_mock_session()
        >>> ctx = create_mock_tool_context(invocation_id="call-001", session=session)

        >>> # With frontend delegate in state
        >>> ctx = create_mock_tool_context(
        ...     invocation_id="payment-call-001",
        ...     session_state={"frontend_delegate": delegate}
        ... )
        >>> await process_payment(amount=100, tool_context=ctx)
    """
    from google.adk.tools import ToolContext  # Import here to avoid circular deps

    mock_context = Mock(spec=ToolContext)
    mock_context.invocation_id = invocation_id

    if session is not None:
        mock_context.session = session
    else:
        mock_context.session = Mock()
        mock_context.session.id = session_id
        mock_context.session.state = session_state or {}

    return mock_context


# ============================================================
# Async Generator Mocks
# ============================================================


async def create_mock_live_events(*events: Any):
    """Create a mock async generator for live_events.

    Args:
        *events: Events to yield

    Yields:
        Each provided event

    Examples:
        >>> async def test():
        ...     mock_event = Mock()
        ...     async for event in create_mock_live_events(mock_event):
        ...         assert event is mock_event
    """
    for event in events:
        yield event


async def create_mock_sse_stream(*chunks: str):
    """Create a mock async generator for SSE stream.

    Args:
        *chunks: SSE-formatted strings to yield

    Yields:
        Each provided SSE chunk

    Examples:
        >>> async def test():
        ...     async for chunk in create_mock_sse_stream(
        ...         'data: {"type":"text-delta","text":"Hi"}\\n\\n'
        ...     ):
        ...         assert "text-delta" in chunk
    """
    for chunk in chunks:
        yield chunk


# ============================================================
# LiveRequestQueue Mocks
# ============================================================


def create_mock_live_request_queue() -> Mock:
    """Create a mock LiveRequestQueue.

    Returns:
        Mock LiveRequestQueue with send_realtime, send_content, close methods

    Examples:
        >>> queue = create_mock_live_request_queue()
        >>> queue.send_realtime(...)
        >>> queue.send_content(...)
        >>> queue.close()
    """
    mock_queue = Mock()
    mock_queue.send_realtime = Mock()
    mock_queue.send_content = Mock()
    mock_queue.close = Mock()
    return mock_queue


# ============================================================
# Agent and Runner Mocks (for ADK testing)
# ============================================================


def create_mock_agent(
    tools: list[Any] | None = None,
    model: str = "gemini-3-flash-preview",
    name: str = "test-agent",
) -> Mock:
    """Create a mock Agent for ADK testing.

    Args:
        tools: Optional list of tools for the agent
        model: Model name (default: gemini-3-flash-preview)
        name: Agent name (default: test-agent)

    Returns:
        Mock Agent with tools, model, and name configured

    Examples:
        >>> agent = create_mock_agent(tools=[tool1, tool2])
        >>> assert agent.model == "gemini-3-flash-preview"
        >>> assert len(agent.tools) == 2
    """
    from google.adk.agents import Agent

    mock_agent = Mock(spec=Agent)
    mock_agent.tools = tools or []
    mock_agent.model = model
    mock_agent.name = name
    return mock_agent


def create_mock_runner(
    agent: Mock | None = None,
) -> Mock:
    """Create a mock Runner for ADK testing.

    Args:
        agent: Optional Agent mock (creates default if None)

    Returns:
        Mock Runner with agent configured

    Examples:
        >>> agent = create_mock_agent()
        >>> runner = create_mock_runner(agent=agent)
        >>> assert runner.agent is agent
    """
    from google.adk.runners import Runner

    mock_runner = Mock(spec=Runner)
    mock_runner.agent = agent or create_mock_agent()
    return mock_runner


def create_mock_frontend_delegate(
    execute_result: Any | None = None,
) -> Mock:
    """Create a mock FrontendToolDelegate.

    Args:
        execute_result: Optional result to return from execute_on_frontend()
                       If None, returns Ok({"success": True})

    Returns:
        Mock FrontendToolDelegate with execute_on_frontend configured

    Examples:
        >>> delegate = create_mock_frontend_delegate()
        >>> result = await delegate.execute_on_frontend(tool_name="test", args={})

        >>> # With custom result
        >>> from adk_stream_protocol.result import Ok
        >>> delegate = create_mock_frontend_delegate(
        ...     execute_result=Ok({"custom": "data"})
        ... )
    """
    from unittest.mock import AsyncMock

    from adk_stream_protocol import FrontendToolDelegate
    from adk_stream_protocol.result import Ok

    mock_delegate = Mock(spec=FrontendToolDelegate)

    if execute_result is None:
        execute_result = Ok({"success": True})

    mock_delegate.execute_on_frontend = AsyncMock(return_value=execute_result)
    return mock_delegate


def create_custom_event(  # noqa: PLR0913
    *,
    content: str | None = None,
    turn_complete: bool | None = None,
    usage_metadata: Any = None,
    finish_reason: str | None = None,
    output_transcription: Any = None,
    input_transcription: Any = None,
    **kwargs: Any,
) -> Mock:
    """Create a custom Event mock with flexible field configuration.

    This helper is useful for transcription tests and other cases where
    you need fine-grained control over Event fields.

    Args:
        content: Event content
        turn_complete: Turn completion flag
        usage_metadata: Usage metadata
        finish_reason: Finish reason
        output_transcription: Output transcription object
        input_transcription: Input transcription object
        **kwargs: Additional fields to set on the event

    Returns:
        A configured Mock instance of Event

    Example:
        >>> mock_event = create_custom_event(
        ...     content=None,
        ...     output_transcription=MockTranscription(text="Hello", finished=True)
        ... )
    """
    from unittest.mock import Mock

    from google.adk.events import Event

    mock_event = Mock(spec=Event)
    mock_event.content = content
    mock_event.turn_complete = turn_complete
    mock_event.usage_metadata = usage_metadata
    mock_event.finish_reason = finish_reason
    mock_event.output_transcription = output_transcription
    mock_event.input_transcription = input_transcription

    # Set any additional fields
    for key, value in kwargs.items():
        setattr(mock_event, key, value)

    return mock_event
