"""Backend E2E Test: get_weather-bidi-baseline.json

Tests backend behavior against get_weather BIDI baseline fixture.

Fixture: fixtures/frontend/get_weather-bidi-baseline.json
Invocation: 1 Invocation, 1 Turn
Tool: get_weather (single-turn, no approval)
Transport: WebSocket (BIDI mode)

Expected Flow:
- WebSocket connection established
- User: "東京の天気を教えて"
- Backend: tool execution → weather data → [DONE] (over WebSocket)

Note: BIDI sends events in SSE format over WebSocket messages.
The event structure is IDENTICAL to SSE mode, only transport differs.
"""

from pathlib import Path

import pytest

from .helpers import (
    compare_raw_events,
    count_done_markers,
    load_frontend_fixture,
    send_bidi_request,
)


@pytest.mark.asyncio
async def test_get_weather_bidi_baseline(frontend_fixture_dir: Path):
    """Should generate correct rawEvents for get_weather BIDI baseline."""
    # Given: Frontend baseline fixture (BIDI mode)
    fixture_path = frontend_fixture_dir / "get_weather-bidi-baseline.json"
    fixture = await load_frontend_fixture(fixture_path)

    input_messages = fixture["input"]["messages"]
    expected_events = fixture["output"]["rawEvents"]
    expected_done_count = fixture["output"]["expectedDoneCount"]

    # When: Send request to backend WebSocket endpoint
    # TODO: Implement send_bidi_request() in helpers.py
    actual_events = await send_bidi_request(
        messages=input_messages,
        backend_url="ws://localhost:8000/live",
    )

    # Then: rawEvents should match expected (with normalization)
    # get_weather returns dynamic content (weather data), so use structure validation
    is_match, diff_msg = compare_raw_events(
        actual=actual_events,
        expected=expected_events,
        normalize=True,
        dynamic_content_tools=["get_weather"],
    )
    assert is_match, f"rawEvents mismatch:\n{diff_msg}"

    # And: Should have exactly 1 [DONE] marker (single-turn)
    actual_done_count = count_done_markers(actual_events)
    assert actual_done_count == expected_done_count, (
        f"[DONE] count mismatch: actual={actual_done_count}, expected={expected_done_count}"
    )

    # And: Event structure should be IDENTICAL to SSE mode
    # (Only transport layer differs, event format is same)
