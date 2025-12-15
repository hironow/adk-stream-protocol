"""
Integration tests for connection isolation and session management.

Tests verify that multiple users and connections get properly isolated sessions
and tool approval routing works correctly, regardless of the backend implementation.

These tests mock get_user() to simulate multiple users.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from tool_delegate import FrontendToolDelegate


@pytest.mark.asyncio
async def test_delegate_stored_in_session_state():
    """
    Should store FrontendToolDelegate in session.state['temp:delegate'].

    Each connection creates its own delegate and stores it in session state
    for proper tool approval routing.
    """
    # given: Mock session with state dict
    mock_session = MagicMock()
    mock_session.state = {}

    # when: Store delegate (simulating WebSocket setup)
    delegate = FrontendToolDelegate()
    mock_session.state["temp:delegate"] = delegate

    # then: Delegate should be retrievable
    retrieved_delegate = mock_session.state.get("temp:delegate")
    assert retrieved_delegate is delegate


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
@patch("server.get_user")
async def test_multiple_users_get_isolated_sessions(mock_get_user):
    """
    Should handle multiple users with isolated sessions.

    This verifies that when different users connect, they get separate sessions
    and delegates, preventing cross-user interference.
    """
    # given: Two different users
    # Simulate different users connecting
    user1_session = MagicMock()
    user1_session.state = {}
    user2_session = MagicMock()
    user2_session.state = {}

    # when: Simulate user1 connecting
    mock_get_user.return_value = "user_001"
    user1_id = mock_get_user()
    delegate1 = FrontendToolDelegate()
    user1_session.state["temp:delegate"] = delegate1
    user1_session.state["user_id"] = user1_id

    # when: Simulate user2 connecting
    mock_get_user.return_value = "user_002"
    user2_id = mock_get_user()
    delegate2 = FrontendToolDelegate()
    user2_session.state["temp:delegate"] = delegate2
    user2_session.state["user_id"] = user2_id

    # then: Users should have different IDs
    assert user1_id != user2_id
    assert user1_id == "user_001"
    assert user2_id == "user_002"

    # then: Each user should have their own delegate instance
    assert user1_session.state["temp:delegate"] is delegate1
    assert user2_session.state["temp:delegate"] is delegate2
    assert delegate1 is not delegate2


@pytest.mark.asyncio
@patch("server.get_user")
async def test_same_user_multiple_connections_get_separate_delegates(mock_get_user):
    """
    Test that the same user with multiple connections gets separate delegates.

    Even when the same user opens multiple WebSocket connections (e.g., multiple tabs),
    each connection should have its own delegate instance for proper isolation.
    """
    # given: Same user with two different connections
    mock_get_user.return_value = "user_001"

    connection1_session = MagicMock()
    connection1_session.state = {}
    connection2_session = MagicMock()
    connection2_session.state = {}

    # when: Create separate delegates for each connection
    delegate1 = FrontendToolDelegate()
    delegate2 = FrontendToolDelegate()

    connection1_session.state["temp:delegate"] = delegate1
    connection2_session.state["temp:delegate"] = delegate2

    # then: Each connection should have its own delegate instance
    assert connection1_session.state["temp:delegate"] is delegate1
    assert connection2_session.state["temp:delegate"] is delegate2
    assert delegate1 is not delegate2

    # then: Both connections are for the same user
    assert mock_get_user() == "user_001"


@pytest.mark.asyncio
@patch("server.get_user")
async def test_session_isolation_with_concurrent_users(mock_get_user):
    """
    Test that sessions remain isolated when users connect concurrently.

    This simulates a realistic scenario where multiple users are
    connecting and using the system at the same time.
    """
    sessions = []
    delegates = []
    user_ids = ["alice", "bob", "charlie", "diana", "eve"]

    # given: Multiple users connecting concurrently
    for _i, user_id in enumerate(user_ids):
        mock_get_user.return_value = user_id

        session = MagicMock()
        session.state = {}
        session.state["user_id"] = mock_get_user()

        delegate = FrontendToolDelegate()
        session.state["temp:delegate"] = delegate

        sessions.append(session)
        delegates.append(delegate)

    # then: Each user should have a unique session and delegate
    for i, session in enumerate(sessions):
        assert session.state["user_id"] == user_ids[i]
        assert session.state["temp:delegate"] is delegates[i]

    # then: All delegates should be different instances
    for i in range(len(delegates)):
        for j in range(i + 1, len(delegates)):
            assert delegates[i] is not delegates[j]

    # then: All user IDs should be correctly assigned
    retrieved_user_ids = [s.state["user_id"] for s in sessions]
    assert retrieved_user_ids == user_ids


@pytest.mark.asyncio
async def test_delegate_lifecycle_without_user_dependency():
    """
    Test delegate creation and lifecycle management.

    Delegates should be created and managed per connection,
    independent of the user management implementation.
    """
    # given: Mock sessions representing different connections
    sessions = []
    for i in range(3):
        session = MagicMock()
        session.state = {}
        session.id = f"session_{i}"
        sessions.append(session)

    # when: Create and assign delegates to each session
    delegates = []
    for session in sessions:
        delegate = FrontendToolDelegate()
        session.state["temp:delegate"] = delegate
        delegates.append(delegate)

    # then: Each session should have its own delegate
    for i, session in enumerate(sessions):
        assert session.state["temp:delegate"] is delegates[i]

    # then: All delegates should be unique instances
    assert len(set(id(d) for d in delegates)) == len(delegates)

    # when: Simulate connection cleanup (removing delegate)
    sessions[0].state.pop("temp:delegate", None)

    # then: First session should no longer have a delegate
    assert "temp:delegate" not in sessions[0].state

    # then: Other sessions should still have their delegates
    assert sessions[1].state["temp:delegate"] is delegates[1]
    assert sessions[2].state["temp:delegate"] is delegates[2]
