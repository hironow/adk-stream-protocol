"""Backend E2E Test: get_location-denied-bidi-baseline.json

Tests backend behavior against get_location BIDI baseline fixture with denial flow.

Fixture: fixtures/frontend/get_location-denied-bidi-baseline.json
Invocation: 1 Invocation, 2 Turns (confirmation + denial)
Tool: get_location (multi-turn, requires approval)
Transport: WebSocket (BIDI mode)

Expected Flow:
Turn 1 (Confirmation Request):
- User: "現在地を教えて"
- Backend: confirmation request → [DONE]

Turn 2 (Denied Execution):
- User denial response
- Backend: tool-output-error + rejection message → [DONE]

Note: This fixture captures the COMPLETE invocation (2 turns).
Backend must handle both turns correctly in a single WebSocket session.
"""

import asyncio
import json
from pathlib import Path

import pytest
import websockets

from .helpers import (
    compare_raw_events,
    count_done_markers,
    create_denial_message,
    extract_tool_call_ids_from_turn1,
    load_frontend_fixture,
)


@pytest.mark.asyncio
async def test_get_location_denied_bidi_baseline(frontend_fixture_dir: Path):
    """Should generate correct rawEvents for get_location denial flow (BIDI)."""
    # Given: Frontend baseline fixture (2 turns)
    fixture_path = frontend_fixture_dir / "get_location-denied-bidi-baseline.json"
    fixture = await load_frontend_fixture(fixture_path)

    input_messages = fixture["input"]["messages"]
    expected_events = fixture["output"]["rawEvents"]
    expected_done_count = fixture["output"]["expectedDoneCount"]

    # Extract Turn 1 expected events (up to first [DONE])
    first_done_index = next(i for i, event in enumerate(expected_events) if "[DONE]" in event)
    expected_turn1_events = expected_events[: first_done_index + 1]
    expected_turn2_events = expected_events[first_done_index + 1 :]

    # When: Open WebSocket connection and process both turns in the same session
    # This is explicit E2E: Turn 1 → denial → Turn 2 in a single WebSocket session
    timeout = 30.0
    async with websockets.connect(
        "ws://localhost:8000/live",
        open_timeout=timeout,
        close_timeout=10.0,
    ) as websocket:
        # ===== TURN 1: Send initial request and receive confirmation =====
        print("\n=== TURN 1: Sending request and receiving confirmation ===")

        # Send Turn 1 message
        await websocket.send(json.dumps({"type": "message", "messages": input_messages}))

        # Receive Turn 1 events until [DONE]
        turn1_events = []
        while True:
            event = await asyncio.wait_for(websocket.recv(), timeout=timeout)
            turn1_events.append(event)
            if "[DONE]" in event:
                break

        # Then: Verify Turn 1 events (confirmation request)
        is_match, diff_msg = compare_raw_events(
            actual=turn1_events,
            expected=expected_turn1_events,
            normalize=True,
            dynamic_content_tools=["get_location", "adk_request_confirmation"],
            include_text_events=False,  # Ignore text-* events (thought process is non-deterministic)
        )
        assert is_match, f"Turn 1 rawEvents structure mismatch:\n{diff_msg}"

        # And: Should have exactly 1 [DONE] marker (Turn 1 only)
        turn1_done_count = count_done_markers(turn1_events)
        assert turn1_done_count == 1, (
            f"Turn 1 [DONE] count mismatch: actual={turn1_done_count}, expected=1"
        )

        # ===== TURN 2: Send denial and receive rejection result =====
        print("\n=== TURN 2: Sending denial and receiving rejection result ===")

        # Extract tool call IDs from Turn 1
        original_id, confirmation_id = extract_tool_call_ids_from_turn1(turn1_events)
        assert original_id is not None, "Should have original tool call ID (get_location)"
        assert confirmation_id is not None, "Should have confirmation tool call ID"

        # Construct denial message
        # NOTE: In BIDI mode, we only send the denial message, not the full history
        # The WebSocket session maintains the conversation context from Turn 1
        denial_msg = create_denial_message(confirmation_id, original_id)

        # Send Turn 2 denial message (in the same WebSocket session)
        # BIDI mode: session context is preserved, so we only send the new message
        await websocket.send(json.dumps({"type": "message", "messages": [denial_msg]}))

        # Receive Turn 2 events until [DONE]
        turn2_events = []
        while True:
            event = await asyncio.wait_for(websocket.recv(), timeout=timeout)
            turn2_events.append(event)
            if "[DONE]" in event:
                break

        # DEBUG: Print Turn 2 events
        print(f"\n=== TURN 2 EVENTS (count={len(turn2_events)}) ===")
        for i, event in enumerate(turn2_events):
            print(f"{i}: {event.strip()}")

        print(f"\n=== EXPECTED TURN 2 EVENTS (count={len(expected_turn2_events)}) ===")
        for i, event in enumerate(expected_turn2_events):
            print(f"{i}: {event.strip()}")

        # Verify Turn 2 events (tool rejection result)
        is_match, diff_msg = compare_raw_events(
            actual=turn2_events,
            expected=expected_turn2_events,
            normalize=True,
            dynamic_content_tools=["get_location"],  # Tool error has dynamic content
            include_text_events=False,  # Ignore text-* events (thought process is non-deterministic)
        )
        assert is_match, f"Turn 2 rawEvents structure mismatch:\n{diff_msg}"

        # And: Should have exactly 1 [DONE] marker in Turn 2
        turn2_done_count = count_done_markers(turn2_events)
        assert turn2_done_count == 1, (
            f"Turn 2 [DONE] count mismatch: actual={turn2_done_count}, expected=1"
        )

    # And: Total should be 2 [DONE] markers (Turn 1 + Turn 2)
    total_done_count = turn1_done_count + turn2_done_count
    assert total_done_count == expected_done_count, (
        f"Total [DONE] count mismatch: actual={total_done_count}, expected={expected_done_count}"
    )

    # And: Event structure should be IDENTICAL to SSE mode
    # (Only transport layer differs, event format is same)
