"""
Minimal ADK test without adk_stream_protocol dependencies.

This test isolates ADK's behavior with LongRunningFunctionTool and send_content()
to determine if the issue is in ADK or our implementation.

Test approach:
1. Use ADK APIs directly (no adk_stream_protocol)
2. Define minimal tool set
3. Test basic send_content() flow
"""

from dotenv import load_dotenv

# Load environment variables BEFORE any ADK imports
load_dotenv(".env.local")

import asyncio
import uuid

import pytest
from google.adk.agents import Agent, LiveRequestQueue
from google.adk.agents.run_config import RunConfig, StreamingMode
from google.adk.runners import InMemoryRunner
from google.adk.tools import FunctionTool, LongRunningFunctionTool
from google.genai import types
from loguru import logger


def simple_tool(message: str) -> dict:
    """Simple tool that returns immediately."""
    logger.info(f"[simple_tool] Called with message: {message}")
    return {"result": f"Processed: {message}"}


def long_running_tool_returns_dict(task: str) -> dict:
    """Long running tool that returns a dict (old behavior)."""
    logger.info(f"[long_running_tool_returns_dict] Called with task: {task}")
    return {"status": "pending", "task": task}


def long_running_tool_returns_none(task: str) -> None:
    """Long running tool that returns None (ADK pattern)."""
    logger.info(f"[long_running_tool_returns_none] Called with task: {task}")
    return None


@pytest.mark.asyncio
async def test_adk_simple_tool_baseline() -> None:
    """Baseline test: Simple tool that returns immediately."""
    logger.info("=" * 80)
    logger.info("[TEST] Baseline: Simple tool with immediate return")
    logger.info("=" * 80)

    # Create agent with simple tool (not LongRunningFunctionTool)
    agent = Agent(
        name="test_simple_tool_agent",
        model="gemini-2.0-flash-exp",
        instruction="You are a helpful assistant. Use the simple_tool when asked.",
        tools=[FunctionTool(simple_tool)],
    )

    # Create runner and queue
    runner = InMemoryRunner(agent)
    queue = LiveRequestQueue()

    # Create run config for BIDI mode
    run_config = RunConfig(
        streaming_mode=StreamingMode.BIDI,
        response_modalities=["AUDIO"],
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
    )

    try:
        # Start run_live()
        live_events = runner.run_live(
            user_id="test-user",
            session_id=str(uuid.uuid4()),
            live_request_queue=queue,
            run_config=run_config,
        )

        # Send message
        queue.send_content(
            types.Content(parts=[types.Part(text="Please use simple_tool with message 'hello'")])
        )

        # Collect events
        events = []
        async for event in live_events:
            events.append(event)
            event_type = type(event).__name__
            logger.info(f"[BASELINE] Event {len(events)}: {event_type}")

            if hasattr(event, "turn_complete") and event.turn_complete:
                logger.info("[BASELINE] ✓ Turn complete - test passed")
                break

        assert len(events) > 0, "Should receive events"
        logger.info(f"[BASELINE] ✓ Test passed with {len(events)} events")

    finally:
        queue.close()


@pytest.mark.asyncio
async def test_adk_long_running_tool_returns_dict() -> None:
    """Test: LongRunningFunctionTool that returns a dict (old behavior)."""
    logger.info("=" * 80)
    logger.info("[TEST] LongRunningFunctionTool returns dict")
    logger.info("=" * 80)

    # Create agent with LongRunningFunctionTool that returns dict
    agent = Agent(
        name="test_long_running_dict_agent",
        model="gemini-2.0-flash-exp",
        instruction="You are a helpful assistant. Use long_running_tool_returns_dict when asked.",
        tools=[LongRunningFunctionTool(long_running_tool_returns_dict)],
    )

    runner = InMemoryRunner(agent)
    queue = LiveRequestQueue()
    run_config = RunConfig(
        streaming_mode=StreamingMode.BIDI,
        response_modalities=["AUDIO"],
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
    )

    try:
        live_events = runner.run_live(
            user_id="test-user",
            session_id=str(uuid.uuid4()),
            live_request_queue=queue,
            run_config=run_config,
        )

        queue.send_content(
            types.Content(
                parts=[
                    types.Part(text="Please use long_running_tool_returns_dict with task 'test'")
                ]
            )
        )

        events = []
        tool_call_id = None

        async for event in live_events:
            events.append(event)
            event_type = type(event).__name__
            logger.info(f"[RETURNS-DICT] Event {len(events)}: {event_type}")

            # Capture tool_call_id
            if hasattr(event, "content") and event.content:
                for part in event.content.parts:
                    if hasattr(part, "function_call") and part.function_call:
                        tool_call_id = part.function_call.id
                        logger.info(f"[RETURNS-DICT] Captured tool_call_id: {tool_call_id}")

            if hasattr(event, "turn_complete") and event.turn_complete:
                logger.info("[RETURNS-DICT] ✓ Turn complete")
                break

        assert len(events) > 0, "Should receive events"
        assert tool_call_id is not None, "Should capture tool_call_id"
        logger.info(f"[RETURNS-DICT] ✓ Test passed with {len(events)} events")

    finally:
        queue.close()


@pytest.mark.asyncio
async def test_adk_long_running_tool_returns_none() -> None:
    """Test: LongRunningFunctionTool that returns None (ADK pattern)."""
    logger.info("=" * 80)
    logger.info("[TEST] LongRunningFunctionTool returns None")
    logger.info("=" * 80)

    agent = Agent(
        model="gemini-2.0-flash-exp",
        tools=[LongRunningFunctionTool(long_running_tool_returns_none)],
        system_instruction="You are a helpful assistant. Use long_running_tool_returns_none when asked.",
    )

    runner = InMemoryRunner(agent)
    queue = LiveRequestQueue()
    run_config = RunConfig(
        streaming_mode=StreamingMode.BIDI,
        response_modalities=["AUDIO"],
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
    )

    try:
        live_events = runner.run_live(
            user_id="test-user",
            session_id=str(uuid.uuid4()),
            live_request_queue=queue,
            run_config=run_config,
        )

        queue.send_content(
            types.Content(
                parts=[
                    types.Part(text="Please use long_running_tool_returns_none with task 'test'")
                ]
            )
        )

        events = []
        tool_call_id = None
        turn_complete_received = False

        async for event in live_events:
            events.append(event)
            event_type = type(event).__name__
            logger.info(f"[RETURNS-NONE] Event {len(events)}: {event_type}")

            # Capture tool_call_id
            if hasattr(event, "content") and event.content:
                for part in event.content.parts:
                    if hasattr(part, "function_call") and part.function_call:
                        tool_call_id = part.function_call.id
                        logger.info(f"[RETURNS-NONE] Captured tool_call_id: {tool_call_id}")

            if hasattr(event, "turn_complete") and event.turn_complete:
                logger.info("[RETURNS-NONE] ✓ Turn complete")
                turn_complete_received = True
                break

            # Timeout after 10 events if turn doesn't complete
            if len(events) >= 10:
                logger.warning("[RETURNS-NONE] ⚠ Reached 10 events without turn_complete")
                break

        logger.info(f"[RETURNS-NONE] Received {len(events)} events")
        logger.info(f"[RETURNS-NONE] tool_call_id: {tool_call_id}")
        logger.info(f"[RETURNS-NONE] turn_complete: {turn_complete_received}")

        # Document what happened
        if not turn_complete_received:
            logger.error(
                "[RETURNS-NONE] ✗ Turn did NOT complete - this confirms the issue: "
                "LongRunningFunctionTool returns None → LLM waits forever → Turn hangs"
            )
        else:
            logger.info("[RETURNS-NONE] ✓ Turn completed successfully")

    finally:
        queue.close()


@pytest.mark.asyncio
async def test_hypothesis_2_no_pending_status_direct_result() -> None:
    """
    Test Hypothesis 2: LLM state after pending status blocks additional FunctionResponse.

    Verification approach:
    - Use regular FunctionTool (NOT LongRunningFunctionTool) that returns result immediately
    - No pending status involved
    - Expected: Turn should complete successfully with tool result
    - If this succeeds, it confirms that pending status is problematic
    """
    logger.info("=" * 80)
    logger.info("[HYPOTHESIS-2] Testing tool WITHOUT pending status")
    logger.info("[HYPOTHESIS-2] Approach: Regular FunctionTool returns result immediately")
    logger.info("=" * 80)

    def direct_result_tool(task: str) -> dict:
        """Regular tool that returns result immediately (no pending status)."""
        logger.info(f"[direct_result_tool] Called with task: {task}")
        return {
            "success": True,
            "result": f"Completed: {task}",
            "status": "completed",  # NOT "pending"
        }

    # Create agent with regular FunctionTool (NOT LongRunningFunctionTool)
    agent = Agent(
        name="test_direct_result_agent",
        model="gemini-2.0-flash-exp",
        instruction="You are a helpful assistant. Use direct_result_tool when asked.",
        tools=[FunctionTool(direct_result_tool)],  # Regular FunctionTool
    )

    app_name = "test_app"
    user_id = "test-user"
    session_id = str(uuid.uuid4())

    runner = InMemoryRunner(agent, app_name=app_name)
    queue = LiveRequestQueue()
    run_config = RunConfig(
        streaming_mode=StreamingMode.BIDI,
        response_modalities=["AUDIO"],
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
    )

    try:
        # Create session before run_live()
        await runner.session_service.create_session(
            app_name=app_name,
            user_id=user_id,
            session_id=session_id,
        )

        live_events = runner.run_live(
            user_id=user_id,
            session_id=session_id,
            live_request_queue=queue,
            run_config=run_config,
        )

        queue.send_content(
            types.Content(
                parts=[types.Part(text="Please use direct_result_tool with task 'test-task'")]
            )
        )

        events = []
        turn_complete = False

        async for event in live_events:
            events.append(event)
            event_type = type(event).__name__
            logger.info(f"[HYPOTHESIS-2] Event {len(events)}: {event_type}")

            if hasattr(event, "turn_complete") and event.turn_complete:
                logger.info("[HYPOTHESIS-2] ✓ Turn complete")
                turn_complete = True
                break

            # Timeout after 20 events
            if len(events) >= 20:
                logger.warning("[HYPOTHESIS-2] ⚠ Reached 20 events without turn_complete")
                break

        logger.info(f"[HYPOTHESIS-2] Received {len(events)} events")
        logger.info(f"[HYPOTHESIS-2] turn_complete: {turn_complete}")

        if turn_complete:
            logger.info("[HYPOTHESIS-2] ✓ SUCCESS: Direct result (no pending status) works!")
            logger.info("[HYPOTHESIS-2] → This suggests pending status might be the issue")
        else:
            logger.error("[HYPOTHESIS-2] ✗ FAILED: Even direct result doesn't work")
            logger.error("[HYPOTHESIS-2] → This suggests the issue is not with pending status")

        assert turn_complete, "Turn should complete for direct result tool"
        logger.info("[HYPOTHESIS-2] ✓ Test passed")

    finally:
        queue.close()


@pytest.mark.asyncio
async def test_hypothesis_1_same_tool_call_id_twice() -> None:
    """
    Test Hypothesis 1: Live API cannot accept same tool_call_id twice.

    Verification approach:
    - Use LongRunningFunctionTool that returns pending status
    - Capture tool_call_id from Turn 1
    - Manually send FunctionResponse with same tool_call_id via send_content()
    - Expected behavior if hypothesis is correct: Timeout (no response from LLM)
    - Expected behavior if hypothesis is wrong: Turn 2 completes successfully
    """
    logger.info("=" * 80)
    logger.info("[HYPOTHESIS-1] Testing same tool_call_id sent twice")
    logger.info(
        "[HYPOTHESIS-1] Approach: pending status (Turn 1) + manual FunctionResponse (Turn 2)"
    )
    logger.info("=" * 80)

    def pending_tool(task: str) -> dict:
        """Tool that returns pending status."""
        logger.info(f"[pending_tool] Called with task: {task}")
        return {"status": "pending", "task": task}

    agent = Agent(
        name="test_same_id_agent",
        model="gemini-2.0-flash-exp",
        instruction="You are a helpful assistant. Use pending_tool when asked.",
        tools=[LongRunningFunctionTool(pending_tool)],
    )

    app_name = "test_app"
    user_id = "test-user"
    session_id = str(uuid.uuid4())

    runner = InMemoryRunner(agent, app_name=app_name)
    queue = LiveRequestQueue()
    run_config = RunConfig(
        streaming_mode=StreamingMode.BIDI,
        response_modalities=["AUDIO"],
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
    )

    try:
        # Create session before run_live()
        await runner.session_service.create_session(
            app_name=app_name,
            user_id=user_id,
            session_id=session_id,
        )

        live_events = runner.run_live(
            user_id=user_id,
            session_id=session_id,
            live_request_queue=queue,
            run_config=run_config,
        )

        # Turn 1: Send initial message
        queue.send_content(
            types.Content(parts=[types.Part(text="Please use pending_tool with task 'test'")])
        )

        turn1_events = []
        tool_call_id = None
        turn1_complete = False

        logger.info("[HYPOTHESIS-1] === Turn 1: Collecting events ===")
        async for event in live_events:
            turn1_events.append(event)
            event_type = type(event).__name__
            logger.info(f"[HYPOTHESIS-1-T1] Event {len(turn1_events)}: {event_type}")

            # Capture tool_call_id
            if hasattr(event, "content") and event.content:
                for part in event.content.parts:
                    if hasattr(part, "function_call") and part.function_call:
                        tool_call_id = part.function_call.id
                        logger.info(f"[HYPOTHESIS-1-T1] Captured tool_call_id: {tool_call_id}")

            if hasattr(event, "turn_complete") and event.turn_complete:
                logger.info("[HYPOTHESIS-1-T1] ✓ Turn 1 complete")
                turn1_complete = True
                break

        assert turn1_complete, "Turn 1 should complete"
        assert tool_call_id is not None, "Should capture tool_call_id"

        # Turn 2: Send FunctionResponse with SAME tool_call_id
        logger.info("[HYPOTHESIS-1] === Turn 2: Sending FunctionResponse with same ID ===")
        logger.info(f"[HYPOTHESIS-1-T2] Using same tool_call_id: {tool_call_id}")

        final_result = {"success": True, "result": "Final result for test task"}
        queue.send_content(
            types.Content(
                role="user",
                parts=[
                    types.Part(
                        function_response=types.FunctionResponse(
                            id=tool_call_id,  # SAME ID
                            name="pending_tool",
                            response=final_result,
                        )
                    )
                ],
            )
        )
        logger.info("[HYPOTHESIS-1-T2] ✓ Sent FunctionResponse via send_content()")

        # Collect Turn 2 events with timeout
        turn2_events = []
        turn2_complete = False

        async def collect_turn2():
            nonlocal turn2_complete
            async for event in live_events:
                turn2_events.append(event)
                event_type = type(event).__name__
                logger.info(f"[HYPOTHESIS-1-T2] Event {len(turn2_events)}: {event_type}")

                if hasattr(event, "turn_complete") and event.turn_complete:
                    logger.info("[HYPOTHESIS-1-T2] ✓ Turn 2 complete")
                    turn2_complete = True
                    break

        try:
            await asyncio.wait_for(collect_turn2(), timeout=10.0)
        except asyncio.TimeoutError:
            logger.error("[HYPOTHESIS-1-T2] ✗ Timeout after 10 seconds")

        logger.info(f"[HYPOTHESIS-1-T2] Received {len(turn2_events)} events")
        logger.info(f"[HYPOTHESIS-1-T2] turn2_complete: {turn2_complete}")

        if turn2_complete:
            logger.info("[HYPOTHESIS-1] ✗ Turn 2 completed - Hypothesis 1 is WRONG")
            logger.info("[HYPOTHESIS-1] → Same tool_call_id CAN be used twice")
        else:
            logger.info("[HYPOTHESIS-1] ✓ Turn 2 timeout - Hypothesis 1 is CORRECT")
            logger.info("[HYPOTHESIS-1] → Same tool_call_id CANNOT be used twice")

        # Document findings without asserting (this is exploratory test)
        logger.info("[HYPOTHESIS-1] Test completed - check logs for findings")

    finally:
        queue.close()


@pytest.mark.asyncio
async def test_hypothesis_1_success_different_id_works() -> None:
    """
    Test Hypothesis 1 Success Case: Using DIFFERENT tool_call_id should work.

    This test verifies the fix approach:
    - Turn 1: LongRunningFunctionTool returns pending status (ADK auto-sends with original ID)
    - Turn 2: Send FunctionResponse with a NEW/DIFFERENT tool_call_id
    - Expected: Turn 2 should complete successfully (LLM accepts the new ID)

    If this test passes, it confirms the fix: generate a new ID for manual FunctionResponse.
    """
    logger.info("=" * 80)
    logger.info("[HYPOTHESIS-1-SUCCESS] Testing DIFFERENT tool_call_id (should work)")
    logger.info("[HYPOTHESIS-1-SUCCESS] Approach: pending status (Turn 1) + NEW ID (Turn 2)")
    logger.info("=" * 80)

    def pending_tool(task: str) -> dict:
        """Tool that returns pending status."""
        logger.info(f"[pending_tool] Called with task: {task}")
        return {"status": "pending", "task": task}

    agent = Agent(
        name="test_different_id_agent",
        model="gemini-2.0-flash-exp",
        instruction="You are a helpful assistant. Use pending_tool when asked.",
        tools=[LongRunningFunctionTool(pending_tool)],
    )

    app_name = "test_app"
    user_id = "test-user"
    session_id = str(uuid.uuid4())

    runner = InMemoryRunner(agent, app_name=app_name)
    queue = LiveRequestQueue()
    run_config = RunConfig(
        streaming_mode=StreamingMode.BIDI,
        response_modalities=["AUDIO"],
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
    )

    try:
        # Create session before run_live()
        await runner.session_service.create_session(
            app_name=app_name,
            user_id=user_id,
            session_id=session_id,
        )

        live_events = runner.run_live(
            user_id=user_id,
            session_id=session_id,
            live_request_queue=queue,
            run_config=run_config,
        )

        # Turn 1: Send initial message
        queue.send_content(
            types.Content(parts=[types.Part(text="Please use pending_tool with task 'test'")])
        )

        turn1_events = []
        original_tool_call_id = None
        turn1_complete = False

        logger.info("[HYPOTHESIS-1-SUCCESS] === Turn 1: Collecting events ===")
        async for event in live_events:
            turn1_events.append(event)
            event_type = type(event).__name__

            # Capture original tool_call_id
            if hasattr(event, "content") and event.content:
                for part in event.content.parts:
                    if hasattr(part, "function_call") and part.function_call:
                        original_tool_call_id = part.function_call.id
                        logger.info(
                            f"[HYPOTHESIS-1-SUCCESS-T1] Captured original tool_call_id: {original_tool_call_id}"
                        )

            if hasattr(event, "turn_complete") and event.turn_complete:
                logger.info("[HYPOTHESIS-1-SUCCESS-T1] ✓ Turn 1 complete")
                turn1_complete = True
                break

        assert turn1_complete, "Turn 1 should complete"
        assert original_tool_call_id is not None, "Should capture original tool_call_id"

        # Turn 2: Send FunctionResponse with DIFFERENT/NEW tool_call_id
        logger.info("[HYPOTHESIS-1-SUCCESS] === Turn 2: Sending FunctionResponse with NEW ID ===")

        # Generate a NEW tool_call_id (different from original)
        new_tool_call_id = f"new-function-call-{uuid.uuid4()}"
        logger.info(f"[HYPOTHESIS-1-SUCCESS-T2] Original ID: {original_tool_call_id}")
        logger.info(f"[HYPOTHESIS-1-SUCCESS-T2] NEW ID: {new_tool_call_id}")

        final_result = {"success": True, "result": "Final result for test task"}
        queue.send_content(
            types.Content(
                role="user",
                parts=[
                    types.Part(
                        function_response=types.FunctionResponse(
                            id=new_tool_call_id,  # NEW/DIFFERENT ID
                            name="pending_tool",
                            response=final_result,
                        )
                    )
                ],
            )
        )
        logger.info(
            "[HYPOTHESIS-1-SUCCESS-T2] ✓ Sent FunctionResponse with NEW ID via send_content()"
        )

        # Collect Turn 2 events with timeout
        turn2_events = []
        turn2_complete = False

        async def collect_turn2():
            nonlocal turn2_complete
            async for event in live_events:
                turn2_events.append(event)
                event_type = type(event).__name__
                logger.info(f"[HYPOTHESIS-1-SUCCESS-T2] Event {len(turn2_events)}: {event_type}")

                if hasattr(event, "turn_complete") and event.turn_complete:
                    logger.info("[HYPOTHESIS-1-SUCCESS-T2] ✓ Turn 2 complete")
                    turn2_complete = True
                    break

        try:
            await asyncio.wait_for(collect_turn2(), timeout=10.0)
        except asyncio.TimeoutError:
            logger.error("[HYPOTHESIS-1-SUCCESS-T2] ✗ Timeout after 10 seconds")

        logger.info(f"[HYPOTHESIS-1-SUCCESS-T2] Received {len(turn2_events)} events")
        logger.info(f"[HYPOTHESIS-1-SUCCESS-T2] turn2_complete: {turn2_complete}")

        # Verify results
        if turn2_complete and len(turn2_events) > 0:
            logger.info("[HYPOTHESIS-1-SUCCESS] ✓ SUCCESS - Different ID works!")
            logger.info(
                "[HYPOTHESIS-1-SUCCESS] → Fix confirmed: Generate NEW ID for manual FunctionResponse"
            )
        else:
            logger.error("[HYPOTHESIS-1-SUCCESS] ✗ FAILED - Even different ID doesn't work")
            logger.error(
                "[HYPOTHESIS-1-SUCCESS] → This suggests a deeper issue beyond just duplicate IDs"
            )

        # Assert for test success
        assert turn2_complete, "Turn 2 should complete when using different ID"
        assert len(turn2_events) > 0, "Should receive events in Turn 2 with different ID"
        logger.info("[HYPOTHESIS-1-SUCCESS] Test completed - check logs for findings")

    finally:
        queue.close()


@pytest.mark.asyncio
async def test_hypothesis_3_direct_live_api_send_tool_response() -> None:
    """
    Test Hypothesis 3: Use Live API's send_tool_response() directly (bypass ADK).

    This test bypasses ADK completely and uses google.genai.live API directly
    to determine if the issue is in ADK's implementation or Live API itself.

    Approach:
    1. Use google.genai.live.connect() directly (no ADK)
    2. Define tools using Live API format
    3. Turn 1: Receive tool call from model
    4. Turn 2: Use session.send_tool_response() (NOT ADK's send_content)
    5. Verify Turn 2 receives events

    Expected result:
    - If this succeeds → ADK's send_content() implementation is the issue
    - If this fails → Live API itself has limitations with tool responses
    """
    logger.info("=" * 80)
    logger.info("[HYPOTHESIS-3] Testing Live API's send_tool_response() directly")
    logger.info("[HYPOTHESIS-3] Approach: Bypass ADK, use Live API directly")
    logger.info("=" * 80)

    # Import Live API directly
    from google import genai

    # Create client
    client = genai.Client()

    # Define tool using Live API format (FunctionDeclaration)
    test_tool = types.FunctionDeclaration(
        name="test_tool",
        description="A test tool that processes a task",
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "task": types.Schema(
                    type=types.Type.STRING,
                    description="The task to process",
                )
            },
            required=["task"],
        ),
    )

    # Create Live connection config
    # Note: model is specified in client.aio.live.connect(), not in config
    config = types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        tools=[types.Tool(function_declarations=[test_tool])],
        system_instruction="You are a helpful assistant. When asked to process a task, use the test_tool.",
    )

    tool_call_id_captured = None
    turn1_complete = False
    turn2_events_received = False

    try:
        # Connect to Live API
        logger.info("[HYPOTHESIS-3] Connecting to Live API...")
        async with client.aio.live.connect(
            model="models/gemini-2.0-flash-exp", config=config
        ) as session:
            logger.info("[HYPOTHESIS-3] ✓ Connected to Live API")

            # Turn 1: Send message that triggers tool call
            logger.info("[HYPOTHESIS-3] === Turn 1: Sending message ===")
            await session.send(
                input=types.LiveClientContent(
                    turns=[
                        types.Content(
                            role="user",
                            parts=[types.Part(text="Please process task 'test-task-123'")],
                        )
                    ],
                    turn_complete=True,
                )
            )
            logger.info("[HYPOTHESIS-3-T1] ✓ Sent message via Live API")

            # Collect Turn 1 events
            turn1_events = []
            async for response in session.receive():
                turn1_events.append(response)
                logger.info(
                    f"[HYPOTHESIS-3-T1] Event {len(turn1_events)}: {type(response).__name__}"
                )

                # Capture tool_call_id
                if response.tool_call:
                    for fc in response.tool_call.function_calls:
                        tool_call_id_captured = fc.id
                        logger.info(
                            f"[HYPOTHESIS-3-T1] ✓ Captured tool_call_id: {tool_call_id_captured}"
                        )

                # Check for turn_complete
                if response.server_content and response.server_content.turn_complete:
                    logger.info("[HYPOTHESIS-3-T1] ✓ Turn 1 complete")
                    turn1_complete = True
                    break

                # Safety limit
                if len(turn1_events) >= 30:
                    logger.warning("[HYPOTHESIS-3-T1] ⚠ Safety limit reached (30 events)")
                    break

            assert turn1_complete, "Turn 1 should complete"
            assert tool_call_id_captured is not None, "Should capture tool_call_id"

            # Turn 2: Send tool response using send_tool_response()
            logger.info("[HYPOTHESIS-3] === Turn 2: Using send_tool_response() ===")
            logger.info(f"[HYPOTHESIS-3-T2] tool_call_id: {tool_call_id_captured}")

            # Prepare FunctionResponse
            function_response = types.FunctionResponse(
                id=tool_call_id_captured,
                name="test_tool",
                response={
                    "success": True,
                    "result": "Task 'test-task-123' completed successfully",
                },
            )

            # Use send_tool_response() method (Live API's recommended method)
            logger.info("[HYPOTHESIS-3-T2] Calling session.send_tool_response()...")
            await session.send_tool_response(function_responses=[function_response])
            logger.info("[HYPOTHESIS-3-T2] ✓ Sent tool response via send_tool_response()")

            # Collect Turn 2 events with timeout
            turn2_events = []

            async def collect_turn2():
                nonlocal turn2_events_received
                async for response in session.receive():
                    turn2_events.append(response)
                    event_type = type(response).__name__
                    logger.info(f"[HYPOTHESIS-3-T2] Event {len(turn2_events)}: {event_type}")

                    # Check if we got any events
                    if len(turn2_events) > 0:
                        turn2_events_received = True

                    # Check for turn_complete
                    if response.server_content and response.server_content.turn_complete:
                        logger.info("[HYPOTHESIS-3-T2] ✓ Turn 2 complete")
                        break

            try:
                await asyncio.wait_for(collect_turn2(), timeout=10.0)
            except asyncio.TimeoutError:
                logger.error(
                    f"[HYPOTHESIS-3-T2] ✗ Timeout after 10 seconds - received {len(turn2_events)} events"
                )

            # Log results
            logger.info(f"[HYPOTHESIS-3-T2] Received {len(turn2_events)} events")
            logger.info(f"[HYPOTHESIS-3-T2] turn2_events_received: {turn2_events_received}")

            # Verify and conclude
            if turn2_events_received and len(turn2_events) > 0:
                logger.info("[HYPOTHESIS-3] ✓ SUCCESS - send_tool_response() works!")
                logger.info(
                    "[HYPOTHESIS-3] → Conclusion: ADK's send_content() implementation is the issue"
                )
                logger.info(
                    "[HYPOTHESIS-3] → Fix: Bypass ADK and use Live API's send_tool_response() directly"
                )
            else:
                logger.error("[HYPOTHESIS-3] ✗ FAILED - Even send_tool_response() doesn't work")
                logger.error(
                    "[HYPOTHESIS-3] → Conclusion: Live API itself has limitations with tool responses"
                )
                logger.error(
                    "[HYPOTHESIS-3] → This suggests the problem is deeper than ADK implementation"
                )

            # Assert for test
            assert turn2_events_received, "Should receive events after send_tool_response()"
            assert len(turn2_events) > 0, "Should receive at least one event in Turn 2"
            logger.info("[HYPOTHESIS-3] Test completed - check logs for findings")

    except Exception as e:
        logger.error(f"[HYPOTHESIS-3] Exception occurred: {e!s}")
        logger.exception(e)
        raise
