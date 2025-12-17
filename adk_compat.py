"""
ADK (Agent Development Kit) Compatibility Functions

This module contains ADK-specific functions for managing sessions,
conversation history synchronization, and other ADK-related operations.
These functions are used by both ADK SSE and ADK BIDI modes.
"""

from typing import Any

from google.adk.events import Event
from loguru import logger

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
        try:
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
            try:
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


async def prepare_session_for_mode_switch(
    session: Any,
    session_service: Any,
    messages: list,
    from_mode: str,
    to_mode: str,
) -> None:
    """
    Prepare an ADK session when switching between modes.

    This function ensures conversation continuity when switching between:
    - Gemini Direct -> ADK SSE
    - Gemini Direct -> ADK BIDI
    - ADK SSE -> ADK BIDI
    - ADK BIDI -> ADK SSE

    Args:
        session: ADK session object
        session_service: ADK session service
        messages: Full message history from frontend
        from_mode: Previous mode ("gemini", "adk-sse", "adk-bidi")
        to_mode: New mode ("adk-sse", "adk-bidi")
    """
    # If switching from Gemini Direct to any ADK mode, we need full sync
    if from_mode == "gemini" and to_mode.startswith("adk"):
        logger.info(f"Mode switch detected: {from_mode} -> {to_mode}, performing full history sync")

        # Clear the synced count to force full sync
        session.state["synced_message_count"] = 0

        # Sync the conversation history
        synced = await sync_conversation_history_to_session(
            session=session,
            session_service=session_service,
            messages=messages,
            current_mode=to_mode.upper().replace("-", "_"),
        )

        logger.info(f"Mode switch sync complete: {synced} messages synced")

    # If switching between ADK modes, history should already be there
    elif from_mode.startswith("adk") and to_mode.startswith("adk"):
        logger.info(f"Switching between ADK modes: {from_mode} -> {to_mode}, history preserved")

    # Track the current mode in session state
    session.state["current_mode"] = to_mode


def clear_sessions() -> None:
    """
    Clear all sessions. Useful for testing or cleanup.
    """
    global _sessions
    _sessions.clear()
    logger.info("Cleared all ADK sessions")


def get_session_count() -> int:
    """
    Get the current number of active sessions.

    Returns:
        Number of active sessions
    """
    return len(_sessions)


def detect_mode_switch(session: Any, current_mode: str) -> tuple[bool, str]:
    """
    Detect if a mode switch has occurred.

    Args:
        session: ADK session object
        current_mode: Current backend mode

    Returns:
        Tuple of (mode_switched: bool, previous_mode: str)
    """
    previous_mode = session.state.get("current_mode", None)

    if previous_mode is None:
        # First time using this session
        return False, ""

    if previous_mode != current_mode:
        # Mode has changed
        return True, previous_mode

    return False, previous_mode


# ========== BIDI Confirmation Injection ==========
# Functions to unify SSE and BIDI tool confirmation flows


def inject_confirmation_for_bidi(
    event: dict[str, Any] | Any,  # dict or Event object
    is_bidi: bool,
) -> Any:  # Iterator[dict[str, Any] | Event]
    """
    Inject adk_request_confirmation events for BIDI mode to unify with SSE flow.

    In SSE mode, ADK automatically generates adk_request_confirmation FunctionCall events
    when a tool has require_confirmation=True. In BIDI mode, ADK does NOT generate these
    events (known limitation). This function manually injects them for BIDI mode to provide
    a consistent experience across both modes.

    Flow:
    - SSE: ADK generates → we pass through (yield original only)
    - BIDI: ADK doesn't generate → we inject (yield original + 2 confirmation events)

    Args:
        event: ADK event dict or Event object (FunctionCall, FunctionResponse, etc.)
        is_bidi: True if BIDI mode, False if SSE mode

    Yields:
        Original event, plus injected confirmation events if BIDI + confirmation required

    Reference:
        - BUG-ADK-BIDI-TOOL-CONFIRMATION.md: Issue #1
        - SSE mode events: backend-sse-event.jsonl seq 88-89
    """
    # Always yield original event first
    yield event

    # SSE mode: ADK handles confirmation, nothing to inject
    if not is_bidi:
        return

    # BIDI mode: Check if this FunctionCall requires confirmation
    if not _is_function_call_requiring_confirmation(event):
        return

    # Inject confirmation events
    yield generate_confirmation_tool_input_start(event)
    yield generate_confirmation_tool_input_available(event)


def _is_function_call_requiring_confirmation(event: dict[str, Any] | Any) -> bool:
    """
    Check if event is a FunctionCall requiring confirmation.

    Works with both dict and Event object representations.

    Args:
        event: ADK event dict or Event object

    Returns:
        True if FunctionCall with confirmation required
    """
    # Handle both dict and Event object
    event_type = event.get("type") if isinstance(event, dict) else getattr(event, "type", None)

    if event_type != "function_call":
        return False

    # Check metadata for requested_tool_confirmations
    if isinstance(event, dict):
        actions = event.get("actions", {})
        confirmations = actions.get("requested_tool_confirmations", [])
    else:
        actions = getattr(event, "actions", None)
        confirmations = actions.requested_tool_confirmations if actions else []

    return len(confirmations) > 0


def generate_confirmation_tool_input_start(event: dict[str, Any] | Any) -> dict[str, Any]:
    """
    Generate tool-input-start event for adk_request_confirmation.

    Args:
        event: Original FunctionCall event (dict or Event object)

    Returns:
        tool-input-start event dict
    """
    # Extract function_call from either dict or Event object
    if isinstance(event, dict):
        function_call = event.get("function_call", {})
        tool_call_id = function_call.get("id", "unknown")
    else:
        function_call = getattr(event, "function_call", None)
        tool_call_id = function_call.id if function_call else "unknown"

    return {
        "type": "tool-input-start",
        "toolCallId": f"confirmation-{tool_call_id}",
        "toolName": "adk_request_confirmation",
    }


def generate_confirmation_tool_input_available(event: dict[str, Any] | Any) -> dict[str, Any]:
    """
    Generate tool-input-available event for adk_request_confirmation.

    Args:
        event: Original FunctionCall event (dict or Event object)

    Returns:
        tool-input-available event dict
    """
    # Extract function_call from either dict or Event object
    if isinstance(event, dict):
        function_call = event.get("function_call", {})
        fc_id = function_call.get("id")
        fc_name = function_call.get("name")
        fc_args = function_call.get("args", {})
    else:
        function_call = getattr(event, "function_call", None)
        fc_id = function_call.id if function_call else None
        fc_name = function_call.name if function_call else None
        fc_args = function_call.args if function_call else {}

    return {
        "type": "tool-input-available",
        "toolCallId": f"confirmation-{fc_id or 'unknown'}",
        "toolName": "adk_request_confirmation",
        "input": {
            "originalFunctionCall": {
                "id": fc_id,
                "name": fc_name,
                "args": fc_args,
            },
            "toolConfirmation": {
                "confirmed": False,  # Initial state
            },
        },
    }
