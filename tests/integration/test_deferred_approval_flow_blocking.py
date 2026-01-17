"""
EXPERIMENT: Test BLOCKING behavior mode for deferred approval flow.

This test investigates if types.Behavior.BLOCKING allows tool functions
to await approval inside the function without blocking the event loop.

If successful, this would simplify the implementation significantly by
eliminating the need for:
- Plugin callbacks
- Deferred execution tasks
- Manual FunctionResponse sending

The tool function would simply await approval and return the final result.
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

from adk_stream_protocol.adk.adk_compat import get_or_create_session

# Import ApprovalQueue from the main test file
from .test_deferred_approval_flow import ApprovalQueue


load_dotenv(".env.local")

# Enable ADK debug logging
logging.basicConfig(
    level=logging.DEBUG, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)

logger = loguru_logger


# ========== BLOCKING Mode Tool ==========


async def blocking_approval_tool(message: str, tool_context: ToolContext) -> dict:
    """
    BLOCKING mode tool that waits for approval inside the function.

    This is the key experiment: Can the tool await approval without
    blocking the entire event loop in BIDI mode?
    """
    logger.info(f"[BLOCKING_TOOL] Called with message: {message}")
    logger.info("[BLOCKING_TOOL] Will now WAIT for approval...")

    tool_call_id = tool_context.function_call_id

    # Get approval_queue from session state
    approval_queue = tool_context.session.state.get("approval_queue")

    if not approval_queue:
        logger.error("[BLOCKING_TOOL] No approval_queue in session state!")
        return {
            "status": "error",
            "message": "approval_queue not configured",
        }

    # Register this tool call for approval
    approval_queue.request_approval(tool_call_id, "blocking_approval_tool", {"message": message})
    logger.info(f"[BLOCKING_TOOL] Registered approval request for {tool_call_id}")

    # ⭐ KEY EXPERIMENT: await inside BLOCKING tool function
    try:
        logger.info("[BLOCKING_TOOL] ⏳ Awaiting approval (this is the critical moment)...")
        approval_result = await approval_queue.wait_for_approval(tool_call_id, timeout=10.0)
        logger.info(f"[BLOCKING_TOOL] ✓ Approval received: {approval_result}")

        if approval_result.get("approved"):
            logger.info("[BLOCKING_TOOL] ✅ APPROVED - returning success result")
            return {
                "status": "approved",
                "message": f"Successfully processed '{message}' after user approval",
                "result": f"Task '{message}' completed",
            }
        else:
            logger.info("[BLOCKING_TOOL] ❌ DENIED - returning denial result")
            return {
                "status": "denied",
                "message": f"User denied the operation for '{message}'",
            }

    except TimeoutError:
        logger.error("[BLOCKING_TOOL] ⏰ Timeout waiting for approval")
        return {
            "status": "timeout",
            "message": "Approval request timed out",
        }


# Simple wrapper for FunctionDeclaration creation (no ToolContext)
# This is needed because from_callable_with_api_option can't handle ToolContext
def blocking_approval_tool_simple(message: str) -> dict:
    """
    Simple wrapper for declaration creation.

    The actual implementation (blocking_approval_tool) will be used at runtime.
    """
    return {"status": "pending", "message": "Processing"}


# Create FunctionDeclaration with BLOCKING behavior using simple wrapper
blocking_approval_declaration = types.FunctionDeclaration.from_callable_with_api_option(
    callable=blocking_approval_tool_simple,  # Use simple wrapper for schema
    api_option="GEMINI_API",
    behavior=types.Behavior.BLOCKING,  # ⭐ BLOCKING mode
)

# Create FunctionTool from actual implementation (with ToolContext)
BLOCKING_APPROVAL_TOOL = FunctionTool(blocking_approval_tool)
# Override the declaration to use our BLOCKING schema
BLOCKING_APPROVAL_TOOL._declaration = blocking_approval_declaration  # type: ignore[attr-defined]

# Create test agent
test_agent_blocking = Agent(
    name="test_blocking_approval_agent",
    model="gemini-2.5-flash-native-audio-preview-12-2025",
    description="Test agent for BLOCKING mode approval experiment",
    instruction=(
        "You are a test assistant. When the user asks you to process a message, "
        "call the blocking_approval_tool function. You MUST use the tool."
    ),
    tools=[BLOCKING_APPROVAL_TOOL],  # type: ignore[list-item]
)

# Create App
test_app_blocking = App(
    name="test_blocking_approval_app",
    root_agent=test_agent_blocking,
    resumability_config=ResumabilityConfig(is_resumable=True),
)

# Create Runner
test_runner_blocking = InMemoryRunner(app=test_app_blocking)


# ========== Test Case ==========


@pytest.mark.asyncio
async def test_blocking_mode_approved():
    """
    EXPERIMENT: Test if BLOCKING behavior allows tool to await approval.

    Expected behavior:
    1. LLM calls test_approval_tool_blocking
    2. Tool function awaits approval (blocks tool execution)
    3. Event loop continues (WebSocket can receive approval message)
    4. Approval arrives → Future resolves
    5. Tool returns final result
    6. LLM receives final result and responds

    If successful: LLM should see "approved" status in a single FunctionResponse
    If failed: Deadlock or timeout (like Phase 2)
    """
    logger.info("=" * 80)
    logger.info("[EXPERIMENT] BLOCKING Mode Approval Flow - Testing await in tool")
    logger.info("=" * 80)

    approval_queue = ApprovalQueue()
    live_request_queue = LiveRequestQueue()

    # Test variables
    user_id = "test-user-blocking-001"
    connection_signature = str(uuid.uuid4())
    tool_call_id = None
    final_result_received = False
    all_events = []

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
            agent_runner=test_runner_blocking,
            app_name="test_blocking_app",
            connection_signature=connection_signature,
        )
        session_id = session.id
        logger.info(f"[TEST] ✓ Created ADK session: {session_id}")

        # Store approval_queue in session state
        session.state["approval_queue"] = approval_queue
        logger.info("[TEST] ✓ Stored approval_queue in session.state")

        # Start run_live()
        live_events = test_runner_blocking.run_live(
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
            parts=[types.Part.from_text(text="Please process task 'blocking-test'")],
        )
        live_request_queue.send_content(user_message_content)
        logger.info("[TEST] ✓ Sent user message via LiveRequestQueue")

        # ========== Event Loop with Approval Simulation ==========

        async def approve_after_delay():
            """Simulate user approval after 2 seconds"""
            await asyncio.sleep(2.0)
            logger.info("[TEST] ⏰ Simulating user APPROVAL...")
            approval_queue.submit_approval(tool_call_id, approved=True)
            logger.info("[TEST] ✓ APPROVAL submitted")

        approval_task = None

        async def event_loop():
            nonlocal tool_call_id, final_result_received, approval_task

            event_count = 0
            async for event in live_events:
                event_count += 1
                all_events.append(event)
                logger.info(f"[TEST] Event {event_count}: {type(event).__name__}")

                # Detect FunctionCall
                if hasattr(event, "content") and event.content:
                    for part in event.content.parts:
                        if hasattr(part, "function_call") and part.function_call:
                            tool_call_id = part.function_call.id
                            logger.info(
                                f"[TEST] ✓ FunctionCall: {part.function_call.name} (id={tool_call_id})"
                            )
                            # Start approval simulation
                            approval_task = asyncio.create_task(approve_after_delay())

                        # Detect FunctionResponse
                        if hasattr(part, "function_response") and part.function_response:
                            func_resp = part.function_response
                            logger.info("=" * 80)
                            logger.info(f"[TEST] FunctionResponse received (id={func_resp.id})")
                            logger.info(f"[TEST] Response data: {func_resp.response}")
                            logger.info("=" * 80)

                            # Check if this is the final result
                            if isinstance(func_resp.response, dict):
                                status = func_resp.response.get("status")
                                if status in ["approved", "denied"]:
                                    final_result_received = True
                                    logger.info(f"[TEST] ✅ Final result received: {status}")

                # Check for turn_complete
                if hasattr(event, "turn_complete") and event.turn_complete:
                    logger.info("[TEST] ✓ turn_complete received")
                    break

        # Run event loop with timeout
        try:
            await asyncio.wait_for(event_loop(), timeout=15.0)
        except TimeoutError:
            logger.error("[TEST] ❌ TIMEOUT - Event loop did not complete")
            logger.error("[TEST] This likely means deadlock occurred (like Phase 2)")

        # Wait for approval task to complete
        if approval_task:
            await approval_task

        # ========== Assertions ==========

        logger.info("=" * 80)
        logger.info("[TEST] EXPERIMENT RESULTS:")
        logger.info(f"  - Tool call ID captured: {tool_call_id is not None}")
        logger.info(f"  - Final result received: {final_result_received}")
        logger.info(f"  - Total events: {len(all_events)}")
        logger.info("=" * 80)

        assert tool_call_id is not None, "Should receive FunctionCall"

        if final_result_received:
            logger.info("🎉 SUCCESS! BLOCKING mode works - tool awaited approval without deadlock")
            logger.info("✅ This means we can use BLOCKING mode for deferred approval in BIDI!")
        else:
            logger.warning("⚠️  BLOCKING mode test did not receive final result")
            logger.warning("This might be a timeout or the pattern doesn't work as expected")

        assert final_result_received, "Should receive final result from BLOCKING tool"

    finally:
        # Cleanup
        try:
            live_request_queue.close()
            logger.info("[TEST] ✓ Closed LiveRequestQueue")
        except Exception as e:
            logger.warning(f"[TEST] Failed to close LiveRequestQueue: {e}")


@pytest.mark.asyncio
async def test_blocking_mode_denied():
    """
    EXPERIMENT: Test if BLOCKING behavior handles denial correctly.

    Expected behavior:
    1. LLM calls test_approval_tool_blocking
    2. Tool function awaits approval (blocks tool execution)
    3. Event loop continues (WebSocket can receive denial message)
    4. Denial arrives → Future resolves
    5. Tool returns denial result
    6. LLM receives denial result and responds

    If successful: LLM should see "denied" status in a single FunctionResponse
    """
    logger.info("=" * 80)
    logger.info("[EXPERIMENT] BLOCKING Mode Denial Flow - Testing denial handling")
    logger.info("=" * 80)

    approval_queue = ApprovalQueue()
    live_request_queue = LiveRequestQueue()

    # Test variables
    user_id = "test-user-blocking-002"  # Different user to avoid session conflicts
    connection_signature = str(uuid.uuid4())
    tool_call_id = None
    final_result_received = False
    denial_confirmed = False
    all_events = []

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
            agent_runner=test_runner_blocking,
            app_name="test_blocking_app",
            connection_signature=connection_signature,
        )
        session_id = session.id
        logger.info(f"[TEST] ✓ Created ADK session: {session_id}")

        # Store approval_queue in session state
        session.state["approval_queue"] = approval_queue
        logger.info("[TEST] ✓ Stored approval_queue in session.state")

        # Start run_live()
        live_events = test_runner_blocking.run_live(
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
            parts=[types.Part.from_text(text="Please process task 'blocking-test-deny'")],
        )
        live_request_queue.send_content(user_message_content)
        logger.info("[TEST] ✓ Sent user message via LiveRequestQueue")

        # ========== Event Loop with Denial Simulation ==========

        async def deny_after_delay():
            """Simulate user denial after 2 seconds"""
            await asyncio.sleep(2.0)
            logger.info("[TEST] ⏰ Simulating user DENIAL...")
            approval_queue.submit_approval(tool_call_id, approved=False)
            logger.info("[TEST] ✓ DENIAL submitted")

        approval_task = None

        async def event_loop():
            nonlocal tool_call_id, final_result_received, denial_confirmed, approval_task

            event_count = 0
            async for event in live_events:
                event_count += 1
                all_events.append(event)
                logger.info(f"[TEST] Event {event_count}: {type(event).__name__}")

                # Detect FunctionCall
                if hasattr(event, "content") and event.content:
                    for part in event.content.parts:
                        if hasattr(part, "function_call") and part.function_call:
                            tool_call_id = part.function_call.id
                            logger.info(
                                f"[TEST] ✓ FunctionCall: {part.function_call.name} (id={tool_call_id})"
                            )
                            # Start denial simulation
                            approval_task = asyncio.create_task(deny_after_delay())

                        # Detect FunctionResponse
                        if hasattr(part, "function_response") and part.function_response:
                            func_resp = part.function_response
                            logger.info("=" * 80)
                            logger.info(f"[TEST] FunctionResponse received (id={func_resp.id})")
                            logger.info(f"[TEST] Response data: {func_resp.response}")
                            logger.info("=" * 80)

                            # Check if this is the final result
                            if isinstance(func_resp.response, dict):
                                status = func_resp.response.get("status")
                                if status in ["approved", "denied"]:
                                    final_result_received = True
                                    logger.info(f"[TEST] ✅ Final result received: {status}")
                                    if status == "denied":
                                        denial_confirmed = True
                                        logger.info("[TEST] ✅ Denial confirmed!")

                # Check for turn_complete
                if hasattr(event, "turn_complete") and event.turn_complete:
                    logger.info("[TEST] ✓ turn_complete received")
                    break

        # Run event loop with timeout
        try:
            await asyncio.wait_for(event_loop(), timeout=15.0)
        except TimeoutError:
            logger.error("[TEST] ❌ TIMEOUT - Event loop did not complete")
            logger.error("[TEST] This likely means deadlock occurred")

        # Wait for denial task to complete
        if approval_task:
            await approval_task

        # ========== Assertions ==========

        logger.info("=" * 80)
        logger.info("[TEST] EXPERIMENT RESULTS:")
        logger.info(f"  - Tool call ID captured: {tool_call_id is not None}")
        logger.info(f"  - Final result received: {final_result_received}")
        logger.info(f"  - Denial confirmed: {denial_confirmed}")
        logger.info(f"  - Total events: {len(all_events)}")
        logger.info("=" * 80)

        assert tool_call_id is not None, "Should receive FunctionCall"
        assert final_result_received, "Should receive final result from BLOCKING tool"
        assert denial_confirmed, "Should receive 'denied' status in FunctionResponse"

        logger.info("🎉 SUCCESS! BLOCKING mode handles denial correctly")
        logger.info("✅ Both approval and denial flows work in BLOCKING mode!")

    finally:
        # Cleanup
        try:
            live_request_queue.close()
            logger.info("[TEST] ✓ Closed LiveRequestQueue")
        except Exception as e:
            logger.warning(f"[TEST] Failed to close LiveRequestQueue: {e}")
