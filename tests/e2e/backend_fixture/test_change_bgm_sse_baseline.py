"""Backend E2E Test: change_bgm-sse-baseline.json

Tests backend behavior against change_bgm SSE baseline fixture.

Fixture: fixtures/frontend/change_bgm-sse-baseline.json
Invocation: 1 Invocation, 1 Turn
Tool: change_bgm (Frontend Delegation pattern, no approval needed)

Expected Flow:
- User: "トラック1に変更して"
- Backend: tool-input-start → tool-output-available (from FrontendToolDelegate) → [DONE]

Note: change_bgm is a Frontend Delegation tool.
Backend defines the tool, but execution happens in frontend (browser API).
Backend receives result via FrontendToolDelegate and returns tool-output-available.
No confirmation flow needed (single-turn).
"""

from pathlib import Path

import pytest

from .helpers import (
    compare_raw_events,
    count_done_markers,
    load_frontend_fixture,
    save_frontend_fixture,
    send_sse_request,
)


@pytest.mark.asyncio
async def test_change_bgm_sse_baseline(frontend_fixture_dir: Path):
    """Should generate correct rawEvents for change_bgm Frontend Delegation."""
    # Given: Frontend baseline fixture (single-turn)
    fixture_path = frontend_fixture_dir / "change_bgm-sse-baseline.json"
    fixture = await load_frontend_fixture(fixture_path)

    input_messages = fixture["input"]["messages"]
    expected_events = fixture["output"]["rawEvents"]
    expected_done_count = fixture["output"]["expectedDoneCount"]

    # When: Send request to backend SSE endpoint
    actual_events = await send_sse_request(
        messages=input_messages,
        backend_url="http://localhost:8000/stream",
    )

    # Then: rawEvents should match expected (structure validation for dynamic AI responses)
    # AI response text is non-deterministic, so we validate structure only
    is_match, diff_msg = compare_raw_events(
        actual=actual_events,
        expected=expected_events,
        normalize=True,
        dynamic_content_tools=["change_bgm"],  # AI response is dynamic
        include_text_events=True,  # SSE mode fixtures include text-* events
    )
    assert is_match, f"rawEvents structure mismatch:\n{diff_msg}"

    # And: Should have exactly 1 [DONE] marker (single-turn)
    actual_done_count = count_done_markers(actual_events)
    assert actual_done_count == expected_done_count, (
        f"[DONE] count mismatch: actual={actual_done_count}, expected={expected_done_count}"
    )

    # And: Should contain tool-output-available from tool execution
    tool_output_events = [event for event in actual_events if "tool-output-available" in event]
    assert len(tool_output_events) > 0, "Should have tool-output-available from tool execution"

    # And: Event count validation (AI text generation is non-deterministic)
    # Note: AI text generation is non-deterministic
    # Accept either:
    # - Full events (9): with text-start, text-delta, text-end
    # - Min events (6): without text-* events (AI skipped text response)
    expected_full = len(expected_events)  # 9
    expected_min = (
        6  # start, tool-input-start, tool-input-available, tool-output-available, finish, DONE
    )

    if len(actual_events) != expected_full:
        assert len(actual_events) == expected_min, (
            f"Event count unexpected: actual={len(actual_events)}, "
            f"expected={expected_full} (with text) or {expected_min} (without text)"
        )
        print(
            f"⚠️  AI did not generate text response (non-deterministic behavior): "
            f"actual={len(actual_events)}, expected={expected_full}"
        )

    # Save events to fixture
    save_frontend_fixture(
        fixture_path=fixture_path,
        description="SSE mode baseline - real E2E capture from change_bgm tool call",
        mode="sse",
        input_messages=input_messages,
        raw_events=actual_events,
        expected_done_count=1,
        source="Backend E2E test capture",
        scenario="User requests background music change - frontend delegation pattern",
        note="change_bgm is a Frontend Delegation tool. Backend receives result via FrontendToolDelegate and returns tool-output-available.",
    )
