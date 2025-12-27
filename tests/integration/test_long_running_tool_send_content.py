"""
Integration test for LongRunningFunctionTool with send_content().

This test verifies that ADK properly handles FunctionResponse sent via
LiveRequestQueue.send_content() after a LongRunningFunctionTool returns
pending status.

Test Flow:
1. Create real ADK session with run_live() using LongRunningFunctionTool
2. Send message that triggers tool (Turn 1)
3. Verify tool returns pending status and turn completes
4. Send FunctionResponse with real result via send_content() (Turn 2)
5. Verify ADK generates events after receiving FunctionResponse

This isolates the core LongRunningFunctionTool + send_content() flow
without WebSocket, frontend, or other E2E complexities.
"""

from dotenv import load_dotenv

# Load environment variables from .env.local BEFORE any ADK imports
# This ensures ADK can read GOOGLE_API_KEY at initialization
load_dotenv(".env.local")

import asyncio
import uuid

import pytest
from google.adk.agents import LiveRequestQueue
from google.adk.agents.run_config import RunConfig, StreamingMode
from google.genai import types
from loguru import logger

from adk_stream_protocol import get_or_create_session
from adk_stream_protocol.adk_ag_runner import BIDI_CONFIRMATION_TOOLS, bidi_agent_runner


@pytest.mark.asyncio
async def test_long_running_tool_send_content_integration() -> None:
    """
    Test that ADK responds after receiving FunctionResponse via send_content().

    This tests the core LongRunningFunctionTool pattern:
    - Tool returns pending status (Turn 1 completes)
    - Manual FunctionResponse sent via send_content()
    - ADK should generate events for Turn 2
    """
    # given - Create real ADK session with LongRunningFunctionTool
    logger.info("=" * 80)
    logger.info("[TEST] Creating ADK session with run_live() and LiveRequestQueue")
    logger.info("=" * 80)

    # Create LiveRequestQueue for bidirectional communication
    live_request_queue = LiveRequestQueue()

    # Create RunConfig for BIDI mode with AUDIO modality
    # Match server.py configuration for audio model with transcription
    run_config = RunConfig(
        streaming_mode=StreamingMode.BIDI,
        response_modalities=["AUDIO"],
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
    )

    # Test variables
    user_id = "test-user-001"
    connection_signature = str(uuid.uuid4())
    session_id = None  # Will be set after session creation
    tool_call_id_captured = None
    function_response_received = False  # Changed: LongRunningFunctionTool returns None, so no FunctionResponse
    turn1_complete = False
    turn2_events_received = False

    try:
        # Create ADK session using get_or_create_session
        # This matches server.py's session creation pattern
        session = await get_or_create_session(
            user_id=user_id,
            agent_runner=bidi_agent_runner,
            app_name="agents",
            connection_signature=connection_signature,
        )
        session_id = session.id
        logger.info(f"[TEST] ✓ Created ADK session: {session_id}")

        # Set mode=bidi to trigger LongRunningFunctionTool behavior
        session.state["mode"] = "bidi"
        logger.info("[TEST] ✓ Set session.state['mode'] = 'bidi'")

        # Start run_live() with the created session
        live_events = bidi_agent_runner.run_live(
            session=session,
            live_request_queue=live_request_queue,
            run_config=run_config,
        )

        logger.info(f"[TEST] ✓ Started run_live() with session: {session_id}")

        # when - Turn 1: Send message requesting payment
        logger.info("=" * 80)
        logger.info("[TEST] Turn 1: Sending message requesting payment")
        logger.info("=" * 80)

        user_message = types.Content(
            parts=[types.Part(text="Please process a payment of 50 USD to Bob")]
        )

        # Send initial message via queue
        live_request_queue.send_content(user_message)
        logger.info("[TEST-TURN1] ✓ Sent initial message via LiveRequestQueue")

        # Collect Turn 1 events
        turn1_events = []
        event_count = 0

        async for event in live_events:
            event_count += 1
            turn1_events.append(event)

            # Log event type
            event_type = type(event).__name__
            logger.info(f"[TEST-TURN1] Event {event_count}: {event_type}")

            # Capture tool_call_id from FunctionCall
            if hasattr(event, "content") and event.content:
                for part in event.content.parts:
                    if hasattr(part, "function_call") and part.function_call:
                        tool_call_id_captured = part.function_call.id
                        tool_name_captured = part.function_call.name
                        logger.info(
                            f"[TEST-TURN1] ✓ Captured tool_call_id: {tool_call_id_captured} "
                            f"for tool: {tool_name_captured}"
                        )

                    # LongRunningFunctionTool returns pending status dict
                    # ADK should generate FunctionResponse from this dict
                    if hasattr(part, "function_response") and part.function_response:
                        function_response_received = True
                        # Verify pending status is in response
                        response_data = part.function_response.response
                        logger.info(
                            f"[TEST-TURN1] ✓ FunctionResponse received with pending status: {response_data}"
                        )
                        # Verify pending status structure
                        if isinstance(response_data, dict):
                            assert (
                                response_data.get("status") == "pending"
                            ), "FunctionResponse should contain pending status"

            # Check for turn_complete
            if hasattr(event, "turn_complete") and event.turn_complete:
                logger.info("[TEST-TURN1] ✓ Turn complete detected - Turn 1 ended")
                turn1_complete = True
                break  # End Turn 1

        # then - Verify Turn 1 completed correctly
        assert turn1_complete, "Turn 1 should complete with turn_complete event"
        assert tool_call_id_captured, "Should capture tool_call_id from FunctionCall"
        assert function_response_received, (
            "LongRunningFunctionTool returns pending status dict - "
            "ADK SHOULD generate FunctionResponse in Turn 1"
        )
        logger.info("[TEST-TURN1] ✓ All Turn 1 assertions passed")
        logger.info(
            "[TEST-TURN1] ✓ Confirmed: FunctionResponse with pending status generated "
            "(correct LongRunningFunctionTool behavior)"
        )

        # when - Turn 2: Send real FunctionResponse via send_content()
        logger.info("=" * 80)
        logger.info("[TEST] Turn 2: Sending real FunctionResponse via send_content()")
        logger.info("=" * 80)

        # Construct FunctionResponse with real result
        real_result = {
            "success": True,
            "transaction_id": "test-txn-12345",
            "amount": 50.0,
            "currency": "USD",
            "recipient": "Bob",
        }

        function_response = types.Content(
            role="user",
            parts=[
                types.Part(
                    function_response=types.FunctionResponse(
                        id=tool_call_id_captured,
                        name="process_payment",
                        response=real_result,
                    )
                )
            ],
        )

        # Send FunctionResponse via LiveRequestQueue
        live_request_queue.send_content(function_response)
        logger.info("[TEST-TURN2] ✓ Sent FunctionResponse via send_content()")
        logger.info(f"[TEST-TURN2] FunctionResponse: id={tool_call_id_captured}, result={real_result}")

        # Collect Turn 2 events - iterate over same live_events stream
        turn2_events = []
        turn2_event_count = 0

        # Continue iterating over live_events for Turn 2
        async for event in live_events:
            turn2_event_count += 1
            turn2_events.append(event)
            event_type = type(event).__name__
            logger.info(f"[TEST-TURN2] Event {turn2_event_count}: {event_type}")

            # Check if we got any events
            if turn2_event_count > 0:
                turn2_events_received = True

            # Check for turn_complete
            if hasattr(event, "turn_complete") and event.turn_complete:
                logger.info("[TEST-TURN2] ✓ Turn 2 complete detected")
                break

        # then - Verify Turn 2 received events
        assert turn2_events_received, "Should receive events from ADK after send_content()"
        assert turn2_event_count > 0, "Should receive at least one event in Turn 2"
        logger.info(f"[TEST-TURN2] ✓ Received {turn2_event_count} events from ADK")
        logger.info("[TEST] ✓ Test passed - ADK responds after send_content()")

    except Exception as e:
        logger.error(f"[TEST] Test failed with exception: {e!s}")
        raise

    finally:
        # Close LiveRequestQueue
        try:
            live_request_queue.close()
            logger.info("[TEST] ✓ Closed LiveRequestQueue")
        except:  # noqa: E722
            pass
        logger.info(f"[TEST] Cleanup: session_id={session_id}")


@pytest.mark.asyncio
async def test_send_content_minimal_example() -> None:
    """
    Minimal test showing how send_content() should work.

    This test documents the expected pattern:
    1. Start run_live() session
    2. Send initial message
    3. Wait for Turn 1 to complete
    4. Get LiveRequestQueue somehow (TODO)
    5. Call queue.send_content(FunctionResponse)
    6. Collect Turn 2 events
    """
    # TODO: Implement once we understand how to access LiveRequestQueue
    # from within run_live() context

    # The challenge is that LiveRequestQueue is not exposed in the public API
    # We may need to:
    # - Check ADK source for how to access it
    # - Or test at a higher level (like our E2E test does)

    logger.info("[TEST] Minimal example - TODO: Implement with queue access")
    logger.info("[TEST] Current limitation: LiveRequestQueue not accessible in test")

    # For now, just verify we can create a session
    session_config = types.LiveConnectConfig(
        response_modalities=["TEXT"],
    )

    async with bidi_agent_runner.run_live(config=session_config) as (session, live_events):
        logger.info(f"✓ Created session: {session.id}")
        # TODO: How to access queue from here?
        logger.info("✗ Cannot access LiveRequestQueue - need to find API")
