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
        self.frontend_delegate = frontend_delegate
        self.confirmation_tools = confirmation_tools
        self.session = session
        self.sse_agent_runner = sse_agent_runner
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
        Handle SSE confirmation flow - pass through to ADK's native handling.

        SSE Mode Design:
        - ADK natively handles confirmation for tools with require_confirmation=True
        - ADK generates both process_payment AND adk_request_confirmation FunctionCalls
        - Stream ends after confirmation UI
        - Frontend sends NEW request with confirmation result
        - Server processes confirmation in new request

        This is different from BIDI mode which manually intercepts and handles confirmation.

        Args:
            event: ADK event (Event object or dict)

        Yields:
            Original event (pass-through, no interception in SSE mode)
        """
        logger.debug("[SSE Confirmation] Passing event through (ADK native handling)")
        yield event

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

                # SSE Continuation: Append FunctionResponse and trigger new run
                # (Same approach as BIDI, but using run_async() instead of LiveRequestQueue)
                if self.sse_agent_runner and hasattr(self.sse_agent_runner, "session_service"):
                    # Append FunctionResponse to session history
                    function_response = types.Part(
                        function_response=types.FunctionResponse(
                            id=fc_id, name=fc_name, response=tool_result
                        )
                    )
                    content = types.Content(role="user", parts=[function_response])
                    adk_event = ADKEvent(author="user", content=content)

                    await self.sse_agent_runner.session_service.append_event(
                        self.session, adk_event
                    )
                    logger.info(
                        "[SSE Confirmation] ✅ FunctionResponse appended to session history"
                    )

                    # Trigger continuation run (SSE-specific: new run_async() call)
                    # Send empty message to trigger AI response based on updated history
                    continuation = types.Content(role="user", parts=[types.Part(text="")])
                    logger.info("[SSE Confirmation] 🔄 Starting continuation run...")

                    continuation_stream = self.sse_agent_runner.run_async(
                        user_id=self.session.user_id,
                        session_id=self.session.id,
                        new_message=continuation,
                    )

                    # Yield events from continuation run
                    async for sse_event in stream_adk_to_ai_sdk(
                        continuation_stream,
                        mode="adk-sse",
                    ):
                        logger.debug(f"[SSE Confirmation] Continuation event: {sse_event[:100]}...")
                        yield sse_event

                    logger.info("[SSE Confirmation] ✅ Continuation run completed")
                else:
                    logger.warning(
                        "[SSE Confirmation] ⚠️ Cannot trigger continuation - no session_service"
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
