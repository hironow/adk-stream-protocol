"""
ADK (Agent Development Kit) Compatibility Functions

This module contains ADK-specific functions for managing sessions,
conversation history synchronization, and other ADK-related operations.
These functions are used by both ADK SSE and ADK BIDI modes.
"""

from typing import TYPE_CHECKING, Any

from google.adk.events import Event
from loguru import logger


if TYPE_CHECKING:
    pass

# Session storage (shared across all ADK modes)
_sessions: dict[str, Any] = {}


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
    # Generate session_id based on whether connection_signature is provided
    if connection_signature:
        # Each WebSocket connection gets unique session to prevent race conditions
        session_id = f"session_{user_id}_{connection_signature}"
    else:
        # Traditional session for SSE mode (one session per user+app)
        session_id = f"session_{user_id}_{app_name}"

    if session_id not in _sessions:
        logger.info(
            f"Creating new session for user: {user_id} with app: {app_name}"
            + (f", connection: {connection_signature}" if connection_signature else "")
        )
        # Reason: ADK SDK session service exception handling - retry logic for existing sessions
        try:  # nosemgrep: forbid-try-except
            session = await agent_runner.session_service.create_session(
                app_name=app_name,
                user_id=user_id,
                session_id=session_id,
            )
            _sessions[session_id] = session
        except Exception as e:
            # If session already exists in ADK, retrieve it from session_service
            # This can happen when clear_sessions() clears _sessions dict but ADK sessions persist
            logger.warning(
                f"Session {session_id} already exists in ADK session_service, retrieving existing session. "
                f"Error: {e}"
            )
            # Reason: ADK SDK session service exception handling - fallback to get_session
            try:  # nosemgrep: forbid-try-except
                session = await agent_runner.session_service.get_session(
                    app_name=app_name,
                    user_id=user_id,
                    session_id=session_id,
                )
                _sessions[session_id] = session
            except Exception as get_error:
                logger.error(f"Failed to retrieve existing session {session_id}: {get_error}")
                raise

    return _sessions[session_id]


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
    # We track synced message count in session state to prevent duplicates
    synced_count = session.state.get("synced_message_count", 0)

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

        # Update the synced count in session state
        session.state["synced_message_count"] = len(messages_to_sync)
        logger.info(f"[{current_mode}] Updated synced_message_count to {len(messages_to_sync)}")

        return len(new_messages_to_sync)

    return 0


def clear_sessions() -> None:
    """
    Clear all sessions. Useful for testing or cleanup.
    """
    global _sessions
    _sessions.clear()
    logger.info("Cleared all ADK sessions")


def is_function_call_requiring_confirmation(  # noqa: PLR0911 - Multiple returns needed for dict/ADK object format handling
    event: dict[str, Any] | Any,
    confirmation_tools: list[str],
) -> bool:
    """
    Check if event is a FunctionCall requiring confirmation.

    Works with both dict (injected events) and Event object (ADK events) representations.

    Args:
        event: ADK event dict or Event object
        confirmation_tools: List of tool names requiring confirmation

    Returns:
        True if FunctionCall with confirmation required
    """
    confirmation_tools_set = set(confirmation_tools)

    # Handle dict (injected confirmation events from our code)
    if isinstance(event, dict):
        if event.get("type") != "function_call":
            return False

        # Check metadata or tool name for confirmation requirement
        actions = event.get("actions", {})
        if len(actions.get("requested_tool_confirmations", [])) > 0:
            return True

        function_call = event.get("function_call", {})
        tool_name = function_call.get("name", "")
        return tool_name in confirmation_tools_set

    # Handle ADK Event object
    # ADK Events don't have a "type" attribute - they have content.parts with function_call
    if not (
        hasattr(event, "content")
        and event.content
        and hasattr(event.content, "parts")
        and event.content.parts
    ):
        return False

    # Check each part for function_call
    for part in event.content.parts:
        if not (hasattr(part, "function_call") and part.function_call):
            continue

        # Check metadata for requested_tool_confirmations (SSE mode)
        actions = getattr(event, "actions", None)
        if actions and len(getattr(actions, "requested_tool_confirmations", [])) > 0:
            logger.debug(
                f"[Confirmation] Found confirmation in metadata: {part.function_call.name}"
            )
            return True

        # Fallback for BIDI mode: Check tool name directly
        # ADK Live API doesn't set requested_tool_confirmations even with require_confirmation=True
        if part.function_call.name in confirmation_tools_set:
            logger.debug(
                f"[Confirmation] Found confirmation by tool name: {part.function_call.name}"
            )
            return True

    return False


def extract_function_call_from_event(event: dict[str, Any] | Any) -> Any | None:
    """
    Extract function_call from either dict or ADK Event object.

    Args:
        event: ADK event dict or Event object

    Returns:
        FunctionCall object or dict, or None if not found
    """
    if isinstance(event, dict):
        return event.get("function_call")

    # ADK Event object - check content.parts for function_call
    if not hasattr(event, "content") or event.content is None:
        return None

    if not hasattr(event.content, "parts") or not event.content.parts:
        return None

    # Find first part with function_call
    for part in event.content.parts:
        if hasattr(part, "function_call") and part.function_call:
            return part.function_call

    return None
