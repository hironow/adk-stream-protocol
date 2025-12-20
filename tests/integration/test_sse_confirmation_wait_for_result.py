"""
Integration Test (RED): SSE mode must wait for confirmation result before sending [DONE].

Problem discovered in E2E scenario-9 (process-payment SSE mode):
- Backend sends adk_request_confirmation tool-input events
- Frontend receives events and shows approval UI
- User clicks Approve and sends confirmation result via addToolOutput
- Backend immediately sends [DONE] marker WITHOUT waiting for confirmation result
- Stream ends prematurely, AI never generates success message

Root cause log evidence:
```
[ADK Confirmation] Suppressing confirmation error for process_payment
[ADK→SSE] Sending [DONE] marker
```

This test verifies that SSE mode:
1. Sends adk_request_confirmation events
2. WAITS (does NOT send [DONE])
3. Receives confirmation result from frontend
4. Continues ADK processing
5. Sends AI response
6. Sends [DONE] only after completion

Expected to FAIL until stream_protocol.py is fixed.
"""

import asyncio
from typing import Any
from unittest.mock import AsyncMock, Mock

import pytest
from google.adk.events import Event
from google.adk.runners import Runner
from google.adk.sessions import Session
from google.genai import types

from services.frontend_tool_service import FrontendToolDelegate
from services.sse_event_streamer import SseEventStreamer


@pytest.mark.asyncio
async def test_sse_confirmation_should_wait_for_result_before_done() -> None:
    """
    TDD RED: SSE mode must NOT send [DONE] until confirmation result is received.

    Sequence:
    1. ADK generates FunctionCall(process_payment)
    2. SSE streamer sends confirmation UI events
    3. SSE streamer WAITS (not sending [DONE])
    4. Frontend sends confirmation result
    5. ADK continues processing
    6. SSE streamer sends AI response
    7. SSE streamer sends [DONE]

    Current bug: Step 3 fails - [DONE] sent immediately.
    """
    # given
    mock_session = Mock(spec=Session)
    mock_runner = Mock(spec=Runner)

    frontend_delegate = FrontendToolDelegate()
    confirmation_tools = ["process_payment"]

    streamer = SseEventStreamer(
        frontend_delegate=frontend_delegate,
        confirmation_tools=confirmation_tools,
        session=mock_session,
        sse_agent_runner=mock_runner,
    )

    # ADK FunctionCall event requiring confirmation
    fc_id = "adk-b53bc9c3-5a99-4f66-89e1-bb5e00d1fe43"
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

    # ADK event stream that generates confirmation call
    async def mock_live_events():
        yield function_call_event
        # ADK would normally wait here for FunctionResponse
        # but in our current bug, streamer sends [DONE] immediately

    # when - collect events until we see [DONE]
    sent_events: list[str] = []
    done_marker_seen = False

    async for event in streamer.stream_events(mock_live_events()):
        sent_events.append(event)
        if "[DONE]" in event:
            done_marker_seen = True
            break

    # then - verify [DONE] was NOT sent prematurely
    confirmation_events = [e for e in sent_events if confirmation_id in e]
    done_marker_index = next(
        (i for i, e in enumerate(sent_events) if "[DONE]" in e),
        -1,
    )

    # RED ASSERTION: This should FAIL
    # Current behavior: [DONE] sent immediately after confirmation events
    # Expected behavior: [DONE] sent only after receiving confirmation result
    assert done_marker_index == -1 or len(sent_events) > len(confirmation_events) + 5, (
        f"[DONE] marker sent too early!\n"
        f"Confirmation events: {len(confirmation_events)}\n"
        f"Total events before [DONE]: {done_marker_index}\n"
        f"Expected: At least {len(confirmation_events) + 5} events before [DONE]\n"
        f"(confirmation UI + wait + AI response + finish)\n"
        f"\nActual sequence:\n"
        + "\n".join(f"  {i}: {e[:100]}..." for i, e in enumerate(sent_events[:10]))
    )


@pytest.mark.asyncio
async def test_sse_confirmation_complete_flow_with_approval() -> None:
    """
    TDD RED: Complete SSE confirmation flow from request to approval to AI response.

    This test simulates the full E2E flow:
    1. Backend sends confirmation request
    2. Frontend approves (via addToolOutput)
    3. Backend receives approval
    4. ADK continues with confirmed=true
    5. AI generates success message
    6. Backend sends [DONE]

    Current bug: Flow stops at step 2 (premature [DONE]).
    """
    # given
    mock_session = Mock(spec=Session)
    mock_runner = Mock(spec=Runner)

    frontend_delegate = FrontendToolDelegate()
    confirmation_tools = ["process_payment"]

    streamer = SseEventStreamer(
        frontend_delegate=frontend_delegate,
        confirmation_tools=confirmation_tools,
        session=mock_session,
        sse_agent_runner=mock_runner,
    )

    fc_id = "adk-test-approval-flow"
    confirmation_id = f"confirmation-{fc_id}"

    # Step 1: ADK generates confirmation request
    function_call_event = Event(
        author="model",
        content=types.Content(
            role="model",
            parts=[
                types.Part(
                    function_call=types.FunctionCall(
                        id=fc_id,
                        name="process_payment",
                        args={"amount": 50, "recipient": "Test User"},
                    )
                )
            ],
        ),
    )

    # Step 3: Simulate AI response after approval
    ai_text_event = Event(
        author="model",
        content=types.Content(
            role="model",
            parts=[types.Part(text="送金が完了しました。花子さんに50USDを送金しました。")],
        ),
    )

    async def mock_live_events():
        yield function_call_event
        # In real flow, ADK waits here for FunctionResponse
        # After receiving confirmation result, ADK continues:
        await asyncio.sleep(0.1)  # Simulate processing time
        yield ai_text_event

    # when
    sent_events: list[str] = []
    async for event in streamer.stream_events(mock_live_events()):
        sent_events.append(event)

    # then - verify complete flow
    has_confirmation_request = any(confirmation_id in e and "tool-input" in e for e in sent_events)
    has_ai_response = any("送金が完了" in e for e in sent_events)
    has_done_marker = any("[DONE]" in e for e in sent_events)

    # Find event indices
    confirmation_idx = next(
        (i for i, e in enumerate(sent_events) if confirmation_id in e and "tool-input" in e),
        -1,
    )
    ai_response_idx = next((i for i, e in enumerate(sent_events) if "送金が完了" in e), -1)
    done_idx = next((i for i, e in enumerate(sent_events) if "[DONE]" in e), -1)

    # RED ASSERTIONS
    assert has_confirmation_request, "Missing confirmation request events"

    assert has_ai_response, (
        f"Missing AI response after confirmation!\n"
        f"Backend sent [DONE] too early, preventing AI from generating response.\n"
        f"Events received: {len(sent_events)}\n"
        f"Confirmation events found: {has_confirmation_request}\n"
        f"This is the ROOT CAUSE of E2E test failure."
    )

    assert has_done_marker, "Missing [DONE] marker"

    # Verify correct sequence: confirmation → AI response → [DONE]
    assert confirmation_idx < ai_response_idx < done_idx, (
        f"Incorrect event sequence!\n"
        f"Expected: confirmation({confirmation_idx}) → AI response({ai_response_idx}) → [DONE]({done_idx})\n"
        f"Actual order violates confirmation flow protocol."
    )


@pytest.mark.asyncio
async def test_sse_confirmation_should_not_suppress_error_prematurely() -> None:
    """
    TDD RED: Backend should not suppress confirmation error until result is received.

    Log evidence shows:
    ```
    [ADK Confirmation] Suppressing confirmation error for process_payment
    [ADK→SSE] Sending [DONE] marker
    ```

    This test verifies that "suppressing confirmation error" should only happen
    AFTER receiving the FunctionResponse with confirmation result, not BEFORE.
    """
    # given
    mock_session = Mock(spec=Session)
    mock_runner = Mock(spec=Runner)

    frontend_delegate = FrontendToolDelegate()
    confirmation_tools = ["process_payment"]

    streamer = SseEventStreamer(
        frontend_delegate=frontend_delegate,
        confirmation_tools=confirmation_tools,
        session=mock_session,
        sse_agent_runner=mock_runner,
    )

    fc_id = "adk-suppress-test"

    # ADK generates confirmation request
    function_call_event = Event(
        author="model",
        content=types.Content(
            role="model",
            parts=[
                types.Part(
                    function_call=types.FunctionCall(
                        id=fc_id,
                        name="process_payment",
                        args={"amount": 100},
                    )
                )
            ],
        ),
    )

    # ADK error response (confirmation not approved yet)
    error_event = Event(
        author="model",
        content=types.Content(
            role="user",
            parts=[
                types.Part(
                    function_response=types.FunctionResponse(
                        id=fc_id,
                        name="process_payment",
                        response={
                            "error": "This tool call requires confirmation, please approve or reject."
                        },
                    )
                )
            ],
        ),
    )

    async def mock_live_events():
        yield function_call_event
        yield error_event  # This should NOT trigger [DONE]

    # when
    sent_events: list[str] = []
    async for event in streamer.stream_events(mock_live_events()):
        sent_events.append(event)

    # then
    has_error_suppression_log = any("Suppressing confirmation error" in e for e in sent_events)
    has_premature_done = any("[DONE]" in e for e in sent_events)

    # RED ASSERTION
    # The error suppression should trigger WAITING, not [DONE]
    assert not (has_error_suppression_log and has_premature_done), (
        f"Backend incorrectly suppressed error AND sent [DONE]!\n"
        f"When confirmation error is suppressed, backend should WAIT for result.\n"
        f"Current behavior: Sends [DONE] immediately, ending stream prematurely.\n"
        f"\nThis is why E2E tests fail - stream ends before user can approve."
    )
