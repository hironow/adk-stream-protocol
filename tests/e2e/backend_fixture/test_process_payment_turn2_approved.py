"""Backend E2E Test: Turn 2 - process_payment approval execution

Tests Turn 2 (approval execution) of the process_payment multi-turn flow.

Flow:
1. Send Turn 1 (initial request) → Get confirmation
2. Extract confirmation ID from Turn 1 events
3. Send Turn 2 (approval response) → Get execution result

Expected Turn 2 Events (from fixture lines 26-32):
- start event (new messageId)
- tool-output-available (process_payment result)
- text-start, text-delta, text-end (AI response)
- finish event
- [DONE] marker

IMPORTANT: This test validates the complete SSE multi-turn flow
across TWO separate HTTP requests (ADR-0007).
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
async def test_process_payment_turn2_approved(frontend_fixture_dir: Path):
    """Should execute process_payment after approval in Turn 2."""
    # Given: Frontend baseline fixture (2 turns)
    fixture_path = frontend_fixture_dir / "process_payment-approved-sse-baseline.json"
    fixture = await load_frontend_fixture(fixture_path)

    initial_messages = fixture["input"]["messages"]
    expected_events = fixture["output"]["rawEvents"]

    # Step 1: Execute Turn 1 to get confirmation
    turn1_events = await send_sse_request(
        messages=initial_messages,
        backend_url="http://localhost:8000/stream",
    )

    # Step 2: Extract tool call IDs from Turn 1
    original_id, confirmation_id = extract_tool_call_ids_from_turn1(turn1_events)

    assert original_id is not None, "Should have original tool call ID (process_payment)"
    assert confirmation_id is not None, "Should have confirmation tool call ID"

    # Step 3: Reconstruct assistant's confirmation message from Turn 1 events
    assistant_msg = create_assistant_message_from_turn1(turn1_events)

    # Step 4: Construct approval message
    approval_msg = create_approval_message(confirmation_id, original_id)

    # Build complete message history for Turn 2
    # Note: In SSE mode, each HTTP request is stateless. We need to send the full
    # conversation history: user → assistant (confirmation) → user (approval)
    # The persistent synced_message_count tracking prevents duplicate syncing
    turn2_messages = [
        *initial_messages,  # Original user message
        assistant_msg,  # Assistant's confirmation response
        approval_msg,  # User's approval response
    ]

    # DEBUG: Print Turn 2 messages to understand what we're sending
    import json

    print(f"\n=== TURN 2 MESSAGES (count={len(turn2_messages)}) ===")
    for i, msg in enumerate(turn2_messages):
        print(f"{i}: {json.dumps(msg, indent=2)}")

    # When: Send Turn 2 request with approval
    turn2_events = await send_sse_request(
        messages=turn2_messages,
        backend_url="http://localhost:8000/stream",
    )

    # DEBUG: Print Turn 2 events received
    print(f"\n=== TURN 2 EVENTS (count={len(turn2_events)}) ===")
    for i, event in enumerate(turn2_events):
        print(f"{i}: {event.strip()}")

    # Then: Turn 2 events should match expected (from fixture lines 26-32)
    # Extract Turn 2 events from fixture (after first [DONE])
    first_done_index = next(
        i for i, event in enumerate(expected_events) if "[DONE]" in event
    )
    expected_turn2_events = expected_events[first_done_index + 1 :]

    # Structure validation (tool output and AI text are dynamic)
    is_match, diff_msg = compare_raw_events(
        actual=turn2_events,
        expected=expected_turn2_events,
        normalize=True,
        dynamic_content_tools=["process_payment"],
    )
    assert is_match, f"Turn 2 rawEvents structure mismatch:\n{diff_msg}"

    # And: Should have exactly 1 [DONE] marker (Turn 2 only)
    actual_done_count = count_done_markers(turn2_events)
    assert actual_done_count == 1, (
        f"[DONE] count mismatch for Turn 2: "
        f"actual={actual_done_count}, expected=1"
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

    # And: Should contain text response (AI explaining the result)
    text_delta_events = [event for event in turn2_events if "text-delta" in event]
    assert len(text_delta_events) > 0, "Turn 2 should have text-delta (AI response)"
