"""
SSE Event Streamer Service (HTTP SSE Mode: ADK → SSE)

This module sends ADK events to the frontend via HTTP Server-Sent Events (SSE),
converting them to AI SDK v6 Data Stream Protocol format.

Responsibilities:
- Receive ADK events from run_live()
- Convert to AI SDK v6 Data Stream Protocol (SSE format)
- Yield events for FastAPI StreamingResponse
- Handle confirmation flow for tools requiring approval

Counterpart: BidiEventSender handles WebSocket (BIDI) mode.
"""

import inspect
from collections.abc import AsyncIterable
from types import SimpleNamespace
from typing import Any

from google.adk.runners import Runner
from google.adk.sessions import Session
from loguru import logger

from . import adk_ag_tools
from .adk_compat import extract_function_call_from_event, is_function_call_requiring_confirmation
from .confirmation_interceptor import ToolConfirmationInterceptor
from .frontend_tool_service import FrontendToolDelegate
from .result import Error, Ok, Result
from .stream_protocol import format_sse_event, stream_adk_to_ai_sdk
from .utils import _parse_sse_event_data


async def _execute_tool_function_sse(
    fc_name: str, fc_args: dict[str, Any], fc_id: str, session: Session
) -> Result[Any, str]:
    """
    Execute tool function and return result (SSE mode).

    Args:
        fc_name: Tool function name
        fc_args: Tool arguments
        fc_id: Function call ID (for tool context)
        session: ADK Session (for tool context)

    Returns:
        Ok(tool_result) if execution succeeds, Error(str) if execution fails
    """
    # Get tool function
    tool_func = getattr(adk_ag_tools, fc_name, None)
    if not tool_func:
        return Error(f"Tool function '{fc_name}' not found")

    # Create tool context
    tool_context = SimpleNamespace()
    tool_context.invocation_id = fc_id
    tool_context.session = session

    # Execute tool
    sig = inspect.signature(tool_func)
    if "tool_context" in sig.parameters:
        fc_args_with_context = {**fc_args, "tool_context": tool_context}
        if inspect.iscoroutinefunction(tool_func):
            tool_result = await tool_func(**fc_args_with_context)
        else:
            tool_result = tool_func(**fc_args_with_context)
    elif inspect.iscoroutinefunction(tool_func):
        tool_result = await tool_func(**fc_args)
    else:
        tool_result = tool_func(**fc_args)

    return Ok(tool_result)


async def _execute_confirmation_sse(
    interceptor: ToolConfirmationInterceptor,
    confirmation_id: str,
    fc_id: str,
    fc_name: str,
    fc_args: dict[str, Any],
) -> Result[dict[str, Any], str]:
    """
    Execute confirmation flow and wait for user decision (SSE mode).

    Args:
        interceptor: ToolConfirmationInterceptor instance
        confirmation_id: Confirmation UI tool call ID
        fc_id: Original function call ID
        fc_name: Tool name
        fc_args: Tool arguments

    Returns:
        Ok(confirmation_result) if execution succeeds, Error(str) if execution fails
    """
    # execute_confirmation now returns Result, so we just pass it through
    return await interceptor.execute_confirmation(
        tool_call_id=confirmation_id,
        original_function_call={
            "id": fc_id,
            "name": fc_name,
            "args": fc_args,
        },
    )


class SseEventStreamer:
    """
    Streams ADK events as SSE (HTTP Server-Sent Events).

    Handles the SSE mode of communication:
    - ADK generates events via run_live()
    - This class converts them to SSE format
    - Yields to FastAPI StreamingResponse

    Counterpart: BidiEventSender handles WebSocket (BIDI) mode.
    """

    def __init__(
        self,
        frontend_delegate: FrontendToolDelegate,
        confirmation_tools: list[str],
        session: Session,
        sse_agent_runner: Runner | None = None,
    ) -> None:
        """
        Initialize SSE event streamer.

        Args:
            frontend_delegate: Frontend tool delegate for ID mapping
            confirmation_tools: List of tool names requiring confirmation
            session: ADK Session for frontend_delegate access
            sse_agent_runner: Runner instance for accessing session_service
        """
        self._delegate = frontend_delegate
        self._confirmation_tools = confirmation_tools
        self._session = session
        self._ag_runner = sse_agent_runner
        # Track tool IDs currently in confirmation flow
        # Used to intercept and consume confirmation error FunctionResponses
        self._confirmation_in_progress: set[str] = set()

    async def stream_events(self, live_events: AsyncIterable[Any]) -> AsyncIterable[str]:
        """
        Stream ADK events as SSE-formatted messages.

        Args:
            live_events: AsyncIterable of ADK events from run_live()

        Yields:
            SSE-formatted strings like 'data: {"type":"text-delta","text":"..."}\\n\\n'
        """
        event_count = 0
        logger.info("[SSE] Starting to stream ADK events via SSE")

        # Wrap live_events with confirmation processing
        # This intercepts tool calls requiring confirmation and handles them inline
        async def events_with_confirmation():
            async for event in live_events:
                async for processed_event in self._handle_confirmation_if_needed(event):
                    yield processed_event

        async for sse_event in stream_adk_to_ai_sdk(
            events_with_confirmation(),
            mode="adk-sse",  # Chunk logger: distinguish from adk-bidi mode
        ):
            event_count += 1

            # Register function_call.id mapping for frontend delegate tools
            if sse_event.startswith("data:"):
                # Skip DONE event
                if "DONE" == sse_event.strip()[5:].strip():
                    yield sse_event
                    continue

                match _parse_sse_event_data(sse_event):
                    case Ok(event_data):
                        event_type = event_data.get("type")

                        if event_type == "tool-input-available":
                            tool_name = event_data.get("toolName")
                            tool_call_id = event_data.get("toolCallId")
                            if tool_name and tool_call_id and self._delegate:
                                self._delegate.set_function_call_id(tool_name, tool_call_id)
                                logger.debug(
                                    f"[SSE] Registered mapping: {tool_name} → {tool_call_id}"
                                )

            yield sse_event

        logger.info(f"[SSE] Streamed {event_count} events to client")
        # no except any other exceptions. Let them propagate to caller for handling.

    def _is_confirmation_error_response(self, event: Any) -> tuple[bool, str | None]:
        """
        Check if event is a confirmation error FunctionResponse from ADK.

        ADK generates error FunctionResponse when a tool requires confirmation:
        FunctionResponse(
            id="adk-xxx",
            name="process_payment",
            response={"error": "This tool call requires confirmation, please approve or reject."}
        )

        Args:
            event: ADK Event object

        Returns:
            (is_confirmation_error, tool_id)
        """
        if not hasattr(event, "content") or not hasattr(event.content, "parts"):
            return (False, None)

        for part in event.content.parts:
            if not hasattr(part, "function_response"):
                continue

            fr = part.function_response
            if not hasattr(fr, "response") or not isinstance(fr.response, dict):
                continue

            error_msg = fr.response.get("error", "")
            if "requires confirmation" in error_msg:
                tool_id = fr.id if hasattr(fr, "id") else None
                return (True, tool_id)

        return (False, None)

    async def _handle_confirmation_if_needed(self, event: Any):
        """
        Handle SSE confirmation flow for tools requiring user approval.

        This implements the same confirmation pattern as BIDI mode,
        but adapted for SSE's request-response model.

        Args:
            event: ADK event (Event object or dict)

        Yields:
            Processed events (original tool events, confirmation events, tool execution results)
        """
        # Check if this event requires confirmation
        if not is_function_call_requiring_confirmation(event, self._confirmation_tools):
            logger.debug("[SSE Confirmation] Event doesn't require confirmation - passing through")
            yield event
            return

        # Extract function_call details
        function_call = extract_function_call_from_event(event)
        if not function_call:
            logger.warning("[SSE Confirmation] Could not extract function_call from event")
            yield event
            return

        # Extract function call data
        if isinstance(function_call, dict):
            fc_id = function_call.get("id", "unknown")
            fc_name = function_call.get("name", "unknown")
            fc_args = function_call.get("args", {})
        else:
            fc_id = function_call.id if hasattr(function_call, "id") else "unknown"
            fc_name = function_call.name if hasattr(function_call, "name") else "unknown"
            fc_args = function_call.args if hasattr(function_call, "args") else {}

        logger.info("[SSE Confirmation] ========== START CONFIRMATION FLOW ==========")
        logger.info(f"[SSE Confirmation] Tool: {fc_name} (id={fc_id}, args={fc_args})")

        # Generate confirmation UI events as SSE format strings
        confirmation_id = f"confirmation-{fc_id}"

        # Create interceptor for this confirmation
        interceptor = ToolConfirmationInterceptor(
            delegate=self._delegate,
            confirmation_tools=self._confirmation_tools,
        )

        # Register confirmation ID in ID mapper
        interceptor._delegate._id_mapper.register("adk_request_confirmation", confirmation_id)

        # STEP 1: Send original tool-input events FIRST (so frontend knows about the original tool)
        # This fixes the bug where frontend only received confirmation events but not the original tool events
        yield format_sse_event(
            {
                "type": "tool-input-start",
                "toolCallId": fc_id,
                "toolName": fc_name,
            }
        )

        yield format_sse_event(
            {
                "type": "tool-input-available",
                "toolCallId": fc_id,
                "toolName": fc_name,
                "input": fc_args,
            }
        )

        # STEP 2: Send confirmation UI events
        yield format_sse_event(
            {
                "type": "tool-input-start",
                "toolCallId": confirmation_id,
                "toolName": "adk_request_confirmation",
            }
        )

        yield format_sse_event(
            {
                "type": "tool-input-available",
                "toolCallId": confirmation_id,
                "toolName": "adk_request_confirmation",
                "input": {
                    "originalFunctionCall": {
                        "id": fc_id,
                        "name": fc_name,
                        "args": fc_args,
                    },
                    "toolConfirmation": {
                        "confirmed": False,
                    },
                },
            }
        )

        # STEP 3: Wait for user decision using Result pattern
        match await _execute_confirmation_sse(interceptor, confirmation_id, fc_id, fc_name, fc_args):
            case Ok(confirmation_result):
                confirmed = confirmation_result.get("confirmed", False)
                logger.info(f"[SSE Confirmation] User decision: confirmed={confirmed}")

                # Yield confirmation result
                yield format_sse_event(
                    {
                        "type": "tool-output-available",
                        "toolCallId": confirmation_id,
                        "output": confirmation_result,
                    }
                )

                # STEP 4: Execute tool if approved
                if confirmed:
                    logger.info("[SSE Confirmation] ========== USER APPROVED ==========")
                    # Execute tool and yield result events
                    async for tool_event in self._execute_tool(fc_id, fc_name, fc_args):
                        yield tool_event
                else:
                    # User denied - yield error
                    logger.info(f"[SSE Confirmation] User denied tool: {fc_name}")
                    yield format_sse_event(
                        {
                            "type": "tool-output-error",
                            "toolCallId": fc_id,
                            "error": f"Tool execution denied by user: {fc_name}",
                        }
                    )

            case Error(error_msg):
                logger.error(f"[SSE Confirmation] {error_msg}")
                # Yield error
                yield format_sse_event(
                    {
                        "type": "tool-output-error",
                        "toolCallId": fc_id,
                        "error": error_msg,
                    }
                )

    async def _execute_tool(self, fc_id: str, fc_name: str, fc_args: dict[str, Any]):
        """
        Execute approved tool and trigger ADK continuation (SSE mode).

        SSE continuation mechanism (different from BIDI):
        1. Execute tool and yield result to frontend
        2. Append FunctionResponse to session history
        3. Trigger NEW run_async() to generate AI response
        4. Yield events from continuation run

        This matches the baseline logs showing TWO separate ADK runs:
        - First run: User message → Confirmation → finish
        - Second run: FunctionResponse in history → AI response → finish

        Args:
            fc_id: Function call ID
            fc_name: Tool name
            fc_args: Tool arguments

        Yields:
            SSE format strings (tool-output-available, AI response events, or errors)
        """
        from google.adk.events import Event as ADKEvent
        from google.genai import types

        # Execute tool function using Result pattern
        match await _execute_tool_function_sse(fc_name, fc_args, fc_id, self._session):
            case Ok(tool_result):
                logger.info(f"[SSE Confirmation] Tool executed successfully: {tool_result}")

                # Yield tool result to frontend as SSE format string
                yield format_sse_event(
                    {
                        "type": "tool-output-available",
                        "toolCallId": fc_id,
                        "output": tool_result,
                    }
                )

                # SSE Continuation: Append FunctionResponse and trigger new run
                # (Same approach as BIDI, but using run_async() instead of LiveRequestQueue)
                if self._ag_runner and hasattr(self._ag_runner, "session_service"):
                    # Append FunctionResponse to session history
                    function_response = types.Part(
                        function_response=types.FunctionResponse(
                            id=fc_id, name=fc_name, response=tool_result
                        )
                    )
                    content = types.Content(role="user", parts=[function_response])
                    adk_event = ADKEvent(author="user", content=content)

                    await self._ag_runner.session_service.append_event(self._session, adk_event)
                    logger.info(
                        "[SSE Confirmation] ✅ FunctionResponse appended to session history"
                    )

                    # Trigger continuation run (SSE-specific: new run_async() call)
                    # Send empty message to trigger AI response based on updated history
                    continuation = types.Content(role="user", parts=[types.Part(text="")])
                    logger.info("[SSE Confirmation] 🔄 Starting continuation run...")

                    continuation_stream = self._ag_runner.run_async(
                        user_id=self._session.user_id,
                        session_id=self._session.id,
                        new_message=continuation,
                    )

                    # Yield events from continuation run
                    # TODO: renew stream is needed here?
                    async for sse_event in stream_adk_to_ai_sdk(
                        continuation_stream,
                        mode="adk-sse",
                    ):
                        logger.debug(f"[SSE Confirmation] Continuation event: {sse_event[:20]}...")
                        yield sse_event

                    logger.info("[SSE Confirmation] ✅ Continuation run completed")

            case Error(error_msg):
                logger.error(f"[SSE Confirmation] {error_msg}")
                # Yield error as SSE format string
                yield format_sse_event(
                    {
                        "type": "tool-output-error",
                        "toolCallId": fc_id,
                        "error": error_msg,
                    }
                )
