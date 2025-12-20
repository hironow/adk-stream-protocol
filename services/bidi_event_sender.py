"""
BIDI Event Sender Service (Downstream: ADK → WebSocket)

This module sends ADK events to the frontend via WebSocket,
converting them to AI SDK v6 Data Stream Protocol format.

Responsibilities:
- Receive ADK events from run_live()
- Convert to AI SDK v6 Data Stream Protocol (SSE format)
- Send events to WebSocket
- Register function_call.id mappings for frontend tools
- Handle confirmation flow via ToolConfirmationInterceptor

Counterpart: BidiEventReceiver handles upstream (WebSocket → ADK) direction.
"""

import inspect
import json
from collections.abc import AsyncIterable
from types import SimpleNamespace
from typing import Any

from fastapi import WebSocket
from google.adk.agents import LiveRequestQueue
from google.adk.events import Event as ADKEvent
from google.adk.runners import Runner
from google.adk.sessions import Session
from google.genai import types
from loguru import logger

import adk_ag_tools
from adk_compat import (
    _extract_function_call_from_event,
    _is_function_call_requiring_confirmation,
)
from confirmation_interceptor import ToolConfirmationInterceptor
from result.result import Error, Ok, Result
from services.frontend_tool_service import FrontendToolDelegate
from stream_protocol import format_sse_event, stream_adk_to_ai_sdk


def _parse_json_safely(json_str: str) -> Result[dict[str, Any], str]:
    """
    Safely parse JSON string, returning Result instead of raising.

    Args:
        json_str: JSON string to parse

    Returns:
        Ok(dict) if parsing succeeds, Error(str) if parsing fails
    """
    try:
        parsed = json.loads(json_str)
        return Ok(parsed)
    except json.JSONDecodeError as e:
        return Error(f"JSON decode error: {e}")


def _parse_sse_event_data(sse_event: str) -> Result[dict[str, Any], str]:
    """
    Parse SSE event data from formatted string.

    Args:
        sse_event: SSE-formatted string like 'data: {...}\\n\\n'

    Returns:
        Ok(event_data) if parsing succeeds, Error(str) if parsing fails
    """
    if not sse_event.startswith("data:"):
        return Error("Event does not start with 'data:'")

    json_str = sse_event[5:].strip()  # Remove "data:" prefix
    return _parse_json_safely(json_str)


async def _execute_tool_function(
    fc_name: str, fc_args: dict[str, Any], fc_id: str, session: Session
) -> Result[Any, str]:
    """
    Execute tool function and return result.

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


async def _execute_confirmation(
    interceptor: ToolConfirmationInterceptor,
    confirmation_id: str,
    fc_id: str,
    fc_name: str,
    fc_args: dict[str, Any],
) -> Result[dict[str, Any], str]:
    """
    Execute confirmation flow and wait for user decision.

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


class BidiEventSender:
    """
    Sends ADK events to WebSocket (Downstream: ADK → WebSocket).

    Handles the downstream direction of BIDI communication:
    - ADK generates events via run_live()
    - This class converts them to SSE format
    - Sends to frontend via WebSocket

    Counterpart: BidiEventReceiver handles upstream (WebSocket → ADK).
    """

    def __init__(  # noqa: PLR0913
        self,
        websocket: WebSocket,
        frontend_delegate: FrontendToolDelegate,
        confirmation_tools: list[str],
        session: Session,
        live_request_queue: LiveRequestQueue,
        bidi_agent_runner: Runner | None = None,
    ) -> None:
        """
        Initialize BIDI event sender.

        Args:
            websocket: FastAPI WebSocket for sending events
            frontend_delegate: Frontend tool delegate for ID mapping
            confirmation_tools: List of tool names requiring confirmation
            session: ADK Session for frontend_delegate access
            live_request_queue: Queue for triggering ADK continuation
            bidi_agent_runner: BidiAgentRunner for accessing session_service
        """
        self.websocket = websocket
        self.frontend_delegate = frontend_delegate
        self.confirmation_tools = confirmation_tools
        self.session = session
        self.live_request_queue = live_request_queue
        self.bidi_agent_runner = bidi_agent_runner

    async def send_events(self, live_events: AsyncIterable[Any]) -> None:
        """
        Stream ADK events to WebSocket as SSE-formatted messages.

        Args:
            live_events: AsyncIterable of ADK events from run_live()

        Raises:
            WebSocketDisconnect: Client disconnected during streaming
            ValueError: ADK connection errors (session resumption, etc.)
            Exception: Other errors during sending
        """
        event_count = 0
        logger.info("[BIDI] Starting to stream ADK events to WebSocket")

        # Wrap live_events with confirmation processing
        # This intercepts tool calls requiring confirmation and handles them inline
        async def events_with_confirmation():
            async for event in live_events:
                async for processed_event in self._handle_confirmation_if_needed(event):
                    yield processed_event

        async for sse_event in stream_adk_to_ai_sdk(
            events_with_confirmation(),
            mode="adk-bidi",  # Chunk logger: distinguish from adk-sse mode
        ):
            event_count += 1

            await self._send_sse_event(sse_event)

        logger.info(f"[BIDI] Sent {event_count} events to client")
        # no except any other exceptions. Let them propagate to caller for handling.

    async def _send_sse_event(self, sse_event: str) -> None:
        """
        Send SSE-formatted event to WebSocket with logging and ID mapping.

        Args:
            sse_event: SSE-formatted string like 'data: {...}\\n\\n'
        """
        # Log event types for debugging
        if sse_event.startswith("data:"):
            # Skip DONE event
            if "DONE" == sse_event.strip()[5:].strip():
                await self.websocket.send_text(sse_event)
                return

            match _parse_sse_event_data(sse_event):
                case Ok(event_data):
                    event_type = event_data.get("type", "unknown")
                    logger.info(f"[BIDI-SEND] Sending event type: {event_type}")

                    # Register function_call.id mapping for frontend delegate tools
                    if event_type == "tool-input-available":
                        tool_name = event_data.get("toolName")
                        tool_call_id = event_data.get("toolCallId")
                        if tool_name and tool_call_id and self.frontend_delegate:
                            result = self.frontend_delegate.set_function_call_id(
                                tool_name, tool_call_id
                            )
                            match result:
                                case Ok(_):
                                    logger.debug(
                                        f"[BIDI-SEND] Registered mapping: {tool_name} → {tool_call_id}"
                                    )
                                case Error(error_msg):
                                    # ID mapping is optional - log and continue if it fails
                                    logger.debug(f"[BIDI-SEND] {error_msg}")

        # Send to WebSocket
        await self.websocket.send_text(sse_event)

    async def _handle_confirmation_if_needed(self, event: Any):
        """
        Handle BIDI confirmation flow for tools requiring user approval.

        This internal method replaces inject_confirmation_for_bidi() from adk_compat.py.
        All confirmation logic is now centralized in BidiEventSender.

        Args:
            event: ADK event (Event object or dict)

        Yields:
            Processed events (confirmation events, tool execution results)
        """

        # Check if this event requires confirmation
        if not _is_function_call_requiring_confirmation(event, self.confirmation_tools):
            logger.debug("[BIDI Confirmation] Event doesn't require confirmation - passing through")
            yield event
            return

        # Extract function_call details
        function_call = _extract_function_call_from_event(event)
        if not function_call:
            logger.warning("[BIDI Confirmation] Could not extract function_call from event")
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

        logger.info("[BIDI Confirmation] ========== START CONFIRMATION FLOW ==========")
        logger.info(f"[BIDI Confirmation] Tool: {fc_name} (id={fc_id}, args={fc_args})")

        # Generate confirmation UI events as SSE format strings
        confirmation_id = f"confirmation-{fc_id}"

        # Create interceptor for this confirmation
        interceptor = ToolConfirmationInterceptor(
            delegate=self.frontend_delegate,
            confirmation_tools=self.confirmation_tools,
        )

        # Register confirmation ID in ID mapper
        interceptor.delegate.id_mapper.register("adk_request_confirmation", confirmation_id)

        # NEW: Send original tool-input events FIRST (so frontend knows about the original tool)
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

        # THEN send confirmation UI events
        # Yield tool-input-start as SSE format string
        yield format_sse_event(
            {
                "type": "tool-input-start",
                "toolCallId": confirmation_id,
                "toolName": "adk_request_confirmation",
            }
        )

        # Yield tool-input-available with full confirmation data as SSE format string
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

        # Wait for user decision using Result pattern
        match await _execute_confirmation(interceptor, confirmation_id, fc_id, fc_name, fc_args):
            case Ok(confirmation_result):
                confirmed = confirmation_result.get("confirmed", False)
                logger.info(f"[BIDI Confirmation] User decision: confirmed={confirmed}")

                # Yield confirmation result as SSE format string
                yield format_sse_event(
                    {
                        "type": "tool-output-available",
                        "toolCallId": confirmation_id,
                        "output": confirmation_result,
                    }
                )

                # Execute tool if approved
                if confirmed:
                    logger.info("[BIDI Confirmation] ========== USER APPROVED ==========")
                    # Execute tool and yield result event
                    async for tool_event in self._execute_tool_and_continue(
                        fc_id, fc_name, fc_args
                    ):
                        yield tool_event
                else:
                    # User denied - yield error as SSE format string
                    logger.info(f"[BIDI Confirmation] User denied tool: {fc_name}")
                    yield format_sse_event(
                        {
                            "type": "tool-output-error",
                            "toolCallId": fc_id,
                            "error": f"Tool execution denied by user: {fc_name}",
                        }
                    )

            case Error(error_msg):
                logger.error(f"[BIDI Confirmation] {error_msg}")
                # Yield error as SSE format string
                yield format_sse_event(
                    {
                        "type": "tool-output-error",
                        "toolCallId": fc_id,
                        "error": error_msg,
                    }
                )

    async def _execute_tool_and_continue(self, fc_id: str, fc_name: str, fc_args: dict[str, Any]):
        """
        Execute approved tool and trigger ADK continuation.

        This is the KEY FIX: After tool execution, we:
        1. Execute tool and yield result to frontend
        2. Append FunctionResponse to session history
        3. Send continuation signal via LiveRequestQueue
        4. ADK generates new turn based on updated history

        Args:
            fc_id: Function call ID
            fc_name: Tool name
            fc_args: Tool arguments

        Yields:
            tool-output-available or tool-output-error event
        """
        # Execute tool function using Result pattern
        match await _execute_tool_function(fc_name, fc_args, fc_id, self.session):
            case Ok(tool_result):
                logger.info(f"[BIDI Confirmation] Tool executed successfully: {tool_result}")

                # Yield tool result to frontend as SSE format string
                yield format_sse_event(
                    {
                        "type": "tool-output-available",
                        "toolCallId": fc_id,
                        "output": tool_result,
                    }
                )

                # Append FunctionResponse to session history
                if self.bidi_agent_runner and hasattr(self.bidi_agent_runner, "session_service"):
                    function_response = types.Part(
                        function_response=types.FunctionResponse(
                            id=fc_id, name=fc_name, response=tool_result
                        )
                    )
                    content = types.Content(role="user", parts=[function_response])
                    adk_event = ADKEvent(author="user", content=content)

                    await self.bidi_agent_runner.session_service.append_event(
                        self.session, adk_event
                    )
                    logger.info(
                        "[BIDI Confirmation] ✅ FunctionResponse appended to session history"
                    )

                    # KEY FIX: Trigger ADK continuation
                    # Send empty content to trigger ADK to generate new turn
                    continuation = types.Content(role="user", parts=[types.Part(text="")])
                    self.live_request_queue.send_content(continuation)
                    logger.info(
                        "[BIDI Confirmation] ✅ Continuation signal sent via LiveRequestQueue"
                    )

            case Error(error_msg):
                logger.error(f"[BIDI Confirmation] {error_msg}")
                # Yield error as SSE format string
                yield format_sse_event(
                    {
                        "type": "tool-output-error",
                        "toolCallId": fc_id,
                        "error": error_msg,
                    }
                )
