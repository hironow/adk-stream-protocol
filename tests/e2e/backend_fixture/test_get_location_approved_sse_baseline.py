"""Backend E2E Test: get_location-approved-sse-baseline.json

Tests backend behavior against get_location approval flow SSE baseline fixture.

Fixture: fixtures/frontend/get_location-approved-sse-baseline.json
Invocation: 1 Invocation, 2 Turns
Tool: get_location (frontend-delegated, requires approval, no arguments)

SSE Mode Execution Pattern:
- **Pattern A only** (1-request): approval + tool result in same HTTP request
- Pattern B (2-request) is NOT supported in SSE mode due to request-response lifecycle
- See ADR-0008 for rationale

Expected Flow:
Turn 1 (Confirmation Request):
- User: "現在地を教えて"
- Backend: tool-input-start → tool-input-available (empty args) → adk_request_confirmation → [DONE]

Turn 2 (Approved Execution - Pattern A):
- User approval response + tool execution result (single request)
- Backend: tool-output-available → location data → [DONE]

Note: get_location takes no arguments (input: {}).
This is a Frontend-Delegated pattern (execution happens in frontend, result sent to backend).
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
    save_frontend_fixture,
    send_sse_request,
    validate_no_adk_request_confirmation_tool_input,
    validate_tool_approval_request_toolcallid,
)


@pytest.mark.asyncio
async def test_get_location_approved_sse_baseline(frontend_fixture_dir: Path):
    """SSE Mode: Pattern A (1-request) - Standard frontend-delegated tool flow.

    SSE mode ONLY supports Pattern A where approval and tool result are sent together.
    This matches the natural frontend flow: approve → execute → send both in one request.

    Flow:
    - Request 1 (Turn 1): Initial message → Return confirmation
    - Request 2 (Turn 2): Approval + Tool result (single request) → AI response with location data

    Technical Implementation:
    - Pre-resolution cache handles timing: result arrives before Future creation
    - Backend uses cached result when ADK calls get_location()
    - No timeout, immediate response

    See ADR-0008 for why Pattern B (2-request) is not supported in SSE mode.
    """
    # Given: Frontend baseline fixture (2 turns)
    fixture_path = frontend_fixture_dir / "get_location-approved-sse-baseline.json"
    fixture = await load_frontend_fixture(fixture_path)

    input_messages = fixture["input"]["messages"]
    expected_events = fixture["output"]["rawEvents"]
    expected_done_count = fixture["output"]["expectedDoneCount"]

    # ===== TURN 1: Send initial request and verify confirmation =====
    # When: Send request to backend SSE endpoint (Turn 1 only)
    # Note: Turn 2 (approval execution) is NOT yet implemented in this test.
    actual_events = await send_sse_request(
        messages=input_messages,
        backend_url="http://localhost:8000/stream",
    )

    # Then: rawEvents should match expected Turn 1
    # Extract Turn 1 events (up to first [DONE])
    first_done_index = next(i for i, event in enumerate(expected_events) if "[DONE]" in event)
    expected_turn1_events = expected_events[: first_done_index + 1]

    # Validate tool-approval-request toolCallId matches original tool's toolCallId
    is_valid, error_msg = validate_tool_approval_request_toolcallid(actual_events)
    assert is_valid, f"Turn 1: tool-approval-request toolCallId validation failed:\n{error_msg}"
    print("✓ Turn 1: tool-approval-request toolCallId matches original tool")

    # Validate no adk_request_confirmation tool-input events
    is_valid, error_msg = validate_no_adk_request_confirmation_tool_input(actual_events)
    assert is_valid, f"Turn 1: adk_request_confirmation tool-input validation failed:\n{error_msg}"
    print("✓ Turn 1: No forbidden adk_request_confirmation tool-input events")

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
        f"[DONE] count mismatch for Turn 1: actual={actual_done_count}, expected=1"
    )

    # And: Should contain tool-input-available with empty args
    tool_input_events = [
        event
        for event in actual_events
        if "tool-input-available" in event and "get_location" in event
    ]
    assert len(tool_input_events) > 0, "Should have tool-input-available for get_location"

    # Verify empty input: {} in the event
    # (This is characteristic of get_location - no arguments needed)
    assert '"input": {}' in tool_input_events[0], "get_location should have empty input: {}"

    assert expected_done_count == 2, f"Fixture should have 2 turns, but has {expected_done_count}"

    # ===== TURN 2: Approval Execution =====
    print("\n=== TURN 2: Sending approval and testing execution ===")

    # Extract tool call IDs from Turn 1
    original_id, confirmation_id = extract_tool_call_ids_from_turn1(actual_events)
    assert original_id is not None, "Should have original tool call ID (get_location)"
    assert confirmation_id is not None, "Should have confirmation tool call ID"

    # Reconstruct assistant's confirmation message from Turn 1 events
    assistant_msg = create_assistant_message_from_turn1(actual_events)

    # Construct approval message with tool result (get_location is frontend-delegated)
    mock_location_result = {
        "latitude": 35.6762,
        "longitude": 139.6503,
        "accuracy": 20,
        "city": "Tokyo",
        "country": "Japan",
    }
    approval_msg = create_approval_message(
        confirmation_id,
        original_id,
        tool_result=mock_location_result,
    )

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

    # Validate Turn 2 events
    is_valid, error_msg = validate_no_adk_request_confirmation_tool_input(turn2_events)
    assert is_valid, f"Turn 2: adk_request_confirmation tool-input validation failed:\n{error_msg}"
    print("✓ Turn 2: No forbidden adk_request_confirmation tool-input events")

    # Extract expected Turn 2 events from fixture (after first [DONE])
    expected_turn2_events = expected_events[first_done_index + 1 :]

    print(f"\n=== EXPECTED TURN 2 EVENTS (count={len(expected_turn2_events)}) ===")
    for i, event in enumerate(expected_turn2_events):
        print(f"{i}: {event.strip()}")

    # Structure validation for Turn 2 (tool output and AI text are dynamic)
    # Note: SSE mode includes text-* events, so we need to validate them
    is_match_turn2, diff_msg_turn2 = compare_raw_events(
        actual=turn2_events,
        expected=expected_turn2_events,
        normalize=True,
        dynamic_content_tools=["get_location"],
        include_text_events=True,  # SSE mode fixtures include text-* events
    )
    assert is_match_turn2, f"Turn 2 rawEvents structure mismatch:\n{diff_msg_turn2}"

    # And: Should have exactly 1 [DONE] marker (Turn 2 only)
    actual_done_count_turn2 = count_done_markers(turn2_events)
    assert actual_done_count_turn2 == 1, (
        f"[DONE] count mismatch for Turn 2: actual={actual_done_count_turn2}, expected=1"
    )

    # And: Should contain tool-output-available event (tool execution result)
    # Note: tool-output-available events don't include toolName, only toolCallId
    tool_output_events = [event for event in turn2_events if "tool-output-available" in event]
    assert len(tool_output_events) > 0, (
        "Turn 2 should have tool-output-available event (tool execution result)"
    )

    print("\n✅ Full invocation (Turn 1 + Turn 2) passed!")

    # Save combined events (Turn 1 + Turn 2) to fixture
    all_events = actual_events + turn2_events
    save_frontend_fixture(
        fixture_path=fixture_path,
        description="SSE mode baseline - get_location with approval flow (MULTI-REQUEST: confirmation + execution)",
        mode="sse",
        input_messages=input_messages,
        raw_events=all_events,
        expected_done_count=2,
        source="Backend E2E test capture",
        scenario="User approves get_location tool call - complete flow from confirmation request to successful execution",
        note="This fixture captures TWO separate HTTP requests: (1) Initial request ending with confirmation [DONE], (2) Approval response with tool result ending with execution [DONE].",
    )
