"""Backend E2E Test: process_payment-approved-sse-baseline.json

Tests backend behavior against process_payment approval flow SSE baseline fixture.

Fixture: fixtures/frontend/process_payment-approved-sse-baseline.json
Invocation: 1 Invocation, 2 Turns
Tool: process_payment (multi-turn, requires approval)

Expected Flow:
Turn 1 (Confirmation Request):
- User: "Hanakoさんに50ドル送金して"
- Backend: tool-input-start → adk_request_confirmation → [DONE]

Turn 2 (Approved Execution):
- User approval response
- Backend: tool-output-available → success result → [DONE]

Note: This fixture captures the COMPLETE invocation (2 turns).
Backend must handle both turns correctly.
"""

from pathlib import Path

import pytest

from .helpers import (
    compare_raw_events,
    count_done_markers,
    create_approval_message,
    create_assistant_message_from_turn1,
    extract_tool_call_ids_from_turn1,
    load_frontend_fixture,
    send_sse_request,
)


@pytest.mark.asyncio
async def test_process_payment_approved_sse_baseline(frontend_fixture_dir: Path):
    """Should generate correct rawEvents for process_payment approval flow."""
    # Given: Frontend baseline fixture (2 turns)
    fixture_path = frontend_fixture_dir / "process_payment-approved-sse-baseline.json"
    fixture = await load_frontend_fixture(fixture_path)

    input_messages = fixture["input"]["messages"]
    expected_events = fixture["output"]["rawEvents"]
    expected_done_count = fixture["output"]["expectedDoneCount"]

    # When: Send request to backend SSE endpoint
    # Note: This test sends the initial user message only.
    # The fixture's rawEvents include BOTH turns (confirmation + execution),
    # but in a real E2E flow, Turn 2 would require a separate HTTP request
    # with approval response.
    #
    # For fixture-based golden file testing, we verify the complete
    # event sequence as documented in the fixture.
    actual_events = await send_sse_request(
        messages=input_messages,
        backend_url="http://localhost:8000/stream",
    )

    # Then: rawEvents should match expected (with normalization)
    # Note: This comparison expects Turn 1 events only (confirmation request).
    # Full 2-turn flow requires separate approval request (see note above).
    #
    # Extract Turn 1 events from expected (up to first [DONE])
    first_done_index = next(
        i for i, event in enumerate(expected_events) if "[DONE]" in event
    )
    expected_turn1_events = expected_events[: first_done_index + 1]

    # DEBUG: Print actual events to understand the difference
    print(f"\n=== ACTUAL EVENTS (count={len(actual_events)}) ===")
    for i, event in enumerate(actual_events):
        print(f"{i}: {event.strip()}")
    print(f"\n=== EXPECTED TURN 1 EVENTS (count={len(expected_turn1_events)}) ===")
    for i, event in enumerate(expected_turn1_events):
        print(f"{i}: {event.strip()}")

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

    # Note: Full fixture has expectedDoneCount=2 (both turns).
    assert expected_done_count == 2, (
        f"Fixture should have 2 turns, but has {expected_done_count}"
    )

    # ===== TURN 2: Approval Execution =====
    print("\n=== TURN 2: Sending approval and testing execution ===")

    # Extract tool call IDs from Turn 1
    original_id, confirmation_id = extract_tool_call_ids_from_turn1(actual_events)
    assert original_id is not None, "Should have original tool call ID (process_payment)"
    assert confirmation_id is not None, "Should have confirmation tool call ID"

    # Reconstruct assistant's confirmation message from Turn 1 events
    assistant_msg = create_assistant_message_from_turn1(actual_events)

    # Construct approval message
    approval_msg = create_approval_message(confirmation_id, original_id)

    # Build complete message history for Turn 2
    turn2_messages = [
        *input_messages,  # Original user message
        assistant_msg,  # Assistant's confirmation response
        approval_msg,  # User's approval response
    ]

    # Send Turn 2 request with approval
    turn2_events = await send_sse_request(
        messages=turn2_messages,
        backend_url="http://localhost:8000/stream",
    )

    # DEBUG: Print Turn 2 events
    print(f"\n=== TURN 2 EVENTS (count={len(turn2_events)}) ===")
    for i, event in enumerate(turn2_events):
        print(f"{i}: {event.strip()}")

    # Extract expected Turn 2 events from fixture (after first [DONE])
    expected_turn2_events = expected_events[first_done_index + 1 :]

    print(f"\n=== EXPECTED TURN 2 EVENTS (count={len(expected_turn2_events)}) ===")
    for i, event in enumerate(expected_turn2_events):
        print(f"{i}: {event.strip()}")

    # Structure validation for Turn 2 (tool output and AI text are dynamic)
    is_match_turn2, diff_msg_turn2 = compare_raw_events(
        actual=turn2_events,
        expected=expected_turn2_events,
        normalize=True,
        dynamic_content_tools=["process_payment"],
    )
    assert is_match_turn2, f"Turn 2 rawEvents structure mismatch:\n{diff_msg_turn2}"

    # And: Should have exactly 1 [DONE] marker (Turn 2 only)
    actual_done_count_turn2 = count_done_markers(turn2_events)
    assert actual_done_count_turn2 == 1, (
        f"[DONE] count mismatch for Turn 2: "
        f"actual={actual_done_count_turn2}, expected=1"
    )

    # And: Should contain tool-output-available for process_payment
    tool_output_events = [
        event
        for event in turn2_events
        if "tool-output-available" in event and "process_payment" in event
    ]
    assert len(tool_output_events) > 0, (
        "Turn 2 should have tool-output-available for process_payment"
    )

    print("\n✅ Full invocation (Turn 1 + Turn 2) passed!")
