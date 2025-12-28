"""Backend E2E Test: get_location-denied-bidi-baseline.json

Tests backend behavior against get_location BIDI baseline fixture with denial flow (get_location).

Fixture: fixtures/frontend/get_location-denied-bidi-baseline.json
Mode: Phase 12 BLOCKING (single continuous stream)
Tool: get_location (requires approval)
Transport: WebSocket (BIDI mode)

Expected Flow (Phase 12):
- Single continuous stream (no [DONE] between approval request and response)
- User: Initial request
- Backend: tool-input → adk_request_confirmation (tool is BLOCKING, waiting for approval)
- User: denial response (unblocks the BLOCKING tool)
- Backend: tool-output-error → finish → [DONE]

Note: Phase 12 BLOCKING mode uses single stream with 1 [DONE], not 2 turns.
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
async def test_get_location_denied_bidi_baseline(frontend_fixture_dir: Path):
    """Should generate correct rawEvents for get_location denial flow (get_location) (Phase 12 BLOCKING)."""
    # Given: Frontend baseline fixture (Phase 12)
    fixture_path = frontend_fixture_dir / "get_location-denied-bidi-baseline.json"
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
            original_tool_name="get_location",
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
                event = await asyncio.wait_for(websocket.recv(), timeout=10.0)
                all_events.append(event)
                print(f"Event {len(all_events)}: {event.strip()}")

                if "[DONE]" in event:
                    print("\n✓ Received [DONE]")
                    break
            except asyncio.TimeoutError:
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

        # Verify against expected events (structure comparison)
        is_match, diff_msg = compare_raw_events(
            actual=all_events,
            expected=expected_events,
            normalize=True,
            dynamic_content_tools=["get_location", "adk_request_confirmation"],
            include_text_events=False,  # Ignore text-* events (thought process is non-deterministic)
        )
        assert is_match, f"rawEvents structure mismatch:\n{diff_msg}"

        print("\n✓ Phase 12 BLOCKING denial flow (get_location) test completed successfully")

    # Total should be 1 [DONE] marker
    total_done_count = done_count
    assert total_done_count == expected_done_count, (
        f"Total [DONE] count mismatch: actual={total_done_count}, expected={expected_done_count}"
    )

    # Save events to fixture
    save_frontend_fixture(
        fixture_path=fixture_path,
        description="BIDI mode Phase 12 BLOCKING - get_location with denial flow (SINGLE CONTINUOUS STREAM)",
        mode="bidi",
        input_messages=input_messages,
        raw_events=all_events,
        expected_done_count=1,
        source="Backend E2E test capture",
        scenario="User denies get_location tool call - Phase 12 BLOCKING mode where tool awaits approval inside function",
        note="Phase 12 BLOCKING behavior: Single continuous stream with 1 [DONE]. Tool enters BLOCKING state awaiting approval, then returns error after denial.",
    )
