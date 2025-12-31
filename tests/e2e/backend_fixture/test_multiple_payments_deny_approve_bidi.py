"""Backend E2E Test: multiple-payments-deny-approve-bidi.json

BIDI mode SEQUENTIAL execution with deny×approve pattern.

Expected Flow:
Turn 1: Alice approval request
Turn 2: Alice denied → Alice error + Bob approval request
Turn 3: Bob approved → Bob execution + final response
"""

import asyncio
import json
from pathlib import Path

import pytest
import websockets

from .helpers import (
    count_done_markers,
    receive_events_until_approval_request,
    save_frontend_fixture,
    validate_no_adk_request_confirmation_tool_input,
    validate_tool_approval_request_toolcallid,
)


@pytest.mark.asyncio
async def test_multiple_payments_deny_approve_bidi(frontend_fixture_dir: Path):
    """BIDI sequential execution: Alice denied, Bob approved."""
    fixture_path = frontend_fixture_dir / "multiple-payments-deny-approve-bidi.json"

    initial_messages = [
        {
            "role": "user",
            "content": "Aliceに30ドル、Bobに40ドル送金してください",
        }
    ]

    timeout = 35.0

    async with websockets.connect(
        "ws://localhost:8000/live",
        open_timeout=timeout,
        close_timeout=10.0,
    ) as websocket:
        print("\n=== BIDI SEQUENTIAL: deny×approve ===")

        all_events: list[str] = []

        # Turn 1: Alice approval request
        print("\n=== TURN 1: Alice approval request ===")
        await websocket.send(json.dumps({"type": "message", "messages": initial_messages}))

        (
            turn1_events,
            alice_confirmation_id,
            alice_tool_call_id,
        ) = await receive_events_until_approval_request(
            websocket=websocket,
            original_tool_name="process_payment",
            timeout=10.0,
        )

        all_events.extend(turn1_events)

        assert alice_confirmation_id is not None
        assert alice_tool_call_id is not None

        # Validate Turn 1
        is_valid, error_msg = validate_tool_approval_request_toolcallid(turn1_events)
        assert is_valid, f"Turn 1 validation failed:\n{error_msg}"

        is_valid, error_msg = validate_no_adk_request_confirmation_tool_input(turn1_events)
        assert is_valid, f"Turn 1 adk_request_confirmation validation failed:\n{error_msg}"

        print("✓ Turn 1: Alice approval request received")

        # Turn 2: Alice denied → Alice error + Bob approval request
        print("\n=== TURN 2: Alice approval (denied) ===")

        alice_approval_message = {
            "role": "user",
            "parts": [
                {
                    "type": "tool-adk_request_confirmation",
                    "toolCallId": alice_confirmation_id,
                    "toolName": "adk_request_confirmation",
                    "state": "approval-responded",
                    "approval": {
                        "id": alice_confirmation_id,
                        "approved": False,  # Alice: denied
                        "reason": "User denied the payment to Alice",
                    },
                }
            ],
        }

        await websocket.send(json.dumps({"type": "message", "messages": [alice_approval_message]}))

        (
            turn2_events,
            bob_confirmation_id,
            bob_tool_call_id,
        ) = await receive_events_until_approval_request(
            websocket=websocket,
            original_tool_name="process_payment",
            timeout=10.0,
        )

        all_events.extend(turn2_events)

        assert bob_confirmation_id is not None
        assert bob_tool_call_id is not None

        # Validate Turn 2 - Alice denied → tool-output-error
        alice_error = None
        for event in turn2_events:
            if not event.startswith("data: ") or "[DONE]" in event:
                continue
            try:
                json_str = event[6:].strip()
                event_data = json.loads(json_str)
                if event_data.get("type") == "tool-output-error" and event_data.get("toolCallId") == alice_tool_call_id:
                    alice_error = event_data.get("errorText", "")
                    print(f"✓ Turn 2: Found Alice tool-output-error: {alice_error}")
                    break
            except (json.JSONDecodeError, KeyError):
                continue

        # Verify Alice was denied
        assert alice_error is not None, "Expected Alice tool-output-error event"
        assert "denied" in alice_error.lower() or "rejected" in alice_error.lower(), \
            f"Alice error should mention denial/rejection: {alice_error}"
        print(f"✓ Turn 2: Alice denied: {alice_error}")
        print("✓ Turn 2: Alice denied + Bob approval request")

        # Turn 3: Bob approved → Bob execution + final response
        print("\n=== TURN 3: Bob approval (approved) ===")

        bob_approval_message = {
            "role": "user",
            "parts": [
                {
                    "type": "tool-adk_request_confirmation",
                    "toolCallId": bob_confirmation_id,
                    "toolName": "adk_request_confirmation",
                    "state": "approval-responded",
                    "approval": {
                        "id": bob_confirmation_id,
                        "approved": True,  # Bob: approved
                    },
                }
            ],
        }

        await websocket.send(json.dumps({"type": "message", "messages": [bob_approval_message]}))

        turn3_events: list[str] = []
        while True:
            try:
                event = await asyncio.wait_for(websocket.recv(), timeout=10.0)
                turn3_events.append(event)
                all_events.append(event)

                if "[DONE]" in event:
                    break
            except TimeoutError:
                print(f"\n✗ Timeout after {len(turn3_events)} events")
                raise

        # Validate Turn 3
        bob_output_events = [e for e in turn3_events if "tool-output-available" in e and bob_tool_call_id in e]
        assert len(bob_output_events) == 1, f"Expected 1 Bob output, got {len(bob_output_events)}"

        # Verify Bob succeeded
        for event in turn3_events:
            if not event.startswith("data: ") or "[DONE]" in event:
                continue
            try:
                json_str = event[6:].strip()
                event_data = json.loads(json_str)
                if event_data.get("type") == "tool-output-available" and event_data.get("toolCallId") == bob_tool_call_id:
                    output = event_data.get("output", {})
                    assert output.get("success") is True, "Bob payment should succeed"
                    print(f"✓ Turn 3: Bob succeeded: {output}")
                    break
            except (json.JSONDecodeError, KeyError):
                continue

        done_count = count_done_markers(turn3_events)
        assert done_count == 1
        print("✓ Turn 3: Bob execution (approved) + [DONE]")

        print("\n✅ BIDI deny×approve completed!")

    save_frontend_fixture(
        fixture_path=fixture_path,
        description="BIDI SEQUENTIAL - deny×approve (Alice denied, Bob approved)",
        mode="bidi",
        input_messages=initial_messages,
        raw_events=all_events,
        expected_done_count=1,
        source="Backend E2E test capture",
        scenario="BIDI sequential execution: Turn 1 (Alice request) → Turn 2 (Alice denied) → Turn 3 (Bob approved)",
        note="Tests BIDI sequential execution with mixed approval (deny×approve).",
    )
