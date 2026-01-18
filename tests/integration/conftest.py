"""Pytest configuration for integration tests.

This module provides fixtures specific to integration tests,
including session cache cleanup to prevent test interference.
"""

import pytest

from adk_stream_protocol.adk.session import _session_store


@pytest.fixture(autouse=True)
def clear_session_cache():
    """Clear module-level session caches before and after each test.

    This prevents test interference caused by shared session state
    across test runs. The fixture is applied automatically to all
    integration tests.
    """
    # Clear before test
    _session_store.clear_all()

    yield

    # Clear after test
    _session_store.clear_all()
