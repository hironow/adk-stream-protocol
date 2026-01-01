"""
Integration Test (RED): SSE confirmation must send tool-input events for original tool.

Problem discovered in E2E scenario-5 (SSE mode):
- Confirmation UI events use `confirmation-adk-...` ID
- Only confirmation events are sent, no original tool-input events
- Frontend needs to track the original tool call to display results

This test verifies that SseEventStreamer sends:
1. tool-input-start for original tool (with original ID)
2. tool-input-available for original tool (with original ID)
3. Confirmation UI events (with confirmation- prefix)
4. Tool execution result (with original ID)

Expected to FAIL until fixed.
"""

import pytest
from google.adk.events import Event
from google.genai import types

from adk_stream_protocol import FrontendToolDelegate, SseEventStreamer
from tests.utils.mocks import create_mock_runner, create_mock_session


@pytest.mark.asyncio
async def test_sse_confirmation_should_send_tool_input_events_for_original_tool() -> None:
    """
    TDD RED: SSE confirmation flow must send tool-input events before tool-output.

    Given: A FunctionCall event requiring confirmation (in SSE mode)
    When: User approves the confirmation
    Then: Frontend should receive events in correct order:
        1. tool-input-start (original tool ID)
        2. tool-input-available (original tool ID)
        3. tool-input-start (confirmation ID)
        4. tool-input-available (confirmation ID)
        5. tool-output-available (confirmation ID)
        6. tool-output-available (original tool ID)

    Without step 1-2, frontend cannot track the tool invocation.
    """
    # given
    mock_session = create_mock_session()
    mock_runner = create_mock_runner()

    frontend_delegate = FrontendToolDelegate()
    confirmation_tools = ["process_payment"]

    streamer = SseEventStreamer(
        frontend_delegate=frontend_delegate,
        confirmation_tools=confirmation_tools,
        session=mock_session,
        sse_agent_runner=mock_runner,
    )

    # ADK FunctionCall event (from ADK run_live)
    fc_id = "adk-b24ae993-497e-456d-8fa4-73bbea0d9c77"
    function_call_event = Event(
        author="model",
        content=types.Content(
            role="model",
            parts=[
                types.Part(
                    function_call=types.FunctionCall(
                        id=fc_id,
                        name="process_payment",
                        args={"amount": 50, "currency": "USD", "recipient": "花子さん"},
                    )
                )
            ],
        ),
    )

    async def mock_live_events():
        yield function_call_event

    # when - collect streamed events
    sent_events = []
    async for event in streamer.stream_events(mock_live_events()):
        sent_events.append(event)

    # then - verify event sequence
    # Find original tool-input-start
    has_original_tool_input_start = any("tool-input-start" in e and fc_id in e for e in sent_events)
    has_original_tool_input_available = any(
        "tool-input-available" in e and fc_id in e and "process_payment" in e for e in sent_events
    )

    # ASSERTIONS (RED - expected to fail)
    assert has_original_tool_input_start, (
        f"Missing tool-input-start for original tool ID: {fc_id}\n"
        "SSE mode must send tool-input events for frontend to track tool invocation.\n"
        f"Sent events: {sent_events[:5]}..."  # Show first 5 events
    )

    assert has_original_tool_input_available, (
        f"Missing tool-input-available for original tool ID: {fc_id}\n"
        "Frontend needs tool args and name before receiving result.\n"
        f"Sent events: {sent_events[:5]}..."
    )
