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
import json
from collections.abc import AsyncIterable
from types import SimpleNamespace
from typing import Any

from google.adk.runners import Runner
from google.adk.sessions import Session
from loguru import logger

import adk_ag_tools
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
    try:
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

    except Exception as e:
        return Error(f"Tool execution failed: {e}")


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
        self.frontend_delegate = frontend_delegate
        self.confirmation_tools = confirmation_tools
        self.session = session
        self.sse_agent_runner = sse_agent_runner

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
                # Handle confirmation for this event if needed
                async for processed_event in self._handle_confirmation_if_needed(event):
                    yield processed_event

        # Convert ADK events to SSE format and yield for FastAPI
        # IMPORTANT: Protocol conversion happens here!
        # stream_adk_to_ai_sdk() converts ADK events to AI SDK v6 Data Stream Protocol
        # Output: SSE-formatted strings like 'data: {"type":"text-delta","text":"..."}\\n\\n'
        # This is the SAME converter used in BIDI mode (/ws endpoint)
        # We reuse 100% of the conversion logic - only transport layer differs
        # SSE mode: Yield SSE format for HTTP response (instead of WebSocket)
        #
        # NOTE: Confirmation is already handled by events_with_confirmation() above
        async for sse_event in stream_adk_to_ai_sdk(
            events_with_confirmation(),
            mode="adk-sse",  # Chunk logger: distinguish from adk-bidi mode
        ):
            event_count += 1

            # Register function_call.id mapping for frontend delegate tools
            if sse_event.startswith("data:"):
                match _parse_sse_event_data(sse_event):
                    case Ok(event_data):
                        event_type = event_data.get("type")

                        if event_type == "tool-input-available":
                            tool_name = event_data.get("toolName")
                            tool_call_id = event_data.get("toolCallId")
                            if tool_name and tool_call_id and self.frontend_delegate:
                                self.frontend_delegate.set_function_call_id(tool_name, tool_call_id)
                                logger.debug(
                                    f"[SSE] Registered mapping: {tool_name} → {tool_call_id}"
                                )
                    case Error(error_msg):
                        logger.debug(f"[SSE] Could not parse event data: {error_msg}")

            # Yield SSE-formatted event for FastAPI StreamingResponse
            # Frontend will parse "data: {...}" format and extract UIMessageChunk
            yield sse_event

        logger.info(f"[SSE] Streamed {event_count} events to client")
        # no except any exceptions. Let them propagate to caller for handling.

    async def _handle_confirmation_if_needed(self, event: Any):
        """
        Handle SSE confirmation flow for tools requiring user approval.

        This internal method handles confirmation in SSE mode.
        Unlike BIDI mode, SSE doesn't need to send continuation signals
        because ADK handles the full conversation in run_live() automatically.

        Args:
            event: ADK event (Event object or dict)

        Yields:
            Processed events (confirmation events, tool execution results, or original event)
        """
        from adk_compat import (
            _extract_function_call_from_event,
            _is_function_call_requiring_confirmation,
        )

        # Check if this event requires confirmation
        if not _is_function_call_requiring_confirmation(event, self.confirmation_tools):
            logger.debug("[SSE Confirmation] Event doesn't require confirmation - passing through")
            yield event
            return

        # Extract function_call details
        function_call = _extract_function_call_from_event(event)
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

        # Generate confirmation UI events
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
        # Generate confirmation UI events as SSE format strings
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
        match await _execute_confirmation_sse(
            interceptor, confirmation_id, fc_id, fc_name, fc_args
        ):
            case Ok(confirmation_result):
                confirmed = confirmation_result.get("confirmed", False)
                logger.info(f"[SSE Confirmation] User decision: confirmed={confirmed}")

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
                    logger.info("[SSE Confirmation] ========== USER APPROVED ==========")
                    # Execute tool and yield result event
                    async for tool_event in self._execute_tool(fc_id, fc_name, fc_args):
                        yield tool_event
                else:
                    # User denied - yield error as SSE format string
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
                # Yield error as SSE format string
                yield format_sse_event(
                    {
                        "type": "tool-output-error",
                        "toolCallId": fc_id,
                        "error": error_msg,
                    }
                )

    async def _execute_tool(self, fc_id: str, fc_name: str, fc_args: dict[str, Any]):
        """
        Execute approved tool (SSE mode).

        Yields tool execution results as pre-converted SSE format strings.
        Unlike BIDI mode, SSE mode doesn't need manual session history
        management - ADK's run_live() handles continuation automatically.

        Args:
            fc_id: Function call ID
            fc_name: Tool name
            fc_args: Tool arguments

        Yields:
            SSE format strings (tool-output-available or tool-output-error)
        """
        # Execute tool function using Result pattern
        match await _execute_tool_function_sse(fc_name, fc_args, fc_id, self.session):
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
