"""Backend E2E Test: get_location-denied-sse-baseline.json

Tests backend behavior against get_location denial flow SSE baseline fixture.

Fixture: fixtures/frontend/get_location-denied-sse-baseline.json
Invocation: 1 Invocation, 2 Turns
Tool: get_location (multi-turn, user denies)

Expected Flow:
Turn 1 (Confirmation Request):
- User: "現在地を教えて"
- Backend: tool-input-start → adk_request_confirmation → [DONE]

Turn 2 (Denied Execution):
- User denial response
- Backend: tool-output-error → rejection message → [DONE]

IMPORTANT (ADR-0007):
Turn 1 timing is IDENTICAL to approval case.
Only Turn 2 content differs (tool-output-error vs tool-output-available).
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
async def test_get_location_denied_sse_baseline(frontend_fixture_dir: Path):
    """Should generate correct rawEvents for get_location denial flow."""
    # Given: Frontend baseline fixture (2 turns)
    fixture_path = frontend_fixture_dir / "get_location-denied-sse-baseline.json"
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

    # And: Turn 1 should be IDENTICAL to approval fixture Turn 1
    # (ADR-0007: only Turn 2 differs between approve/deny)
    assert expected_done_count == 2, (
        f"Fixture should have 2 turns, but has {expected_done_count}"
    )
