"""Backend E2E Test: process_payment-denied-bidi-baseline.json

Tests backend behavior against process_payment BIDI baseline fixture with denial flow.

Fixture: fixtures/frontend/process_payment-denied-bidi-baseline.json
Mode: BIDI Blocking Mode (single continuous stream)
Tool: process_payment (requires approval)
Transport: WebSocket (BIDI mode)

Expected Flow (BIDI Blocking Mode):
- Single continuous stream (no [DONE] between approval request and response)
- User: Initial request
- Backend: tool-input → adk_request_confirmation (tool is BLOCKING, waiting for approval)
- User: denial response (unblocks the BLOCKING tool)
- Backend: tool-output-error → finish → [DONE]

Note: BIDI Blocking Mode mode uses single stream with 1 [DONE], not 2 turns.
"""

import asyncio
import json
from pathlib import Path

import pytest
import websockets

from .helpers import (
    compare_raw_events,
    load_frontend_fixture,
    receive_events_until_approval_request,
    save_frontend_fixture,
    validate_no_adk_request_confirmation_tool_input,
    validate_tool_approval_request_toolcallid,
)


@pytest.mark.asyncio
async def test_process_payment_denied_bidi_baseline(frontend_fixture_dir: Path):
    """Should generate correct rawEvents for process_payment denial flow (BIDI Blocking Mode)."""
    # Given: Frontend baseline fixture (BIDI Blocking Mode)
    fixture_path = frontend_fixture_dir / "process_payment-denied-bidi-baseline.json"
    fixture = await load_frontend_fixture(fixture_path)

    input_messages = fixture["input"]["messages"]
    expected_events = fixture["output"]["rawEvents"]
    expected_done_count = fixture["output"]["expectedDoneCount"]

    timeout = 35.0  # Slightly longer than tool timeout (30s)

    async with websockets.connect(
        "ws://localhost:8000/live",
        open_timeout=timeout,
        close_timeout=10.0,
    ) as websocket:
        print("\n=== PHASE 12 BLOCKING MODE TEST (DENIAL) ===")
        print("Expected: Single continuous stream with 1 [DONE]")
        print("Tool will BLOCK awaiting approval, then return error\n")

        # Send initial request
        await websocket.send(json.dumps({"type": "message", "messages": input_messages}))
        print("✓ Sent initial request")

        # Receive events until we get tool-approval-request
        (
            all_events,
            confirmation_id,
            original_tool_call_id,
        ) = await receive_events_until_approval_request(
            websocket=websocket,
            original_tool_name="process_payment",
            timeout=5.0,
        )

        assert confirmation_id is not None, "Should have confirmation_id"
        assert original_tool_call_id is not None, "Should have original tool call ID"

        # Immediately send denial (don't wait for [DONE])
        print("\n=== Sending denial (tool is BLOCKING, awaiting this) ===")
        denial_message = {
            "role": "user",
            "parts": [
                {
                    "type": "tool-adk_request_confirmation",
                    "toolCallId": confirmation_id,
                    "toolName": "adk_request_confirmation",
                    "state": "approval-responded",
                    "approval": {
                        "id": confirmation_id,
                        "approved": False,
                        "reason": "User rejected the operation",
                    },
                }
            ],
        }

        await websocket.send(json.dumps({"type": "message", "messages": [denial_message]}))
        print("✓ Sent denial message")

        # Continue receiving events until [DONE]
        print("\n=== Receiving remaining events until [DONE] ===")
        while True:
            try:
                event_raw = await asyncio.wait_for(websocket.recv(), timeout=10.0)
                # Ensure event is str (websocket.recv() can return bytes or str)
                event = event_raw.decode("utf-8") if isinstance(event_raw, bytes) else event_raw
                all_events.append(event)
                print(f"Event {len(all_events)}: {event.strip()}")

                if "[DONE]" in event:
                    print("\n✓ Received [DONE]")
                    break
            except TimeoutError:
                print(f"\n✗ Timeout waiting for [DONE] after {len(all_events)} events")
                raise

        # Verify results
        print("\n=== VERIFICATION ===")

        # Validate tool-approval-request toolCallId matches original tool's toolCallId
        is_valid, error_msg = validate_tool_approval_request_toolcallid(all_events)
        assert is_valid, f"tool-approval-request toolCallId validation failed:\n{error_msg}"
        print("✓ tool-approval-request toolCallId matches original tool")

        # Validate no adk_request_confirmation tool-input events
        is_valid, error_msg = validate_no_adk_request_confirmation_tool_input(all_events)
        assert is_valid, f"adk_request_confirmation tool-input validation failed:\n{error_msg}"
        print("✓ No forbidden adk_request_confirmation tool-input events")

        # Count [DONE] markers
        done_count = sum(1 for e in all_events if "[DONE]" in e)
        print(f"[DONE] count: {done_count} (expected: {expected_done_count})")
        assert done_count == expected_done_count, (
            f"Expected {expected_done_count} [DONE], got {done_count}"
        )

        # Verify we got tool-output-error
        tool_output_events = [
            e for e in all_events if "tool-output" in e and original_tool_call_id in e
        ]
        print(f"Tool output events: {len(tool_output_events)}")
        assert len(tool_output_events) > 0, "Should have tool output event"

        print("\n✓ BIDI Blocking Mode denial flow test completed successfully")

    # Total should be 1 [DONE] marker
    total_done_count = done_count
    assert total_done_count == expected_done_count, (
        f"Total [DONE] count mismatch: actual={total_done_count}, expected={expected_done_count}"
    )

    # Save events to fixture (BEFORE comparison to ensure fixture is saved even if assertion fails)
    save_frontend_fixture(
        fixture_path=fixture_path,
        description="BIDI Blocking Mode - process_payment with denial flow (SINGLE CONTINUOUS STREAM)",
        mode="bidi",
        input_messages=input_messages,
        raw_events=all_events,
        expected_done_count=1,
        source="Backend E2E test capture",
        scenario="User denies process_payment tool call - BIDI Blocking Mode mode where tool awaits approval inside function",
        note="BIDI Blocking Mode behavior: Single continuous stream with 1 [DONE]. Tool enters BLOCKING state awaiting approval, then returns error after denial. This is different from Legacy Approval Mode where tool returns pending immediately.",
    )

    # Verify against expected events (structure comparison) - MOVED AFTER SAVE
    is_match, diff_msg = compare_raw_events(
        actual=all_events,
        expected=expected_events,
        normalize=True,
        dynamic_content_tools=["process_payment", "adk_request_confirmation"],
        include_text_events=False,  # Ignore text-* events (thought process is non-deterministic)
    )
    assert is_match, f"rawEvents structure mismatch:\n{diff_msg}"
