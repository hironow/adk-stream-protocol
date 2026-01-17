"""
ADK Integration Layer - ADK session management and compatibility.

This subpackage handles:
- Session storage and lifecycle management
- Conversation history synchronization with ADK sessions
- ADK-specific compatibility functions

Components:
- SessionStore: Central session storage class
- get_or_create_session: Session factory with connection-based isolation
- sync_conversation_history_to_session: Message history synchronization
- clear_sessions: Session cleanup for testing
"""

from .adk_compat import (
    Event,
    SessionStore,
    _session_store,
    clear_sessions,
    get_or_create_session,
    sync_conversation_history_to_session,
)


__all__ = [
    # Re-export from google.adk
    "Event",
    # Session Management
    "SessionStore",
    # Internal state (for testing)
    "_session_store",
    "clear_sessions",
    "get_or_create_session",
    "sync_conversation_history_to_session",
]
