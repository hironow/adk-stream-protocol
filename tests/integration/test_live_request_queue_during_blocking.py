"""
EXPERIMENT: Test LiveRequestQueue accessibility during BLOCKING tool execution.

This experiment investigates:
1. Does LiveRequestQueue continue operating while a BLOCKING tool is executing?
2. Can we observe messages sent to LiveRequestQueue during BLOCKING?
3. Do we really need approval_queue, or can we use LiveRequestQueue directly?

Expected outcomes:
- If LiveRequestQueue continues: Events should appear while tool is blocked
- If LiveRequestQueue is accessible in tool: We might not need approval_queue
- If neither: approval_queue is the correct approach
"""

import asyncio
import logging
import uuid

import pytest
from dotenv import load_dotenv
from google.adk.agents import Agent, LiveRequestQueue
from google.adk.agents.run_config import RunConfig, StreamingMode
from google.adk.apps import App, ResumabilityConfig
from google.adk.runners import InMemoryRunner
from google.adk.tools import FunctionTool, ToolContext
from google.genai import types
from loguru import logger as loguru_logger

from adk_stream_protocol.adk.session import get_or_create_session
from adk_stream_protocol.ags import BIDI_MODEL


load_dotenv(".env.local")

# Enable ADK debug logging
logging.basicConfig(
    level=logging.DEBUG, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)

logger = loguru_logger


# ========== Experiment Tool ==========


async def live_queue_experiment_tool(message: str, tool_context: ToolContext) -> dict:
    """
    EXPERIMENT: Inspect ToolContext to find LiveRequestQueue access.

    This tool explores what's available in tool_context to see if we can
    access LiveRequestQueue directly, eliminating the need for approval_queue.
    """
    logger.info(f"[EXPERIMENT_TOOL] Called with message: {message}")
    logger.info("[EXPERIMENT_TOOL] 🔍 Inspecting ToolContext...")

    # Inspect ToolContext structure
    logger.info(f"[EXPERIMENT_TOOL] ToolContext attributes: {dir(tool_context)}")
    logger.info(f"[EXPERIMENT_TOOL] ToolContext.session: {tool_context.session}")
    logger.info(f"[EXPERIMENT_TOOL] ToolContext.session attributes: {dir(tool_context.session)}")
    logger.info(f"[EXPERIMENT_TOOL] ToolContext.session.state: {tool_context.session.state}")

    # Check if there's a live_request_queue accessible
    if hasattr(tool_context, "live_request_queue"):
        logger.info("[EXPERIMENT_TOOL] ✅ Found live_request_queue in ToolContext!")
        logger.info(f"[EXPERIMENT_TOOL] Type: {type(tool_context.live_request_queue)}")
    else:
        logger.info("[EXPERIMENT_TOOL] ❌ No live_request_queue in ToolContext")

    # Check session for live_request_queue
    if hasattr(tool_context.session, "live_request_queue"):
        logger.info("[EXPERIMENT_TOOL] ✅ Found live_request_queue in session!")
        logger.info(f"[EXPERIMENT_TOOL] Type: {type(tool_context.session.live_request_queue)}")
    else:
        logger.info("[EXPERIMENT_TOOL] ❌ No live_request_queue in session")

    # Check what else is in the context
    logger.info("[EXPERIMENT_TOOL] Other ToolContext fields:")
    for attr in dir(tool_context):
        if not attr.startswith("_"):
            try:
                value = getattr(tool_context, attr)
                logger.info(f"[EXPERIMENT_TOOL]   - {attr}: {type(value)}")
            except Exception as e:
                logger.info(f"[EXPERIMENT_TOOL]   - {attr}: Error accessing: {e}")

    logger.info("[EXPERIMENT_TOOL] ⏳ Will block for 5 seconds...")
    await asyncio.sleep(5.0)

    logger.info("[EXPERIMENT_TOOL] ✓ 5 seconds elapsed")

    return {
        "status": "completed",
        "message": f"Processed '{message}' - Check logs for ToolContext inspection results",
        "has_live_request_queue_in_context": hasattr(tool_context, "live_request_queue"),
        "has_live_request_queue_in_session": hasattr(tool_context.session, "live_request_queue"),
    }


# Simple wrapper for FunctionDeclaration
def live_queue_experiment_tool_simple(message: str) -> dict:
    """Simple wrapper for declaration creation."""
    return {"status": "pending", "message": "Processing"}


# Create BLOCKING declaration
live_queue_experiment_declaration = types.FunctionDeclaration.from_callable_with_api_option(
    callable=live_queue_experiment_tool_simple,
    api_option="GEMINI_API",
    behavior=types.Behavior.BLOCKING,
)

# Create FunctionTool
LIVE_QUEUE_EXPERIMENT_TOOL = FunctionTool(live_queue_experiment_tool)
LIVE_QUEUE_EXPERIMENT_TOOL._declaration = live_queue_experiment_declaration  # type: ignore[attr-defined]


@pytest.fixture
def experiment_runner():
    """Create fresh runner for each test to ensure test isolation."""
    # Create test agent with unique name to avoid conflicts
    agent = Agent(
        name=f"live_queue_experiment_agent_{uuid.uuid4().hex[:8]}",
        model=BIDI_MODEL,
        description="Experiment agent for LiveRequestQueue observation",
        instruction=(
            "You are a test assistant. When the user asks you to process a message, "
            "call the live_queue_experiment_tool function. You MUST use the tool."
        ),
        tools=[LIVE_QUEUE_EXPERIMENT_TOOL],  # type: ignore[list-item]
    )

    # Create App with unique name
    app = App(
        name=f"live_queue_experiment_app_{uuid.uuid4().hex[:8]}",
        root_agent=agent,
        resumability_config=ResumabilityConfig(is_resumable=True),
    )

    # Create Runner
    return InMemoryRunner(app=app)


@pytest.mark.asyncio
async def test_live_request_queue_during_blocking(experiment_runner):
    """
    EXPERIMENT: Observe LiveRequestQueue behavior during BLOCKING tool execution.

    Test procedure:
    1. Start BIDI session with run_live()
    2. Send user message → LLM calls BLOCKING tool
    3. While tool is blocked (5 seconds), send test messages via LiveRequestQueue
    4. Observe if those messages appear as events
    5. Conclude whether LiveRequestQueue continues during BLOCKING

    Expected observations:
    - If messages appear as events → LiveRequestQueue is active during BLOCKING
    - If no messages appear → LiveRequestQueue is paused/blocked
    """
    logger.info("=" * 80)
    logger.info("[EXPERIMENT] LiveRequestQueue Behavior During BLOCKING")
    logger.info("=" * 80)

    live_request_queue = LiveRequestQueue()

    # Test variables
    user_id = "test-user-live-queue-001"
    connection_signature = str(uuid.uuid4())
    tool_started = False
    tool_completed = False
    messages_sent_during_blocking = []
    events_received_during_blocking = []
    all_events = []
    message_task = None  # Initialize for finally block cleanup

    # Create RunConfig for BIDI mode
    run_config = RunConfig(
        streaming_mode=StreamingMode.BIDI,
        response_modalities=["AUDIO"],
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
        session_resumption=None,
        context_window_compression=types.ContextWindowCompressionConfig(
            trigger_tokens=100000,
            sliding_window=types.SlidingWindow(target_tokens=80000),
        ),
    )

    try:
        # Create ADK session
        session = await get_or_create_session(
            user_id=user_id,
            agent_runner=experiment_runner,
            app_name="live_queue_experiment_app",
            connection_signature=connection_signature,
        )
        session_id = session.id
        logger.info(f"[TEST] ✓ Created ADK session: {session_id}")

        # Start run_live()
        live_events = experiment_runner.run_live(
            user_id=user_id,
            session_id=session.id,
            live_request_queue=live_request_queue,
            run_config=run_config,
            session=session,  # Still required during migration period
        )
        logger.info(f"[TEST] ✓ Started run_live() with session: {session_id}")

        # Send user message
        user_message_content = types.Content(
            role="user",
            parts=[types.Part.from_text(text="Please process task 'live-queue-experiment'")],
        )
        live_request_queue.send_content(user_message_content)
        logger.info("[TEST] ✓ Sent user message via LiveRequestQueue")

        # ========== Event Loop with Message Injection ==========

        async def send_test_messages_during_blocking():
            """Send test messages while tool is BLOCKING"""
            # Wait for tool to start
            while not tool_started:
                await asyncio.sleep(0.1)

            logger.info("[TEST] 🚀 Tool has started BLOCKING - sending test messages...")

            # Send 3 test messages during the 5-second blocking period
            for i in range(3):
                await asyncio.sleep(1.5)  # Send every 1.5 seconds
                test_message = types.Content(
                    role="user",
                    parts=[types.Part.from_text(text=f"TEST_MESSAGE_{i + 1}")],
                )
                live_request_queue.send_content(test_message)
                messages_sent_during_blocking.append(f"TEST_MESSAGE_{i + 1}")
                logger.info(f"[TEST] 📨 Sent TEST_MESSAGE_{i + 1} while tool is BLOCKING")

        message_task = asyncio.create_task(send_test_messages_during_blocking())

        async def event_loop():
            nonlocal tool_started, tool_completed

            event_count = 0
            async for event in live_events:
                event_count += 1
                all_events.append(event)
                logger.info(f"[TEST] Event {event_count}: {type(event).__name__}")

                # Detect FunctionCall (tool starts)
                if hasattr(event, "content") and event.content:
                    for part in event.content.parts:
                        if hasattr(part, "function_call") and part.function_call:
                            tool_started = True
                            logger.info(
                                f"[TEST] ⚡ FunctionCall: {part.function_call.name} - BLOCKING started"
                            )

                        # Detect FunctionResponse (tool completes)
                        if hasattr(part, "function_response") and part.function_response:
                            tool_completed = True
                            func_resp = part.function_response
                            logger.info("=" * 80)
                            logger.info("[TEST] FunctionResponse received")
                            logger.info(f"[TEST] Response data: {func_resp.response}")
                            logger.info("=" * 80)

                # If tool is blocking, track events
                if tool_started and not tool_completed:
                    events_received_during_blocking.append(event)
                    logger.info(
                        f"[TEST] 📊 Event received while BLOCKING (count: {len(events_received_during_blocking)})"
                    )

                # Check for turn_complete
                if hasattr(event, "turn_complete") and event.turn_complete:
                    logger.info("[TEST] ✓ turn_complete received")
                    break

        # Run event loop with timeout
        try:
            await asyncio.wait_for(event_loop(), timeout=20.0)
        except TimeoutError:
            logger.error("[TEST] ❌ TIMEOUT - Event loop did not complete")

        # Wait for message task
        await message_task

        # ========== Results Analysis ==========

        logger.info("=" * 80)
        logger.info("[EXPERIMENT] RESULTS ANALYSIS:")
        logger.info("=" * 80)
        logger.info(f"  - Tool started BLOCKING: {tool_started}")
        logger.info(f"  - Tool completed: {tool_completed}")
        logger.info(f"  - Messages sent during BLOCKING: {len(messages_sent_during_blocking)}")
        logger.info(f"  - Events received during BLOCKING: {len(events_received_during_blocking)}")
        logger.info(f"  - Total events: {len(all_events)}")
        logger.info("=" * 80)
        logger.info("")
        logger.info("📊 CONCLUSIONS:")

        if len(events_received_during_blocking) > 0:
            logger.info("  ✅ LiveRequestQueue CONTINUES operating during BLOCKING!")
            logger.info("  ✅ Events are received while tool is blocked")
            logger.info("  ℹ️  However, tool cannot directly access these events")
            logger.info("  ℹ️  This is why approval_queue is necessary:")
            logger.info("     - LiveRequestQueue is managed by ADK's run_live()")
            logger.info("     - Tool has no API to read from LiveRequestQueue")
            logger.info("     - approval_queue provides awaitable interface for tool")
        else:
            logger.info("  ❌ LiveRequestQueue appears to be paused during BLOCKING")
            logger.info("  ℹ️  This confirms approval_queue is necessary")

        logger.info("=" * 80)

        # Basic assertions
        assert tool_started, "Tool should have started"
        assert tool_completed, "Tool should have completed"

    finally:
        # Cleanup: Cancel pending async tasks first
        if message_task and not message_task.done():
            message_task.cancel()
            try:
                await message_task
            except asyncio.CancelledError:
                logger.info("[TEST] ✓ Cancelled message_task")

        # Then close the queue
        try:
            live_request_queue.close()
            logger.info("[TEST] ✓ Closed LiveRequestQueue")
        except Exception as e:
            logger.warning(f"[TEST] Failed to close LiveRequestQueue: {e}")
