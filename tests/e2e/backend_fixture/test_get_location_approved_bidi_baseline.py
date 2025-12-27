"""Backend E2E Test: get_location-approved-bidi-baseline.json

Tests backend behavior against get_location BIDI baseline fixture with approval flow (get_location).

Fixture: fixtures/frontend/get_location-approved-bidi-baseline.json
Mode: Phase 12 BLOCKING (single continuous stream)
Tool: get_location (requires approval)
Transport: WebSocket (BIDI mode)

Expected Flow (Phase 12):
- Single continuous stream (no [DONE] between approval request and response)
- User: Initial request
- Backend: tool-input → adk_request_confirmation (tool is BLOCKING, waiting for approval)
- User: approval response (unblocks the BLOCKING tool)
- Backend: tool-output (success result) → finish → [DONE]

Note: Phase 12 BLOCKING mode uses single stream with 1 [DONE], not 2 turns.
"""

import asyncio
import json
from pathlib import Path

import pytest
import websockets

from .helpers import (
    compare_raw_events,
    count_done_markers,
    create_approval_message,
    extract_tool_call_ids_from_turn1,
    load_frontend_fixture,
    save_frontend_fixture,
)


@pytest.mark.asyncio
async def test_get_location_approved_bidi_baseline(frontend_fixture_dir: Path):
    """Should generate correct rawEvents for get_location approval flow (get_location) (Phase 12 BLOCKING)."""
    # Given: Frontend baseline fixture (Phase 12)
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

        # Receive events until we get adk_request_confirmation
        all_events = []
        confirmation_id = None
        original_tool_call_id = None

        print("\n=== Receiving events until adk_request_confirmation ===")
        while True:
            try:
                event = await asyncio.wait_for(websocket.recv(), timeout=5.0)
                all_events.append(event)
                print(f"Event {len(all_events)}: {event.strip()}")

                # ERROR: If we get [DONE] before approval response, that's wrong!
                if "[DONE]" in event:
                    raise AssertionError(
                        "Received [DONE] before approval response in Phase 12 BLOCKING mode! "
                        "This indicates the tool returned early instead of BLOCKING."
                    )

                # Parse event to extract tool call IDs
                if "data:" in event and event.strip() != "data: [DONE]":
                    try:
                        event_data = json.loads(event.strip().replace("data: ", ""))

                        # Look for adk_request_confirmation
                        if event_data.get("type") == "tool-input-available":
                            if event_data.get("toolName") == "adk_request_confirmation":
                                confirmation_id = event_data.get("toolCallId")
                                original_tool_call_id = event_data.get("input", {}).get(
                                    "originalFunctionCall", {}
                                ).get("id")
                                print(f"\n✓ Found confirmation request:")
                                print(f"  confirmation_id: {confirmation_id}")
                                print(f"  original_id: {original_tool_call_id}")
                                # IMPORTANT: Don't wait for [DONE], send approval immediately
                                break
                    except json.JSONDecodeError:
                        pass

            except asyncio.TimeoutError:
                print(f"\n✗ Timeout waiting for adk_request_confirmation after {len(all_events)} events")
                raise

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
                        "country": "Japan"
                    },
                }
            ],
        }

        await websocket.send(json.dumps({"type": "message", "messages": [approval_message]}))
        print("✓ Sent approval message with tool result")

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

        # Count [DONE] markers
        done_count = sum(1 for e in all_events if "[DONE]" in e)
        print(f"[DONE] count: {done_count} (expected: {expected_done_count})")
        assert done_count == expected_done_count, f"Expected {expected_done_count} [DONE], got {done_count}"

        # Verify we got tool-output-available with location data
        tool_output_events = [
            e for e in all_events
            if "tool-output-available" in e and original_tool_call_id in e
        ]
        print(f"Tool output events: {len(tool_output_events)}")
        assert len(tool_output_events) > 0, "Should have tool output event"

        # Verify location data in tool output (latitude/longitude)
        location_events = [e for e in all_events if "latitude" in e and "longitude" in e]
        print(f"Location data events: {len(location_events)}")
        assert len(location_events) > 0, "Should have location data in output"

        # Verify against expected events (structure comparison)
        is_match, diff_msg = compare_raw_events(
            actual=all_events,
            expected=expected_events,
            normalize=True,
            dynamic_content_tools=["get_location", "adk_request_confirmation"],
            include_text_events=False,  # Ignore text-* events (thought process is non-deterministic)
        )
        assert is_match, f"rawEvents structure mismatch:\n{diff_msg}"

        print("\n✓ Phase 12 BLOCKING approval flow (get_location) test completed successfully")

    # Total should be 1 [DONE] marker
    total_done_count = done_count
    assert total_done_count == expected_done_count, (
        f"Total [DONE] count mismatch: actual={total_done_count}, expected={expected_done_count}"
    )

    # And: Event structure should be IDENTICAL to SSE mode
    # (Only transport layer differs, event format is same)

    # Save events to fixture
    save_frontend_fixture(
        fixture_path=fixture_path,
        description="BIDI mode Phase 12 BLOCKING - get_location with approval flow (SINGLE CONTINUOUS STREAM)",
        mode="bidi",
        input_messages=input_messages,
        raw_events=all_events,
        expected_done_count=1,
        source="Backend E2E test capture",
        scenario="User approves get_location tool call - Phase 12 BLOCKING mode where tool awaits approval inside function",
        note="Phase 12 BLOCKING behavior: Single continuous stream with 1 [DONE]. Tool enters BLOCKING state awaiting approval, then returns location result after approval.",
    )
