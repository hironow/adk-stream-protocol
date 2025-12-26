"""Backend E2E Test: get_location-denied-bidi-baseline.json

Tests backend behavior against get_location BIDI baseline fixture with denial flow.

Fixture: fixtures/frontend/get_location-denied-bidi-baseline.json
Invocation: 1 Invocation, 2 Turns (confirmation + denial)
Tool: get_location (multi-turn, requires approval)
Transport: WebSocket (BIDI mode)

Expected Flow:
- WebSocket connection established
- User: "現在地を教えて"
- Backend: confirmation request → [DONE] (first turn)
- User: Denies (via frontend confirmation)
- Backend: tool-output-error + rejection message → [DONE] (second turn)

Note: This fixture captures BOTH turns in a single expected output.
The fixture documents the complete denial flow from request to rejection.
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
async def test_get_location_denied_bidi_baseline(frontend_fixture_dir: Path):
    """Should generate correct rawEvents for get_location denial flow (BIDI)."""
    # Given: Frontend baseline fixture (BIDI mode, multi-turn)
    fixture_path = frontend_fixture_dir / "get_location-denied-bidi-baseline.json"
    fixture = await load_frontend_fixture(fixture_path)

    input_messages = fixture["input"]["messages"]
    expected_events = fixture["output"]["rawEvents"]
    expected_done_count = fixture["output"]["expectedDoneCount"]

    # When: Send request to backend WebSocket endpoint
    # Note: This test requires approval_required=True for get_location tool
    actual_events = await send_bidi_request(
        messages=input_messages,
        backend_url="ws://localhost:8000/live",
    )

    # Then: rawEvents should match expected (with normalization)
    is_match, diff_msg = compare_raw_events(
        actual=actual_events,
        expected=expected_events,
        normalize=True,
        dynamic_content_tools=["get_location", "adk_request_confirmation"],
    )
    assert is_match, f"rawEvents mismatch:\n{diff_msg}"

    # And: Should have exactly 2 [DONE] markers (two-turn: confirmation + rejection)
    actual_done_count = count_done_markers(actual_events)
    assert actual_done_count == expected_done_count, (
        f"[DONE] count mismatch: actual={actual_done_count}, expected={expected_done_count}"
    )

    # And: Event structure should be IDENTICAL to SSE mode
    # (Only transport layer differs, event format is same)
