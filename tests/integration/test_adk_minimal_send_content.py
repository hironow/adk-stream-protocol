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
                parts=[types.Part(text="Please use long_running_tool_returns_dict with task 'test'")]
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
                parts=[types.Part(text="Please use long_running_tool_returns_none with task 'test'")]
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
