"""
BIDI Event Sender Service (Downstream: ADK → WebSocket)

This module sends ADK events to the frontend via WebSocket,
converting them to AI SDK v6 Data Stream Protocol format.

Responsibilities:
- Receive ADK events from run_live()
- Convert to AI SDK v6 Data Stream Protocol (SSE format)
- Send events to WebSocket
- Register function_call.id mappings for frontend tools
- Handle confirmation flow

Counterpart: BidiEventReceiver handles upstream (WebSocket → ADK) direction.
"""

import uuid
from collections.abc import AsyncGenerator, AsyncIterable
from typing import Any

from fastapi import WebSocket
from fastapi.websockets import WebSocketDisconnect
from google.adk.sessions import Session
from loguru import logger

from adk_stream_protocol.ags import Error, Ok
from adk_stream_protocol.protocol.stream_protocol import (
    StreamProtocolConverter,
    stream_adk_to_ai_sdk,
)
from adk_stream_protocol.tools.frontend_tool_service import FrontendToolDelegate
from adk_stream_protocol.transport._utils import ensure_session_state_key
from adk_stream_protocol.utils import _parse_sse_event_data


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

        try:
            async for sse_event in stream_adk_to_ai_sdk(
                self._events_with_invocation_capture(live_events),
                mode="adk-bidi",  # Chunk logger: distinguish from adk-sse mode
                agent_model=self._agent_model,  # Pass agent model for modelVersion fallback
            ):
                event_count += 1

                # Log SSE output (after ADK conversion)
                self._log_sse_output(sse_event)

                # Check if this is a tool-input-available event requiring confirmation
                should_send_now = await self._handle_confirmation_if_needed(sse_event)

                if should_send_now:
                    await self._send_sse_event(sse_event)

                # Log [DONE] markers for debugging multi-turn flow
                if sse_event.strip() == "data: [DONE]":
                    logger.info("[BIDI] Sent [DONE] marker (turn completed, stream continues)")

            logger.info(f"[BIDI] Sent {event_count} events to client")
        except WebSocketDisconnect:
            logger.warning(
                f"[BIDI] WebSocket disconnected during send - stopping stream gracefully "
                f"(sent {event_count} events before disconnect)"
            )
            # Gracefully stop - do not re-raise
            return
        # no except any other exceptions. Let them propagate to caller for handling.

    async def _events_with_invocation_capture(
        self, live_events: AsyncIterable[Any]
    ) -> AsyncGenerator[Any]:
        """
        Wrap ADK events to capture invocation_id and log tool-related content.

        Args:
            live_events: AsyncIterable of ADK events from run_live()

        Yields:
            ADK events (unchanged)
        """
        async for event in live_events:
            # Capture invocation_id from first event
            if self._current_invocation_id is None and hasattr(event, "invocation_id"):
                self._current_invocation_id = event.invocation_id
                logger.info(f"[BIDI] Captured invocation_id: {self._current_invocation_id}")

            # Log ADK events (before conversion to SSE) - skip audio
            self._log_adk_event(event)

            yield event

    def _log_adk_event(self, event: Any) -> None:
        """
        Log ADK events for debugging. Focuses on tool-related events, skips audio.

        Args:
            event: ADK event object
        """
        event_type = type(event).__name__
        if "Audio" in event_type or "Pcm" in event_type:
            return

        # Check for tool-related content
        has_tool_content = False
        if hasattr(event, "content") and event.content:
            for part in event.content.parts:
                if hasattr(part, "function_call") and part.function_call:
                    has_tool_content = True
                    logger.info(
                        f"[ADK→SSE INPUT] FunctionCall: id={part.function_call.id}, "
                        f"name={part.function_call.name}"
                    )
                elif hasattr(part, "function_response") and part.function_response:
                    has_tool_content = True
                    logger.info(
                        f"[ADK→SSE INPUT] FunctionResponse: id={part.function_response.id}, "
                        f"name={part.function_response.name}"
                    )

        # Log all non-audio events for debugging
        if has_tool_content or event_type in ["TurnComplete", "ToolOutputAvailable"]:
            logger.info(f"[ADK→SSE INPUT] Event type: {event_type}")

    def _log_sse_output(self, sse_event: str) -> None:
        """
        Log SSE output events for debugging. Focuses on tool-related events.

        Args:
            sse_event: SSE-formatted event string
        """
        if not sse_event.startswith("data:") or "DONE" in sse_event:
            return

        match _parse_sse_event_data(sse_event):
            case Ok(event_data):
                event_type = event_data.get("type", "unknown")
                # Log tool-related events only
                if event_type in [
                    "tool-input-start",
                    "tool-input-available",
                    "tool-output-available",
                ]:
                    logger.info(
                        f"[ADK→SSE OUTPUT] {event_type}: {event_data.get('toolName', 'N/A')}"
                    )
                elif event_type in ["finish", "start"]:
                    logger.info(f"[ADK→SSE OUTPUT] {event_type}")

    async def _send_sse_event(self, sse_event: str) -> bool:  # noqa: C901 - event routing requires complexity
        """
        Send SSE-formatted event to WebSocket with logging and ID mapping.

        Args:
            sse_event: SSE-formatted string like 'data: {...}\\n\\n'

        Returns:
            True if sent successfully, False if send failed (B3: graceful error handling)
        """
        # Log event types for debugging
        if sse_event.startswith("data:"):
            # Skip DONE event
            if "DONE" == sse_event.strip()[5:].strip():
                try:
                    await self._ws.send_text(sse_event)
                    return True
                except WebSocketDisconnect:
                    raise
                except Exception as e:
                    logger.error(f"[BIDI-SEND] Failed to send [DONE] event: {e!s}")
                    return False

            match _parse_sse_event_data(sse_event):
                case Ok(event_data):
                    event_type = event_data.get("type", "unknown")
                    # Detailed logging moved to send_events loop

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

        # Send to WebSocket with error handling (B3: log but don't crash for non-disconnect errors)
        try:
            await self._ws.send_text(sse_event)
            return True
        except WebSocketDisconnect:
            # Re-raise disconnect so outer handler in send_events() can catch it
            # and stop the stream gracefully
            raise
        except Exception as e:
            logger.error(f"[BIDI-SEND] ✗ Failed to send event: {e}")
            logger.error(f"[BIDI-SEND] Event that failed: {sse_event[:200]}")
            return False

    async def _send_confirmation_step(self, sse_data: str, step_name: str) -> None:
        """
        Send a confirmation step event to WebSocket with logging and error handling.

        Args:
            sse_data: SSE-formatted string to send
            step_name: Human-readable step name for logging (e.g., "start-step", "finish-step")

        Raises:
            Exception: Re-raises any exception after logging
        """
        try:
            await self._ws.send_text(sse_data)
            logger.info(f"[BIDI Approval] ✓ Sent {step_name}")
        except Exception as e:
            logger.error(f"[BIDI Approval] ✗ Failed to send {step_name}: {e!s}")
            raise

    async def _handle_confirmation_if_needed(self, sse_event: str) -> bool:
        """
        Legacy Approval Mode: Detect LongRunningFunctionTool calls and inject confirmation flow.

        LongRunningFunctionTool returns None to prevent ADK from sending FunctionResponse.
        We detect tool-input-available for confirmation-required tools and inject
        adk_request_confirmation to match SSE mode UX.

        Flow:
        1. On tool-input-start: Record tool_name for confirmation-required tools
        2. On tool-input-available: Inject confirmation events immediately
        3. Extract tool call arguments from input event
        4. Send original tool-input-available
        5. Inject tool-input-start/available for adk_request_confirmation
        6. Save pending call info for later execution

        Args:
            sse_event: SSE-formatted string like 'data: {"type":"tool-input-available",...}\n\n'

        Returns:
            True if the event should be sent immediately, False if it was deferred and sent later
        """
        logger.info(
            f"[BIDI Approval] _handle_confirmation_if_needed called with: {sse_event[:100]}"
        )

        # Only process data events (skip DONE, comments, etc.)
        if not sse_event.startswith("data:"):
            return True

        # EXPERIMENT: Comment out DONE skip to see if it affects behavior
        # # Skip [DONE] marker
        # if "DONE" == sse_event.strip()[5:].strip():
        #     return True

        # Parse event data
        match _parse_sse_event_data(sse_event):
            case Ok(event_data):
                event_type = event_data.get("type")
                tool_call_id = event_data.get("toolCallId")
                tool_name = event_data.get("toolName")

                # Legacy Approval Mode Step 1: Record tool-input-start for confirmation-required tools
                if (
                    event_type == "tool-input-start"
                    and tool_name in self._confirmation_tools
                    and tool_call_id
                ):
                    self._record_tool_confirmation(tool_call_id, tool_name)
                    return True  # Send this event normally

                # Legacy Approval Mode Step 2: Detect tool-input-available for confirmation-required tools
                elif event_type == "tool-input-available":
                    if tool_call_id and tool_call_id in self._pending_confirmation:
                        await self._inject_confirmation_flow(sse_event, tool_call_id, event_data)
                        return False  # Already sent the original event

                # Legacy Approval Mode Step 3: Skip tool-output-available for confirmation-required tools
                elif event_type == "tool-output-available":
                    if self._skip_pending_output(tool_call_id):
                        return False  # Skip this event

            case _:
                # Parse failed, send event normally
                pass

        # Default: send event normally
        return True

    def _record_tool_confirmation(self, tool_call_id: str, tool_name: str) -> None:
        """
        Legacy Approval Mode Step 1: Record tool-input-start for confirmation-required tools.

        Args:
            tool_call_id: Unique identifier for the tool call
            tool_name: Name of the tool requiring confirmation
        """
        self._pending_confirmation[tool_call_id] = tool_name
        logger.info(
            f"[BIDI Approval] Recorded pending confirmation for {tool_name} (ID: {tool_call_id})"
        )

    async def _inject_confirmation_flow(
        self, sse_event: str, tool_call_id: str, event_data: dict[str, Any]
    ) -> None:
        """
        Legacy Approval Mode Step 2: Inject confirmation flow for tools requiring approval.

        Flow:
        1. Send original tool-input-available
        2. Save pending call info
        3. Inject start-step, tool-approval-request, finish-step

        Args:
            sse_event: Original SSE event string
            tool_call_id: Tool call identifier
            event_data: Parsed event data dict
        """
        # Get tool_name from pending_confirmation dict
        tool_name = self._pending_confirmation.pop(tool_call_id)
        logger.info(
            f"[BIDI Approval] Detected tool-input-available for {tool_name} (ID: {tool_call_id})"
        )

        # Extract args from input event
        tool_args = event_data.get("input", {})

        # Save pending call info for later execution
        ensure_session_state_key(self._session, "pending_long_running_calls", {})
        self._session.state["pending_long_running_calls"][tool_call_id] = {
            "name": tool_name,
            "args": tool_args,
        }
        logger.info(
            f"[BIDI Approval] Saved pending call: id={tool_call_id}, "
            f"name={tool_name}, args={tool_args}"
        )

        # Send original tool-input-available FIRST
        await self._send_sse_event(sse_event)

        # Generate unique ID for confirmation tool call
        confirmation_id = f"confirm-{uuid.uuid4()}"
        logger.info(f"[BIDI Approval] Injecting approval step for {tool_name}")

        # ADR 0011: Inject start-step to begin approval step
        start_step_sse = 'data: {"type":"start-step"}\n\n'
        await self._send_confirmation_step(
            start_step_sse, "start-step before tool-approval-request"
        )

        # Send tool-approval-request (AI SDK v6 standard event)
        approval_request_sse = StreamProtocolConverter.format_tool_approval_request(
            original_tool_call_id=tool_call_id,
            approval_id=confirmation_id,
        )
        await self._send_confirmation_step(approval_request_sse, "tool-approval-request")

        # ADR 0011: Inject finish-step to complete approval step
        finish_step_sse = 'data: {"type":"finish-step"}\n\n'
        await self._send_confirmation_step(
            finish_step_sse, "finish-step after tool-approval-request"
        )

        # Save confirmation_id → original_tool_call_id mapping
        ensure_session_state_key(self._session, "confirmation_id_mapping", {})
        self._session.state["confirmation_id_mapping"][confirmation_id] = tool_call_id
        logger.info(
            f"[BIDI Approval] Saved confirmation mapping: {confirmation_id} → {tool_call_id} for tool {tool_name}"
        )

    def _skip_pending_output(self, tool_call_id: str | None) -> bool:
        """
        Legacy Approval Mode Step 3: Check if tool-output-available should be skipped.

        Pending status FunctionResponse should not be sent to frontend.
        Real result will be sent after approval via LiveRequestQueue.send_content().

        Args:
            tool_call_id: Tool call identifier (may be None)

        Returns:
            True if event should be skipped, False otherwise
        """
        pending_calls = self._session.state.get("pending_long_running_calls", {})
        logger.info(
            f"[BIDI Approval] Checking tool-output-available: tool_call_id={tool_call_id}, "
            f"pending_calls={list(pending_calls.keys())}"
        )

        if tool_call_id and tool_call_id in pending_calls:
            tool_name = pending_calls[tool_call_id]["name"]
            logger.info(
                f"[BIDI Approval] Skipping tool-output-available for {tool_name} (ID: {tool_call_id}) - "
                "pending status should not be sent to frontend"
            )
            return True  # Skip this event

        logger.info(
            f"[BIDI Approval] NOT skipping tool-output-available (ID: {tool_call_id}) - "
            f"not in pending_calls or tool_call_id is None"
        )
        return False
