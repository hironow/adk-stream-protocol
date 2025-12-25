"""Backend E2E Test: get_location-approved-sse-baseline.json

Tests backend behavior against get_location approval flow SSE baseline fixture.

Fixture: fixtures/frontend/get_location-approved-sse-baseline.json
Invocation: 1 Invocation, 2 Turns
Tool: get_location (multi-turn, requires approval, no arguments)

Expected Flow:
Turn 1 (Confirmation Request):
- User: "現在地を教えて"
- Backend: tool-input-start → tool-input-available (empty args) → adk_request_confirmation → [DONE]

Turn 2 (Approved Execution):
- User approval response
- Backend: tool-output-available → location data → [DONE]

Note: get_location takes no arguments (input: {}).
This is a Server Execute pattern, not Frontend Delegation.
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
async def test_get_location_approved_sse_baseline(frontend_fixture_dir: Path):
    """Should generate correct rawEvents for get_location approval flow."""
    # Given: Frontend baseline fixture (2 turns)
    fixture_path = frontend_fixture_dir / "get_location-approved-sse-baseline.json"
    fixture = await load_frontend_fixture(fixture_path)

    input_messages = fixture["input"]["messages"]
    expected_events = fixture["output"]["rawEvents"]
    expected_done_count = fixture["output"]["expectedDoneCount"]

    # When: Send request to backend SSE endpoint (Turn 1 only)
    actual_events = await send_sse_request(
        messages=input_messages,
        backend_url="http://localhost:8000/stream",
    )

    # Then: rawEvents should match expected Turn 1
    # Extract Turn 1 events (up to first [DONE])
    first_done_index = next(
        i for i, event in enumerate(expected_events) if "[DONE]" in event
    )
    expected_turn1_events = expected_events[: first_done_index + 1]

    # Structure validation for confirmation tools (LLM parameters and tokens are dynamic)
    is_match, diff_msg = compare_raw_events(
        actual=actual_events,
        expected=expected_turn1_events,
        normalize=True,
        dynamic_content_tools=["get_location", "adk_request_confirmation"],
    )
    assert is_match, f"Turn 1 rawEvents structure mismatch:\n{diff_msg}"

    # And: Should have exactly 1 [DONE] marker (Turn 1 only)
    actual_done_count = count_done_markers(actual_events)
    assert actual_done_count == 1, (
        f"[DONE] count mismatch for Turn 1: "
        f"actual={actual_done_count}, expected=1"
    )

    # And: Should contain tool-input-available with empty args
    tool_input_events = [
        event for event in actual_events
        if "tool-input-available" in event and "get_location" in event
    ]
    assert len(tool_input_events) > 0, (
        "Should have tool-input-available for get_location"
    )

    # Verify empty input: {} in the event
    # (This is characteristic of get_location - no arguments needed)
    assert '"input": {}' in tool_input_events[0], (
        "get_location should have empty input: {}"
    )

    assert expected_done_count == 2, (
        f"Fixture should have 2 turns, but has {expected_done_count}"
    )
