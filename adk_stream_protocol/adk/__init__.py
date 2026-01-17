"""
ADK Integration Layer - ADK session management and compatibility.

This subpackage handles:
- Session storage and lifecycle management
- Conversation history synchronization with ADK sessions
- ADK-specific compatibility functions

Components:
- get_or_create_session: Session factory with connection-based isolation
- sync_conversation_history_to_session: Message history synchronization
- clear_sessions: Session cleanup for testing
"""

from .adk_compat import (
    Event,
    _sessions,
    _synced_message_counts,
    clear_sessions,
    get_or_create_session,
    sync_conversation_history_to_session,
)

__all__ = [
    # Session Management
    "get_or_create_session",
    "clear_sessions",
    "sync_conversation_history_to_session",
    # Re-export from google.adk
    "Event",
    # Internal state (for testing)
    "_sessions",
    "_synced_message_counts",
]
