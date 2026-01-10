"""Backend E2E Test: multiple-payments-deny-deny-sse.json

Tests backend behavior for parallel process_payment with BOTH DENIED approval flow (SSE).

Fixture: fixtures/frontend/multiple-payments-deny-deny-sse.json
Invocation: 1 Invocation, 2 Turns (2 parallel payments, both denied)
Tool: process_payment (multi-turn, requires approval) x2

Expected Flow:
Turn 1 (Confirmation Request - Multiple Tools):
- User: "Aliceに30ドル、Bobに40ドル送金してください"
- Backend:
  - tool-input-start/available (process_payment #1 - Alice)
  - tool-approval-request #1
  - tool-input-start/available (process_payment #2 - Bob)
  - tool-approval-request #2
  - [DONE]

Turn 2 (Both Denied Execution):
- User approval responses (Alice: denied, Bob: denied)
- Backend:
  - tool-output-available (process_payment #1 - Alice denied with error)
  - tool-output-available (process_payment #2 - Bob denied with error)
  - text-delta/text-done (AI response acknowledging both denials)
  - [DONE]

Purpose: Verify backend correctly handles case where all approvals are denied.
"""

from pathlib import Path

import pytest

from .helpers import (
    count_done_markers,
    create_assistant_message_from_turn1,
    save_frontend_fixture,
    send_sse_request,
    validate_no_adk_request_confirmation_tool_input,
    validate_tool_approval_request_toolcallid,
)


@pytest.mark.asyncio
async def test_multiple_payments_deny_deny_sse(frontend_fixture_dir: Path):
    """Should generate correct rawEvents for parallel process_payment with deny×deny flow."""
    # Given: Frontend baseline fixture (2 turns - both denied)
    fixture_path = frontend_fixture_dir / "multiple-payments-deny-deny-sse.json"

    # Initial input: Multiple payments in single message
    initial_messages = [
        {
            "role": "user",
            "content": "Aliceに30ドル、Bobに40ドル送金してください",
        }
    ]

    # ===== TURN 1: Multiple payment confirmation requests =====
    print("\n=== TURN 1: Sending multiple payment request (Alice 30ドル, Bob 40ドル) ===")
    turn1_events = await send_sse_request(
        messages=initial_messages,
        backend_url="http://localhost:8000/stream",
    )

    # DEBUG: Print Turn 1 events
    print(f"\n=== TURN 1 EVENTS (count={len(turn1_events)}) ===")
    for i, event in enumerate(turn1_events):
        print(f"{i}: {event.strip()}")

    # Validate Turn 1
    is_valid, error_msg = validate_tool_approval_request_toolcallid(turn1_events)
    assert is_valid, f"Turn 1: tool-approval-request toolCallId validation failed:\n{error_msg}"
    print("✓ Turn 1: tool-approval-request toolCallIds match original tools")

    is_valid, error_msg = validate_no_adk_request_confirmation_tool_input(turn1_events)
    assert is_valid, f"Turn 1: adk_request_confirmation tool-input validation failed:\n{error_msg}"
    print("✓ Turn 1: No forbidden adk_request_confirmation tool-input events")

    # Count tool-approval-request events (should be 2)
    approval_requests = [e for e in turn1_events if "tool-approval-request" in e]
    assert len(approval_requests) == 2, (
        f"Expected 2 tool-approval-requests, got {len(approval_requests)}"
    )
    print(f"✓ Turn 1: Found {len(approval_requests)} tool-approval-requests")

    actual_done_count_turn1 = count_done_markers(turn1_events)
    assert actual_done_count_turn1 == 1, (
        f"[DONE] count mismatch for Turn 1: actual={actual_done_count_turn1}, expected=1"
    )

    # ===== TURN 2: Both denied =====
    print("\n=== TURN 2: Sending both denials (Alice: denied, Bob: denied) ===")

    # Extract all tool call IDs from Turn 1 (2 pairs)
    import json

    tool_call_pairs = []  # [(original_id, approval_id), ...]
    for event in turn1_events:
        if not event.startswith("data: "):
            continue
        if "[DONE]" in event:
            continue

        try:
            json_str = event[6:].strip()
            event_data = json.loads(json_str)

            if event_data.get("type") == "tool-approval-request":
                original_id = event_data.get("toolCallId")
                approval_id = event_data.get("approvalId")
                if original_id and approval_id:
                    tool_call_pairs.append((original_id, approval_id))
                    print(f"  Found approval pair: original={original_id}, approval={approval_id}")
        except (json.JSONDecodeError, KeyError):
            continue

    assert len(tool_call_pairs) == 2, f"Expected 2 tool call pairs, got {len(tool_call_pairs)}"

    # Create assistant message from Turn 1
    assistant_msg = create_assistant_message_from_turn1(turn1_events)

    # Create approval messages: both denied
    approval_msg = {
        "role": "user",
        "parts": [
            {
                "type": "tool-adk_request_confirmation",
                "toolCallId": tool_call_pairs[0][1],  # First approval (Alice)
                "toolName": "adk_request_confirmation",
                "state": "approval-responded",
                "approval": {
                    "id": tool_call_pairs[0][1],
                    "approved": False,  # Alice: denied
                    "reason": "User denied the payment to Alice",
                },
            },
            {
                "type": "tool-adk_request_confirmation",
                "toolCallId": tool_call_pairs[1][1],  # Second approval (Bob)
                "toolName": "adk_request_confirmation",
                "state": "approval-responded",
                "approval": {
                    "id": tool_call_pairs[1][1],
                    "approved": False,  # Bob: denied
                    "reason": "User denied the payment to Bob",
                },
            },
        ],
    }

    turn2_messages = [
        *initial_messages,
        assistant_msg,
        approval_msg,
    ]

    turn2_events = await send_sse_request(
        messages=turn2_messages,
        backend_url="http://localhost:8000/stream",
    )

    # DEBUG: Print Turn 2 events
    print(f"\n=== TURN 2 EVENTS (count={len(turn2_events)}) ===")
    for i, event in enumerate(turn2_events):
        print(f"{i}: {event.strip()}")

    # Validate Turn 2
    is_valid, error_msg = validate_no_adk_request_confirmation_tool_input(turn2_events)
    assert is_valid, f"Turn 2: adk_request_confirmation tool-input validation failed:\n{error_msg}"
    print("✓ Turn 2: No forbidden adk_request_confirmation tool-input events")

    actual_done_count_turn2 = count_done_markers(turn2_events)
    assert actual_done_count_turn2 == 1, (
        f"[DONE] count mismatch for Turn 2: actual={actual_done_count_turn2}, expected=1"
    )

    # Should have 2 tool-output-error events (both denied)
    alice_tool_call_id = tool_call_pairs[0][0]  # First tool call (Alice)
    bob_tool_call_id = tool_call_pairs[1][0]  # Second tool call (Bob)

    # Find both error outputs
    alice_error = None
    bob_error = None

    for event in turn2_events:
        if not event.startswith("data: ") or "[DONE]" in event:
            continue
        try:
            json_str = event[6:].strip()
            event_data = json.loads(json_str)

            # Alice denied → tool-output-error
            if (
                event_data.get("type") == "tool-output-error"
                and event_data.get("toolCallId") == alice_tool_call_id
            ):
                alice_error = event_data.get("errorText", "")
                print(f"✓ Found Alice tool-output-error: {alice_error}")

            # Bob denied → tool-output-error
            elif (
                event_data.get("type") == "tool-output-error"
                and event_data.get("toolCallId") == bob_tool_call_id
            ):
                bob_error = event_data.get("errorText", "")
                print(f"✓ Found Bob tool-output-error: {bob_error}")
        except (json.JSONDecodeError, KeyError):
            continue

    # Verify Alice payment was denied
    assert alice_error is not None, "Expected Alice tool-output-error event"
    assert "denied" in alice_error.lower() or "rejected" in alice_error.lower(), (
        f"Alice error should mention denial/rejection: {alice_error}"
    )
    print(f"✓ Alice payment denied: {alice_error}")

    # Verify Bob payment was denied
    assert bob_error is not None, "Expected Bob tool-output-error event"
    assert "denied" in bob_error.lower() or "rejected" in bob_error.lower(), (
        f"Bob error should mention denial/rejection: {bob_error}"
    )
    print(f"✓ Bob payment denied: {bob_error}")

    # Verify AI response acknowledges both denials
    text_deltas = []
    for event in turn2_events:
        if not event.startswith("data: ") or "[DONE]" in event:
            continue
        try:
            json_str = event[6:].strip()
            event_data = json.loads(json_str)
            if event_data.get("type") == "text-delta":
                text_deltas.append(event_data.get("delta", ""))
        except (json.JSONDecodeError, KeyError):
            continue

    ai_response = "".join(text_deltas)
    print(f"\n✓ AI Response: {ai_response}")

    # AI should acknowledge both denials
    assert len(ai_response) > 0, "AI should provide a response"
    print("✓ AI provided response for both denials scenario")

    print("\n✅ Both denials scenario (deny×deny) completed!")

    # Save combined events (Turn 1 + Turn 2) to fixture
    all_events = turn1_events + turn2_events
    save_frontend_fixture(
        fixture_path=fixture_path,
        description="SSE mode baseline - Parallel process_payment with BOTH DENIED (Alice denied, Bob denied)",
        mode="sse",
        input_messages=initial_messages,
        raw_events=all_events,
        expected_done_count=2,  # 2 [DONE] markers (one per turn)
        source="Backend E2E test capture",
        scenario="User requests two parallel payments (Alice 30ドル, Bob 40ドル) in single message - both denied. Tests all-denied approval handling.",
        note="This fixture captures deny×deny pattern: (1) Initial request with 2 tool-approval-requests [DONE], (2) Both denied with 2 tool executions (both errors) [DONE]. Verifies backend and AI correctly handle case where all approvals are denied.",
    )
