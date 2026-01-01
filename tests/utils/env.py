"""Environment variable helpers for pytest tests.

This module provides utilities for managing environment variables in tests,
including context managers for temporary environment changes.
"""

import os
from contextlib import contextmanager
from typing import Any, Iterator


def get_chunk_logger_enabled(default: bool = False) -> bool:
    """Get CHUNK_LOGGER_ENABLED environment variable as boolean.

    Args:
        default: Default value if not set

    Returns:
        True if env var is "true" (case-insensitive), False otherwise
    """
    value = os.environ.get("CHUNK_LOGGER_ENABLED", "").lower()
    if not value:
        return default
    return value == "true"


def get_chunk_logger_output_dir(default: str = "./chunk_logs") -> str:
    """Get CHUNK_LOGGER_OUTPUT_DIR environment variable.

    Args:
        default: Default output directory

    Returns:
        Output directory from env or default
    """
    return os.environ.get("CHUNK_LOGGER_OUTPUT_DIR", default)


def get_chunk_logger_session_id(default: str | None = None) -> str | None:
    """Get CHUNK_LOGGER_SESSION_ID environment variable.

    Args:
        default: Default session ID

    Returns:
        Session ID from env or default
    """
    return os.environ.get("CHUNK_LOGGER_SESSION_ID", default)


def get_e2e_chunk_player_mode(default: bool = False) -> bool:
    """Get E2E_CHUNK_PLAYER_MODE environment variable as boolean.

    Args:
        default: Default value if not set

    Returns:
        True if env var is "true" (case-insensitive), False otherwise
    """
    value = os.environ.get("E2E_CHUNK_PLAYER_MODE", "").lower()
    if not value:
        return default
    return value == "true"


def get_e2e_chunk_player_fixture(default: str | None = None) -> str | None:
    """Get E2E_CHUNK_PLAYER_FIXTURE environment variable.

    Args:
        default: Default fixture path

    Returns:
        Fixture path from env or default
    """
    return os.environ.get("E2E_CHUNK_PLAYER_FIXTURE", default)


def get_e2e_refresh_fixture(default: bool = False) -> bool:
    """Get E2E_REFRESH_FIXTURE environment variable as boolean.

    Args:
        default: Default value if not set

    Returns:
        True if env var is "true" (case-insensitive), False otherwise
    """
    value = os.environ.get("E2E_REFRESH_FIXTURE", "").lower()
    if not value:
        return default
    return value == "true"


@contextmanager
def temporary_env(**env_vars: Any) -> Iterator[None]:
    """Context manager to temporarily set environment variables.

    Saves current environment, sets new values, and restores on exit.
    Useful for tests that need to modify environment without affecting other tests.

    Args:
        **env_vars: Environment variables to set (key=value pairs)

    Example:
        with temporary_env(CHUNK_LOGGER_ENABLED="true", CHUNK_LOGGER_SESSION_ID="test"):
            # Environment variables are set
            assert os.environ["CHUNK_LOGGER_ENABLED"] == "true"
        # Environment is restored
    """
    original_env = os.environ.copy()
    try:
        for key, value in env_vars.items():
            os.environ[key] = str(value)
        yield
    finally:
        os.environ.clear()
        os.environ.update(original_env)


@contextmanager
def clean_env(*keys: str) -> Iterator[None]:
    """Context manager to temporarily remove specific environment variables.

    Args:
        *keys: Environment variable keys to remove

    Example:
        with clean_env("CHUNK_LOGGER_ENABLED", "CHUNK_LOGGER_SESSION_ID"):
            # These env vars are removed
            assert "CHUNK_LOGGER_ENABLED" not in os.environ
        # Environment is restored
    """
    original_values = {key: os.environ.get(key) for key in keys}
    try:
        for key in keys:
            os.environ.pop(key, None)
        yield
    finally:
        for key, value in original_values.items():
            if value is not None:
                os.environ[key] = value
            else:
                os.environ.pop(key, None)
