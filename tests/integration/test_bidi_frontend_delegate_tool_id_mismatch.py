"""
Integration Test (RED): BIDI frontend delegate tools - ID mismatch between tool-input and execution.

Problem discovered in E2E scenario-6 (BIDI mode, change_bgm tool):
- Frontend receives tool-input-available with ID: function-call-931550426395150784
- Backend FrontendToolDelegate executes with ID: e-3166e920-26d8-4452-9a7e-eb2851d2447f
- Frontend never receives result because IDs don't match
- Backend timeout: "Frontend never responded after 5 seconds"

This test verifies that BidiEventSender sends tool-input events with the SAME ID
that FrontendToolDelegate will use for execution.

Expected to FAIL until fixed.
"""

import json
from unittest.mock import AsyncMock, Mock

import pytest
from google.adk.events import Event
from google.genai import types

from adk_stream_protocol import BidiEventSender, FrontendToolDelegate
from tests.utils.mocks import create_mock_live_request_queue, create_mock_session


@pytest.mark.asyncio
async def test_bidi_frontend_delegate_tool_should_use_consistent_id() -> None:
    """
    TDD RED: BIDI frontend delegate tool must use consistent ID for tool-input and execution.

    Given: A FunctionCall event for frontend delegate tool (no confirmation)
    When: Tool executes on frontend
    Then:
        1. tool-input-available sends ID: X
        2. FrontendToolDelegate.execute_on_frontend() awaits result for ID: X (same ID)
        3. Frontend can match the result to the original call

    Without this, frontend receives tool-input with ID A but backend waits for result with ID B.
    """
    # given
    mock_websocket = Mock()
    mock_websocket.send_text = AsyncMock()
    mock_session = create_mock_session()
    mock_live_request_queue = create_mock_live_request_queue()

    frontend_delegate = FrontendToolDelegate()
    confirmation_tools: list[str] = []  # change_bgm does NOT require confirmation

    sender = BidiEventSender(
        websocket=mock_websocket,
        frontend_delegate=frontend_delegate,
        confirmation_tools=confirmation_tools,
        session=mock_session,
    )

    # ADK FunctionCall event for frontend delegate tool
    fc_id = "function-call-931550426395150784"
    function_call_event = Event(
        author="model",
        content=types.Content(
            role="model",
            parts=[
                types.Part(
                    function_call=types.FunctionCall(
                        id=fc_id,
                        name="change_bgm",
                        args={"track": 1},
                    )
                )
            ],
        ),
    )

    async def mock_live_events():
        yield function_call_event

    # when - process the event
    await sender.send_events(mock_live_events())

    # Extract events from WebSocket calls
    sent_events = []
    for call in mock_websocket.send_text.call_args_list:
        event_str = call[0][0]
        sent_events.append(event_str)

    # then - verify ID consistency
    # Find tool-input-available event
    tool_input_id = None
    for event in sent_events:
        if "tool-input-available" in event and "change_bgm" in event:
            # Parse: data: {...}\n\n
            if event.startswith("data: "):
                data = json.loads(event[6:].strip())
                tool_input_id = data.get("toolCallId")
                break

    # ASSERTION (RED - expected to fail)
    assert tool_input_id is not None, (
        "BIDI mode must send tool-input-available for frontend delegate tool\n"
        f"Sent events: {sent_events[:5]}..."
    )

    # Check if backend would create different ID
    # This is the bug: backend creates e-XXX but frontend knows function-call-XXX
    assert tool_input_id == fc_id, (
        f"ID MISMATCH BUG:\n"
        f"  Frontend receives tool-input with ID: {tool_input_id}\n"
        f"  But backend FunctionCall has ID: {fc_id}\n"
        f"  These must match for frontend to return result!\n"
        f"Sent events: {sent_events[:5]}..."
    )


@pytest.mark.asyncio
async def test_bidi_frontend_delegate_multiple_tools_id_consistency() -> None:
    """
    TDD RED: Verify ID consistency for multiple frontend delegate tool calls.

    This test ensures that when multiple frontend delegate tools are called,
    each tool-input-available event uses the correct ID that matches what
    FrontendToolDelegate will use for execution.
    """
    # given
    mock_websocket = Mock()
    sent_events: list[str] = []

    async def capture_send_text(event: str) -> None:
        sent_events.append(event)

    mock_websocket.send_text = AsyncMock(side_effect=capture_send_text)
    mock_session = create_mock_session()
    mock_live_request_queue = create_mock_live_request_queue()

    frontend_delegate = FrontendToolDelegate()

    sender = BidiEventSender(
        websocket=mock_websocket,
        frontend_delegate=frontend_delegate,
        confirmation_tools=[],  # No confirmation tools
        session=mock_session,
    )

    # Two FunctionCall events for different frontend delegate tools
    fc_id_1 = "function-call-111"
    fc_id_2 = "function-call-222"

    event_1 = Event(
        author="model",
        content=types.Content(
            role="model",
            parts=[
                types.Part(
                    function_call=types.FunctionCall(
                        id=fc_id_1,
                        name="change_bgm",
                        args={"track": 1},
                    )
                )
            ],
        ),
    )

    event_2 = Event(
        author="model",
        content=types.Content(
            role="model",
            parts=[
                types.Part(
                    function_call=types.FunctionCall(
                        id=fc_id_2,
                        name="get_location",
                        args={},
                    )
                )
            ],
        ),
    )

    async def mock_live_events():
        yield event_1
        yield event_2

    # when
    await sender.send_events(mock_live_events())

    # then - extract tool-input IDs
    tool_input_ids = []
    for event in sent_events:
        if "tool-input-available" in event:
            if event.startswith("data: "):
                data = json.loads(event[6:].strip())
                tool_name = data.get("toolName")
                tool_call_id = data.get("toolCallId")
                tool_input_ids.append((tool_name, tool_call_id))

    # ASSERTIONS (RED - expected to fail)
    assert len(tool_input_ids) >= 2, (
        f"Expected at least 2 tool-input-available events\n"
        f"Found: {len(tool_input_ids)}\n"
        f"Events: {tool_input_ids}"
    )

    # Verify each tool-input ID matches the original FunctionCall ID
    has_change_bgm = any(
        name == "change_bgm" and call_id == fc_id_1 for name, call_id in tool_input_ids
    )
    has_get_location = any(
        name == "get_location" and call_id == fc_id_2 for name, call_id in tool_input_ids
    )

    assert has_change_bgm, (
        f"change_bgm tool-input ID mismatch!\nExpected ID: {fc_id_1}\nTool inputs: {tool_input_ids}"
    )

    assert has_get_location, (
        f"get_location tool-input ID mismatch!\n"
        f"Expected ID: {fc_id_2}\n"
        f"Tool inputs: {tool_input_ids}"
    )


@pytest.mark.asyncio
async def test_bidi_vs_sse_frontend_delegate_tool_id_behavior() -> None:
    """
    TDD RED: Document ID behavior difference between BIDI and SSE modes.

    SSE mode: Works fine (IDs match)
    BIDI mode: Fails (ID mismatch)

    This test documents the expected behavior for BIDI mode to match SSE mode.
    """
    # given
    mock_websocket = Mock()
    sent_events: list[str] = []

    async def capture_send_text(event: str) -> None:
        sent_events.append(event)

    mock_websocket.send_text = AsyncMock(side_effect=capture_send_text)
    mock_session = create_mock_session()
    mock_live_request_queue = create_mock_live_request_queue()

    frontend_delegate = FrontendToolDelegate()

    sender = BidiEventSender(
        websocket=mock_websocket,
        frontend_delegate=frontend_delegate,
        confirmation_tools=[],
        session=mock_session,
    )

    fc_id = "function-call-test-123"
    function_call_event = Event(
        author="model",
        content=types.Content(
            role="model",
            parts=[
                types.Part(
                    function_call=types.FunctionCall(
                        id=fc_id,
                        name="change_bgm",
                        args={"track": 2},
                    )
                )
            ],
        ),
    )

    async def mock_live_events():
        yield function_call_event

    # when
    await sender.send_events(mock_live_events())

    # then
    # Extract tool-input-available event
    tool_input_event = None
    for event in sent_events:
        if "tool-input-available" in event and "change_bgm" in event:
            if event.startswith("data: "):
                tool_input_event = json.loads(event[6:].strip())
                break

    # ASSERTION (RED)
    assert tool_input_event is not None, "Missing tool-input-available event"

    tool_call_id = tool_input_event.get("toolCallId")

    # In SSE mode, this would be: adk-XXXXX (ADK's original ID)
    # In BIDI mode, this should ALSO be: function-call-XXXXX (ADK's original ID)
    # Bug: BIDI mode creates new e-XXXXX ID instead

    assert tool_call_id == fc_id, (
        f"BIDI mode should behave like SSE mode!\n"
        f"SSE mode: tool-input ID matches FunctionCall.id\n"
        f"BIDI mode (current bug): tool-input ID = {tool_call_id}, FunctionCall.id = {fc_id}\n"
        f"BIDI mode (expected): tool-input ID should be {fc_id}\n"
        f"\n"
        f"Fix: BIDI mode should use FunctionCall.id directly, not create new e-XXX ID"
    )
