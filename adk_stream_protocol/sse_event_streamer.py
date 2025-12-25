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

        # Initialize invocation_id capture
        self._current_invocation_id = None

        # Capture invocation_id and pass events through to ADK's native flow
        async def events_with_invocation_capture():
            async for event in live_events:
                # Capture invocation_id from first event
                if self._current_invocation_id is None and hasattr(event, 'invocation_id'):
                    self._current_invocation_id = event.invocation_id
                    logger.info(f"[SSE] Captured invocation_id: {self._current_invocation_id}")

                yield event

        async for sse_event in stream_adk_to_ai_sdk(
            events_with_invocation_capture(),
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
