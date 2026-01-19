"""Backend E2E Test: change_bgm-bidi-baseline.json

Tests backend behavior against change_bgm BIDI baseline fixture.

Fixture: fixtures/frontend/change_bgm-bidi-baseline.json
Invocation: 1 Invocation, 1 Turn
Tool: change_bgm (single-turn, no approval)
Transport: WebSocket (BIDI mode)

Expected Flow:
- WebSocket connection established
- User: "トラック1に変更して"
- Backend: tool execution → BGM change → [DONE] (over WebSocket)

Note: BIDI sends events in SSE format over WebSocket messages.
The event structure is IDENTICAL to SSE mode, only transport differs.
"""

from pathlib import Path

import pytest

from .helpers import (
    compare_raw_events,
    count_done_markers,
    load_frontend_fixture,
    save_frontend_fixture,
    send_bidi_request,
)


@pytest.mark.asyncio
async def test_change_bgm_bidi_baseline(frontend_fixture_dir: Path):
    """Should generate correct rawEvents for change_bgm BIDI baseline."""
    # Given: Frontend baseline fixture (BIDI mode)
    fixture_path = frontend_fixture_dir / "change_bgm-bidi-baseline.json"
    fixture = await load_frontend_fixture(fixture_path)

    input_messages = fixture["input"]["messages"]
    expected_events = fixture["output"]["rawEvents"]
    expected_done_count = fixture["output"]["expectedDoneCount"]

    # When: Send request to backend WebSocket endpoint
    # Simulate frontend executing change_bgm tool (frontend-delegate pattern)
    actual_events = await send_bidi_request(
        messages=input_messages,
        backend_url="ws://localhost:8000/live",
        frontend_delegate_tools={
            "change_bgm": {
                "success": True,
                "track": 1,
                "message": "BGM change to track 1 initiated (frontend handles execution)",
            }
        },
    )

    # Then: rawEvents should match expected (with normalization)
    # Note: include_text_events=False to ignore non-deterministic thought process text-* events
    is_match, diff_msg = compare_raw_events(
        actual=actual_events,
        expected=expected_events,
        normalize=True,
        dynamic_content_tools=["change_bgm"],
        include_text_events=False,  # Ignore text-* events (thought process is non-deterministic)
    )
    assert is_match, f"rawEvents mismatch:\n{diff_msg}"

    # And: Should have exactly 1 [DONE] marker (single-turn)
    actual_done_count = count_done_markers(actual_events)
    assert actual_done_count == expected_done_count, (
        f"[DONE] count mismatch: actual={actual_done_count}, expected={expected_done_count}"
    )

    # And: Event structure should be IDENTICAL to SSE mode
    # (Only transport layer differs, event format is same)

    # Save events to fixture
    save_frontend_fixture(
        fixture_path=fixture_path,
        description="BIDI mode baseline - real E2E capture from change_bgm tool call",
        mode="bidi",
        input_messages=input_messages,
        raw_events=actual_events,
        expected_done_count=1,
        source="Backend E2E test capture",
        scenario="User requests background music change via WebSocket - frontend delegation pattern",
        note="BIDI mode sends events in SSE format over WebSocket. change_bgm is a Frontend Delegation tool executed by browser API.",
    )
