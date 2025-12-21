"""
Integration Test (RED): BIDI confirmation must send tool-input events for original tool.

Problem discovered in E2E scenario-5:
- Confirmation UI events use `confirmation-function-call-...` ID
- Tool execution result uses `function-call-...` ID
- Frontend receives tool-output-available but没有前置の tool-input events
- Frontend error: "no tool invocation found for tool call function-call-..."

This test verifies that BidiEventSender sends:
1. tool-input-start for original tool (with original ID)
2. tool-input-available for original tool (with original ID)
3. Confirmation UI events (with confirmation- prefix)
4. Tool execution result (with original ID)

Expected to FAIL until fixed.
"""

import asyncio
from unittest.mock import AsyncMock

import pytest
from google.adk.events import Event
from google.genai import types

from adk_stream_protocol import BidiEventSender, FrontendToolDelegate
from tests.utils.mocks import (
    create_mock_live_request_queue,
    create_mock_session,
    create_mock_websocket,
)


@pytest.mark.asyncio
async def test_bidi_confirmation_should_send_tool_input_events_for_original_tool() -> None:
    """
    TDD RED: BIDI confirmation flow must send tool-input events before tool-output.

    Given: A FunctionCall event requiring confirmation
    When: User approves the confirmation
    Then: Frontend should receive events in correct order:
        1. tool-input-start (original tool ID)
        2. tool-input-available (original tool ID)
        3. tool-input-start (confirmation ID)
        4. tool-input-available (confirmation ID)
        5. tool-output-available (confirmation ID)
        6. tool-output-available (original tool ID)

    Without step 1-2, frontend shows "no tool invocation found" error.
    """
    # given
    mock_websocket = create_mock_websocket()
    mock_session = create_mock_session()
    mock_live_request_queue = create_mock_live_request_queue()

    frontend_delegate = FrontendToolDelegate()
    confirmation_tools = ["process_payment"]

    sender = BidiEventSender(
        websocket=mock_websocket,
        frontend_delegate=frontend_delegate,
        confirmation_tools=confirmation_tools,
        session=mock_session,
        live_request_queue=mock_live_request_queue,
    )

    # ADK FunctionCall event (this is what triggers confirmation)
    function_call_event = Event(
        author="model",
        content=types.Content(
            role="model",
            parts=[
                types.Part(
                    function_call=types.FunctionCall(
                        id="function-call-123",
                        name="process_payment",
                        args={"amount": 50, "recipient": "花子"},
                    )
                )
            ],
        ),
    )

    async def mock_live_events():
        yield function_call_event

    # when - process the event
    # Note: This will block waiting for user approval, so we need to mock the interceptor
    await sender.send_events(mock_live_events())

    # then - verify event order (this will fail until fixed)
    # Extract all sent events
    sent_events = []
    for call in mock_websocket.send_text.call_args_list:
        event_str = call[0][0]
        sent_events.append(event_str)

    # Expected events:
    # 1. tool-input-start (original ID: function-call-123)
    # 2. tool-input-available (original ID: function-call-123)
    # 3. tool-input-start (confirmation ID: confirmation-function-call-123)
    # 4. tool-input-available (confirmation ID: confirmation-function-call-123)
    # ... (then confirmation result and tool execution)

    # Find original tool-input-start
    original_tool_input_start = None
    for event in sent_events:
        if "tool-input-start" in event and "function-call-123" in event:
            original_tool_input_start = event
            break

    # ASSERTION: This should exist but currently doesn't (RED)
    assert original_tool_input_start is not None, (
        "BIDI confirmation flow must send tool-input-start for original tool\n"
        "Frontend needs this to track the tool invocation before receiving tool-output-available.\n"
        f"Sent events: {sent_events}"
    )


@pytest.mark.asyncio
async def test_bidi_confirmation_event_sequence() -> None:
    """
    TDD RED: Verify complete event sequence for BIDI confirmation flow.

    This test documents the expected event sequence from E2E logs.
    """
    # given
    sent_events: list[str] = []

    async def capture_send_text(event: str) -> None:
        sent_events.append(event)

    mock_websocket = create_mock_websocket()
    mock_websocket.send_text = AsyncMock(side_effect=capture_send_text)
    mock_session = create_mock_session()
    mock_live_request_queue = create_mock_live_request_queue()

    frontend_delegate = FrontendToolDelegate()
    confirmation_tools = ["process_payment"]

    sender = BidiEventSender(
        websocket=mock_websocket,
        frontend_delegate=frontend_delegate,
        confirmation_tools=confirmation_tools,
        session=mock_session,
        live_request_queue=mock_live_request_queue,
    )

    # Create FunctionCall event
    fc_id = "function-call-9656672104687609647"
    confirmation_id = f"confirmation-{fc_id}"

    function_call_event = Event(
        author="model",
        content=types.Content(
            role="model",
            parts=[
                types.Part(
                    function_call=types.FunctionCall(
                        id=fc_id,
                        name="process_payment",
                        args={"amount": 50, "currency": "USD", "recipient": "花子"},
                    )
                )
            ],
        ),
    )

    async def mock_live_events():
        yield function_call_event

    # Mock frontend sending confirmation response
    async def simulate_confirmation_response():
        await asyncio.sleep(0.05)
        frontend_delegate.resolve_tool_result(confirmation_id, {"confirmed": True})

    # when
    response_task = asyncio.create_task(simulate_confirmation_response())
    await sender.send_events(mock_live_events())
    await response_task

    # then - verify event sequence
    # Expected sequence:
    # 1. tool-input-start (toolCallId: function-call-9656672104687609647)
    # 2. tool-input-available (toolCallId: function-call-9656672104687609647)
    # 3. tool-input-start (toolCallId: confirmation-function-call-...)
    # 4. tool-input-available (toolCallId: confirmation-function-call-...)
    # 5. tool-output-available (toolCallId: confirmation-function-call-...)
    # 6. tool-output-available (toolCallId: function-call-9656672104687609647)

    # Verify original tool-input events exist
    has_original_tool_input_start = any("tool-input-start" in e and fc_id in e for e in sent_events)
    has_original_tool_input_available = any(
        "tool-input-available" in e and fc_id in e and "process_payment" in e for e in sent_events
    )

    # ASSERTIONS (RED - expected to fail)
    assert has_original_tool_input_start, (
        f"Missing tool-input-start for original tool ID: {fc_id}\n"
        "Frontend cannot track tool invocation without this event."
    )

    assert has_original_tool_input_available, (
        f"Missing tool-input-available for original tool ID: {fc_id}\n"
        "Frontend needs tool args and name before receiving result."
    )
