"""Pytest configuration for integration tests.

This module provides fixtures specific to integration tests,
including session cache cleanup to prevent test interference.
"""

import pytest

from adk_stream_protocol.adk_compat import _sessions, _synced_message_counts


@pytest.fixture(autouse=True)
def clear_session_cache():
    """Clear module-level session caches before and after each test.

    This prevents test interference caused by shared session state
    across test runs. The fixture is applied automatically to all
    integration tests.
    """
    # Clear before test
    _sessions.clear()
    _synced_message_counts.clear()

    yield

    # Clear after test
    _sessions.clear()
    _synced_message_counts.clear()
