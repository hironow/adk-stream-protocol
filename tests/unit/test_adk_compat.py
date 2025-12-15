"""
Unit tests for adk_compat module

This module tests the ADK compatibility functions for session management and history synchronization.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch, call
import uuid


@pytest.fixture
def mock_session():
    """Create a mock ADK session"""
    session = MagicMock()
    session.state = {}
    session.events = []
    return session


@pytest.fixture
def mock_session_service():
    """Create a mock ADK session service"""
    service = AsyncMock()
    return service


@pytest.fixture
def sample_messages():
    """Create sample ChatMessage objects for testing"""
    # Create mock messages instead of real ChatMessage objects to avoid attribute issues
    messages = []
    for role, content in [
        ("user", "My name is Alice and my favorite color is blue."),
        ("assistant", "Nice to meet you Alice! I'll remember that your favorite color is blue."),
        ("user", "What's my name?"),
        ("assistant", "Your name is Alice."),
        ("user", "What's my favorite color?"),
    ]:
        msg = MagicMock()
        msg.role = role
        msg.content = content
        msg.to_adk_content = MagicMock(return_value=MagicMock(role=role))
        messages.append(msg)
    return messages


@pytest.mark.asyncio
async def test_sync_conversation_history_first_sync(mock_session, mock_session_service, sample_messages):
    """Test syncing conversation history for the first time"""
    from adk_compat import sync_conversation_history_to_session

    # Mock to_adk_content method
    for msg in sample_messages:
        msg.to_adk_content = MagicMock()
        msg.to_adk_content.return_value = MagicMock(role=msg.role)

    # Call the function (should sync all except last message)
    result = await sync_conversation_history_to_session(
        session=mock_session,
        session_service=mock_session_service,
        messages=sample_messages,
        current_mode="TEST",
    )

    # Should sync 4 messages (all except the last one)
    assert result == 4

    # Should have called append_event 4 times
    assert mock_session_service.append_event.call_count == 4

    # Check that synced_message_count was updated
    assert mock_session.state["synced_message_count"] == 4

    # Verify the events were created with correct roles
    calls = mock_session_service.append_event.call_args_list
    assert calls[0][1]['event'].author == 'user'
    assert calls[1][1]['event'].author == 'assistant'
    assert calls[2][1]['event'].author == 'user'
    assert calls[3][1]['event'].author == 'assistant'


@pytest.mark.asyncio
async def test_sync_conversation_history_incremental(mock_session, mock_session_service, sample_messages):
    """Test syncing only new messages when some are already synced"""
    from adk_compat import sync_conversation_history_to_session

    # Mock to_adk_content method
    for msg in sample_messages:
        msg.to_adk_content = MagicMock()
        msg.to_adk_content.return_value = MagicMock(role=msg.role)

    # Set that we've already synced 2 messages
    mock_session.state["synced_message_count"] = 2

    # Call the function
    result = await sync_conversation_history_to_session(
        session=mock_session,
        session_service=mock_session_service,
        messages=sample_messages,
        current_mode="TEST",
    )

    # Should only sync 2 new messages (index 2 and 3, skipping the last)
    assert result == 2

    # Should have called append_event only 2 times
    assert mock_session_service.append_event.call_count == 2

    # Check that synced_message_count was updated
    assert mock_session.state["synced_message_count"] == 4


@pytest.mark.asyncio
async def test_sync_conversation_history_no_messages(mock_session, mock_session_service):
    """Test syncing with no messages"""
    from adk_compat import sync_conversation_history_to_session

    # Call with only one message (which would be the new message)
    msg = MagicMock()
    msg.role = "user"
    msg.content = "Hello"
    msg.to_adk_content = MagicMock(return_value=MagicMock(role="user"))
    messages = [msg]

    result = await sync_conversation_history_to_session(
        session=mock_session,
        session_service=mock_session_service,
        messages=messages,
        current_mode="TEST",
    )

    # Should sync 0 messages (no history to sync)
    assert result == 0

    # Should not have called append_event
    assert mock_session_service.append_event.call_count == 0


@pytest.mark.asyncio
async def test_sync_conversation_history_already_synced(mock_session, mock_session_service, sample_messages):
    """Test when all messages are already synced"""
    from adk_compat import sync_conversation_history_to_session

    # Mock to_adk_content method
    for msg in sample_messages:
        msg.to_adk_content = MagicMock()
        msg.to_adk_content.return_value = MagicMock(role=msg.role)

    # Set that we've already synced all messages except the last
    mock_session.state["synced_message_count"] = 4

    # Call the function
    result = await sync_conversation_history_to_session(
        session=mock_session,
        session_service=mock_session_service,
        messages=sample_messages,
        current_mode="TEST",
    )

    # Should sync 0 messages (all already synced)
    assert result == 0

    # Should not have called append_event
    assert mock_session_service.append_event.call_count == 0

    # synced_message_count should remain the same
    assert mock_session.state["synced_message_count"] == 4


def test_detect_mode_switch():
    """Test mode switch detection"""
    from adk_compat import detect_mode_switch

    # Test first time (no previous mode)
    session = MagicMock()
    session.state = {}

    switched, prev_mode = detect_mode_switch(session, "adk-sse")
    assert switched is False
    assert prev_mode == ""

    # Test same mode
    session.state["current_mode"] = "adk-sse"
    switched, prev_mode = detect_mode_switch(session, "adk-sse")
    assert switched is False
    assert prev_mode == "adk-sse"

    # Test mode switch
    session.state["current_mode"] = "gemini"
    switched, prev_mode = detect_mode_switch(session, "adk-sse")
    assert switched is True
    assert prev_mode == "gemini"


@pytest.mark.asyncio
async def test_prepare_session_for_mode_switch(mock_session, mock_session_service):
    """Test preparing session when switching modes"""
    from adk_compat import prepare_session_for_mode_switch

    # Mock messages
    messages = []
    for role, content in [("user", "Test"), ("assistant", "Response")]:
        msg = MagicMock()
        msg.role = role
        msg.content = content
        msg.to_adk_content = MagicMock(return_value=MagicMock(role=role))
        messages.append(msg)

    # Test switching from Gemini to ADK SSE
    with patch('adk_compat.sync_conversation_history_to_session') as mock_sync:
        mock_sync.return_value = 1  # Return that 1 message was synced

        await prepare_session_for_mode_switch(
            session=mock_session,
            session_service=mock_session_service,
            messages=messages,
            from_mode="gemini",
            to_mode="adk-sse",
        )

        # Should have called sync function
        mock_sync.assert_called_once()

        # Should have reset the synced count
        assert mock_session.state["synced_message_count"] == 0

        # Should track current mode
        assert mock_session.state["current_mode"] == "adk-sse"


@pytest.mark.asyncio
async def test_prepare_session_adk_to_adk_switch(mock_session, mock_session_service):
    """Test switching between ADK modes (no sync needed)"""
    from adk_compat import prepare_session_for_mode_switch

    msg = MagicMock()
    msg.role = "user"
    msg.content = "Test"
    msg.to_adk_content = MagicMock(return_value=MagicMock(role="user"))
    messages = [msg]

    with patch('adk_compat.sync_conversation_history_to_session') as mock_sync:
        await prepare_session_for_mode_switch(
            session=mock_session,
            session_service=mock_session_service,
            messages=messages,
            from_mode="adk-sse",
            to_mode="adk-bidi",
        )

        # Should NOT have called sync function (history already in ADK)
        mock_sync.assert_not_called()

        # Should track current mode
        assert mock_session.state["current_mode"] == "adk-bidi"


@pytest.mark.asyncio
async def test_event_creation_with_unique_ids(mock_session, mock_session_service, sample_messages):
    """Test that events are created with unique invocation IDs"""
    from adk_compat import sync_conversation_history_to_session

    # Mock to_adk_content method
    for msg in sample_messages:
        msg.to_adk_content = MagicMock()
        msg.to_adk_content.return_value = MagicMock(role=msg.role)

    # Call the function
    await sync_conversation_history_to_session(
        session=mock_session,
        session_service=mock_session_service,
        messages=sample_messages,
        current_mode="TEST",
    )

    # Check that events have unique invocation IDs
    calls = mock_session_service.append_event.call_args_list
    invocation_ids = []

    for call_args in calls:
        event = call_args[1]['event']
        assert hasattr(event, 'invocation_id')
        invocation_ids.append(event.invocation_id)

    # All invocation IDs should be unique
    assert len(invocation_ids) == len(set(invocation_ids))

    # IDs should follow the pattern sync_{index}_{role}
    assert invocation_ids[0] == "sync_0_user"
    assert invocation_ids[1] == "sync_1_assistant"
    assert invocation_ids[2] == "sync_2_user"
    assert invocation_ids[3] == "sync_3_assistant"


@pytest.mark.asyncio
async def test_get_or_create_session_creates_new_session():
    """Test that get_or_create_session creates a new session when needed"""
    from adk_compat import get_or_create_session, clear_sessions

    # Clear any existing sessions
    clear_sessions()

    # Mock agent runner
    mock_runner = MagicMock()
    mock_session_service = AsyncMock()
    mock_runner.session_service = mock_session_service

    mock_session = MagicMock()
    mock_session.id = "session_test_user_agents"
    mock_session_service.create_session.return_value = mock_session

    # Create session
    session = await get_or_create_session("test_user", mock_runner, "agents")

    # Should have called create_session
    mock_session_service.create_session.assert_called_once_with(
        app_name="agents",
        user_id="test_user",
        session_id="session_test_user_agents",
    )

    assert session == mock_session


@pytest.mark.asyncio
async def test_get_or_create_session_reuses_existing():
    """Test that get_or_create_session reuses existing sessions"""
    from adk_compat import get_or_create_session, clear_sessions

    # Clear any existing sessions
    clear_sessions()

    # Mock agent runner
    mock_runner = MagicMock()
    mock_session_service = AsyncMock()
    mock_runner.session_service = mock_session_service

    mock_session = MagicMock()
    mock_session.id = "session_test_user_agents"
    mock_session_service.create_session.return_value = mock_session

    # Create session twice
    session1 = await get_or_create_session("test_user", mock_runner, "agents")
    session2 = await get_or_create_session("test_user", mock_runner, "agents")

    # Should only create once
    mock_session_service.create_session.assert_called_once()

    # Should return the same session
    assert session1 == session2
    assert session1 == mock_session


@pytest.mark.asyncio
async def test_get_or_create_session_with_connection_signature():
    """Test that connection_signature creates unique sessions"""
    from adk_compat import get_or_create_session, clear_sessions

    # Clear any existing sessions
    clear_sessions()

    # Mock agent runner
    mock_runner = MagicMock()
    mock_session_service = AsyncMock()
    mock_runner.session_service = mock_session_service

    # Mock sessions
    mock_session1 = MagicMock()
    mock_session2 = MagicMock()
    mock_session_service.create_session.side_effect = [mock_session1, mock_session2]

    # Create sessions with different connection signatures
    conn_sig1 = str(uuid.uuid4())
    conn_sig2 = str(uuid.uuid4())

    session1 = await get_or_create_session("test_user", mock_runner, "agents", conn_sig1)
    session2 = await get_or_create_session("test_user", mock_runner, "agents", conn_sig2)

    # Should create two different sessions
    assert mock_session_service.create_session.call_count == 2
    assert session1 == mock_session1
    assert session2 == mock_session2

    # Check the session IDs used
    calls = mock_session_service.create_session.call_args_list
    assert calls[0][1]["session_id"] == f"session_test_user_{conn_sig1}"
    assert calls[1][1]["session_id"] == f"session_test_user_{conn_sig2}"


def test_clear_sessions():
    """Test that clear_sessions removes all sessions"""
    from adk_compat import clear_sessions, get_session_count, _sessions

    # Clear any existing sessions first
    clear_sessions()
    assert get_session_count() == 0

    # Add some test sessions directly
    _sessions["test1"] = MagicMock()
    _sessions["test2"] = MagicMock()

    assert get_session_count() == 2

    # Clear sessions
    clear_sessions()

    assert get_session_count() == 0
    assert len(_sessions) == 0


def test_get_session_count():
    """Test that get_session_count returns correct count"""
    from adk_compat import get_session_count, clear_sessions, _sessions

    # Clear first
    clear_sessions()
    assert get_session_count() == 0

    # Add sessions
    _sessions["test1"] = MagicMock()
    assert get_session_count() == 1

    _sessions["test2"] = MagicMock()
    assert get_session_count() == 2

    # Clear again
    clear_sessions()


@pytest.mark.asyncio
async def test_sync_conversation_history_error_handling(mock_session, mock_session_service):
    """Test that sync_conversation_history handles errors gracefully"""
    from adk_compat import sync_conversation_history_to_session

    # Mock to_adk_content to raise an error
    msg = MagicMock()
    msg.role = "user"
    msg.content = "Test message"
    msg.to_adk_content = MagicMock(side_effect=ValueError("Conversion error"))
    messages = [msg, MagicMock()]  # Two messages (one will fail)

    # Should handle error and continue (or re-raise - depends on implementation)
    with pytest.raises(ValueError):
        await sync_conversation_history_to_session(
            session=mock_session,
            session_service=mock_session_service,
            messages=messages,
            current_mode="TEST",
        )


@pytest.mark.asyncio
async def test_prepare_session_mode_combinations(mock_session, mock_session_service):
    """Test various mode switch combinations"""
    from adk_compat import prepare_session_for_mode_switch

    messages = []

    # Test all possible mode combinations
    mode_pairs = [
        ("gemini", "adk-sse", True),   # Should sync
        ("gemini", "adk-bidi", True),  # Should sync
        ("gemini", "gemini", False),   # Same mode, no sync
        ("adk-sse", "adk-bidi", False),  # ADK to ADK, no sync
        ("adk-bidi", "adk-sse", False),  # ADK to ADK, no sync
        ("adk-sse", "gemini", False),  # Back to Gemini, no sync needed
    ]

    for from_mode, to_mode, should_sync in mode_pairs:
        mock_session.state = {}

        with patch('adk_compat.sync_conversation_history_to_session') as mock_sync:
            mock_sync.return_value = 0

            await prepare_session_for_mode_switch(
                session=mock_session,
                session_service=mock_session_service,
                messages=messages,
                from_mode=from_mode,
                to_mode=to_mode,
            )

            # Check if sync was called based on expected behavior
            if should_sync:
                mock_sync.assert_called_once()
            else:
                mock_sync.assert_not_called()

            # Should always update current_mode
            assert mock_session.state["current_mode"] == to_mode


@pytest.mark.asyncio
async def test_get_or_create_session_concurrent_access():
    """Test that concurrent access to the same session is handled correctly"""
    from adk_compat import get_or_create_session, clear_sessions
    import asyncio

    # Clear any existing sessions
    clear_sessions()

    # Mock agent runner
    mock_runner = MagicMock()
    mock_session_service = AsyncMock()
    mock_runner.session_service = mock_session_service

    mock_session = MagicMock()
    mock_session.id = "session_concurrent_agents"
    mock_session_service.create_session.return_value = mock_session

    # Create multiple concurrent tasks requesting the same session
    tasks = []
    for _ in range(10):
        task = asyncio.create_task(
            get_or_create_session("concurrent", mock_runner, "agents")
        )
        tasks.append(task)

    # Wait for all tasks
    sessions = await asyncio.gather(*tasks)

    # All should get the same session
    assert all(s == mock_session for s in sessions)

    # create_session should only be called once despite concurrent requests
    mock_session_service.create_session.assert_called_once()


@pytest.mark.asyncio
async def test_sync_conversation_history_with_large_history(mock_session, mock_session_service):
    """Test syncing with a large conversation history"""
    from adk_compat import sync_conversation_history_to_session

    # Create a large conversation history
    messages = []
    for i in range(100):  # 100 message pairs
        user_msg = MagicMock()
        user_msg.role = "user"
        user_msg.content = f"Question {i}"
        user_msg.to_adk_content = MagicMock(return_value=MagicMock(role="user"))

        assistant_msg = MagicMock()
        assistant_msg.role = "assistant"
        assistant_msg.content = f"Answer {i}"
        assistant_msg.to_adk_content = MagicMock(return_value=MagicMock(role="assistant"))

        messages.extend([user_msg, assistant_msg])

    # Add current message (won't be synced)
    current_msg = MagicMock()
    current_msg.role = "user"
    current_msg.content = "Current question"
    current_msg.to_adk_content = MagicMock(return_value=MagicMock(role="user"))
    messages.append(current_msg)

    # Sync all except the last message
    result = await sync_conversation_history_to_session(
        session=mock_session,
        session_service=mock_session_service,
        messages=messages,
        current_mode="TEST",
    )

    # Should sync 200 messages (all except the last)
    assert result == 200
    assert mock_session_service.append_event.call_count == 200
    assert mock_session.state["synced_message_count"] == 200


def test_detect_mode_switch_edge_cases():
    """Test edge cases for mode switch detection"""
    from adk_compat import detect_mode_switch

    # Test with None values (first time)
    session = MagicMock()
    session.state = {"current_mode": None}

    switched, prev_mode = detect_mode_switch(session, "adk-sse")
    assert switched is False  # None means first time, not a switch
    assert prev_mode == ""

    # Test with empty string (not None, so it's a switch)
    session.state = {"current_mode": ""}

    switched, prev_mode = detect_mode_switch(session, "adk-sse")
    assert switched is True  # Empty string to something IS a switch
    assert prev_mode == ""

    # Test case sensitivity (should be exact match)
    session.state = {"current_mode": "ADK-SSE"}

    switched, prev_mode = detect_mode_switch(session, "adk-sse")
    assert switched is True  # Different case is a switch
    assert prev_mode == "ADK-SSE"


@pytest.mark.asyncio
async def test_connection_signature_uniqueness():
    """Test that connection signatures truly create unique sessions"""
    from adk_compat import get_or_create_session, clear_sessions, get_session_count, _sessions
    import uuid

    # Clear any existing sessions
    clear_sessions()

    # Mock agent runner
    mock_runner = MagicMock()
    mock_session_service = AsyncMock()
    mock_runner.session_service = mock_session_service

    # Create mock sessions with unique IDs
    created_sessions = []

    def create_unique_session(**kwargs):
        session = MagicMock()
        session.id = kwargs["session_id"]
        created_sessions.append(session)
        return session

    mock_session_service.create_session.side_effect = create_unique_session

    # Create sessions with different connection signatures
    signatures = [str(uuid.uuid4()) for _ in range(5)]
    sessions = []

    for sig in signatures:
        session = await get_or_create_session(
            "user", mock_runner, "agents", connection_signature=sig
        )
        sessions.append(session)

    # All sessions should be different
    session_ids = [s.id for s in sessions]
    assert len(set(session_ids)) == 5  # All unique

    # Verify the session IDs contain the connection signatures
    for sig, session in zip(signatures, sessions):
        assert sig in session.id

    # Verify we have 5 sessions in storage
    assert get_session_count() == 5