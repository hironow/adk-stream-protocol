"""
Backend E2E Tests: WebSocket BIDI Endpoint Structure Validation

Tests that the WebSocket /live endpoint (ADK BIDI mode) produces correct
event structures compared to frontend baseline fixtures.

This complements test_server_structure_validation.py which tests SSE (/stream).

Test Strategy:
1. Connect to WebSocket endpoint /live
2. Send messages in AI SDK v6 format
3. Receive SSE-formatted events over WebSocket
4. Parse and validate event structures

Per CLAUDE.md guidelines:
- Real WebSocket server (no mocks)
- Real LLM API calls
- Given-When-Then structure
- Tests critical BIDI protocol correctness
"""

import json
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from server import app


def load_frontend_fixture(filename: str) -> dict[str, Any]:
    """Load frontend baseline fixture."""
    fixture_path = Path(__file__).parent.parent.parent / "fixtures" / "frontend" / filename
    return json.loads(fixture_path.read_text())


def parse_sse_from_websocket(message: str) -> dict[str, Any] | str:
    """
    Parse SSE-formatted message from WebSocket.

    WebSocket sends: 'data: {"type": "start", ...}\\n\\n'
    Returns: {"type": "start", ...}
    """
    if not message.startswith("data: "):
        raise ValueError(f"Invalid SSE format: {message[:50]}")

    data = message[6:].rstrip("\n")  # Remove 'data: ' prefix and newlines

    if data == "[DONE]":
        return "[DONE]"

    return json.loads(data)


def extract_structure(chunk: dict[str, Any]) -> dict[str, Any]:
    """Extract structure from chunk (type + field names)."""
    if chunk == "[DONE]" or chunk.get("type") == "DONE":
        return {"type": "DONE"}

    return {
        "type": chunk.get("type"),
        "fields": sorted([k for k in chunk.keys() if k != "type"]),
    }


def has_required_fields(actual: dict[str, Any], expected: dict[str, Any]) -> bool:
    """Check if actual has all required fields from expected (allows extra fields)."""
    if actual.get("type") != expected.get("type"):
        return False

    expected_fields = set(expected.get("fields", []))
    actual_fields = set(actual.get("fields", []))

    # Actual must contain all expected fields (but can have more)
    return expected_fields.issubset(actual_fields)


class TestWebSocketBIDIStructure:
    """
    E2E tests for WebSocket /live endpoint (ADK BIDI mode).

    These tests verify that the BIDI endpoint produces events with correct
    structure (types and fields) matching frontend expectations.
    """

    def test_get_weather_bidi_websocket_structure_matches_baseline(self):
        """WebSocket BIDI output for get_weather should match baseline structure."""
        # Given: Frontend baseline fixture
        frontend_fixture = load_frontend_fixture("get_weather-bidi-baseline.json")
        expected_chunks = frontend_fixture["output"]["expectedChunks"]

        # When: Connect to WebSocket and send message
        with TestClient(app) as client:
            with client.websocket_connect("/live") as websocket:
                # Send message in correct BIDI event format (matches TypeScript EventSender)
                websocket.send_json(
                    {
                        "type": "message",
                        "version": "1.0",
                        "timestamp": 1234567890,
                        "id": "test-chat-id",
                        "messages": frontend_fixture["input"]["messages"],
                        "trigger": "submit-message",
                        "messageId": None,
                    }
                )

                # Receive events
                actual_chunks = []
                while True:
                    data = websocket.receive_text()
                    chunk = parse_sse_from_websocket(data)

                    if chunk == "[DONE]":
                        break

                    actual_chunks.append(chunk)

        # Then: All expected event types should be present
        # Note: BIDI mode with Gemini native models may produce additional reasoning-* events
        # We validate that expected event structures exist, not exact count/order
        expected_event_types = [chunk.get("type") for chunk in expected_chunks]
        actual_event_types = [chunk.get("type") for chunk in actual_chunks]

        for expected_type in set(expected_event_types):
            assert expected_type in actual_event_types, (
                f"Expected event type '{expected_type}' not found in actual events"
            )

        # And: Validate structure of key event types
        # Check that each expected event type has required fields (allows extra fields for BIDI-specific extensions)
        for expected_chunk in expected_chunks:
            expected_type = expected_chunk.get("type")
            # Find first matching event type in actual chunks
            matching_actual = next(
                (c for c in actual_chunks if c.get("type") == expected_type), None
            )

            if matching_actual:
                actual_structure = extract_structure(matching_actual)
                expected_structure = extract_structure(expected_chunk)

                assert has_required_fields(actual_structure, expected_structure), (
                    f"Event type '{expected_type}' missing required fields:\n"
                    f"Actual fields:   {actual_structure['fields']}\n"
                    f"Required fields: {expected_structure['fields']}"
                )

    def test_change_bgm_bidi_websocket_structure_matches_baseline(self):
        """WebSocket BIDI output for change_bgm should match baseline structure."""
        # Given: Frontend baseline fixture for frontend tool
        frontend_fixture = load_frontend_fixture("change_bgm-bidi-baseline.json")
        expected_chunks = frontend_fixture["output"]["expectedChunks"]

        # When: Connect and send message
        with TestClient(app) as client:
            with client.websocket_connect("/live") as websocket:
                websocket.send_json(
                    {
                        "type": "message",
                        "version": "1.0",
                        "timestamp": 1234567890,
                        "id": "test-chat-id",
                        "messages": frontend_fixture["input"]["messages"],
                        "trigger": "submit-message",
                        "messageId": None,
                    }
                )

                # Receive events and respond to frontend tool calls
                actual_chunks = []
                while True:
                    data = websocket.receive_text()
                    chunk = parse_sse_from_websocket(data)

                    if chunk == "[DONE]":
                        break

                    actual_chunks.append(chunk)

                    # Handle frontend tool confirmation for change_bgm
                    if isinstance(chunk, dict) and chunk.get("type") == "tool-input-available":
                        tool_name = chunk.get("toolName")
                        tool_call_id = chunk.get("toolCallId")
                        if tool_name == "change_bgm":
                            # Send tool_result event (simulating frontend approval)
                            websocket.send_json(
                                {
                                    "type": "tool_result",
                                    "toolCallId": tool_call_id,
                                    "result": {
                                        "success": True,
                                        "track": 1,
                                        "message": "BGM change to track 1 initiated (frontend handles execution)",
                                    },
                                }
                            )

        # Then: All expected event types should be present
        expected_event_types = [chunk.get("type") for chunk in expected_chunks]
        actual_event_types = [chunk.get("type") for chunk in actual_chunks]

        for expected_type in set(expected_event_types):
            assert expected_type in actual_event_types, (
                f"Expected event type '{expected_type}' not found"
            )

        # And: Validate structure of key event types
        for expected_chunk in expected_chunks:
            expected_type = expected_chunk.get("type")
            matching_actual = next(
                (c for c in actual_chunks if c.get("type") == expected_type), None
            )

            if matching_actual:
                actual_structure = extract_structure(matching_actual)
                expected_structure = extract_structure(expected_chunk)
                assert has_required_fields(actual_structure, expected_structure), (
                    f"Event type '{expected_type}' missing required fields:\n"
                    f"Actual: {actual_structure['fields']}, Required: {expected_structure['fields']}"
                )


class TestWebSocketEventSequence:
    """Tests for WebSocket event sequence patterns."""

    def test_websocket_sends_sse_format(self):
        """WebSocket should send events in SSE format."""
        # Given: Any message
        frontend_fixture = load_frontend_fixture("get_weather-bidi-baseline.json")

        # When: Connect and send
        with TestClient(app) as client:
            with client.websocket_connect("/live") as websocket:
                websocket.send_json(
                    {
                        "type": "message",
                        "version": "1.0",
                        "timestamp": 1234567890,
                        "id": "test-chat-id",
                        "messages": frontend_fixture["input"]["messages"],
                        "trigger": "submit-message",
                        "messageId": None,
                    }
                )

                # Then: Should receive SSE-formatted strings
                first_message = websocket.receive_text()
                assert first_message.startswith("data: "), (
                    "WebSocket should send SSE-formatted messages"
                )
                assert first_message.endswith("\n\n"), "SSE messages should end with double newline"

    def test_websocket_has_start_event(self):
        """WebSocket stream should start with 'start' event."""
        # Given: Any message
        frontend_fixture = load_frontend_fixture("get_weather-bidi-baseline.json")

        # When: Connect and send
        with TestClient(app) as client:
            with client.websocket_connect("/live") as websocket:
                websocket.send_json(
                    {
                        "type": "message",
                        "version": "1.0",
                        "timestamp": 1234567890,
                        "id": "test-chat-id",
                        "messages": frontend_fixture["input"]["messages"],
                        "trigger": "submit-message",
                        "messageId": None,
                    }
                )

                # Then: First event should be 'start'
                first_message = websocket.receive_text()
                first_chunk = parse_sse_from_websocket(first_message)

                assert first_chunk.get("type") == "start", "First event should be 'start'"
                assert "messageId" in first_chunk, "Start event should have messageId"

    def test_websocket_ends_with_done_marker(self):
        """WebSocket stream should end with [DONE] marker."""
        # Given: Simple tool execution
        frontend_fixture = load_frontend_fixture("get_weather-bidi-baseline.json")

        # When: Connect and send
        with TestClient(app) as client:
            with client.websocket_connect("/live") as websocket:
                websocket.send_json(
                    {
                        "type": "message",
                        "version": "1.0",
                        "timestamp": 1234567890,
                        "id": "test-chat-id",
                        "messages": frontend_fixture["input"]["messages"],
                        "trigger": "submit-message",
                        "messageId": None,
                    }
                )

                # Receive all events
                events = []
                while True:
                    data = websocket.receive_text()
                    chunk = parse_sse_from_websocket(data)
                    events.append(chunk)

                    if chunk == "[DONE]":
                        break

                # Then: Last event should be [DONE]
                assert events[-1] == "[DONE]", "Stream should end with [DONE] marker"


class TestWebSocketRequiredFields:
    """Tests for required fields in WebSocket events."""

    def test_websocket_tool_events_have_required_fields(self):
        """Tool events over WebSocket should have toolCallId and toolName."""
        # Given: Tool execution fixture
        frontend_fixture = load_frontend_fixture("get_weather-bidi-baseline.json")

        # When: Execute
        with TestClient(app) as client:
            with client.websocket_connect("/live") as websocket:
                websocket.send_json(
                    {
                        "type": "message",
                        "version": "1.0",
                        "timestamp": 1234567890,
                        "id": "test-chat-id",
                        "messages": frontend_fixture["input"]["messages"],
                        "trigger": "submit-message",
                        "messageId": None,
                    }
                )

                # Collect tool events
                tool_events = []
                while True:
                    data = websocket.receive_text()
                    chunk = parse_sse_from_websocket(data)

                    if chunk == "[DONE]":
                        break

                    if isinstance(chunk, dict) and chunk.get("type", "").startswith("tool-"):
                        tool_events.append(chunk)

                # Then: Tool events should have required fields
                tool_input_events = [e for e in tool_events if e.get("type") == "tool-input-start"]
                assert len(tool_input_events) > 0

                for event in tool_input_events:
                    assert "toolCallId" in event
                    assert "toolName" in event
