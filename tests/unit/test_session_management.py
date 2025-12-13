"""
Unit tests for session management functions.

Tests the get_or_create_session() function with connection-specific session IDs.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

# Import the function we're testing and the global sessions dict
from server import _sessions, get_or_create_session


@pytest.fixture(autouse=True)
def clear_sessions():
    """Clear the global _sessions dict before each test."""
    _sessions.clear()
    yield
    _sessions.clear()


@pytest.mark.asyncio
async def test_get_or_create_session_without_connection_id():
    """
    Should create session with traditional session_id when connection_id not provided.

    This ensures backward compatibility with existing code.
    """
    # given: Mock agent runner with session service
    mock_runner = MagicMock()
    mock_session = MagicMock()
    mock_session.id = "session_alice_agents"
    mock_runner.session_service.create_session = AsyncMock(return_value=mock_session)

    user_id = "alice"
    app_name = "agents"

    # when: Call without connection_id
    session = await get_or_create_session(user_id, mock_runner, app_name)

    # then: Session created with traditional session_id format
    assert session is not None
    mock_runner.session_service.create_session.assert_called_once_with(
        app_name=app_name,
        user_id=user_id,
        session_id="session_alice_agents",
    )


@pytest.mark.asyncio
async def test_get_or_create_session_with_connection_signature():
    """
    Should create session with connection-specific session_id when connection_signature provided.

    This enables per-connection session isolation to avoid race conditions.
    ADK design: session = connection (each connection gets unique session).
    """
    # given: Mock agent runner with session service
    mock_runner = MagicMock()
    mock_session = MagicMock()
    connection_signature = "conn_abc123"
    expected_session_id = f"session_alice_{connection_signature}"
    mock_session.id = expected_session_id
    mock_runner.session_service.create_session = AsyncMock(return_value=mock_session)

    user_id = "alice"
    app_name = "agents"

    # when: Call with connection_signature
    session = await get_or_create_session(
        user_id, mock_runner, app_name, connection_signature=connection_signature
    )

    # then: Session created with connection-specific session_id
    assert session is not None
    mock_runner.session_service.create_session.assert_called_once_with(
        app_name=app_name,
        user_id=user_id,
        session_id=expected_session_id,
    )


@pytest.mark.asyncio
async def test_get_or_create_session_reuses_existing_session():
    """
    Should reuse existing session if already created with same session_id.

    This prevents redundant session creation and maintains session state.
    """
    # given: Mock agent runner
    mock_runner = MagicMock()
    mock_session = MagicMock()
    connection_signature = "conn_abc123"
    mock_runner.session_service.create_session = AsyncMock(return_value=mock_session)

    user_id = "alice"
    app_name = "agents"

    # when: Call twice with same parameters
    session_1 = await get_or_create_session(
        user_id, mock_runner, app_name, connection_signature=connection_signature
    )
    session_2 = await get_or_create_session(
        user_id, mock_runner, app_name, connection_signature=connection_signature
    )

    # then: Same session returned, create_session called only once
    assert session_1 is session_2
    mock_runner.session_service.create_session.assert_called_once()


@pytest.mark.asyncio
async def test_get_or_create_session_different_connections_get_different_sessions():
    """
    Should create separate sessions for different connection_signatures.

    This ensures connection isolation and prevents race conditions.
    ADK design: Each connection = unique session to avoid concurrent run_live() issues.
    """
    # given: Mock agent runner
    mock_runner = MagicMock()
    mock_session_1 = MagicMock()
    mock_session_1.id = "session_alice_conn_1"
    mock_session_2 = MagicMock()
    mock_session_2.id = "session_alice_conn_2"

    # Mock create_session to return different sessions
    mock_runner.session_service.create_session = AsyncMock(
        side_effect=[mock_session_1, mock_session_2]
    )

    user_id = "alice"
    app_name = "agents"

    # when: Call with different connection_signatures
    session_1 = await get_or_create_session(
        user_id, mock_runner, app_name, connection_signature="conn_1"
    )
    session_2 = await get_or_create_session(
        user_id, mock_runner, app_name, connection_signature="conn_2"
    )

    # then: Different sessions created
    assert session_1 is not session_2
    assert session_1.id == "session_alice_conn_1"
    assert session_2.id == "session_alice_conn_2"
    assert mock_runner.session_service.create_session.call_count == 2
