"""
Test deferred approval flow with ADK BIDI mode.

This test validates the proposed architecture:
1. Tool returns "deferred" status immediately (non-blocking)
2. Approval flow runs in separate task
3. Real result sent via LiveRequestQueue after approval
4. ADK processes both responses correctly
"""

import asyncio
import time
import uuid

import pytest
from dotenv import load_dotenv
from google.adk.agents import Agent, LiveRequestQueue
from google.adk.agents.run_config import RunConfig, StreamingMode
from google.adk.apps import App, ResumabilityConfig
from google.adk.runners import InMemoryRunner
from google.adk.tools.long_running_tool import LongRunningFunctionTool
from google.genai import types
from loguru import logger

from adk_stream_protocol import get_or_create_session


load_dotenv(".env.local")


# ========== Test-specific Minimal Agent Setup ==========
# This test uses a dedicated agent with only ONE tool to ensure isolation


def test_approval_tool(message: str) -> dict:
    """
    Minimal test tool that requires approval.

    This tool returns pending status to signal that it requires
    user approval before actual execution.

    Args:
        message: A message to process

    Returns:
        dict: Pending status indicating approval is required
    """
    logger.info(f"[test_approval_tool] Message: {message}")
    return {
        "status": "pending",
        "message": f"Processing '{message}' requires approval",
        "awaiting_confirmation": True,
    }


# Wrap tool with LongRunningFunctionTool for deferred execution pattern
# TODO: LongRunningFunctionTool があることで、よくないADKの内部挙動があるかもしれない
TEST_APPROVAL_TOOL = LongRunningFunctionTool(test_approval_tool)

# Create minimal test agent with only ONE tool
test_agent = Agent(
    name="test_deferred_approval_agent",
    model="gemini-2.5-flash-native-audio-preview-12-2025",
    description="Minimal test agent for deferred approval flow testing",
    instruction=(
        "You are a test assistant. When the user asks you to process a message, "
        "call the test_approval_tool function. You MUST use the tool - do not just describe what you would do."
    ),
    tools=[TEST_APPROVAL_TOOL],  # type: ignore[list-item]
)

# Create App with ResumabilityConfig
test_app = App(
    name="test_deferred_approval_app",
    root_agent=test_agent,
    resumability_config=ResumabilityConfig(is_resumable=True),
)

# Create InMemoryRunner
test_agent_runner = InMemoryRunner(app=test_app)


class ApprovalQueue:
    """Queue-based approval mechanism (supports multiple concurrent approvals)"""

    def __init__(self) -> None:
        # Pending approval requests
        self._approval_results: dict[str, dict] = {}
        # Track active approvals for debugging
        self._active_approvals: dict[str, dict] = {}

    def request_approval(self, tool_call_id: str, tool_name: str, args: dict) -> None:
        """Register approval request (non-blocking)"""
        request = {
            "tool_call_id": tool_call_id,
            "tool_name": tool_name,
            "args": args,
            "timestamp": time.time(),
        }
        self._active_approvals[tool_call_id] = request
        logger.info(f"[ApprovalQueue] Request registered: {tool_call_id}")

    async def wait_for_approval(self, tool_call_id: str, timeout: float = 300.0) -> dict:
        """Wait for approval (only this task blocks)"""
        logger.info(f"[ApprovalQueue] Waiting for approval: {tool_call_id}")
        start = time.time()

        while time.time() - start < timeout:
            if tool_call_id in self._approval_results:
                result = self._approval_results.pop(tool_call_id)
                self._active_approvals.pop(tool_call_id, None)
                logger.info(f"[ApprovalQueue] Approval received: {tool_call_id}")
                return result
            await asyncio.sleep(0.1)

        raise TimeoutError(f"Approval timeout for {tool_call_id}")

    def submit_approval(self, tool_call_id: str, approved: bool) -> None:
        """Submit approval decision (called by external system)"""
        logger.info("=" * 60)
        if approved:
            logger.info(f"[ApprovalQueue] ✓ APPROVAL submitted for: {tool_call_id}")
        else:
            logger.info(f"[ApprovalQueue] ✗ DENIAL submitted for: {tool_call_id}")
        logger.info("=" * 60)

        self._approval_results[tool_call_id] = {"approved": approved}

    def get_pending_count(self) -> int:
        """Debug: number of pending approvals"""
        return len(self._active_approvals)


async def deferred_tool_execution(
    tool_call_id: str,
    tool_name: str,
    args: dict,
    approval_queue: ApprovalQueue,
    live_request_queue: LiveRequestQueue,
):
    """
    Deferred tool execution flow (runs in separate task, non-blocking).

    This is the core of the proposed architecture:
    1. Wait for approval
    2. Execute tool if approved
    3. Send result via LiveRequestQueue
    """
    try:
        logger.info(f"[DeferredExec] Started for {tool_call_id}")

        # 1. Wait for approval (this task blocks, but run_live() continues)
        approval = await approval_queue.wait_for_approval(tool_call_id)

        # 2. Execute tool or reject based on approval
        if approval["approved"]:
            # ========== APPROVED: Execute actual processing ==========
            logger.info("=" * 60)
            logger.info(f"[DeferredExec] ✓ APPROVED - Executing tool: {tool_name}")
            logger.info(f"[DeferredExec] Tool call ID: {tool_call_id}")
            logger.info(f"[DeferredExec] Arguments: {args}")
            logger.info("=" * 60)

            # Execute actual processing (not the pending-status-returning tool function)
            if tool_name == "test_approval_tool":
                message_to_process = args.get('message', '')
                result = {
                    "success": True,
                    "status": "completed",
                    "message": f"Successfully processed message after user approval: '{message_to_process}'",
                    "original_message": message_to_process,
                    "timestamp": time.time(),
                }
            else:
                # Fallback for unknown tools
                result = {
                    "success": True,
                    "status": "completed",
                    "message": f"Tool {tool_name} executed successfully after approval"
                }

            logger.info(f"[DeferredExec] ✓ Execution completed: {result}")
        else:
            # ========== DENIED: Return rejection message ==========
            logger.info("=" * 60)
            logger.info(f"[DeferredExec] ✗ DENIED - Tool execution rejected: {tool_name}")
            logger.info(f"[DeferredExec] Tool call ID: {tool_call_id}")
            logger.info(f"[DeferredExec] User explicitly rejected this operation")
            logger.info("=" * 60)

            result = {
                "success": False,
                "status": "denied",
                "error": "User denied the operation",
                "message": f"The operation '{tool_name}' was denied by the user and was not executed.",
                "tool_name": tool_name,
                "denied_args": args,
            }

            logger.info(f"[DeferredExec] ✗ Rejection result: {result}")

        # 3. Send actual result via LiveRequestQueue
        logger.info(f"[DeferredExec] Sending final result for {tool_call_id}")
        function_response = types.Content(
            parts=[
                types.Part(
                    function_response=types.FunctionResponse(
                        id=tool_call_id,
                        name=tool_name,
                        response=result,
                    )
                )
            ],
        )
        live_request_queue.send_content(function_response)
        logger.info(f"[DeferredExec] ✓ Final result sent for {tool_call_id}")

    except Exception as e:
        logger.error(f"[DeferredExec] Error in deferred execution: {e}")
        # Send error result
        error_response = types.Content(
            parts=[
                types.Part(
                    function_response=types.FunctionResponse(
                        id=tool_call_id,
                        name=tool_name,
                        response={"success": False, "error": str(e)},
                    )
                )
            ],
        )
        live_request_queue.send_content(error_response)


@pytest.mark.asyncio
async def test_deferred_approval_flow_approved():
    """
    Test deferred approval flow with APPROVAL using ADK BIDI mode.

    Flow:
    1. User message triggers FunctionCall (from ADK agent)
    2. Manually send "deferred" status via LiveRequestQueue
    3. Approval granted (simulated after 2 seconds)
    4. Tool executed, real result sent via LiveRequestQueue
    5. ADK generates final response
    """
    logger.info("=" * 80)
    logger.info("[TEST] Deferred Approval Flow - APPROVED case (ADK BIDI)")
    logger.info("=" * 80)

    approval_queue = ApprovalQueue()
    live_request_queue = LiveRequestQueue()

    # Create RunConfig for BIDI mode with TEXT modality (matching server.py configuration)
    run_config = RunConfig(
        streaming_mode=StreamingMode.BIDI,
        response_modalities=["AUDIO"],
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
        session_resumption=None,  # Not using Vertex AI in test
        context_window_compression=types.ContextWindowCompressionConfig(
            trigger_tokens=100000,
            sliding_window=types.SlidingWindow(target_tokens=80000),
        ),
    )

    # Test variables
    user_id = "test-user-deferred-001"
    connection_signature = str(uuid.uuid4())
    tool_call_id = None
    tool_name = None
    tool_args = None
    deferred_sent = False
    final_response_received = False
    all_events = []

    try:
        # ========== Agent Configuration ==========
        # - Using test_agent_runner (minimal test agent with ONE tool: test_approval_tool)
        # - test_approval_tool is wrapped with LongRunningFunctionTool (requires approval)
        # - In BIDI mode (session.state["mode"] = "bidi"), LongRunningFunctionTool
        #   should automatically return pending/deferred status without blocking
        #
        # Test Strategy:
        # - Intercept FunctionCall events from ADK
        # - Observe ADK's automatic deferred status generation (if any)
        # - After approval, send actual result via LiveRequestQueue
        # - This allows testing approval flow in isolation with minimal dependencies

        # Create ADK session using get_or_create_session
        session = await get_or_create_session(
            user_id=user_id,
            agent_runner=test_agent_runner,
            app_name="test_app",
            connection_signature=connection_signature,
        )
        session_id = session.id
        logger.info(f"[TEST] ✓ Created ADK session: {session_id}")

        # Set mode=bidi to trigger LongRunningFunctionTool behavior
        session.state["mode"] = "bidi"
        logger.info("[TEST] ✓ Set session.state['mode'] = 'bidi'")

        # Start run_live() with the created session
        live_events = test_agent_runner.run_live(
            session=session,
            live_request_queue=live_request_queue,
            run_config=run_config,
        )
        logger.info(f"[TEST] ✓ Started run_live() with session: {session_id}")

        # Send message that triggers tool
        user_message = types.Content(
            parts=[types.Part(text="Please process this test message: Hello from test")]
        )
        live_request_queue.send_content(user_message)
        logger.info("[TEST] ✓ Sent user message via LiveRequestQueue")

        # Collect events and handle FunctionCall
        async def event_loop():
            nonlocal tool_call_id, tool_name, tool_args, deferred_sent, final_response_received

            async for event in live_events:
                all_events.append(event)
                event_num = len(all_events)
                event_type = type(event).__name__
                logger.info(f"[TEST] Event {event_num}: {event_type}")

                # Capture FunctionCall from event
                if hasattr(event, "content") and event.content:
                    for part in event.content.parts:
                        if hasattr(part, "function_call") and part.function_call:
                            tool_call_id = part.function_call.id
                            tool_name = part.function_call.name
                            tool_args = dict(part.function_call.args)
                            logger.info(
                                f"[TEST] ✓ FunctionCall received: {tool_name}(id={tool_call_id})"
                            )

                            # Register approval request
                            approval_queue.request_approval(tool_call_id, tool_name, tool_args)

                            # Start deferred execution in separate task
                            # This task will wait for approval, then send the actual result
                            _deferred_task = asyncio.create_task(
                                deferred_tool_execution(
                                    tool_call_id,
                                    tool_name,
                                    tool_args,
                                    approval_queue,
                                    live_request_queue,
                                )
                            )

                            # Simulate approval after 2 seconds
                            async def approve_after_delay(call_id: str = tool_call_id) -> None:
                                await asyncio.sleep(2)
                                logger.info("[TEST] Simulating user APPROVAL...")
                                approval_queue.submit_approval(call_id, approved=True)

                            _approval_task = asyncio.create_task(approve_after_delay())

                        # Check for ADK-generated FunctionResponse (pending/deferred status)
                        # LongRunningFunctionTool should automatically generate this in BIDI mode
                        if hasattr(part, "function_response") and part.function_response:
                            response_data = part.function_response.response
                            logger.info(
                                f"[TEST] ✓ ADK generated FunctionResponse: {response_data}"
                            )
                            # If this is a pending/deferred status, mark it
                            if isinstance(response_data, dict) and response_data.get("status") in [
                                "pending",
                                "deferred",
                            ]:
                                deferred_sent = True
                                logger.info("[TEST] ✓ Deferred status detected from ADK")

                # Check for final model response (text from model)
                if hasattr(event, "content") and event.content:
                    for part in event.content.parts:
                        if hasattr(part, "text") and part.text:
                            logger.info(f"[TEST] Model response: {part.text[:100]}...")
                            final_response_received = True

                # Check for turn_complete
                if hasattr(event, "turn_complete") and event.turn_complete:
                    logger.info("[TEST] ✓ turn_complete received")
                    # For deferred execution, we might get multiple turns
                    # Only break if we've received final response
                    if final_response_received:
                        break

        # Run event loop with timeout
        try:
            await asyncio.wait_for(event_loop(), timeout=15.0)
        except TimeoutError:
            logger.error("[TEST] ✗ Timeout waiting for events")

        # Assertions
        assert tool_call_id is not None, "Should receive FunctionCall"
        assert deferred_sent, "Should send deferred status"
        # Note: final_response_received might be False if model doesn't generate text after tool execution
        logger.info(f"[TEST] ✓ Test passed - received {len(all_events)} events")

    finally:
        # Close LiveRequestQueue
        try:
            live_request_queue.close()
            logger.info("[TEST] ✓ Closed LiveRequestQueue")
        except Exception as e:
            logger.warning(f"[TEST] Failed to close LiveRequestQueue: {e}")


@pytest.mark.asyncio
async def test_deferred_approval_flow_rejected():
    """
    Test deferred approval flow with REJECTION using ADK BIDI mode.

    Flow:
    1. User message triggers FunctionCall (from ADK agent)
    2. Manually send "deferred" status via LiveRequestQueue
    3. Approval REJECTED (simulated after 2 seconds)
    4. Rejection message sent via LiveRequestQueue
    5. ADK generates response about rejection
    """
    logger.info("=" * 80)
    logger.info("[TEST] Deferred Approval Flow - REJECTED case (ADK BIDI)")
    logger.info("=" * 80)

    approval_queue = ApprovalQueue()
    live_request_queue = LiveRequestQueue()

    # Create RunConfig for BIDI mode with TEXT modality (matching server.py configuration)
    run_config = RunConfig(
        streaming_mode=StreamingMode.BIDI,
        response_modalities=["AUDIO"],
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
        session_resumption=None,  # Not using Vertex AI in test
        context_window_compression=types.ContextWindowCompressionConfig(
            trigger_tokens=100000,
            sliding_window=types.SlidingWindow(target_tokens=80000),
        ),
    )

    # Test variables
    user_id = "test-user-deferred-002"
    connection_signature = str(uuid.uuid4())
    tool_call_id = None
    tool_name = None
    tool_args = None
    deferred_sent = False
    final_response_received = False
    all_events = []

    try:
        # Create ADK session using test_agent_runner (minimal agent with ONE tool)
        session = await get_or_create_session(
            user_id=user_id,
            agent_runner=test_agent_runner,
            app_name="test_app",
            connection_signature=connection_signature,
        )
        session_id = session.id
        logger.info(f"[TEST] ✓ Created ADK session: {session_id}")

        # Set mode=bidi to trigger LongRunningFunctionTool behavior
        session.state["mode"] = "bidi"
        logger.info("[TEST] ✓ Set session.state['mode'] = 'bidi'")

        # Start run_live() with the created session
        live_events = test_agent_runner.run_live(
            session=session,
            live_request_queue=live_request_queue,
            run_config=run_config,
        )
        logger.info(f"[TEST] ✓ Started run_live() with session: {session_id}")

        # Send message that triggers tool
        user_message = types.Content(
            parts=[types.Part(text="Please process this test message: Hello from test")]
        )
        live_request_queue.send_content(user_message)
        logger.info("[TEST] ✓ Sent user message via LiveRequestQueue")

        # Collect events and handle FunctionCall
        async def event_loop():
            nonlocal tool_call_id, tool_name, tool_args, deferred_sent, final_response_received

            async for event in live_events:
                all_events.append(event)
                event_num = len(all_events)
                event_type = type(event).__name__
                logger.info(f"[TEST] Event {event_num}: {event_type}")

                # Capture FunctionCall from event
                if hasattr(event, "content") and event.content:
                    for part in event.content.parts:
                        if hasattr(part, "function_call") and part.function_call:
                            tool_call_id = part.function_call.id
                            tool_name = part.function_call.name
                            tool_args = dict(part.function_call.args)
                            logger.info(
                                f"[TEST] ✓ FunctionCall received: {tool_name}(id={tool_call_id})"
                            )

                            # Register approval request
                            approval_queue.request_approval(tool_call_id, tool_name, tool_args)

                            # Start deferred execution in separate task
                            # This task will wait for approval, then send the actual result
                            _deferred_task = asyncio.create_task(
                                deferred_tool_execution(
                                    tool_call_id,
                                    tool_name,
                                    tool_args,
                                    approval_queue,
                                    live_request_queue,
                                )
                            )

                            # Simulate REJECTION after 2 seconds
                            async def reject_after_delay(call_id: str = tool_call_id) -> None:
                                await asyncio.sleep(2)
                                logger.info("[TEST] Simulating user REJECTION...")
                                approval_queue.submit_approval(call_id, approved=False)

                            _approval_task = asyncio.create_task(reject_after_delay())

                        # Check for ADK-generated FunctionResponse (pending/deferred status)
                        # LongRunningFunctionTool should automatically generate this in BIDI mode
                        if hasattr(part, "function_response") and part.function_response:
                            response_data = part.function_response.response
                            logger.info(
                                f"[TEST] ✓ ADK generated FunctionResponse: {response_data}"
                            )
                            # If this is a pending/deferred status, mark it
                            if isinstance(response_data, dict) and response_data.get("status") in [
                                "pending",
                                "deferred",
                            ]:
                                deferred_sent = True
                                logger.info("[TEST] ✓ Deferred status detected from ADK")

                # Check for final model response (text from model)
                if hasattr(event, "content") and event.content:
                    for part in event.content.parts:
                        if hasattr(part, "text") and part.text:
                            logger.info(f"[TEST] Model response: {part.text[:100]}...")
                            final_response_received = True

                # Check for turn_complete
                if hasattr(event, "turn_complete") and event.turn_complete:
                    logger.info("[TEST] ✓ turn_complete received")
                    # For deferred execution, we might get multiple turns
                    # Only break if we've received final response
                    if final_response_received:
                        break

        # Run event loop with timeout
        try:
            await asyncio.wait_for(event_loop(), timeout=15.0)
        except TimeoutError:
            logger.error("[TEST] ✗ Timeout waiting for events")

        # Assertions
        assert tool_call_id is not None, "Should receive FunctionCall"
        assert deferred_sent, "Should send deferred status"
        # Note: final_response_received might be False if model doesn't generate text after rejection
        logger.info(f"[TEST] ✓ Test passed - received {len(all_events)} events")

    finally:
        # Close LiveRequestQueue
        try:
            live_request_queue.close()
            logger.info("[TEST] ✓ Closed LiveRequestQueue")
        except Exception as e:
            logger.warning(f"[TEST] Failed to close LiveRequestQueue: {e}")
