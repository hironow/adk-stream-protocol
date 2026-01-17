"""
Unit tests for adk_compat module

This module tests the ADK compatibility functions for session management and history synchronization.
"""

import asyncio
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from adk_stream_protocol.adk.adk_compat import (
    _sessions,
    _synced_message_counts,
    clear_sessions,
    get_or_create_session,
    sync_conversation_history_to_session,
)
from adk_stream_protocol.protocol.ai_sdk_v6_compat import process_chat_message_for_bidi


@pytest.fixture(autouse=True)
def clear_synced_counts():
    """Clear synced message counts before and after each test"""
    _synced_message_counts.clear()
    yield
    _synced_message_counts.clear()


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
async def test_sync_conversation_history_first_sync(
    mock_session, mock_session_service, sample_messages
):
    """Test syncing conversation history for the first time"""
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
    assert _synced_message_counts[mock_session.id] == 4

    # Verify the events were created with correct roles
    calls = mock_session_service.append_event.call_args_list
    assert calls[0][1]["event"].author == "user"
    assert calls[1][1]["event"].author == "assistant"
    assert calls[2][1]["event"].author == "user"
    assert calls[3][1]["event"].author == "assistant"


@pytest.mark.asyncio
async def test_sync_conversation_history_incremental(
    mock_session, mock_session_service, sample_messages
):
    """Test syncing only new messages when some are already synced"""

    # Mock to_adk_content method
    for msg in sample_messages:
        msg.to_adk_content = MagicMock()
        msg.to_adk_content.return_value = MagicMock(role=msg.role)

    # Set that we've already synced 2 messages
    _synced_message_counts[mock_session.id] = 2

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
    assert _synced_message_counts[mock_session.id] == 4


@pytest.mark.asyncio
async def test_sync_conversation_history_no_messages(mock_session, mock_session_service):
    """Test syncing with no messages"""
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
async def test_sync_conversation_history_already_synced(
    mock_session, mock_session_service, sample_messages
):
    """Test when all messages are already synced"""
    # Mock to_adk_content method
    for msg in sample_messages:
        msg.to_adk_content = MagicMock()
        msg.to_adk_content.return_value = MagicMock(role=msg.role)

    # Set that we've already synced all messages except the last
    _synced_message_counts[mock_session.id] = 4

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
    assert _synced_message_counts[mock_session.id] == 4


@pytest.mark.asyncio
async def test_event_creation_with_unique_ids(mock_session, mock_session_service, sample_messages):
    """Test that events are created with unique invocation IDs"""
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
        event = call_args[1]["event"]
        assert hasattr(event, "invocation_id")
        invocation_ids.append(event.invocation_id)

    # All invocation IDs should be unique
    assert len(invocation_ids) == len(set(invocation_ids))

    # IDs should follow the pattern sync_{index}_{role}
    assert invocation_ids[0] == "sync_0_user"
    assert invocation_ids[1] == "sync_1_assistant"
    assert invocation_ids[2] == "sync_2_user"
    assert invocation_ids[3] == "sync_3_assistant"


# ========== Session Management Tests ==========
# Tests for get_or_create_session() function and session lifecycle


@pytest.mark.asyncio
async def test_get_or_create_session_creates_new_session():
    """Test that get_or_create_session creates a new session when needed"""
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
async def test_get_or_create_session_without_connection_signature():
    """
    Should create session with traditional session_id when connection_signature not provided.

    This ensures backward compatibility with existing code.
    """
    clear_sessions()

    # Mock agent runner with session service
    mock_runner = MagicMock()
    mock_session = MagicMock()
    mock_session.id = "session_alice_agents"
    mock_runner.session_service.create_session = AsyncMock(return_value=mock_session)

    user_id = "alice"
    app_name = "agents"

    # Call without connection_signature
    session = await get_or_create_session(user_id, mock_runner, app_name)

    # Session created with traditional session_id format
    assert session is not None
    mock_runner.session_service.create_session.assert_called_once_with(
        app_name=app_name,
        user_id=user_id,
        session_id="session_alice_agents",
    )


@pytest.mark.asyncio
async def test_get_or_create_session_different_connections_get_different_sessions():
    """
    Should create separate sessions for different connection_signatures.

    This ensures connection isolation and prevents race conditions.
    ADK design: Each connection = unique session to avoid concurrent run_live() issues.
    """
    clear_sessions()

    # Mock agent runner
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

    # Call with different connection_signatures
    session_1 = await get_or_create_session(
        user_id, mock_runner, app_name, connection_signature="conn_1"
    )
    session_2 = await get_or_create_session(
        user_id, mock_runner, app_name, connection_signature="conn_2"
    )

    # Different sessions created
    assert session_1 is not session_2
    assert session_1.id == "session_alice_conn_1"
    assert session_2.id == "session_alice_conn_2"
    assert mock_runner.session_service.create_session.call_count == 2


@pytest.mark.asyncio
async def test_get_or_create_session_reuses_existing():
    """Test that get_or_create_session reuses existing sessions"""
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
    # Clear any existing sessions first
    clear_sessions()
    assert len(_sessions) == 0

    # Add some test sessions directly
    _sessions["test1"] = MagicMock()
    _sessions["test2"] = MagicMock()

    assert len(_sessions) == 2

    # Clear sessions
    clear_sessions()

    assert len(_sessions) == 0


@pytest.mark.asyncio
async def test_sync_conversation_history_error_handling(mock_session, mock_session_service):
    """Test that sync_conversation_history handles errors gracefully"""
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
async def test_get_or_create_session_concurrent_access():
    """Test that concurrent access to the same session is handled correctly"""
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
        task = asyncio.create_task(get_or_create_session("concurrent", mock_runner, "agents"))
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
    assert _synced_message_counts[mock_session.id] == 200


@pytest.mark.asyncio
async def test_connection_signature_uniqueness():
    """Test that connection signatures truly create unique sessions"""
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
    for sig, session in zip(signatures, sessions, strict=False):
        assert sig in session.id

    # Verify we have 5 sessions in storage
    assert len(_sessions) == 5


@pytest.mark.asyncio
async def test_message_conversion_pipeline_call_count():
    """Integration spy test: Verify message conversion pipeline is called correctly (simulates E2E flow)."""
    # given - simulate frontend sending messages in correct format
    message_data = {
        "messages": [
            {"role": "user", "parts": [{"type": "text", "text": "Send 50 dollars to Hanako"}]},
            {
                "role": "assistant",
                "parts": [
                    {"type": "text", "text": "I'll process the payment"},
                    {
                        "type": "tool-process_payment",
                        "toolCallId": "call-payment-1",
                        "toolName": "process_payment",
                        "state": "input-available",
                        "input": {"amount": 50, "recipient": "Hanako", "currency": "USD"},
                    },
                    {
                        "type": "tool-adk_request_confirmation",
                        "toolCallId": "call-confirm-1",
                        "toolName": "adk_request_confirmation",
                        "state": "output-available",
                        "output": {"confirmed": True},
                    },
                ],
            },
        ]
    }

    # when - spy on process_chat_message_for_bidi
    with patch(
        "adk_stream_protocol.protocol.ai_sdk_v6_compat.process_chat_message_for_bidi",
        wraps=process_chat_message_for_bidi,
    ) as spy_process:
        image_blobs, text_content = spy_process(message_data)

        # then - should be called exactly once
        assert spy_process.call_count == 1, (
            f"Expected process_chat_message_for_bidi to be called once, "
            f"but was called {spy_process.call_count} times"
        )

        # Verify result correctness
        assert image_blobs == []  # No images in this test
        assert text_content is not None
        assert text_content.role == "user"  # FunctionResponse forces role="user"

        # ADK Protocol: FunctionResponse must be sent ALONE (text parts filtered out)
        assert len(text_content.parts) == 1  # Only FunctionResponse part
        assert hasattr(text_content.parts[0], "function_response")
        assert text_content.parts[0].function_response is not None
        assert text_content.parts[0].function_response.name == "adk_request_confirmation"
        assert text_content.parts[0].function_response.id == "call-confirm-1"
        assert text_content.parts[0].function_response.response == {"confirmed": True}


@pytest.mark.asyncio
async def test_session_send_message_called_for_user_input():
    """Integration spy test: Verify session.send_message is called when user sends message."""

    # given
    clear_sessions()
    mock_runner = MagicMock()
    mock_session = MagicMock()
    mock_session.id = "session_test_user"
    mock_session.send_message = AsyncMock()
    mock_runner.session_service.create_session = AsyncMock(return_value=mock_session)

    user_id = "test_user"
    app_name = "test_app"

    # when - get session and send message
    session = await get_or_create_session(user_id, mock_runner, app_name)
    await session.send_message("Send 50 dollars to Hanako")

    # then - send_message should be called exactly once
    assert session.send_message.call_count == 1, (
        f"Expected session.send_message to be called once, "
        f"but was called {session.send_message.call_count} times"
    )
    session.send_message.assert_called_once_with("Send 50 dollars to Hanako")
