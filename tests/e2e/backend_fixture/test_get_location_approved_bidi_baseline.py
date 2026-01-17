"""Backend E2E Test: get_location-approved-bidi-baseline.json

Tests backend behavior against get_location BIDI baseline fixture with approval flow (get_location).

Fixture: fixtures/frontend/get_location-approved-bidi-baseline.json
Mode: BIDI Blocking Mode (single continuous stream)
Tool: get_location (requires approval)
Transport: WebSocket (BIDI mode)

Expected Flow (BIDI Blocking Mode):
- Single continuous stream (no [DONE] between approval request and response)
- User: Initial request
- Backend: tool-input → adk_request_confirmation (tool is BLOCKING, waiting for approval)
- User: approval response (unblocks the BLOCKING tool)
- Backend: tool-output (success result) → finish → [DONE]

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
async def test_get_location_approved_bidi_baseline(frontend_fixture_dir: Path):
    """Should generate correct rawEvents for get_location approval flow (get_location) (BIDI Blocking Mode)."""
    # Given: Frontend baseline fixture (BIDI Blocking Mode)
    fixture_path = frontend_fixture_dir / "get_location-approved-bidi-baseline.json"
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
        print("\n=== PHASE 12 BLOCKING MODE TEST (APPROVAL) ===")
        print("Expected: Single continuous stream with 1 [DONE]")
        print("Tool will BLOCK awaiting approval, then return result\n")

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

        # Immediately send approval with tool result (get_location is frontend-delegated)
        print("\n=== Sending approval with tool result (tool is BLOCKING, awaiting this) ===")
        approval_message = {
            "role": "user",
            "parts": [
                {
                    "type": "tool-adk_request_confirmation",
                    "toolCallId": confirmation_id,
                    "toolName": "adk_request_confirmation",
                    "state": "approval-responded",
                    "approval": {
                        "id": confirmation_id,
                        "approved": True,
                    },
                },
                {
                    "type": "tool-result",
                    "toolCallId": original_tool_call_id,
                    "result": {
                        "latitude": 35.6762,
                        "longitude": 139.6503,
                        "accuracy": 20,
                        "city": "Tokyo",
                        "country": "Japan",
                    },
                },
            ],
        }

        await websocket.send(json.dumps({"type": "message", "messages": [approval_message]}))
        print("✓ Sent approval message with tool result")

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

        # Verify we got tool-output-available with location data
        tool_output_events = [
            e for e in all_events if "tool-output-available" in e and original_tool_call_id in e
        ]
        print(f"Tool output events: {len(tool_output_events)}")
        assert len(tool_output_events) > 0, "Should have tool output event"

        # Verify location data in tool output (latitude/longitude)
        location_events = [e for e in all_events if "latitude" in e and "longitude" in e]
        print(f"Location data events: {len(location_events)}")
        assert len(location_events) > 0, "Should have location data in output"

        print("\n✓ BIDI Blocking Mode approval flow (get_location) test completed successfully")

    # Total should be 1 [DONE] marker
    total_done_count = done_count
    assert total_done_count == expected_done_count, (
        f"Total [DONE] count mismatch: actual={total_done_count}, expected={expected_done_count}"
    )

    # And: Event structure should be IDENTICAL to SSE mode
    # (Only transport layer differs, event format is same)

    # Save events to fixture (BEFORE comparison to ensure fixture is saved even if assertion fails)
    save_frontend_fixture(
        fixture_path=fixture_path,
        description="BIDI Blocking Mode - get_location with approval flow (SINGLE CONTINUOUS STREAM)",
        mode="bidi",
        input_messages=input_messages,
        raw_events=all_events,
        expected_done_count=1,
        source="Backend E2E test capture",
        scenario="User approves get_location tool call - BIDI Blocking Mode mode where tool awaits approval inside function",
        note="BIDI Blocking Mode behavior: Single continuous stream with 1 [DONE]. Tool enters BLOCKING state awaiting approval, then returns location result after approval.",
    )

    # Verify against expected events (structure comparison) - MOVED AFTER SAVE
    is_match, diff_msg = compare_raw_events(
        actual=all_events,
        expected=expected_events,
        normalize=True,
        dynamic_content_tools=["get_location", "adk_request_confirmation"],
        include_text_events=False,  # Ignore text-* events (thought process is non-deterministic)
    )
    assert is_match, f"rawEvents structure mismatch:\n{diff_msg}"
