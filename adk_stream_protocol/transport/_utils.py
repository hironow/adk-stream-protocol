"""
Transport layer utility functions.

Shared utilities for BidiEventReceiver and BidiEventSender.
"""

from typing import Any

from google.adk.sessions import Session
from loguru import logger


def log_implementation_gap(context: str, **details: Any) -> None:
    """
    Log implementation gap detection with standard format.

    Use this when an unexpected code path is reached, indicating
    a gap between expected and actual behavior.

    Args:
        context: Brief description of what went wrong
        **details: Additional key-value pairs to log
    """
    logger.error("[BIDI] ========== IMPLEMENTATION GAP DETECTED ==========")
    logger.error(f"[BIDI] {context}")
    for key, value in details.items():
        logger.error(f"[BIDI] {key}: {value}")


def ensure_session_state_key(session: Session, key: str, default: Any) -> None:
    """
    Ensure a key exists in session.state, initializing with default if absent.

    This is a common pattern for initializing session state dicts that are
    shared between BidiEventReceiver and BidiEventSender.

    Args:
        session: ADK Session object
        key: Key to ensure exists in session.state
        default: Default value to set if key doesn't exist
    """
    if key not in session.state:
        session.state[key] = default
