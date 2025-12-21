"""Pytest configuration and shared fixtures for tests.

This module provides common pytest fixtures that are shared across
unit, integration, and E2E tests.
"""

import base64

import pytest


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
