"""
Frontend Tool Registry

Global registry for FrontendToolDelegate instances.

Architecture:
    - FrontendToolDelegate is a non-serializable Python object (contains asyncio.Future)
    - Cannot be stored in ADK session.state (only supports serializable data)
    - Need global registry keyed by session_id to make delegates available to tools

Pattern:
    1. HTTP request handler creates FrontendToolDelegate instance
    2. Register delegate using session.id as key
    3. Tools access delegate via tool_context.session.id lookup
    4. Session.id persists across invocation_id continuations (multi-turn)

Lifecycle:
    - Register: When HTTP request starts (/stream endpoint)
    - Lookup: When tool executes (get_location, change_bgm)
    - Cleanup: After session ends or timeout (not yet implemented)
"""

from typing import TYPE_CHECKING

from loguru import logger


if TYPE_CHECKING:
    from .frontend_tool_service import FrontendToolDelegate


# Global registry: session_id → FrontendToolDelegate
_REGISTRY: dict[str, "FrontendToolDelegate"] = {}


def register_delegate(session_id: str, delegate: "FrontendToolDelegate") -> None:
    """
    Register a FrontendToolDelegate for a session.

    Args:
        session_id: ADK session ID (from session.id)
        delegate: FrontendToolDelegate instance for this session
    """
    _REGISTRY[session_id] = delegate
    logger.info(f"[FrontendToolRegistry] Registered delegate for session_id={session_id}")


def get_delegate(session_id: str) -> "FrontendToolDelegate | None":
    """
    Lookup FrontendToolDelegate for a session.

    Args:
        session_id: ADK session ID (from tool_context.session.id)

    Returns:
        FrontendToolDelegate instance, or None if not found
    """
    delegate = _REGISTRY.get(session_id)
    if delegate:
        logger.debug(f"[FrontendToolRegistry] Found delegate for session_id={session_id}")
    else:
        logger.warning(
            f"[FrontendToolRegistry] No delegate found for session_id={session_id}. "
            f"Available sessions: {list(_REGISTRY.keys())}"
        )
    return delegate


def unregister_delegate(session_id: str) -> None:
    """
    Remove FrontendToolDelegate for a session.

    Args:
        session_id: ADK session ID to remove
    """
    if session_id in _REGISTRY:
        del _REGISTRY[session_id]
        logger.info(f"[FrontendToolRegistry] Unregistered delegate for session_id={session_id}")
    else:
        logger.warning(
            f"[FrontendToolRegistry] No delegate to unregister for session_id={session_id}"
        )


def get_all_session_ids() -> list[str]:
    """
    Get list of all registered session IDs (for debugging).

    Returns:
        List of session IDs with registered delegates
    """
    return list(_REGISTRY.keys())
