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

from collections.abc import AsyncIterable
from typing import Any

from google.adk.runners import Runner
from google.adk.sessions import Session
from loguru import logger

from .ags import Ok
from .frontend_tool_service import FrontendToolDelegate
from .stream_protocol import stream_adk_to_ai_sdk
from .utils import _parse_sse_event_data


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
                if self._current_invocation_id is None and hasattr(event, "invocation_id"):
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
