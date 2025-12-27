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
    save_frontend_fixture,
    compare_raw_events,
    count_done_markers,
    create_assistant_message_from_turn1,
    create_denial_message,
    extract_tool_call_ids_from_turn1,
    load_frontend_fixture,
    save_frontend_fixture,
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

    # ===== TURN 1: Send initial request and verify confirmation =====
    # When: Send request to backend SSE endpoint (Turn 1)
    # Note: This sends Turn 1 only (initial user message).
    # Turn 2 (denial response) is NOT yet implemented in this test.
    actual_events = await send_sse_request(
        messages=input_messages,
        backend_url="http://localhost:8000/stream",
    )

    # Then: rawEvents should match expected Turn 1 (with normalization)
    # Extract Turn 1 events from expected (up to first [DONE])
    first_done_index = next(i for i, event in enumerate(expected_events) if "[DONE]" in event)
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
        f"[DONE] count mismatch for Turn 1: actual={actual_done_count}, expected=1"
    )

    # And: Turn 1 should be IDENTICAL to approval fixture Turn 1
    # (ADR-0007: approved/denied have same timing for Turn 1)
    # This is verified by comparing with process_payment-approved-sse-baseline
    # Turn 1 events (excluding dynamic fields like messageId).
    # The only difference should be in Turn 2 (not tested here).
    assert expected_done_count == 2, f"Fixture should have 2 turns, but has {expected_done_count}"

    # ===== TURN 2: Denial Execution =====
    print("\n=== TURN 2: Sending denial and testing execution ===")

    # Extract tool call IDs from Turn 1
    original_id, confirmation_id = extract_tool_call_ids_from_turn1(actual_events)
    assert original_id is not None, "Should have original tool call ID (process_payment)"
    assert confirmation_id is not None, "Should have confirmation tool call ID"

    # Reconstruct assistant's confirmation message from Turn 1 events
    assistant_msg = create_assistant_message_from_turn1(actual_events)

    # Construct denial message
    denial_msg = create_denial_message(confirmation_id, original_id)

    # Build complete message history for Turn 2
    turn2_messages = [
        *input_messages,  # Original user message
        assistant_msg,  # Assistant's confirmation response
        denial_msg,  # User's denial response
    ]

    # Send Turn 2 request with denial
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

    # Structure validation for Turn 2 (tool error and AI text are dynamic)
    # Note: SSE mode includes text-* events, so we need to validate them
    is_match_turn2, diff_msg_turn2 = compare_raw_events(
        actual=turn2_events,
        expected=expected_turn2_events,
        normalize=True,
        dynamic_content_tools=["process_payment"],
        include_text_events=True,  # SSE mode fixtures include text-* events
    )
    assert is_match_turn2, f"Turn 2 rawEvents structure mismatch:\n{diff_msg_turn2}"

    # And: Should have exactly 1 [DONE] marker (Turn 2 only)
    actual_done_count_turn2 = count_done_markers(turn2_events)
    assert actual_done_count_turn2 == 1, (
        f"[DONE] count mismatch for Turn 2: actual={actual_done_count_turn2}, expected=1"
    )

    # And: Should contain tool-output-error event (tool rejection)
    # Note: tool-output-error events don't include toolName, only toolCallId
    tool_error_events = [event for event in turn2_events if "tool-output-error" in event]
    assert len(tool_error_events) > 0, "Turn 2 should have tool-output-error event (tool rejection)"

    print("\n✅ Full invocation (Turn 1 + Turn 2) passed!")

    # Save combined events (Turn 1 + Turn 2) to fixture
    all_events = actual_events + turn2_events
    save_frontend_fixture(
        fixture_path=fixture_path,
        description="SSE mode baseline - process_payment with denial flow (MULTI-REQUEST: confirmation + rejection)",
        mode="sse",
        input_messages=input_messages,
        raw_events=all_events,
        expected_done_count=2,
        source="Backend E2E test capture",
        scenario="User denies process_payment tool call - complete flow from confirmation request to rejection",
        note="This fixture captures TWO separate HTTP requests: (1) Initial request ending with confirmation [DONE], (2) Denial response ending with rejection [DONE].",
    )
