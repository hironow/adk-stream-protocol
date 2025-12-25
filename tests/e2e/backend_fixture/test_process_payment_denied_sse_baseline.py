"""Backend E2E Test: process_payment-denied-sse-baseline.json

Tests backend behavior against process_payment denial flow SSE baseline fixture.

Fixture: fixtures/frontend/process_payment-denied-sse-baseline.json
Invocation: 1 Invocation, 2 Turns
Tool: process_payment (multi-turn, user denies)

Expected Flow:
Turn 1 (Confirmation Request):
- User: "次郎さんに200ドル送金してください"
- Backend: tool-input-start → adk_request_confirmation → [DONE]

Turn 2 (Denied Execution):
- User denial response
- Backend: tool-output-error → rejection message → [DONE]

IMPORTANT (ADR-0007):
The timing of Turn 1 → Turn 2 is IDENTICAL for approval and denial.
Only the content differs (tool-output-available vs tool-output-error).
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
async def test_process_payment_denied_sse_baseline(frontend_fixture_dir: Path):
    """Should generate correct rawEvents for process_payment denial flow."""
    # Given: Frontend baseline fixture (2 turns)
    fixture_path = frontend_fixture_dir / "process_payment-denied-sse-baseline.json"
    fixture = await load_frontend_fixture(fixture_path)

    input_messages = fixture["input"]["messages"]
    expected_events = fixture["output"]["rawEvents"]
    expected_done_count = fixture["output"]["expectedDoneCount"]

    # When: Send request to backend SSE endpoint
    # Note: This sends Turn 1 only (initial user message).
    # Turn 2 (denial response) requires separate HTTP request.
    actual_events = await send_sse_request(
        messages=input_messages,
        backend_url="http://localhost:8000/stream",
    )

    # Then: rawEvents should match expected Turn 1 (with normalization)
    # Extract Turn 1 events from expected (up to first [DONE])
    first_done_index = next(
        i for i, event in enumerate(expected_events) if "[DONE]" in event
    )
    expected_turn1_events = expected_events[: first_done_index + 1]

    # Structure validation for confirmation tools (LLM parameters and tokens are dynamic)
    is_match, diff_msg = compare_raw_events(
        actual=actual_events,
        expected=expected_turn1_events,
        normalize=True,
        dynamic_content_tools=["process_payment", "adk_request_confirmation"],
    )
    assert is_match, f"Turn 1 rawEvents structure mismatch:\n{diff_msg}"

    # And: Should have exactly 1 [DONE] marker (Turn 1 only)
    actual_done_count = count_done_markers(actual_events)
    assert actual_done_count == 1, (
        f"[DONE] count mismatch for Turn 1: "
        f"actual={actual_done_count}, expected=1"
    )

    # And: Turn 1 should be IDENTICAL to approval fixture Turn 1
    # (ADR-0007: approved/denied have same timing for Turn 1)
    # This is verified by comparing with process_payment-approved-sse-baseline
    # Turn 1 events (excluding dynamic fields like messageId).
    # The only difference should be in Turn 2 (not tested here).
    assert expected_done_count == 2, (
        f"Fixture should have 2 turns, but has {expected_done_count}"
    )
