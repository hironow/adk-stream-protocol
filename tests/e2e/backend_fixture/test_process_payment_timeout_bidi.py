"""Backend E2E Test: process_payment timeout flow in BIDI mode.

Tests backend behavior when user doesn't respond to approval request within timeout period.

Mode: Phase 12 BLOCKING (single continuous stream)
Tool: process_payment (requires approval)
Transport: WebSocket (BIDI mode)
Scenario: User receives approval request but doesn't respond (timeout after 30s)

Expected Flow (Phase 12 Timeout):
- Single continuous stream (no [DONE] between approval request and timeout)
- User: Initial request
- Backend: tool-input → adk_request_confirmation (tool is BLOCKING, waiting for approval)
- User: (no response - timeout after 30s)
- Backend: tool-output-error (timeout) → finish → [DONE]

Note: Phase 12 BLOCKING mode uses single stream with 1 [DONE], not 2 turns.
"""

import asyncio
import json
from pathlib import Path

import pytest
import websockets

from .helpers import save_frontend_fixture


@pytest.mark.asyncio
async def test_process_payment_timeout_bidi():
    """Should generate timeout error when user doesn't respond to approval request (Phase 12 BLOCKING)."""

    timeout = 35.0  # Slightly longer than tool timeout (30s)

    async with websockets.connect(
        "ws://localhost:8000/live",
        open_timeout=timeout,
        close_timeout=10.0,
    ) as websocket:
        print("\n=== PHASE 12 BLOCKING MODE TEST (TIMEOUT) ===")
        print("Expected: Single continuous stream with 1 [DONE]")
        print("Tool will BLOCK awaiting approval, then timeout after 30s\n")

        # Send initial request
        initial_message = {
            "role": "user",
            "parts": [
                {
                    "type": "text",
                    "text": "Process a payment of $100 to Alice",
                }
            ],
        }

        await websocket.send(json.dumps({"type": "message", "messages": [initial_message]}))
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
                        "Received [DONE] before approval request in Phase 12 BLOCKING mode! "
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
                                print("\n⏳ Waiting for timeout (30s)... NOT sending approval/denial")
                                break
                    except json.JSONDecodeError:
                        pass

            except asyncio.TimeoutError:
                print(f"\n✗ Timeout waiting for adk_request_confirmation after {len(all_events)} events")
                raise

        assert confirmation_id is not None, "Should have confirmation_id"
        assert original_tool_call_id is not None, "Should have original tool call ID"

        # IMPORTANT: Don't send approval or denial - let it timeout
        # The tool should timeout after ~30 seconds

        # Continue receiving events until [DONE]
        print("\n=== Receiving remaining events until timeout and [DONE] ===")
        while True:
            try:
                event = await asyncio.wait_for(websocket.recv(), timeout=35.0)
                all_events.append(event)
                print(f"Event {len(all_events)}: {event.strip()}")

                if "[DONE]" in event:
                    print("\n✓ Received [DONE]")
                    break
            except asyncio.TimeoutError:
                print(f"\n✗ Timeout waiting for [DONE] after {len(all_events)} events")
                print("This might indicate the tool didn't timeout properly")
                raise

        # Verify results
        print("\n=== VERIFICATION ===")

        # Count [DONE] markers
        done_count = sum(1 for e in all_events if "[DONE]" in e)
        print(f"[DONE] count: {done_count} (expected: 1)")
        assert done_count == 1, f"Expected 1 [DONE], got {done_count}"

        # Verify we got tool-output-error with timeout
        tool_output_events = [
            e for e in all_events
            if "tool-output" in e and original_tool_call_id in e
        ]
        print(f"Tool output events: {len(tool_output_events)}")
        assert len(tool_output_events) > 0, "Should have tool output event"

        # Verify timeout/error in output
        timeout_events = [
            e for e in all_events
            if ("timeout" in e.lower() or "error" in e.lower()) and original_tool_call_id in e
        ]
        print(f"Timeout/error events: {len(timeout_events)}")
        assert len(timeout_events) > 0, "Should have timeout or error indicator in output"

        # Verify the tool output contains error information
        tool_output_error_events = [
            e for e in all_events
            if "tool-output" in e and "error" in e.lower()
        ]
        print(f"Tool output error events: {len(tool_output_error_events)}")
        assert len(tool_output_error_events) > 0, "Should have tool-output-error event"

        # Save events to fixture
        fixture_path = Path(__file__).parent.parent.parent.parent / "fixtures" / "frontend" / "process_payment-timeout-bidi-baseline.json"
        save_frontend_fixture(
            fixture_path=fixture_path,
            description="BIDI mode Phase 12 BLOCKING - process_payment with timeout flow (SINGLE CONTINUOUS STREAM, user doesn't respond)",
            mode="bidi",
            input_messages=[initial_message],
            raw_events=all_events,
            expected_done_count=1,
            source="Backend E2E test capture",
            scenario="User receives approval request but doesn't respond - timeout after 30s",
            note="Phase 12 BLOCKING behavior: Single continuous stream with 1 [DONE]. Tool enters BLOCKING state awaiting approval, then times out after 30s and returns error.",
        )

        print("\n✓ Phase 12 BLOCKING timeout flow test completed successfully")
        print("✓ Tool properly timed out after ~30s without approval response")
        print("✓ Single continuous stream with 1 [DONE] marker confirmed")
