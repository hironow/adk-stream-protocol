"""
Backend E2E Tests: Server Output Structure Validation

Tests that the actual server output has the correct EVENT STRUCTURE
(types, fields, order) compared to frontend baseline fixtures.

This validates the protocol implementation WITHOUT requiring exact data match:
- Event count matches
- Event types match (start, tool-input-start, text-delta, etc.)
- Required fields exist
- Event order is correct

Data content (temperature, text, etc.) is NOT validated here - that's tested
in test_server_complete_match.py with ChunkPlayer mocking.

Test Strategy:
1. Send real requests to server (real LLM API calls)
2. Parse SSE response
3. Extract event structures (type + field names)
4. Compare structures with frontend baseline expectations

Per CLAUDE.MD guidelines:
- Real server, real LLM API (no mocks for structure tests)
- Given-When-Then structure
- Tests critical protocol correctness
"""

import json
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from server import app


# Default API key for development/test
DEFAULT_HEADERS = {
    "X-API-Key": "dev-key-12345",
    "Accept": "text/event-stream",
}


def load_frontend_fixture(filename: str) -> dict[str, Any]:
    """Load frontend baseline fixture."""
    fixture_path = Path(__file__).parent.parent.parent / "fixtures" / "frontend" / filename
    return json.loads(fixture_path.read_text())


def parse_sse_to_chunks(response_text: str) -> list[dict[str, Any]]:
    """
    Parse SSE response into list of chunk objects.

    Returns:
        List of parsed JSON objects (without the SSE 'data:' wrapper)
    """
    chunks = []
    for line in response_text.split("\n"):
        if line.startswith("data: "):
            data = line[6:].strip()  # Remove 'data: ' prefix
            if data and data != "[DONE]":
                try:
                    chunks.append(json.loads(data))
                except json.JSONDecodeError:
                    # Skip malformed events
                    pass
            elif data == "[DONE]":
                chunks.append({"type": "DONE"})
    return chunks


def extract_structure(chunk: dict[str, Any]) -> dict[str, Any]:
    """
    Extract structure from chunk (type + field names, no values).

    Examples:
        {"type": "start", "messageId": "xyz"} → {"type": "start", "fields": ["messageId"]}
        {"type": "tool-input-available", "toolCallId": "...", "toolName": "...", "input": {...}}
        → {"type": "tool-input-available", "fields": ["toolCallId", "toolName", "input"]}
    """
    if chunk.get("type") == "DONE":
        return {"type": "DONE"}

    return {
        "type": chunk.get("type"),
        "fields": sorted([k for k in chunk.keys() if k != "type"]),
    }


class TestServerOutputStructure:
    """
    E2E tests verifying server output structure matches frontend expectations.

    These tests use REAL LLM API calls and validate event structure only.
    Data content may differ, but event types and fields must match.
    """

    def test_get_weather_sse_structure_matches_baseline(self):
        """Server output structure for get_weather (SSE) should match baseline."""
        # Given: Frontend baseline fixture
        frontend_fixture = load_frontend_fixture("get_weather-sse-baseline.json")

        # When: Send request to server (real LLM API call)
        with TestClient(app) as client:
            response = client.post(
                "/stream",
                json={
                    "messages": frontend_fixture["input"]["messages"],
                    "mode": "adk-sse",
                },
                headers=DEFAULT_HEADERS,
            )

        # Then: Response should be successful
        assert response.status_code == 200

        # And: Parse chunks
        actual_chunks = parse_sse_to_chunks(response.text)
        expected_chunks = frontend_fixture["output"]["expectedChunks"]

        # Note: expectedChunks doesn't include [DONE], but actual does
        # So we compare actual without [DONE] OR add [DONE] to expected
        actual_chunks_without_done = [c for c in actual_chunks if c.get("type") != "DONE"]

        # And: Event count should match (excluding DONE marker)
        assert len(actual_chunks_without_done) == len(expected_chunks), (
            f"Event count mismatch: got {len(actual_chunks_without_done)}, "
            f"expected {len(expected_chunks)}"
        )

        # And: Event structures should match
        for i, (actual, expected) in enumerate(
            zip(actual_chunks_without_done, expected_chunks, strict=False)
        ):
            actual_structure = extract_structure(actual)
            expected_structure = extract_structure(expected)

            assert actual_structure == expected_structure, (
                f"Event {i} structure mismatch:\n"
                f"Actual:   {actual_structure}\n"
                f"Expected: {expected_structure}\n"
                f"Full actual event: {actual}"
            )

    def test_change_bgm_sse_structure_matches_baseline(self):
        """Server output structure for change_bgm (SSE) should match baseline."""
        # Given: Frontend baseline fixture for frontend tool
        frontend_fixture = load_frontend_fixture("change_bgm-sse-baseline.json")

        # When: Send request to server
        with TestClient(app) as client:
            response = client.post(
                "/stream",
                json={
                    "messages": frontend_fixture["input"]["messages"],
                    "mode": "adk-sse",
                },
                headers=DEFAULT_HEADERS,
            )

        # Then: Response should be successful
        assert response.status_code == 200

        # And: Parse chunks
        actual_chunks = parse_sse_to_chunks(response.text)
        expected_chunks = frontend_fixture["output"]["expectedChunks"]
        actual_chunks_without_done = [c for c in actual_chunks if c.get("type") != "DONE"]

        # And: Structures should match (excluding DONE)
        assert len(actual_chunks_without_done) == len(expected_chunks)
        for i, (actual, expected) in enumerate(
            zip(actual_chunks_without_done, expected_chunks, strict=False)
        ):
            actual_structure = extract_structure(actual)
            expected_structure = extract_structure(expected)
            assert actual_structure == expected_structure, f"Event {i} structure mismatch"

    # test_get_location_approved_sse_structure_matches_baseline removed
    # Reason: Multi-turn approval flow requires complete message history
    # This is better tested in complete match tests, not structure-only tests


class TestEventSequencePatterns:
    """
    Tests for common event sequence patterns.

    Validates that specific tool execution patterns produce expected event sequences.
    """

    def test_simple_tool_execution_has_correct_event_sequence(self):
        """Simple tool execution should follow: start → tool-input → tool-output → text → finish → DONE."""
        # Given: Simple tool execution fixture
        frontend_fixture = load_frontend_fixture("get_weather-sse-baseline.json")

        # When: Execute request
        with TestClient(app) as client:
            response = client.post(
                "/stream",
                json={
                    "messages": frontend_fixture["input"]["messages"],
                    "mode": "adk-sse",
                },
                headers=DEFAULT_HEADERS,
            )

        # Then: Parse event types
        chunks = parse_sse_to_chunks(response.text)
        event_types = [chunk.get("type") for chunk in chunks]

        # And: Should follow expected pattern
        assert event_types[0] == "start"
        assert "tool-input-start" in event_types
        assert "tool-input-available" in event_types
        assert "tool-output-available" in event_types
        assert "text-start" in event_types
        assert "text-delta" in event_types
        assert "text-end" in event_types
        assert "finish" in event_types
        assert event_types[-1] == "DONE"

    def test_frontend_tool_execution_has_correct_event_sequence(self):
        """Frontend tool execution should include tool-output-available."""
        # Given: Frontend tool fixture
        frontend_fixture = load_frontend_fixture("change_bgm-sse-baseline.json")

        # When: Execute request
        with TestClient(app) as client:
            response = client.post(
                "/stream",
                json={
                    "messages": frontend_fixture["input"]["messages"],
                    "mode": "adk-sse",
                },
                headers=DEFAULT_HEADERS,
            )

        # Then: Parse event types
        chunks = parse_sse_to_chunks(response.text)
        event_types = [chunk.get("type") for chunk in chunks]

        # And: Should contain frontend tool execution pattern
        assert "tool-input-start" in event_types
        assert "tool-input-available" in event_types
        assert "tool-output-available" in event_types
        # Frontend tool should have output immediately (no backend execution)
        tool_input_idx = event_types.index("tool-input-available")
        tool_output_idx = event_types.index("tool-output-available")
        # Output should come shortly after input
        assert tool_output_idx > tool_input_idx
        assert tool_output_idx - tool_input_idx <= 2  # At most 1 event between


class TestRequiredFields:
    """
    Tests that required fields exist in specific event types.
    """

    def test_start_event_has_message_id(self):
        """Start event must have messageId field."""
        # Given: Any frontend fixture
        frontend_fixture = load_frontend_fixture("get_weather-sse-baseline.json")

        # When: Execute request
        with TestClient(app) as client:
            response = client.post(
                "/stream",
                json={
                    "messages": frontend_fixture["input"]["messages"],
                    "mode": "adk-sse",
                },
                headers=DEFAULT_HEADERS,
            )

        # Then: Parse chunks
        chunks = parse_sse_to_chunks(response.text)

        # And: Find start event
        start_events = [c for c in chunks if c.get("type") == "start"]
        assert len(start_events) == 1

        # And: Should have messageId
        assert "messageId" in start_events[0]
        assert isinstance(start_events[0]["messageId"], str)
        assert len(start_events[0]["messageId"]) > 0

    def test_tool_events_have_required_fields(self):
        """Tool events must have toolCallId and toolName fields."""
        # Given: Tool execution fixture
        frontend_fixture = load_frontend_fixture("get_weather-sse-baseline.json")

        # When: Execute request
        with TestClient(app) as client:
            response = client.post(
                "/stream",
                json={
                    "messages": frontend_fixture["input"]["messages"],
                    "mode": "adk-sse",
                },
                headers=DEFAULT_HEADERS,
            )

        # Then: Parse chunks
        chunks = parse_sse_to_chunks(response.text)

        # And: Find tool-input-start events
        tool_input_events = [c for c in chunks if c.get("type") == "tool-input-start"]
        assert len(tool_input_events) > 0

        # And: Each should have required fields
        for event in tool_input_events:
            assert "toolCallId" in event
            assert "toolName" in event

        # And: Find tool-input-available events
        tool_available_events = [c for c in chunks if c.get("type") == "tool-input-available"]
        for event in tool_available_events:
            assert "toolCallId" in event
            assert "toolName" in event
            assert "input" in event

    def test_finish_event_has_required_fields(self):
        """Finish event must have finishReason and messageMetadata fields."""
        # Given: Any fixture
        frontend_fixture = load_frontend_fixture("get_weather-sse-baseline.json")

        # When: Execute request
        with TestClient(app) as client:
            response = client.post(
                "/stream",
                json={
                    "messages": frontend_fixture["input"]["messages"],
                    "mode": "adk-sse",
                },
                headers=DEFAULT_HEADERS,
            )

        # Then: Parse chunks
        chunks = parse_sse_to_chunks(response.text)

        # And: Find finish event
        finish_events = [c for c in chunks if c.get("type") == "finish"]
        assert len(finish_events) == 1

        # And: Should have required fields
        finish_event = finish_events[0]
        assert "finishReason" in finish_event
        assert "messageMetadata" in finish_event
        assert "usage" in finish_event["messageMetadata"]
