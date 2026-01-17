"""
ADK (Agent Development Kit) Compatibility Functions

This module contains ADK-specific functions for managing sessions,
conversation history synchronization, and other ADK-related operations.
These functions are used by both ADK SSE and ADK BIDI modes.
"""

from typing import Any

from google.adk.events import Event
from loguru import logger


class SessionStore:
    """
    Central store for ADK session management.

    Encapsulates session storage and message sync tracking that were
    previously module-level globals. This improves testability and
    makes state management more explicit.

    Thread-safety: This implementation is NOT thread-safe. It assumes
    single-threaded async operation within one event loop.
    """

    def __init__(self) -> None:
        """Initialize empty session store."""
        # Session storage (shared across all ADK modes)
        self._sessions: dict[str, Any] = {}
        # Synced message count tracking (persists across HTTP requests)
        # Key: session_id, Value: number of messages synced
        # NOTE: session.state dict does NOT persist across HTTP requests in ADK,
        # so we maintain this separately to prevent duplicate history syncing
        self._synced_message_counts: dict[str, int] = {}

    def get_session(self, session_id: str) -> Any | None:
        """Get session by ID, or None if not found."""
        return self._sessions.get(session_id)

    def set_session(self, session_id: str, session: Any) -> None:
        """Store session by ID."""
        self._sessions[session_id] = session

    def has_session(self, session_id: str) -> bool:
        """Check if session exists."""
        return session_id in self._sessions

    def get_synced_count(self, session_id: str) -> int:
        """Get number of messages synced for a session."""
        return self._synced_message_counts.get(session_id, 0)

    def set_synced_count(self, session_id: str, count: int) -> None:
        """Set synced message count for a session."""
        self._synced_message_counts[session_id] = count

    def clear_all(self) -> None:
        """Clear all sessions and synced message counts."""
        self._sessions.clear()
        self._synced_message_counts.clear()
        logger.info("Cleared all ADK sessions and synced message counts")


# Module-level singleton instance for backward compatibility
_session_store = SessionStore()


def _build_session_id(
    user_id: str, app_name: str, connection_signature: str | None
) -> str:
    """Build session ID based on connection signature presence."""
    if connection_signature:
        return f"session_{user_id}_{connection_signature}"
    return f"session_{user_id}_{app_name}"


async def _create_adk_session(
    agent_runner: Any,
    app_name: str,
    user_id: str,
    session_id: str,
) -> Any:
    """Create or retrieve ADK session with fallback.

    First attempts to create a new session. If it already exists in ADK
    (e.g., after clear_sessions() which only clears our cache), falls back
    to retrieving the existing session.
    """
    try:  # nosemgrep: forbid-try-except - ADK session service retry logic
        return await agent_runner.session_service.create_session(
            app_name=app_name,
            user_id=user_id,
            session_id=session_id,
        )
    except Exception as e:
        logger.warning(
            f"Session {session_id} already exists in ADK, retrieving. Error: {e!s}"
        )
        try:  # nosemgrep: forbid-try-except - fallback to get_session
            return await agent_runner.session_service.get_session(
                app_name=app_name,
                user_id=user_id,
                session_id=session_id,
            )
        except Exception as get_error:
            logger.error(f"Failed to retrieve session {session_id}: {get_error}")
            raise


async def get_or_create_session(
    user_id: str,
    agent_runner: Any,  # InMemoryRunner type
    app_name: str = "agents",
    connection_signature: str | None = None,
) -> Any:
    """
    Get or create a session for a user with specific agent runner.

    ADK Design Note: Session = Connection
    In ADK's architecture, each WebSocket connection should have its own session
    to avoid race conditions when run_live() is called concurrently. While ADK
    treats 'session' and 'connection' as equivalent concepts, we use the term
    'connection_signature' to emphasize this is not an operational ID but rather
    a unique identifier to distinguish sessions for the same user.

    Reference: https://github.com/google/adk-python/discussions/2784

    Args:
        user_id: User identifier
        agent_runner: ADK agent runner instance
        app_name: Application name (default: "agents")
        connection_signature: Optional signature to create unique session per connection.
                            Should be UUID v4 to prevent collisions.

    Returns:
        Session object

    Usage:
        # Traditional session (backward compatible, for SSE mode)
        session = await get_or_create_session(user_id, runner, app_name)

        # Connection-specific session (for WebSocket BIDI mode)
        connection_signature = str(uuid.uuid4())
        session = await get_or_create_session(user_id, runner, app_name, connection_signature)
    """
    session_id = _build_session_id(user_id, app_name, connection_signature)

    # Early return if session already exists in cache
    if _session_store.has_session(session_id):
        return _session_store.get_session(session_id)

    # Create new session
    logger.info(
        f"Creating new session for user: {user_id} with app: {app_name}"
        + (f", connection: {connection_signature}" if connection_signature else "")
    )
    session = await _create_adk_session(agent_runner, app_name, user_id, session_id)
    _session_store.set_session(session_id, session)
    return session


async def sync_conversation_history_to_session(
    session: Any,
    session_service: Any,
    messages: list,
    current_mode: str = "ADK",
) -> int:
    """
    Synchronize frontend message history with ADK session events.

    This function addresses the issue where ADK sessions don't have conversation
    history when switching from other modes (e.g., Gemini Direct -> ADK SSE/BIDI).

    The function:
    1. Checks existing session events to avoid duplicates
    2. Tracks synced messages using session state
    3. Only syncs new messages that haven't been added yet
    4. Creates proper ADK Events for historical messages

    Args:
        session: ADK session object
        session_service: ADK session service for managing events
        messages: List of ChatMessage objects from frontend
        current_mode: Current backend mode ("SSE" or "BIDI")

    Returns:
        Number of messages synced

    Note:
        - Messages list includes both user and assistant messages
        - The last message in the list is typically the new message
        - This function syncs all except the last message
    """
    # Frontend sends all messages including the new one
    # We need to sync all except the last message (which will be sent as new_message)
    messages_to_sync = messages[:-1] if len(messages) > 1 else []

    # Edge case: Check if we need to sync (avoid duplicates)
    # We track synced message count in persistent dict (not session.state, which resets)
    synced_count = _session_store.get_synced_count(session.id)

    # Calculate how many new messages need syncing
    new_messages_to_sync = (
        messages_to_sync[synced_count:] if synced_count < len(messages_to_sync) else []
    )

    # If there are new messages to sync
    if new_messages_to_sync:
        logger.info(
            f"[{current_mode}] Syncing {len(new_messages_to_sync)} new messages "
            f"(already synced: {synced_count})"
        )

        # Add only the new messages as events
        for i, msg in enumerate(new_messages_to_sync):
            msg_content = msg.to_adk_content()

            # Create unique invocation ID based on absolute position
            event_index = synced_count + i

            # Create event for this historical message
            event = Event(
                invocation_id=f"sync_{event_index}_{msg_content.role}",
                author=msg_content.role,
                content=msg_content,
            )

            # Append to session via session service
            await session_service.append_event(session=session, event=event)

            logger.info(f"[{current_mode}] Synced message {event_index}: role={msg_content.role}")

        # Update the synced count in persistent dict (persists across HTTP requests)
        _session_store.set_synced_count(session.id, len(messages_to_sync))
        logger.info(
            f"[{current_mode}] Updated synced_message_count to {len(messages_to_sync)} "
            f"for session {session.id}"
        )

        return len(new_messages_to_sync)

    return 0


def clear_sessions() -> None:
    """
    Clear all sessions and synced message counts. Useful for testing or cleanup.
    """
    _session_store.clear_all()
