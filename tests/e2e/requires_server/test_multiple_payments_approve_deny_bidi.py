"""Backend E2E Test: multiple-payments-approve-deny-bidi.json

BIDI mode SEQUENTIAL execution with approve×deny pattern.

Expected Flow:
Turn 1: Alice approval request
Turn 2: Alice approved → Alice execution + Bob approval request
Turn 3: Bob denied → Bob error + final response
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
async def test_multiple_payments_approve_deny_bidi(frontend_fixture_dir: Path):
    """BIDI sequential execution: Alice approved, Bob denied."""
    fixture_path = frontend_fixture_dir / "multiple-payments-approve-deny-bidi.json"

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
        print("\n=== BIDI SEQUENTIAL: approve×deny ===")

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

        # Turn 2: Alice approved → Alice execution + Bob approval request
        print("\n=== TURN 2: Alice approval (approved) ===")

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
                        "approved": True,  # Alice: approved
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

        # Validate Turn 2
        alice_output_events = [
            e for e in turn2_events if "tool-output-available" in e and alice_tool_call_id in e
        ]
        assert len(alice_output_events) == 1, (
            f"Expected 1 Alice output, got {len(alice_output_events)}"
        )
        print("✓ Turn 2: Alice execution successful + Bob approval request")

        # Turn 3: Bob denied → Bob error + final response
        print("\n=== TURN 3: Bob approval (denied) ===")

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
                        "approved": False,  # Bob: denied
                        "reason": "User denied the payment to Bob",
                    },
                }
            ],
        }

        await websocket.send(json.dumps({"type": "message", "messages": [bob_approval_message]}))

        turn3_events: list[str] = []
        while True:
            try:
                event_raw = await asyncio.wait_for(websocket.recv(), timeout=10.0)
                # Ensure event is str (websocket.recv() can return bytes or str)
                event = event_raw.decode("utf-8") if isinstance(event_raw, bytes) else event_raw
                turn3_events.append(event)
                all_events.append(event)

                if "[DONE]" in event:
                    break
            except TimeoutError:
                print(f"\n✗ Timeout after {len(turn3_events)} events")
                raise

        # Validate Turn 3 - Bob denied → tool-output-error
        bob_error = None
        for event in turn3_events:
            if not event.startswith("data: ") or "[DONE]" in event:
                continue
            try:
                json_str = event[6:].strip()
                event_data = json.loads(json_str)
                if (
                    event_data.get("type") == "tool-output-error"
                    and event_data.get("toolCallId") == bob_tool_call_id
                ):
                    bob_error = event_data.get("errorText", "")
                    print(f"✓ Turn 3: Found Bob tool-output-error: {bob_error}")
                    break
            except (json.JSONDecodeError, KeyError):
                continue

        # Verify Bob was denied
        assert bob_error is not None, "Expected Bob tool-output-error event"
        assert "denied" in bob_error.lower() or "rejected" in bob_error.lower(), (
            f"Bob error should mention denial/rejection: {bob_error}"
        )
        print(f"✓ Turn 3: Bob denied: {bob_error}")

        done_count = count_done_markers(turn3_events)
        assert done_count == 1
        print("✓ Turn 3: Bob execution (denied) + [DONE]")

        print("\n✅ BIDI approve×deny completed!")

    save_frontend_fixture(
        fixture_path=fixture_path,
        description="BIDI SEQUENTIAL - approve×deny (Alice approved, Bob denied)",
        mode="bidi",
        input_messages=initial_messages,
        raw_events=all_events,
        expected_done_count=1,
        source="Backend E2E test capture",
        scenario="BIDI sequential execution: Turn 1 (Alice request) → Turn 2 (Alice approved) → Turn 3 (Bob denied)",
        note="Tests BIDI sequential execution with mixed approval (approve×deny).",
    )
