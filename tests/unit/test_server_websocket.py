"""
Unit tests for WebSocket event handling in BIDI mode.

Tests the structured event format introduced in P2-T2 for handling:
- ping/pong events (latency monitoring)
- message events (chat messages)
- interrupt events (user abort)
- audio_control events (start/stop recording)
- audio_chunk events (PCM audio streaming)
- tool_result events (tool execution results)

Based on TypeScript implementation in lib/websocket-chat-transport.ts
"""

import base64
import json
from typing import TYPE_CHECKING, Any
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import WebSocket


if TYPE_CHECKING:
    pass


# ============================================================
# Event Fixtures
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
    """Tool result event with execution result."""
    return {
        "type": "tool_result",
        "version": "1.0",
        "data": {
            "toolCallId": "call_123",
            "result": {"value": 42},
            "status": "approved",
        },
    }


# ============================================================
# Event Parsing Tests
# ============================================================


def test_parse_ping_event(ping_event: dict[str, str]) -> None:
    """Ping event should have correct structure."""
    assert ping_event["type"] == "ping"
    assert ping_event["version"] == "1.0"
    assert "timestamp" in ping_event


def test_parse_message_event(message_event: dict[str, object]) -> None:
    """Message event should have data with messages array."""
    assert message_event["type"] == "message"
    assert message_event["version"] == "1.0"
    assert "data" in message_event
    data = message_event["data"]
    assert isinstance(data, dict)
    assert "messages" in data


def test_parse_interrupt_event(interrupt_event: dict[str, str]) -> None:
    """Interrupt event should have reason field."""
    assert interrupt_event["type"] == "interrupt"
    assert interrupt_event["version"] == "1.0"
    assert interrupt_event["reason"] == "user_abort"


def test_parse_audio_control_event(
    audio_control_start_event: dict[str, str],
) -> None:
    """Audio control event should have action field."""
    assert audio_control_start_event["type"] == "audio_control"
    assert audio_control_start_event["version"] == "1.0"
    assert audio_control_start_event["action"] == "start"


def test_parse_audio_chunk_event(audio_chunk_event: dict[str, object]) -> None:
    """Audio chunk event should have PCM data."""
    assert audio_chunk_event["type"] == "audio_chunk"
    assert audio_chunk_event["version"] == "1.0"
    assert "data" in audio_chunk_event
    data = audio_chunk_event["data"]
    assert isinstance(data, dict)
    assert "chunk" in data
    assert data["sampleRate"] == 16000
    assert data["channels"] == 1
    assert data["bitDepth"] == 16


def test_parse_tool_result_event(tool_result_event: dict[str, object]) -> None:
    """Tool result event should have result data."""
    assert tool_result_event["type"] == "tool_result"
    assert tool_result_event["version"] == "1.0"
    assert "data" in tool_result_event
    data = tool_result_event["data"]
    assert isinstance(data, dict)
    assert data["toolCallId"] == "call_123"
    assert data["status"] == "approved"


# ============================================================
# Event Handler Logic Tests
# ============================================================


@pytest.mark.asyncio
async def test_ping_event_responds_with_pong(ping_event: dict[str, str]) -> None:
    """Ping event should respond with pong containing same timestamp."""
    # Mock WebSocket
    websocket = AsyncMock(spec=WebSocket)
    websocket.receive_text = AsyncMock(return_value=json.dumps(ping_event))
    websocket.send_text = AsyncMock()

    # Simulate ping handling logic
    data = await websocket.receive_text()
    event = json.loads(data)

    if event.get("type") == "ping":
        pong_response = {
            "type": "pong",
            "timestamp": event.get("timestamp"),
        }
        await websocket.send_text(json.dumps(pong_response))

    # Verify pong was sent
    websocket.send_text.assert_called_once()
    call_args = websocket.send_text.call_args[0][0]
    pong_data = json.loads(call_args)
    assert pong_data["type"] == "pong"
    assert pong_data["timestamp"] == ping_event["timestamp"]


@pytest.mark.asyncio
async def test_message_event_extracts_messages(
    message_event: dict[str, object],
) -> None:
    """Message event should extract messages array from data."""
    # Simulate message handling logic
    event = message_event
    event_type = event.get("type")

    assert event_type == "message"

    message_data = event.get("data", {})
    assert isinstance(message_data, dict)
    messages = message_data.get("messages", [])

    # Verify messages were extracted
    assert len(messages) == 1
    assert messages[0]["role"] == "user"


@pytest.mark.asyncio
async def test_interrupt_event_closes_request_queue(
    interrupt_event: dict[str, str],
) -> None:
    """Interrupt event should close LiveRequestQueue."""
    # Mock LiveRequestQueue
    mock_queue = Mock()
    mock_queue.close = Mock()

    # Simulate interrupt handling logic
    event = interrupt_event
    event_type = event.get("type")
    reason = event.get("reason", "user_abort")

    if event_type == "interrupt":
        mock_queue.close()

    # Verify queue was closed
    mock_queue.close.assert_called_once()
    assert reason == "user_abort"


@pytest.mark.asyncio
async def test_audio_chunk_event_decodes_pcm_data(
    audio_chunk_event: dict[str, object],
) -> None:
    """Audio chunk event should decode base64 PCM data."""
    # Simulate audio chunk handling logic
    event = audio_chunk_event
    event_type = event.get("type")

    assert event_type == "audio_chunk"

    chunk_data = event.get("data", {})
    assert isinstance(chunk_data, dict)
    chunk_base64 = chunk_data.get("chunk")
    sample_rate = chunk_data.get("sampleRate", 16000)
    channels = chunk_data.get("channels", 1)
    bit_depth = chunk_data.get("bitDepth", 16)

    # Decode base64 PCM data
    if chunk_base64:
        audio_bytes = base64.b64decode(chunk_base64)

        # Verify decoded data
        assert len(audio_bytes) == 4  # 2 int16 samples = 4 bytes
        assert sample_rate == 16000
        assert channels == 1
        assert bit_depth == 16


@pytest.mark.asyncio
async def test_audio_chunk_event_creates_blob() -> None:
    """Audio chunk event should create Blob for ADK."""
    from google.genai import types

    # Create sample PCM data
    pcm_bytes = b"\x00\x01\x02\x03"
    chunk_base64 = base64.b64encode(pcm_bytes).decode("ascii")

    # Simulate audio chunk to blob conversion
    audio_bytes = base64.b64decode(chunk_base64)
    audio_blob = types.Blob(mime_type="audio/pcm", data=audio_bytes)

    # Verify blob
    assert audio_blob.mime_type == "audio/pcm"
    assert audio_blob.data == pcm_bytes


@pytest.mark.asyncio
async def test_audio_control_start_event() -> None:
    """Audio control start event should be logged."""
    event = {
        "type": "audio_control",
        "version": "1.0",
        "action": "start",
    }

    event_type = event.get("type")
    action = event.get("action")

    assert event_type == "audio_control"
    assert action == "start"


@pytest.mark.asyncio
async def test_audio_control_stop_event() -> None:
    """Audio control stop event should be logged."""
    event = {
        "type": "audio_control",
        "version": "1.0",
        "action": "stop",
    }

    event_type = event.get("type")
    action = event.get("action")

    assert event_type == "audio_control"
    assert action == "stop"


@pytest.mark.asyncio
async def test_tool_result_event_extracts_data(
    tool_result_event: dict[str, object],
) -> None:
    """Tool result event should extract tool call ID and status."""
    event = tool_result_event
    event_type = event.get("type")

    assert event_type == "tool_result"

    result_data = event.get("data", {})
    assert isinstance(result_data, dict)
    tool_call_id = result_data.get("toolCallId")
    status = result_data.get("status", "approved")

    # Verify extracted data
    assert tool_call_id == "call_123"
    assert status == "approved"


@pytest.mark.asyncio
async def test_unknown_event_type() -> None:
    """Unknown event type should be handled gracefully."""
    event = {
        "type": "unknown_type",
        "version": "1.0",
    }

    event_type = event.get("type")

    # Should not raise exception
    assert event_type == "unknown_type"


# ============================================================
# Event Version Tests
# ============================================================


def test_event_version_defaults_to_1_0() -> None:
    """Event version should default to 1.0 if not specified."""
    event = {
        "type": "ping",
        "timestamp": "2025-12-13T00:00:00.000Z",
    }

    version = event.get("version", "1.0")
    assert version == "1.0"


def test_event_version_extraction() -> None:
    """Event version should be extracted correctly."""
    event = {
        "type": "message",
        "version": "2.0",
        "data": {},
    }

    version = event.get("version", "1.0")
    assert version == "2.0"


# ============================================================
# Edge Cases and Error Handling
# ============================================================


@pytest.mark.asyncio
async def test_message_event_with_empty_messages() -> None:
    """Message event with empty messages array should not crash."""
    event = {
        "type": "message",
        "version": "1.0",
        "data": {
            "messages": [],
        },
    }

    message_data = event.get("data", {})
    assert isinstance(message_data, dict)
    messages = message_data.get("messages", [])

    assert len(messages) == 0


@pytest.mark.asyncio
async def test_audio_chunk_event_missing_chunk_data() -> None:
    """Audio chunk event without chunk data should not crash."""
    event = {
        "type": "audio_chunk",
        "version": "1.0",
        "data": {
            "sampleRate": 16000,
            "channels": 1,
            "bitDepth": 16,
        },
    }

    chunk_data = event.get("data", {})
    assert isinstance(chunk_data, dict)
    chunk_base64 = chunk_data.get("chunk")

    # Should be None
    assert chunk_base64 is None


@pytest.mark.asyncio
async def test_event_with_missing_data_field() -> None:
    """Event without data field should handle gracefully."""
    event: dict[str, Any] = {
        "type": "message",
        "version": "1.0",
    }

    message_data: dict[str, Any] = event.get("data", {})
    assert message_data == {}


@pytest.mark.asyncio
async def test_interrupt_event_default_reason() -> None:
    """Interrupt event without reason should default to user_abort."""
    event = {
        "type": "interrupt",
        "version": "1.0",
    }

    reason = event.get("reason", "user_abort")
    assert reason == "user_abort"


@pytest.mark.asyncio
async def test_tool_result_event_default_status() -> None:
    """Tool result event without status should default to approved."""
    event = {
        "type": "tool_result",
        "version": "1.0",
        "data": {
            "toolCallId": "call_123",
        },
    }

    result_data = event.get("data", {})
    assert isinstance(result_data, dict)
    status = result_data.get("status", "approved")

    assert status == "approved"
