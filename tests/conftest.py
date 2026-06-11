"""Pytest configuration and shared fixtures for tests.

This module provides common pytest fixtures that are shared across
unit, integration, and E2E tests.
"""

import base64
import functools
import os
import socket
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, Mock

import pytest
from dotenv import load_dotenv


# Load .env.local for environment variables (e.g., CHUNK_LOGGER_SESSION_ID)
# This ensures consistency across all test frameworks
load_dotenv(".env.local")


from adk_stream_protocol import FrontendToolDelegate  # noqa: E402
from adk_stream_protocol.protocol.id_mapper import IDMapper  # noqa: E402


# ============================================================
# External-dependency gating (requires_api / requires_server)
# ============================================================


@functools.cache
def _gemini_api_key_status() -> tuple[str, str]:
    """Probe the Gemini API once per session to classify the configured key.

    Returns (status, reason). status is one of:
    - "ok": key accepted by the API
    - "missing": GOOGLE_API_KEY is not set
    - "invalid": the API rejected the key (expired, revoked, malformed)
    - "unverifiable": probe could not complete (offline, quota) — tests run

    The probe is a single models-list request (no LLM tokens consumed).
    """
    key = os.environ.get("GOOGLE_API_KEY", "")
    if not key:
        return "missing", "GOOGLE_API_KEY is not set (populate .env.local)"
    request = urllib.request.Request(
        "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1",
        headers={"x-goog-api-key": key},
    )
    try:
        with urllib.request.urlopen(request, timeout=5):
            return "ok", ""
    except urllib.error.HTTPError as error:
        if error.code in (400, 401, 403):
            return "invalid", f"Gemini API rejected GOOGLE_API_KEY (HTTP {error.code})"
        return "unverifiable", f"Gemini API probe failed (HTTP {error.code})"
    except OSError as error:
        return "unverifiable", f"Gemini API unreachable: {error}"


@functools.cache
def _backend_server_reachable() -> bool:
    """Check once per session whether the local backend server is up."""
    port = int(os.environ.get("BACKEND_PORT", "8000"))
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=2):
            return True
    except OSError:
        return False


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    """Auto-mark everything under tests/e2e/requires_server/."""
    for item in items:
        if "requires_server" in item.path.parts:
            item.add_marker(pytest.mark.requires_api)
            item.add_marker(pytest.mark.requires_server)


def pytest_runtest_setup(item: pytest.Item) -> None:
    """Skip (not fail) external-dependency tests when the dependency is absent.

    A failing test must mean broken code; a missing/expired credential or a
    stopped server is an environment condition and reads as a skip reason.
    """
    if item.get_closest_marker("requires_api") is not None:
        status, reason = _gemini_api_key_status()
        if status in ("missing", "invalid"):
            pytest.skip(f"requires a live Gemini API key: {reason}")
    if item.get_closest_marker("requires_server") is not None and not _backend_server_reachable():
        port = int(os.environ.get("BACKEND_PORT", "8000"))
        pytest.skip(f"requires the backend server on localhost:{port} (start with `just server`)")


# ============================================================
# WebSocket Event Fixtures
# ============================================================


@pytest.fixture
def ping_event() -> dict[str, str]:
    """Ping event for latency monitoring."""
    return {
        "type": "ping",
        "version": "1.0",
        "timestamp": "2025-12-13T00:00:00.000Z",
    }


@pytest.fixture
def message_event() -> dict[str, object]:
    """Message event with chat messages."""
    return {
        "type": "message",
        "version": "1.0",
        "data": {
            "messages": [
                {
                    "role": "user",
                    "parts": [{"type": "text", "text": "Hello, AI!"}],
                }
            ]
        },
    }


@pytest.fixture
def interrupt_event() -> dict[str, str]:
    """Interrupt event for user abort."""
    return {
        "type": "interrupt",
        "version": "1.0",
        "reason": "user_abort",
    }


@pytest.fixture
def audio_control_start_event() -> dict[str, str]:
    """Audio control event for start recording."""
    return {
        "type": "audio_control",
        "version": "1.0",
        "action": "start",
    }


@pytest.fixture
def audio_control_stop_event() -> dict[str, str]:
    """Audio control event for stop recording."""
    return {
        "type": "audio_control",
        "version": "1.0",
        "action": "stop",
    }


@pytest.fixture
def audio_chunk_event() -> dict[str, object]:
    """Audio chunk event with PCM data."""
    # Create 4 bytes of PCM data (2 int16 samples)
    pcm_bytes = b"\x00\x01\x02\x03"
    chunk_base64 = base64.b64encode(pcm_bytes).decode("ascii")

    return {
        "type": "audio_chunk",
        "version": "1.0",
        "data": {
            "chunk": chunk_base64,
            "sampleRate": 16000,
            "channels": 1,
            "bitDepth": 16,
        },
    }


@pytest.fixture
def tool_result_event() -> dict[str, object]:
    """Tool result event with tool execution result."""
    return {
        "type": "tool_result",
        "version": "1.0",
        "data": {
            "toolCallId": "call-123",
            "result": {"success": True, "data": "processed"},
        },
    }


# ============================================================
# Mock Object Fixtures (Common across all test types)
# ============================================================


@pytest.fixture
def id_mapper() -> IDMapper:
    """Create fresh ID mapper instance for tests."""
    return IDMapper()


@pytest.fixture
def frontend_delegate(id_mapper: IDMapper) -> FrontendToolDelegate:
    """Create FrontendToolDelegate with ID mapper."""
    return FrontendToolDelegate(id_mapper=id_mapper)


@pytest.fixture
def mock_session() -> Mock:
    """Create a mock ADK session."""
    session = MagicMock()
    session.state = {}
    session.events = []
    return session


@pytest.fixture
def mock_session_service() -> Mock:
    """Create a mock ADK session service."""
    return AsyncMock()


# ============================================================
# Path Fixtures
# ============================================================


@pytest.fixture
def fixture_dir() -> Path:
    """Get E2E fixtures directory (backend JSONL files)."""
    return Path(__file__).parent.parent / "fixtures" / "backend"


@pytest.fixture
def frontend_fixture_dir() -> Path:
    """Get frontend fixtures directory (JSON baseline files)."""
    return Path(__file__).parent.parent / "fixtures" / "frontend"
