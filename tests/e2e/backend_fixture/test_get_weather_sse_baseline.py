"""Backend E2E Test: get_weather-sse-baseline.json

Tests backend behavior against get_weather SSE baseline fixture.

Fixture: fixtures/frontend/get_weather-sse-baseline.json
Invocation: 1 Invocation, 1 Turn
Tool: get_weather (single-turn, no approval)

Expected Flow:
- User: "東京の天気を教えて"
- Backend: tool execution → weather data → [DONE]
"""

from pathlib import Path

import pytest

from .helpers import (
    compare_raw_events,
    count_done_markers,
    load_frontend_fixture,
    send_sse_request,
)


@pytest.mark.asyncio
async def test_get_weather_sse_baseline(frontend_fixture_dir: Path):
    """Should generate correct rawEvents for get_weather SSE baseline."""
    # Given: Frontend baseline fixture
    fixture_path = frontend_fixture_dir / "get_weather-sse-baseline.json"
    fixture = await load_frontend_fixture(fixture_path)

    input_messages = fixture["input"]["messages"]
    expected_events = fixture["output"]["rawEvents"]
    expected_done_count = fixture["output"]["expectedDoneCount"]

    # When: Send request to backend SSE endpoint
    actual_events = await send_sse_request(
        messages=input_messages,
        backend_url="http://localhost:8000/stream",
    )

    # Then: rawEvents should match expected (structure validation for dynamic tool)
    # get_weather returns real-time weather data, so we validate structure only
    is_match, diff_msg = compare_raw_events(
        actual=actual_events,
        expected=expected_events,
        normalize=True,  # Normalize dynamic fields like messageId
        dynamic_content_tools=["get_weather"],  # Weather data is dynamic
    )
    assert is_match, f"rawEvents structure mismatch:\n{diff_msg}"

    # And: Should have exactly 1 [DONE] marker (single-turn)
    actual_done_count = count_done_markers(actual_events)
    assert actual_done_count == expected_done_count, (
        f"[DONE] count mismatch: "
        f"actual={actual_done_count}, expected={expected_done_count}"
    )

    # And: Should have expected event count
    assert len(actual_events) == len(expected_events), (
        f"Event count mismatch: "
        f"actual={len(actual_events)}, expected={len(expected_events)}"
    )
