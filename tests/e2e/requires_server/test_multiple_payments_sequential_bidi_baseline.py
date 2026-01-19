"""Backend E2E Test: multiple-payments-sequential-bidi-baseline.json

Tests backend behavior for SEQUENTIAL process_payment approval flow (BIDI baseline fixture).

Fixture: fixtures/frontend/multiple-payments-sequential-bidi-baseline.json
Mode: BIDI (WebSocket)
Tool: process_payment (requires approval) x2
Transport: WebSocket (BIDI mode)

Expected Flow (BIDI Sequential Execution):
Turn 1 (First Payment Confirmation):
- User: "Aliceに30ドル、Bobに40ドル送金してください"
- Backend:
  - tool-input-start/available (process_payment #1 - Alice ONLY)
  - tool-approval-request #1 (Alice)
  [BLOCKS - Bob payment NOT generated yet]

Turn 2 (First Payment Execution + Second Payment Confirmation):
- User: Alice approval
- Backend:
  - tool-output-available (process_payment #1 - Alice)
  - tool-input-start/available (process_payment #2 - Bob) ← NOW generated
  - tool-approval-request #2 (Bob)
  [BLOCKS - awaiting Bob approval]

Turn 3 (Second Payment Execution + Final Response):
- User: Bob approval
- Backend:
  - tool-output-available (process_payment #2 - Bob)
  - text-delta/text-done (AI response)
  - [DONE]

Note: This fixture demonstrates BIDI mode sequential tool execution (Gemini Live API limitation).
Unlike SSE mode which generates both tool calls in parallel, BIDI generates tools one at a time.
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
async def test_multiple_payments_sequential_bidi_baseline(frontend_fixture_dir: Path):
    """Should generate correct rawEvents for SEQUENTIAL process_payment approval flows (BIDI)."""
    # Given: Frontend baseline fixture for BIDI sequential execution
    fixture_path = frontend_fixture_dir / "multiple-payments-sequential-bidi-baseline.json"

    # Initial input: Multiple payments in single message (but BIDI executes sequentially)
    initial_messages = [
        {
            "role": "user",
            "content": "Aliceに30ドル、Bobに40ドル送金してください",
        }
    ]

    timeout = 35.0  # Slightly longer than tool timeout (30s)

    async with websockets.connect(
        "ws://localhost:8000/live",
        open_timeout=timeout,
        close_timeout=10.0,
    ) as websocket:
        print("\n=== BIDI MODE SEQUENTIAL EXECUTION TEST (2 PAYMENTS) ===")
        print("Expected: 3 turns (Alice approval → Bob approval → final response)")
        print("BIDI executes tools SEQUENTIALLY, not in parallel\n")

        all_events: list[str] = []

        # ===== TURN 1: First payment (Alice) confirmation =====
        print("\n=== TURN 1: Sending request for 2 payments (only Alice will be generated) ===")
        await websocket.send(json.dumps({"type": "message", "messages": initial_messages}))
        print("✓ Sent initial request")

        # Receive events until we get first tool-approval-request
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

        print(f"\n=== TURN 1 EVENTS (count={len(turn1_events)}) ===")
        for i, event in enumerate(turn1_events):
            print(f"{i}: {event.strip()}")

        assert alice_confirmation_id is not None, "Should have Alice confirmation ID"
        assert alice_tool_call_id is not None, "Should have Alice tool call ID"

        # Validate Turn 1
        is_valid, error_msg = validate_tool_approval_request_toolcallid(turn1_events)
        assert is_valid, f"Turn 1: tool-approval-request toolCallId validation failed:\n{error_msg}"
        print("✓ Turn 1: tool-approval-request toolCallId matches original tool")

        is_valid, error_msg = validate_no_adk_request_confirmation_tool_input(turn1_events)
        assert is_valid, (
            f"Turn 1: adk_request_confirmation tool-input validation failed:\n{error_msg}"
        )
        print("✓ Turn 1: No forbidden adk_request_confirmation tool-input events")

        # Count tool-approval-request events (should be 1 in BIDI mode)
        approval_requests_turn1 = [e for e in turn1_events if "tool-approval-request" in e]
        assert len(approval_requests_turn1) == 1, (
            f"BIDI Turn 1: Expected 1 tool-approval-request (sequential execution), got {len(approval_requests_turn1)}"
        )
        print(
            f"✓ Turn 1: Found {len(approval_requests_turn1)} tool-approval-request (Alice only, Bob not generated yet)"
        )

        # ===== TURN 2: Alice approval → Alice execution + Bob confirmation =====
        print(
            "\n=== TURN 2: Sending Alice approval (expect Alice execution + Bob approval request) ==="
        )

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
                        "approved": True,
                    },
                }
            ],
        }

        await websocket.send(json.dumps({"type": "message", "messages": [alice_approval_message]}))
        print("✓ Sent Alice approval")

        # Receive events until we get second tool-approval-request (Bob)
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

        print(f"\n=== TURN 2 EVENTS (count={len(turn2_events)}) ===")
        for i, event in enumerate(turn2_events):
            print(f"{i}: {event.strip()}")

        assert bob_confirmation_id is not None, "Should have Bob confirmation ID"
        assert bob_tool_call_id is not None, "Should have Bob tool call ID"

        # Validate Turn 2
        is_valid, error_msg = validate_tool_approval_request_toolcallid(all_events)
        assert is_valid, f"Turn 2: tool-approval-request toolCallId validation failed:\n{error_msg}"
        print("✓ Turn 2: tool-approval-request toolCallIds match original tools")

        is_valid, error_msg = validate_no_adk_request_confirmation_tool_input(turn2_events)
        assert is_valid, (
            f"Turn 2: adk_request_confirmation tool-input validation failed:\n{error_msg}"
        )
        print("✓ Turn 2: No forbidden adk_request_confirmation tool-input events")

        # Should have Alice tool-output and Bob approval-request
        alice_output_events = [
            e for e in turn2_events if "tool-output-available" in e and alice_tool_call_id in e
        ]
        assert len(alice_output_events) == 1, (
            f"Turn 2: Expected 1 Alice tool-output, got {len(alice_output_events)}"
        )
        print("✓ Turn 2: Found Alice tool-output-available")

        approval_requests_turn2 = [e for e in turn2_events if "tool-approval-request" in e]
        assert len(approval_requests_turn2) == 1, (
            f"Turn 2: Expected 1 Bob tool-approval-request, got {len(approval_requests_turn2)}"
        )
        print("✓ Turn 2: Found Bob tool-approval-request")

        # ===== TURN 3: Bob approval → Bob execution + final response =====
        print("\n=== TURN 3: Sending Bob approval (expect Bob execution + final response) ===")

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
                        "approved": True,
                    },
                }
            ],
        }

        await websocket.send(json.dumps({"type": "message", "messages": [bob_approval_message]}))
        print("✓ Sent Bob approval")

        # Continue receiving events until [DONE]
        print("\n=== TURN 3: Receiving events until [DONE] ===")
        turn3_events: list[str] = []
        while True:
            try:
                event_raw = await asyncio.wait_for(websocket.recv(), timeout=10.0)
                # Ensure event is str (websocket.recv() can return bytes or str)
                event = event_raw.decode("utf-8") if isinstance(event_raw, bytes) else event_raw
                turn3_events.append(event)
                all_events.append(event)
                print(f"Event {len(turn3_events)}: {event.strip()}")

                if "[DONE]" in event:
                    print("\n✓ Received [DONE]")
                    break
            except TimeoutError:
                print(f"\n✗ Timeout waiting for [DONE] after {len(turn3_events)} events")
                raise

        print(f"\n=== TURN 3 EVENTS (count={len(turn3_events)}) ===")

        # Validate Turn 3
        is_valid, error_msg = validate_no_adk_request_confirmation_tool_input(turn3_events)
        assert is_valid, (
            f"Turn 3: adk_request_confirmation tool-input validation failed:\n{error_msg}"
        )
        print("✓ Turn 3: No forbidden adk_request_confirmation tool-input events")

        # Should have Bob tool-output
        bob_output_events = [
            e for e in turn3_events if "tool-output-available" in e and bob_tool_call_id in e
        ]
        assert len(bob_output_events) == 1, (
            f"Turn 3: Expected 1 Bob tool-output, got {len(bob_output_events)}"
        )
        print("✓ Turn 3: Found Bob tool-output-available")

        # Should have [DONE]
        done_count = count_done_markers(turn3_events)
        assert done_count == 1, f"Turn 3: Expected 1 [DONE], got {done_count}"
        print("✓ Turn 3: Found [DONE] marker")

        # ===== FINAL VALIDATION =====
        print("\n=== FINAL VALIDATION ===")

        # Total should be 1 [DONE] marker (BIDI continuous stream)
        total_done_count = count_done_markers(all_events)
        assert total_done_count == 1, (
            f"Total [DONE] count mismatch: actual={total_done_count}, expected=1"
        )
        print(f"✓ Total [DONE] count: {total_done_count}")

        # Should have 2 tool-output-available events total (both payments executed)
        all_tool_outputs = [e for e in all_events if "tool-output-available" in e]
        assert len(all_tool_outputs) == 2, (
            f"Expected 2 tool-output-available events total (both payments), got {len(all_tool_outputs)}"
        )
        print(f"✓ Total tool-output-available events: {len(all_tool_outputs)}")

        # Should have 2 tool-approval-request events total
        all_approval_requests = [e for e in all_events if "tool-approval-request" in e]
        assert len(all_approval_requests) == 2, (
            f"Expected 2 tool-approval-request events total, got {len(all_approval_requests)}"
        )
        print(f"✓ Total tool-approval-request events: {len(all_approval_requests)}")

        print("\n✅ All 3 turns completed! BIDI sequential execution verified")

    # Save combined events (Turn 1 + Turn 2 + Turn 3) to fixture
    save_frontend_fixture(
        fixture_path=fixture_path,
        description="BIDI mode baseline - SEQUENTIAL process_payment with approval flows (3 TURNS: Alice → Bob → response)",
        mode="bidi",
        input_messages=initial_messages,
        raw_events=all_events,
        expected_done_count=1,  # BIDI has 1 [DONE] marker (continuous stream)
        source="Backend E2E test capture",
        scenario="User requests two payments (Alice 30ドル, Bob 40ドル) in single message - BIDI executes SEQUENTIALLY: Turn 1 (Alice approval request) → Turn 2 (Alice execution + Bob approval request) → Turn 3 (Bob execution + final response)",
        note="This fixture demonstrates BIDI mode's sequential tool execution limitation (Gemini Live API behavior). Unlike SSE which generates both tool calls in parallel, BIDI generates tools one at a time due to types.Behavior.BLOCKING. This is a fundamental difference between SSE (generateContent API) and BIDI (Live API).",
    )
