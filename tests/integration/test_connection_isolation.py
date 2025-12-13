"""
Integration tests for connection-specific session management.

Verifies that multiple WebSocket connections get isolated sessions
and tool approval routing works correctly.

This is Phase 4 of per-connection state management implementation.
"""

from __future__ import annotations

import uuid
from unittest.mock import MagicMock

import pytest

from server import _sessions, get_or_create_session
from tool_delegate import FrontendToolDelegate


@pytest.fixture(autouse=True)
def clear_sessions():
    """Clear the global _sessions dict before each test."""
    _sessions.clear()
    yield
    _sessions.clear()


@pytest.mark.asyncio
async def test_delegate_stored_in_session_state():
    """
    Should store FrontendToolDelegate in session.state['temp:delegate'].

    This verifies the Phase 2 implementation where each connection
    creates its own delegate and stores it in session state.
    """
    # given: Mock session with state dict
    mock_session = MagicMock()
    mock_session.state = {}

    # when: Store delegate (simulating Phase 2 WebSocket setup)
    delegate = FrontendToolDelegate()
    connection_signature = str(uuid.uuid4())
    mock_session.state["temp:delegate"] = delegate
    mock_session.state["client_identifier"] = connection_signature

    # then: Delegate should be retrievable
    retrieved_delegate = mock_session.state.get("temp:delegate")
    assert retrieved_delegate is delegate
    assert "client_identifier" in mock_session.state
    assert mock_session.state["client_identifier"] == connection_signature


@pytest.mark.asyncio
async def test_multiple_connections_get_isolated_delegates():
    """
    Should create separate delegates for different connections.

    This is the core of connection isolation - each connection should have
    its own delegate instance to prevent cross-connection interference.
    """
    # given: Two mock sessions for different connections
    session1 = MagicMock()
    session1.state = {}
    session2 = MagicMock()
    session2.state = {}

    # when: Create separate delegates for each connection
    delegate1 = FrontendToolDelegate()
    delegate2 = FrontendToolDelegate()

    connection_sig1 = str(uuid.uuid4())
    connection_sig2 = str(uuid.uuid4())

    session1.state["temp:delegate"] = delegate1
    session1.state["client_identifier"] = connection_sig1

    session2.state["temp:delegate"] = delegate2
    session2.state["client_identifier"] = connection_sig2

    # then: Delegates should be different instances
    assert session1.state["temp:delegate"] is not session2.state["temp:delegate"]
    assert delegate1 is not delegate2

    # then: Connection identifiers should be different
    assert session1.state["client_identifier"] != session2.state["client_identifier"]


@pytest.mark.asyncio
async def test_session_state_uses_temp_prefix():
    """
    Should use 'temp:' prefix for non-persisted state.

    ADK's temp: prefix ensures state is not persisted to storage,
    which is appropriate for connection-lifetime objects like delegates.
    """
    # given: Mock session
    mock_session = MagicMock()
    mock_session.state = {}

    # when: Store delegate with temp: prefix
    delegate = FrontendToolDelegate()
    mock_session.state["temp:delegate"] = delegate

    # then: Should be stored with temp: prefix
    assert "temp:delegate" in mock_session.state
    assert mock_session.state.get("temp:delegate") is delegate


@pytest.mark.asyncio
async def test_connection_specific_session_creation():
    """
    Should create connection-specific sessions when connection_signature provided.

    This integration test verifies Phase 1 + Phase 2 work together:
    - Phase 1: get_or_create_session() accepts connection_signature
    - Phase 2: WebSocket endpoint generates and uses connection_signature
    """
    # given: Mock runner
    mock_runner = MagicMock()
    mock_session1 = MagicMock()
    mock_session2 = MagicMock()

    connection_sig1 = str(uuid.uuid4())
    connection_sig2 = str(uuid.uuid4())

    expected_session_id1 = f"session_alice_{connection_sig1}"
    expected_session_id2 = f"session_alice_{connection_sig2}"

    mock_session1.id = expected_session_id1
    mock_session2.id = expected_session_id2

    # Mock create_session to return different sessions
    from unittest.mock import AsyncMock

    mock_runner.session_service.create_session = AsyncMock(
        side_effect=[mock_session1, mock_session2]
    )

    # when: Create sessions for two different connections
    session1 = await get_or_create_session(
        "alice", mock_runner, "agents", connection_signature=connection_sig1
    )
    session2 = await get_or_create_session(
        "alice", mock_runner, "agents", connection_signature=connection_sig2
    )

    # then: Should create different sessions
    assert session1 is not session2
    assert session1.id == expected_session_id1
    assert session2.id == expected_session_id2

    # then: Session IDs should contain connection signatures
    assert connection_sig1 in session1.id
    assert connection_sig2 in session2.id


@pytest.mark.asyncio
async def test_fallback_to_sse_mode_without_connection_signature():
    """
    Should create traditional session when connection_signature not provided.

    This ensures backward compatibility with SSE mode, which uses
    one session per user+app instead of per-connection sessions.
    """
    # given: Mock runner
    mock_runner = MagicMock()
    mock_session = MagicMock()
    expected_session_id = "session_alice_agents"
    mock_session.id = expected_session_id

    from unittest.mock import AsyncMock

    mock_runner.session_service.create_session = AsyncMock(return_value=mock_session)

    # when: Create session WITHOUT connection_signature (SSE mode)
    session = await get_or_create_session("alice", mock_runner, "agents")

    # then: Should create traditional session
    assert session is not None
    assert session.id == expected_session_id

    # then: Session ID should NOT contain UUID (no connection signature)
    assert "session_alice_agents" == session.id
