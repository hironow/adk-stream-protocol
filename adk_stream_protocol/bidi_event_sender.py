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

from collections.abc import AsyncIterable
from typing import Any

from fastapi import WebSocket
from fastapi.websockets import WebSocketDisconnect
from google.adk.sessions import Session
from loguru import logger

from .frontend_tool_service import FrontendToolDelegate
from .result import Ok
from .stream_protocol import stream_adk_to_ai_sdk
from .utils import _parse_sse_event_data


class BidiEventSender:
    """
    Sends ADK events to WebSocket (Downstream: ADK → WebSocket).

    Handles the downstream direction of BIDI communication:
    - ADK generates events via run_live()
    - This class converts them to SSE format
    - Sends to frontend via WebSocket

    Counterpart: BidiEventReceiver handles upstream (WebSocket → ADK).
    """

    def __init__(
        self,
        websocket: WebSocket,
        frontend_delegate: FrontendToolDelegate,
        session: Session,
        agent_model: str | None = None,  # Agent model name for modelVersion fallback
    ) -> None:
        """
        Initialize BIDI event sender.

        Args:
            websocket: FastAPI WebSocket for sending events
            frontend_delegate: Frontend tool delegate for ID mapping
            session: ADK Session (for invocation_id tracking)
            agent_model: Agent model name (used as fallback when event.model_version is None)
        """
        self._ws = websocket
        self._delegate = frontend_delegate
        self._session = session
        self._agent_model = agent_model

    async def send_events(self, live_events: AsyncIterable[Any]) -> None:
        """
        Stream ADK events to WebSocket as SSE-formatted messages.

        Args:
            live_events: AsyncIterable of ADK events from run_live()

        Raises:
            ValueError: ADK connection errors (session resumption, etc.)
            Exception: Other errors during sending

        Note:
            WebSocketDisconnect is caught and handled gracefully - the method
            returns normally without raising when client disconnects.
        """
        event_count = 0
        logger.info("[BIDI] Starting to stream ADK events to WebSocket")

        # Initialize invocation_id capture
        self._current_invocation_id = None

        # Capture invocation_id and pass events through to ADK's native flow
        async def events_with_invocation_capture():
            async for event in live_events:
                # Capture invocation_id from first event
                if self._current_invocation_id is None and hasattr(event, 'invocation_id'):
                    self._current_invocation_id = event.invocation_id
                    logger.info(f"[BIDI] Captured invocation_id: {self._current_invocation_id}")

                yield event

        try:
            async for sse_event in stream_adk_to_ai_sdk(
                events_with_invocation_capture(),
                mode="adk-bidi",  # Chunk logger: distinguish from adk-sse mode
                agent_model=self._agent_model,  # Pass agent model for modelVersion fallback
            ):
                event_count += 1

                await self._send_sse_event(sse_event)

            logger.info(f"[BIDI] Sent {event_count} events to client")
        except WebSocketDisconnect:
            logger.warning(
                f"[BIDI] WebSocket disconnected during send - stopping stream gracefully "
                f"(sent {event_count} events before disconnect)"
            )
            # Gracefully stop - do not re-raise
            return
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
                await self._ws.send_text(sse_event)
                return

            match _parse_sse_event_data(sse_event):
                case Ok(event_data):
                    event_type = event_data.get("type", "unknown")
                    logger.info(f"[BIDI-SEND] Sending event type: {event_type}")

                    # Register function_call.id mapping for frontend delegate tools
                    if event_type == "tool-input-available":
                        tool_name = event_data.get("toolName")
                        tool_call_id = event_data.get("toolCallId")
                        if tool_name and tool_call_id and self._delegate:
                            result = self._delegate.set_function_call_id(tool_name, tool_call_id)
                            match result:
                                case Ok(_):
                                    logger.debug(
                                        f"[BIDI-SEND] Registered mapping: {tool_name} → {tool_call_id}"
                                    )
                                case Error(error_msg):
                                    # ID mapping is optional - log and continue if it fails
                                    logger.debug(f"[BIDI-SEND] {error_msg}")

        # Send to WebSocket
        await self._ws.send_text(sse_event)

