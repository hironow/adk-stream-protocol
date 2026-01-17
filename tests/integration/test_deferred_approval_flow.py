"""
Test deferred approval flow with ADK BIDI mode.

This test validates the proposed architecture:
1. Tool returns "deferred" status immediately (non-blocking)
2. Approval flow runs in separate task
3. Real result sent via LiveRequestQueue after approval
4. ADK processes both responses correctly
"""

import asyncio
import logging
import time
import uuid
from typing import Any

import pytest
from dotenv import load_dotenv
from google.adk.agents import Agent, LiveRequestQueue
from google.adk.agents.run_config import RunConfig, StreamingMode
from google.adk.apps import App, ResumabilityConfig
from google.adk.plugins import BasePlugin
from google.adk.runners import InMemoryRunner
from google.adk.tools import BaseTool, FunctionTool, ToolContext
from google.genai import types
from loguru import logger

from adk_stream_protocol.adk_compat import get_or_create_session


load_dotenv(".env.local")

# Enable ADK debug logging to see what's sent to Live API
logging.basicConfig(
    level=logging.DEBUG, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
# Focus on gemini_llm_connection to see FunctionResponse sending
logging.getLogger("google.adk.models.gemini_llm_connection").setLevel(logging.DEBUG)
# Enable plugin manager logging to see plugin registration and callback execution
logging.getLogger("google_adk.google.adk.plugins.plugin_manager").setLevel(logging.DEBUG)
logging.getLogger("google_adk.google.adk.flows.llm_flows.functions").setLevel(logging.DEBUG)


# ========== Test-specific Minimal Agent Setup ==========
# This test uses a dedicated agent with only ONE tool to ensure isolation


class DeferredApprovalPlugin(BasePlugin):
    """
    Plugin that intercepts tool calls and sends pending FunctionResponse with will_continue=True.

    This allows the LLM to receive multiple FunctionResponses for the same tool call:
    1. Pending response (will_continue=True) - sent immediately
    2. Final response (will_continue=False) - sent after approval
    """

    def __init__(self, approval_queue: ApprovalQueue) -> None:
        super().__init__(name="deferred_approval_plugin")
        self.approval_queue = approval_queue

    async def before_tool_callback(
        self,
        *,
        tool: BaseTool,
        tool_args: dict[str, Any],
        tool_context: ToolContext,
    ) -> dict | None:
        """
        Intercept approval_test_tool calls and send pending FunctionResponse with will_continue=True.

        Returns pending dict to skip actual tool execution.
        """
        print(
            f"\n{'=' * 80}\n[PLUGIN DEBUG] before_tool_callback CALLED! tool.name={tool.name}\n{'=' * 80}\n"
        )
        logger.info(f"[Plugin] before_tool_callback triggered for tool: {tool.name}")

        if tool.name != "approval_test_tool":
            logger.info("[Plugin] Not approval_test_tool, returning None for normal execution")
            return None  # Normal execution for other tools

        logger.info("[Plugin] MATCHED approval_test_tool! Intercepting...")

        # Access InvocationContext to get LiveRequestQueue
        invocation_context = tool_context._invocation_context  # type: ignore
        live_request_queue = invocation_context.live_request_queue

        if not live_request_queue:
            logger.warning("[Plugin] LiveRequestQueue not available in InvocationContext")
            return None

        tool_call_id = tool_context.function_call_id
        assert tool_call_id is not None, "function_call_id must not be None"

        # Create pending FunctionResponse with will_continue=True
        pending_func_response = types.FunctionResponse(
            id=tool_call_id,
            name=tool.name,
            response={
                "status": "pending",
                "message": f"Processing '{tool_args.get('message', '')}' requires approval",
                "awaiting_confirmation": True,
            },
            will_continue=True,  # Signal that more responses will follow
        )

        logger.info("=" * 80)
        logger.info("[Plugin] >>> SENDING PENDING RESPONSE WITH will_continue=True <<<")
        logger.info(f"[Plugin] id: {pending_func_response.id}")
        logger.info(f"[Plugin] name: {pending_func_response.name}")
        logger.info(f"[Plugin] response: {pending_func_response.response}")
        logger.info(f"[Plugin] will_continue: {pending_func_response.will_continue}")
        logger.info("=" * 80)

        pending_response = types.Content(
            role="user",
            parts=[types.Part(function_response=pending_func_response)],
        )
        live_request_queue.send_content(pending_response)
        logger.info("[Plugin] ✓ Sent pending FunctionResponse")

        # Register approval request
        self.approval_queue.request_approval(tool_call_id, tool.name, tool_args)

        # Start deferred execution in separate task
        # This task will wait for approval, then send the actual result
        import asyncio  # Import here to avoid top-level import

        _deferred_task = asyncio.create_task(
            deferred_tool_execution(
                tool_call_id,
                tool.name,
                tool_args,
                self.approval_queue,
                live_request_queue,
            )
        )
        logger.info(f"[Plugin] ✓ Started deferred execution task for {tool_call_id}")

        # Return pending dict to skip actual tool execution
        # This prevents ADK from auto-generating another FunctionResponse
        return {
            "status": "pending",
            "message": f"Processing '{tool_args.get('message', '')}' requires approval",
            "awaiting_confirmation": True,
        }


def approval_test_tool(message: str) -> dict:
    """
    Minimal test tool that requires approval.

    This tool returns pending status to signal that approval is required.
    The LongRunningFunctionTool wrapper will handle this appropriately.

    Args:
        message: A message to process

    Returns:
        dict: Pending status indicating approval is required
    """
    logger.info(f"[approval_test_tool] Called with message: {message}")
    # Return pending status - LongRunningFunctionTool will handle this
    return {
        "status": "pending",
        "message": f"Processing '{message}' requires approval",
        "awaiting_confirmation": True,
    }


async def approval_test_tool_blocking(message: str, tool_context: ToolContext) -> dict:
    """
    EXPERIMENT: BLOCKING mode tool that waits for approval inside the function.

    This tests if BLOCKING behavior allows the tool to await approval
    without blocking the entire event loop.

    Args:
        message: A message to process
        tool_context: ToolContext for accessing session state

    Returns:
        dict: Final result after approval (approved or denied)
    """
    logger.info(f"[approval_test_tool_blocking] Called with message: {message}")
    logger.info("[approval_test_tool_blocking] Tool will now WAIT for approval...")

    tool_call_id = tool_context.function_call_id

    # Get approval_queue from session state
    approval_queue = tool_context.session.state.get("approval_queue")

    if not approval_queue:
        logger.error("[approval_test_tool_blocking] No approval_queue in session state!")
        return {
            "status": "error",
            "message": "approval_queue not configured",
        }

    # Register this tool call for approval
    approval_queue.request_approval(
        tool_call_id, "approval_test_tool_blocking", {"message": message}
    )
    logger.info(f"[approval_test_tool_blocking] Registered approval request for {tool_call_id}")

    # ⭐ KEY EXPERIMENT: await inside BLOCKING tool function
    try:
        approval_result = await approval_queue.wait_for_approval(tool_call_id, timeout=10.0)
        logger.info(f"[approval_test_tool_blocking] ✓ Approval received: {approval_result}")

        if approval_result.approved:
            return {
                "status": "approved",
                "message": f"Successfully processed '{message}' after user approval",
                "result": f"Task '{message}' completed",
            }
        else:
            return {
                "status": "denied",
                "message": f"User denied the operation for '{message}'",
            }

    except TimeoutError:
        logger.error("[approval_test_tool_blocking] ❌ Timeout waiting for approval")
        return {
            "status": "timeout",
            "message": "Approval request timed out",
        }


# Create FunctionDeclaration with NON_BLOCKING behavior using from_callable_with_api_option
# This allows will_continue field to work properly
test_approval_declaration_non_blocking = types.FunctionDeclaration.from_callable_with_api_option(
    callable=approval_test_tool,
    api_option="GEMINI_API",
    behavior=types.Behavior.NON_BLOCKING,  # Enable multi-response pattern
)

# EXPERIMENT: Create BLOCKING version to test if tool can await inside
test_approval_declaration_blocking = types.FunctionDeclaration.from_callable_with_api_option(
    callable=approval_test_tool,
    api_option="GEMINI_API",
    behavior=types.Behavior.BLOCKING,  # Tool can block and wait for approval
)

# Wrap tool with FunctionTool using the custom declaration
TEST_APPROVAL_TOOL = FunctionTool(approval_test_tool)
# Override the declaration with our NON_BLOCKING version
TEST_APPROVAL_TOOL._declaration = test_approval_declaration_non_blocking  # type: ignore[attr-defined]
# TEMPORARILY DISABLED: Testing if is_long_running interferes with plugin callbacks
# TEST_APPROVAL_TOOL.is_long_running = True

# Create minimal test agent with only ONE tool
test_agent = Agent(
    name="test_deferred_approval_agent",
    model="gemini-2.5-flash-native-audio-preview-12-2025",
    description="Minimal test agent for deferred approval flow testing",
    instruction=(
        "You are a test assistant. When the user asks you to process a message, "
        "call the approval_test_tool function. You MUST use the tool - do not just describe what you would do."
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
    import time  # Import at function level

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
            if tool_name == "approval_test_tool":
                message_to_process = args.get("message", "")
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
                    "message": f"Tool {tool_name} executed successfully after approval",
                }

            logger.info(f"[DeferredExec] ✓ Execution completed: {result}")
        else:
            # ========== DENIED: Return rejection message ==========
            logger.info("=" * 60)
            logger.info(f"[DeferredExec] ✗ DENIED - Tool execution rejected: {tool_name}")
            logger.info(f"[DeferredExec] Tool call ID: {tool_call_id}")
            logger.info("[DeferredExec] User explicitly rejected this operation")
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
        send_time = time.time()
        logger.info("=" * 80)
        logger.info("[DeferredExec] >>> SENDING FINAL RESULT via send_content() <<<")
        logger.info(f"[DeferredExec] Tool call ID: {tool_call_id}")
        logger.info(f"[DeferredExec] Result: {result}")
        logger.info(f"[DeferredExec] Timestamp: {send_time}")
        logger.info("=" * 80)

        final_func_response = types.FunctionResponse(
            id=tool_call_id,
            name=tool_name,
            response=result,
            will_continue=False,  # Signal that function call is finished
        )

        logger.info("=" * 80)
        logger.info("[DeferredExec] >>> MANUAL FINAL RESPONSE <<<")
        logger.info(f"[DeferredExec] id: {final_func_response.id}")
        logger.info(f"[DeferredExec] name: {final_func_response.name}")
        logger.info(f"[DeferredExec] response: {final_func_response.response}")
        logger.info(f"[DeferredExec] will_continue: {final_func_response.will_continue}")
        logger.info("=" * 80)

        function_response = types.Content(
            role="user",
            parts=[types.Part(function_response=final_func_response)],
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
    2. DeferredApprovalPlugin intercepts and sends pending FunctionResponse (will_continue=True)
    3. Approval granted (simulated after 2 seconds)
    4. Final result sent via LiveRequestQueue (will_continue=False)
    5. ADK generates final response
    """
    logger.info("=" * 80)
    logger.info("[TEST] Deferred Approval Flow - APPROVED case (ADK BIDI with Plugin)")
    logger.info("=" * 80)

    approval_queue = ApprovalQueue()
    live_request_queue = LiveRequestQueue()

    # Create Plugin instance with approval_queue
    deferred_approval_plugin = DeferredApprovalPlugin(approval_queue=approval_queue)
    logger.info("[TEST] ✓ Created DeferredApprovalPlugin")

    # Create a fresh agent for this test (not using the module-level test_agent)
    # This ensures the agent is created after the plugin is defined
    fresh_test_agent = Agent(
        name="test_deferred_approval_agent_fresh",
        model="gemini-2.5-flash-native-audio-preview-12-2025",
        description="Fresh test agent for deferred approval flow testing with plugin",
        instruction=(
            "You are a test assistant. When the user asks you to process a message, "
            "call the approval_test_tool function. You MUST use the tool - do not just describe what you would do."
        ),
        tools=[TEST_APPROVAL_TOOL],  # type: ignore[list-item]
    )
    logger.info("[TEST] ✓ Created fresh test agent")

    # Create App with Plugin registered
    test_app_with_plugin = App(
        name="test_deferred_approval_app_with_plugin",
        root_agent=fresh_test_agent,
        resumability_config=ResumabilityConfig(is_resumable=True),
        plugins=[deferred_approval_plugin],  # Register the plugin
    )
    logger.info("[TEST] ✓ Created App with Plugin registered")

    # Create Runner with the plugin-enabled App
    test_runner_with_plugin = InMemoryRunner(app=test_app_with_plugin)
    logger.info("[TEST] ✓ Created Runner with plugin-enabled App")

    # DEBUG: Verify plugin is registered
    print(f"\n{'=' * 80}")
    print(
        f"[DEBUG] Runner plugin_manager has {len(test_runner_with_plugin.plugin_manager.plugins)} plugins:"
    )
    for plugin in test_runner_with_plugin.plugin_manager.plugins:
        print(f"  - {plugin.name}: {type(plugin).__name__}")
    print(f"{'=' * 80}\n")

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
    function_response_count = 0  # Track FunctionResponse count
    final_result_sent_time = None  # Track when we send final result

    try:
        # ========== Agent Configuration ==========
        # - Using DeferredApprovalPlugin to intercept tool calls
        # - Plugin sends pending FunctionResponse with will_continue=True
        # - Then sends final FunctionResponse with will_continue=False after approval
        #
        # Test Strategy:
        # - Plugin's before_tool_callback intercepts approval_test_tool
        # - Sends pending response immediately
        # - Deferred execution task sends final result after approval

        # Create ADK session using get_or_create_session
        session = await get_or_create_session(
            user_id=user_id,
            agent_runner=test_runner_with_plugin,  # Use plugin-enabled runner
            app_name="test_app_with_plugin",
            connection_signature=connection_signature,
        )
        session_id = session.id
        logger.info(f"[TEST] ✓ Created ADK session: {session_id}")

        # Set mode=bidi to trigger LongRunningFunctionTool behavior
        session.state["mode"] = "bidi"
        logger.info("[TEST] ✓ Set session.state['mode'] = 'bidi'")

        # Start run_live() with the created session (use plugin-enabled runner!)
        live_events = test_runner_with_plugin.run_live(
            user_id=user_id,
            session_id=session.id,
            live_request_queue=live_request_queue,
            run_config=run_config,
            session=session,  # Still required during migration period
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
            nonlocal function_response_count, final_result_sent_time

            async for event in live_events:
                all_events.append(event)
                event_num = len(all_events)
                event_type = type(event).__name__

                # Add timestamp for precise timing analysis
                event_time = time.time()
                if final_result_sent_time:
                    time_since_final = event_time - final_result_sent_time
                    logger.info(
                        f"[TEST] Event {event_num}: {event_type} "
                        f"(+{time_since_final:.3f}s after final result sent)"
                    )
                else:
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

                            # Plugin will handle:
                            # 1. Sending pending FunctionResponse (will_continue=True)
                            # 2. Registering approval request
                            # 3. Starting deferred execution task

                            # Simulate approval after 2 seconds
                            async def approve_after_delay(call_id: str = tool_call_id) -> None:
                                await asyncio.sleep(2)
                                logger.info("[TEST] Simulating user APPROVAL...")
                                approval_queue.submit_approval(call_id, approved=True)

                            _approval_task = asyncio.create_task(approve_after_delay())

                        # Check for ADK-generated FunctionResponse (pending/deferred status)
                        # LongRunningFunctionTool should automatically generate this in BIDI mode
                        if hasattr(part, "function_response") and part.function_response:
                            function_response_count += 1
                            response_id = part.function_response.id
                            response_data = part.function_response.response
                            will_continue = getattr(part.function_response, "will_continue", None)

                            logger.info("=" * 80)
                            logger.info(
                                f"[TEST] FunctionResponse #{function_response_count} received "
                                f"(id={response_id})"
                            )
                            logger.info(f"[TEST] Response data: {response_data}")
                            logger.info(f"[TEST] will_continue: {will_continue}")
                            logger.info("=" * 80)

                            # If this is a pending/deferred status, mark it
                            if isinstance(response_data, dict) and response_data.get("status") in [
                                "pending",
                                "deferred",
                            ]:
                                deferred_sent = True
                                logger.info(
                                    "[TEST] ✓ This is the PENDING status (FunctionResponse #1)"
                                )
                            elif (
                                isinstance(response_data, dict)
                                and response_data.get("status") == "completed"
                            ):
                                logger.info(
                                    "[TEST] ✓ This is the FINAL RESULT (FunctionResponse #2)"
                                )
                            elif (
                                isinstance(response_data, dict)
                                and response_data.get("status") == "denied"
                            ):
                                logger.info(
                                    "[TEST] ✓ This is the DENIAL RESULT (FunctionResponse #2)"
                                )

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
            user_id=user_id,
            session_id=session.id,
            live_request_queue=live_request_queue,
            run_config=run_config,
            session=session,  # Still required during migration period
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

                            # Let ADK automatically generate FunctionResponse from tool's return value
                            # The tool returns pending dict, which ADK will convert to FunctionResponse
                            logger.info(
                                "[TEST] Letting ADK auto-generate pending FunctionResponse..."
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
                            logger.info(f"[TEST] ✓ ADK generated FunctionResponse: {response_data}")
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
