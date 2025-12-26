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

import json
import uuid
from collections.abc import AsyncIterable
from typing import Any

from fastapi import WebSocket
from fastapi.websockets import WebSocketDisconnect
from google.adk.sessions import Session
from loguru import logger

from .frontend_tool_service import FrontendToolDelegate
from .result import Error, Ok
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
        confirmation_tools: list[str] | None = None,  # Tools requiring confirmation
    ) -> None:
        """
        Initialize BIDI event sender.

        Args:
            websocket: FastAPI WebSocket for sending events
            frontend_delegate: Frontend tool delegate for ID mapping
            session: ADK Session (for invocation_id tracking and shared state access)
            agent_model: Agent model name (used as fallback when event.model_version is None)
            confirmation_tools: List of tool names requiring confirmation (e.g., ["process_payment"])

        Note:
            Tool execution deferral state is stored in session.state["pending_confirmations"]
        """
        self._ws = websocket
        self._delegate = frontend_delegate
        self._session = session
        self._agent_model = agent_model
        self._confirmation_tools = set(confirmation_tools or [])
        # Track tool-input-start events that require confirmation
        # Maps tool_call_id -> tool_name for pending confirmation injection
        self._pending_confirmation: dict[str, str] = {}

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

                # Check if this is a tool-input-available event requiring confirmation
                # If so, inject adk_request_confirmation events and defer the original event
                should_send_now = await self._handle_confirmation_if_needed(sse_event)

                if should_send_now:
                    await self._send_sse_event(sse_event)

                # Log [DONE] markers for debugging multi-turn flow
                # Note: We do NOT break here - run_live() stream continues for Turn 2+
                if sse_event.strip() == "data: [DONE]":
                    logger.info(
                        "[BIDI] Sent [DONE] marker (turn completed, stream continues)"
                    )

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
                    # logger.info(f"[BIDI-SEND] Sending event type: {event_type}")

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

    async def _handle_confirmation_if_needed(self, sse_event: str) -> bool:
        """
        Two-phase confirmation handling:
        1. On tool-input-start: Record confirmation-required tools
        2. On tool-input-available: Inject adk_request_confirmation events BEFORE the tool event

        BIDI mode limitation: ADK does not auto-generate adk_request_confirmation
        FunctionCalls for tools with require_confirmation=True (marked as TODO in ADK).
        We manually inject these events to match SSE mode behavior.

        Args:
            sse_event: SSE-formatted string like 'data: {"type":"tool-input-start",...}\n\n'

        Returns:
            True if the event should be sent immediately, False if it was deferred and sent later
        """
        # Only process data events (skip DONE, comments, etc.)
        if not sse_event.startswith("data:"):
            return True

        # Skip [DONE] marker
        if "DONE" == sse_event.strip()[5:].strip():
            return True

        # Parse event data
        match _parse_sse_event_data(sse_event):
            case Ok(event_data):
                event_type = event_data.get("type")
                tool_name = event_data.get("toolName")
                tool_call_id = event_data.get("toolCallId")

                # Phase 1: Record tool-input-start for confirmation-required tools
                if event_type == "tool-input-start" and tool_name in self._confirmation_tools and tool_call_id:
                    self._pending_confirmation[tool_call_id] = tool_name
                    logger.info(
                        f"[BIDI] Recorded pending confirmation for {tool_name} (ID: {tool_call_id})"
                    )
                    return True  # Send this event normally

                # Phase 2: Send original tool-input-available FIRST, then inject confirmation events
                elif event_type == "tool-input-available" and tool_call_id and tool_call_id in self._pending_confirmation:
                    tool_name = self._pending_confirmation.pop(tool_call_id)
                    tool_input = event_data.get("input")

                    # First, send the original tool-input-available event
                    await self._ws.send_text(sse_event)
                    logger.info(
                        f"[BIDI] Sent original tool-input-available for {tool_name}"
                    )

                    logger.info(
                        f"[BIDI] Injecting adk_request_confirmation events for {tool_name}"
                    )

                    # Generate unique ID for confirmation tool call
                    confirmation_id = f"adk-{uuid.uuid4()}"

                    # Create originalFunctionCall payload
                    original_function_call = {
                        "id": tool_call_id,
                        "name": tool_name,
                        "args": tool_input,
                    }

                    # Inject tool-input-start for adk_request_confirmation
                    start_event = {
                        "type": "tool-input-start",
                        "toolCallId": confirmation_id,
                        "toolName": "adk_request_confirmation",
                    }
                    start_sse = f"data: {json.dumps(start_event)}\n\n"
                    await self._ws.send_text(start_sse)
                    logger.info("[BIDI] Sent tool-input-start for adk_request_confirmation")

                    # Inject tool-input-available for adk_request_confirmation
                    available_event = {
                        "type": "tool-input-available",
                        "toolCallId": confirmation_id,
                        "toolName": "adk_request_confirmation",
                        "input": {
                            "originalFunctionCall": original_function_call,
                            "toolConfirmation": {
                                "hint": f"Please approve or reject the tool call {tool_name}() by responding with a FunctionResponse with an expected ToolConfirmation payload.",
                                "confirmed": False,
                            },
                        },
                    }
                    available_sse = f"data: {json.dumps(available_event)}\n\n"
                    await self._ws.send_text(available_sse)
                    logger.info(
                        "[BIDI] Sent tool-input-available for adk_request_confirmation"
                    )

                    # Save confirmation_id → original_tool_call_id mapping in session.state
                    # BidiEventReceiver will use this to resolve the original tool_call_id
                    # when it receives confirmation approval
                    # KEY: Use confirmation_id as key because approval comes with confirmation_id
                    self._session.state["confirmation_id_mapping"][confirmation_id] = tool_call_id
                    logger.info(
                        f"[BIDI] Saved confirmation mapping: {confirmation_id} → {tool_call_id} for tool {tool_name}"
                    )

                    # Save current_function_call_id for tool function to access
                    # Tool function will use this to request confirmation with correct ID
                    self._session.state["current_function_call_id"] = tool_call_id
                    logger.info(
                        f"[BIDI] Saved current_function_call_id: {tool_call_id} for tool {tool_name}"
                    )

                    # Return False to prevent duplicate sending of original event
                    return False
            case _:
                # Parse failed, send event normally
                pass

        # Default: send event normally
        return True

