"""
BIDI Event Receiver Service (Upstream: WebSocket → ADK)

This module receives and processes WebSocket events from the frontend,
converting them to ADK format for the Live API.

Responsibilities:
- Receive incoming WebSocket events (message, interrupt, audio_control, audio_chunk, tool_result)
- Convert message format (AI SDK v6 → ADK)
- Synchronize conversation history
- Coordinate tool confirmation flow with FrontendToolDelegate
- Process audio streaming (PCM audio chunks)

Counterpart: BidiEventSender handles downstream (ADK → WebSocket) direction.
"""

import base64
from typing import Any

from google.adk.agents import LiveRequestQueue
from google.adk.runners import Runner
from google.adk.sessions import Session
from google.genai import types
from loguru import logger

from adk_stream_protocol.adk.session import Event as AdkEvent
from adk_stream_protocol.adk.session import sync_conversation_history_to_session
from adk_stream_protocol.ags.tools import execute_get_location, execute_process_payment
from adk_stream_protocol.protocol.message_types import ChatMessage, process_chat_message_for_bidi
from adk_stream_protocol.tools.approval_queue import ApprovalQueue
from adk_stream_protocol.tools.frontend_tool_service import FrontendToolDelegate
from adk_stream_protocol.transport._utils import ensure_session_state_key, log_implementation_gap


class BidiEventReceiver:
    """
    Receives and processes BIDI mode WebSocket events (Upstream: WebSocket → ADK).

    Handles the upstream direction of BIDI communication:
    - Frontend sends WebSocket events
    - This class processes them and sends to ADK via LiveRequestQueue

    Each event type has a dedicated handler method for testability.
    Counterpart: BidiEventSender handles downstream (ADK → WebSocket).
    """

    def __init__(
        self,
        session: Session,
        frontend_delegate: FrontendToolDelegate,
        live_request_queue: LiveRequestQueue,
        bidi_agent_runner: Runner,
    ) -> None:
        """
        Initialize BIDI event handler.

        Args:
            session: ADK Session object (also provides access to shared state)
            frontend_delegate: Frontend tool delegate for tool execution
            live_request_queue: ADK LiveRequestQueue for sending data to Live API
            bidi_agent_runner: ADK Runner with session_service

        Note:
            Tool execution deferral state is accessed via session.state["pending_confirmations"]
            Approval queue for BLOCKING tools is stored in session.state["approval_queue"]
        """
        self._session = session
        self._delegate = frontend_delegate
        self._live_request_queue = live_request_queue
        self._ag_runner = bidi_agent_runner

        # Setup approval queue for BLOCKING tools (BIDI Blocking Mode)
        approval_queue = ApprovalQueue()
        session.state["approval_queue"] = approval_queue
        logger.info("[BidiEventReceiver] ✓ ApprovalQueue initialized and stored in session.state")

        # Initialize session state dicts upfront (B2: consistency improvement)
        # These are used by both BidiEventSender and BidiEventReceiver
        ensure_session_state_key(session, "pending_long_running_calls", {})
        ensure_session_state_key(session, "confirmation_id_mapping", {})
        logger.info("[BidiEventReceiver] ✓ Session state dicts initialized")

        # Set mode to "bidi" for tool functions to detect mode
        session.state["mode"] = "bidi"
        logger.info("[BidiEventReceiver] ✓ Session mode set to 'bidi'")

    async def handle_event(self, event: dict[str, Any]) -> None:
        """
        Route event to appropriate handler based on event type.

        Args:
            event: WebSocket event dict with 'type' and optional 'data'
        """
        event_type = event.get("type")
        event_version = event.get("version", "unknown")

        # Ignore ping events in logs (too noisy)
        if event_type != "ping":
            logger.info(f"[BIDI] Received event: {event_type} (v{event_version})")

        # Route to specific handler
        if event_type == "message":
            await self._handle_message_event(event)
        elif event_type == "interrupt":
            await self._handle_interrupt_event(event)
        elif event_type == "audio_control":
            await self._handle_audio_control_event(event)
        elif event_type == "audio_chunk":
            await self._handle_audio_chunk_event(event)
        elif event_type == "tool_result":
            await self._handle_tool_result_event(event)
        elif event_type == "ping":
            # Ping events are handled at WebSocket layer, no action needed
            pass
        else:
            logger.warning(f"[BIDI] Unknown event type: {event_type}")

    async def _handle_message_event(self, event: dict[str, Any]) -> None:
        """
        Handle 'message' event: chat messages with text/images/tool responses.

        Steps:
        1. Sync conversation history (BUG-006 fix)
        2. Process AI SDK v6 message format → ADK format
        3. Separate image blobs from text parts
        4. Send images via send_realtime()
        5. Handle FunctionResponse specially (append to session history)
        6. Send regular text via send_content()
        """
        # Flat structure: payload fields at same level as metadata
        # Create message_data dict for process_chat_message_for_bidi compatibility
        message_data = {
            "messages": event.get("messages", []),
            "id": event.get("id"),
            "trigger": event.get("trigger"),
            "messageId": event.get("messageId"),
        }

        # Track whether any queue operation was performed
        queue_operation_performed = False

        # BUG-006 FIX: Sync history for BIDI mode
        # When switching from Gemini Direct or ADK SSE to BIDI
        messages = message_data.get("messages", [])
        if messages:
            # Convert to ChatMessage objects for sync function
            chat_messages = [ChatMessage(**msg) for msg in messages]

            # Sync conversation history
            await sync_conversation_history_to_session(
                session=self._session,
                session_service=self._ag_runner.session_service,
                messages=chat_messages,
                current_mode="BIDI",
            )

        # Process AI SDK v6 message format → ADK format
        # Separates image blobs from text parts (Live API requirement)
        # Tool confirmations handled in ChatMessage.to_adk_content()
        # Pass ID mapper for tool-result part resolution
        image_blobs, text_content = process_chat_message_for_bidi(
            message_data, id_mapper=self._delegate._id_mapper
        )

        # Send images/videos to ADK LiveRequestQueue
        for blob in image_blobs:
            self._live_request_queue.send_realtime(blob)
            queue_operation_performed = True

        # Handle text content
        if text_content:
            logger.info(
                f"[BIDI] Processing text_content with {len(text_content.parts or [])} parts"
            )

            # Check if this is a FunctionResponse (tool confirmation)
            has_function_response = any(
                hasattr(part, "function_response") and part.function_response
                for part in (text_content.parts or [])
            )

            logger.info(f"[BIDI] has_function_response={has_function_response}")

            if has_function_response:
                await self._handle_function_response(text_content)
                queue_operation_performed = True
            else:
                # Regular text messages go through LiveRequestQueue
                logger.info("[BIDI] Sending regular text via send_content()")
                self._live_request_queue.send_content(text_content)
                queue_operation_performed = True

        # Detect implementation gaps: event received but no queue operation performed
        if not queue_operation_performed:
            log_implementation_gap(
                "Message event received but NO queue operation was performed!",
                event_data=message_data,
                image_blobs_count=len(image_blobs),
                has_text_content=text_content is not None,
            )
            logger.error("[BIDI] Possible causes:")
            logger.error(
                "[BIDI]   1. New message format not handled in process_chat_message_for_bidi()"
            )
            logger.error("[BIDI]   2. Empty message_data with no content")
            logger.error("[BIDI]   3. Logic bug in event processing path")

    async def _handle_function_response(self, text_content: types.Content) -> None:
        """
        Handle FunctionResponse parts in message event.

        Simplified confirmation flow (user suggestion 2025-12-26):
        - adk_request_confirmation: Don't send to ADK, handle approval/rejection only
        - Other tools: Add to session history via append_event() OR send via send_content()

        The key insight: We don't need to tell ADK about the confirmation flow.
        We only send the FINAL tool result to ADK after user approval.
        """
        logger.info("[BIDI] Processing FunctionResponse")

        # Process each FunctionResponse part
        for part in text_content.parts or []:
            if hasattr(part, "function_response") and part.function_response:
                func_resp = part.function_response
                tool_call_id = func_resp.id
                response_data = func_resp.response

                # Handle confirmation approval: execute deferred tool
                # Don't add adk_request_confirmation to ADK session - ADK doesn't know about it
                if func_resp.name == "adk_request_confirmation":
                    logger.info("[BIDI] Handling adk_request_confirmation (not sending to ADK)")
                    if func_resp.id and response_data is not None:
                        await self._handle_confirmation_approval(func_resp.id, response_data)
                    else:
                        logger.error(
                            f"[BIDI] Invalid confirmation approval: id={func_resp.id}, "
                            f"response_data={response_data}"
                        )
                    continue

                # For non-confirmation tools, add to session history
                logger.info(f"[BIDI] Adding {func_resp.name} FunctionResponse to session history")
                event = AdkEvent(author="user", content=text_content)
                await self._ag_runner.session_service.append_event(self._session, event)
                logger.info(f"[BIDI] ✓ Added {func_resp.name} FunctionResponse to session history")

                # Resolve frontend tool request (skip if id or response is None)
                if tool_call_id and response_data is not None:
                    self._delegate.resolve_tool_result(tool_call_id, response_data)
                    logger.info(f"[BIDI] Resolved tool result for {tool_call_id}")
                    continue

                log_implementation_gap(
                    "Cannot resolve frontend request, missing id or response",
                    tool_call_id=tool_call_id,
                    response_data=response_data,
                )

            continue

    async def _handle_confirmation_approval(
        self, confirmation_id: str, response_data: dict[str, Any]
    ) -> None:
        """
        Handle confirmation approval: Route to BIDI Blocking Mode (BLOCKING) or Legacy Approval Mode.

        Args:
            confirmation_id: The ID of the confirmation FunctionResponse (lookup key)
            response_data: FunctionResponse.response dict with {"confirmed": bool} or {"approved": bool}
        """
        logger.info("=" * 80)
        logger.info("[BIDI-APPROVAL] ===== APPROVAL MESSAGE ARRIVED =====")
        logger.info(
            f"[BIDI-APPROVAL] confirmation_id={confirmation_id}, response_data={response_data}"
        )
        logger.info("=" * 80)

        # Route to appropriate handler based on approval_queue presence
        if self._session.state.get("approval_queue"):
            await self._handle_blocking_mode_approval(confirmation_id, response_data)
        else:
            await self._handle_legacy_mode_approval(confirmation_id, response_data)

    async def _handle_blocking_mode_approval(
        self, confirmation_id: str, response_data: dict[str, Any]
    ) -> None:
        """
        Handle confirmation approval in BIDI Blocking Mode mode.

        BIDI Blocking Mode (BLOCKING mode):
        - Tool is BLOCKING and awaiting approval via approval_queue
        - Submit approval decision to approval_queue
        - Tool function will resume and return final result

        Args:
            confirmation_id: The ID of the confirmation FunctionResponse (lookup key)
            response_data: FunctionResponse.response dict with {"confirmed": bool} or {"approved": bool}
        """
        logger.info("[BIDI-APPROVAL] BIDI Blocking Mode: BLOCKING mode detected (approval_queue exists)")

        approval_queue: ApprovalQueue | None = self._session.state.get("approval_queue")
        if approval_queue is None:
            # This should never happen - caller verified approval_queue exists
            logger.error("[BIDI-APPROVAL] BIDI Blocking Mode: approval_queue unexpectedly None")
            return

        # Look up original tool_call_id using confirmation_id
        confirmation_id_mapping = self._session.state.get("confirmation_id_mapping", {})
        original_tool_call_id = confirmation_id_mapping.get(confirmation_id)

        if not original_tool_call_id:
            logger.error(
                f"[BIDI-APPROVAL] BIDI Blocking Mode: confirmation_id {confirmation_id} not found in mapping"
            )
            return

        # Extract approval decision (try both "confirmed" and "approved" fields for compatibility)
        approved = response_data.get("approved", response_data.get("confirmed", False))

        logger.info(
            f"[BIDI-APPROVAL] BIDI Blocking Mode: Submitting to approval_queue: "
            f"tool_call_id={original_tool_call_id}, approved={approved}"
        )

        # Submit to approval_queue (this unblocks the BLOCKING tool function)
        approval_queue.submit_approval(original_tool_call_id, approved)

        # Clean up pending_long_running_calls to allow final tool-output-available to be sent
        # IMPORTANT: Without this, BidiEventSender will skip the final result event
        pending_calls = self._session.state.get("pending_long_running_calls", {})
        if original_tool_call_id in pending_calls:
            del pending_calls[original_tool_call_id]
            logger.info(
                f"[BIDI-APPROVAL] BIDI Blocking Mode: Removed {original_tool_call_id} from pending_long_running_calls"
            )

        # Clean up confirmation mapping
        del confirmation_id_mapping[confirmation_id]
        logger.info(
            f"[BIDI-APPROVAL] BIDI Blocking Mode: Cleaned up confirmation mapping for {confirmation_id}"
        )

        logger.info("[BIDI-APPROVAL] BIDI Blocking Mode: ✓ Approval decision submitted to ApprovalQueue")
        logger.info("[BIDI-APPROVAL] BIDI Blocking Mode: Tool will resume and return final result")

    async def _handle_legacy_mode_approval(
        self, confirmation_id: str, response_data: dict[str, Any]
    ) -> None:
        """
        Handle confirmation approval in Legacy Approval Mode (LongRunningFunctionTool).

        Legacy Approval Mode (LongRunningFunctionTool):
        - Tool returned pending status without execution
        - Server executes actual tool logic after approval
        - Server sends FunctionResponse with execution result to ADK

        Args:
            confirmation_id: The ID of the confirmation FunctionResponse (lookup key)
            response_data: FunctionResponse.response dict with {"confirmed": bool}
        """
        logger.info("[BIDI-APPROVAL] Legacy Approval Mode: LongRunningFunctionTool (no approval_queue)")

        # Look up original tool_call_id using confirmation_id from session.state
        try:  # nosemgrep: forbid-try-except - legitimate session.state access with KeyError handling
            confirmation_id_mapping = self._session.state["confirmation_id_mapping"]
            logger.info(
                f"[BIDI-APPROVAL] confirmation_id_mapping keys: {list(confirmation_id_mapping.keys())}"
            )
        except KeyError as e:
            logger.error(
                f"[BIDI-APPROVAL] KeyError accessing confirmation_id_mapping: {e}. "
                f"session.state keys: {list(self._session.state.keys())}"
            )
            return

        if confirmation_id not in confirmation_id_mapping:
            logger.error(
                f"[BIDI-APPROVAL] confirmation_id {confirmation_id} not found in mapping. "
                f"Available keys: {list(confirmation_id_mapping.keys())}"
            )
            return

        # Get original tool_call_id
        tool_call_id = confirmation_id_mapping[confirmation_id]
        logger.info(
            f"[BIDI-APPROVAL] Resolved confirmation mapping: {confirmation_id} → {tool_call_id}"
        )

        # Extract approval status
        # response_data is {"confirmed": True/False} from ai_sdk_v6_compat.py
        approved = response_data.get("confirmed", False)
        logger.info(f"[BIDI-APPROVAL] Approval status: {approved}")

        # ===== GET PENDING LONG-RUNNING CALL DETAILS =====
        pending_calls = self._session.state.get("pending_long_running_calls", {})
        if tool_call_id not in pending_calls:
            logger.error(
                f"[BIDI-APPROVAL] tool_call_id {tool_call_id} not found in pending_long_running_calls. "
                f"Available keys: {list(pending_calls.keys())}"
            )
            return

        pending_call = pending_calls[tool_call_id]
        tool_name = pending_call["name"]
        tool_args = pending_call["args"]

        logger.info("=" * 80)
        logger.info("[BIDI-APPROVAL] ===== EXECUTING TOOL LOGIC (Legacy Approval Mode) =====")
        logger.info(f"[BIDI-APPROVAL] tool_name={tool_name}, args={tool_args}, approved={approved}")
        logger.info("=" * 80)

        # Execute tool logic
        result = await self._execute_legacy_tool(tool_name, tool_args, approved)
        logger.info(f"[BIDI-APPROVAL] Execution result: {result}")

        # Send FunctionResponse to ADK
        await self._send_function_response_to_adk(tool_call_id, tool_name, result)

        # Clean up mappings
        del confirmation_id_mapping[confirmation_id]
        del pending_calls[tool_call_id]
        logger.info(f"[BIDI-APPROVAL] Cleaned up mappings for {tool_call_id}")

    async def _execute_legacy_tool(
        self, tool_name: str, tool_args: dict[str, Any], approved: bool
    ) -> dict[str, Any]:
        """
        Execute tool logic for Legacy Approval Mode.

        Args:
            tool_name: Name of the tool to execute
            tool_args: Arguments for the tool
            approved: Whether user approved the tool execution

        Returns:
            Tool execution result dict
        """
        if approved:
            # Execute actual tool logic
            if tool_name == "process_payment":
                return execute_process_payment(**tool_args)
            elif tool_name == "get_location":
                return await execute_get_location(self._session.id)
            else:
                logger.error(f"[BIDI-APPROVAL] Unknown tool name: {tool_name}")
                return {"success": False, "error": f"Unknown tool: {tool_name}"}
        else:
            # User rejected - create error response
            logger.info(f"[BIDI-APPROVAL] User rejected {tool_name}")
            if tool_name == "process_payment":
                return {
                    "success": False,
                    "error": "Payment rejected by user",
                    "transaction_id": None,
                }
            elif tool_name == "get_location":
                return {"success": False, "error": "Location access rejected by user"}
            else:
                return {"success": False, "error": f"{tool_name} rejected by user"}

    async def _send_function_response_to_adk(
        self, tool_call_id: str, tool_name: str, result: dict[str, Any]
    ) -> None:
        """
        Send FunctionResponse to ADK via LiveRequestQueue.

        Args:
            tool_call_id: Original tool call ID
            tool_name: Name of the tool
            result: Tool execution result
        """
        logger.info("=" * 80)
        logger.info("[BIDI-APPROVAL] ===== SENDING FUNCTIONRESPONSE TO ADK =====")
        logger.info(f"[BIDI-APPROVAL] id={tool_call_id}, name={tool_name}")
        logger.info("=" * 80)

        # Create FunctionResponse with same id and name as original FunctionCall
        function_response = types.Content(
            role="user",
            parts=[
                types.Part(
                    function_response=types.FunctionResponse(
                        id=tool_call_id, name=tool_name, response=result
                    )
                )
            ],
        )

        # Send to ADK via LiveRequestQueue
        self._live_request_queue.send_content(function_response)

        logger.info("[BIDI-APPROVAL] ✓ FunctionResponse sent to ADK")
        logger.info("[BIDI-APPROVAL] ADK will continue execution with this result")

    async def _handle_interrupt_event(self, event: dict[str, Any]) -> None:
        """
        Handle 'interrupt' event: user interruption during streaming.

        Per ADK documentation: Interrupt is a conversation state change, not connection termination.
        - Frontend should stop rendering current partial response
        - LiveRequestQueue remains open for continued interaction
        - Queue.close() should only be called in finally block (session end)

        Reference: https://google.github.io/adk-docs/streaming/dev-guide/part3/
        """
        reason = event.get("reason", "user_abort")
        logger.info(f"[BIDI] User interrupted (reason: {reason})")
        logger.info("[BIDI] Note: LiveRequestQueue remains open, interrupt is a state change only")

    async def _handle_audio_control_event(self, event: dict[str, Any]) -> None:
        """
        Handle 'audio_control' event: audio input start/stop.

        Tracks audio recording state (CMD key press/release).
        Actual audio chunks are streamed separately via audio_chunk events.
        """
        action = event.get("action")
        if action == "start":
            logger.info("[BIDI] Audio input started (CMD key pressed)")
        elif action == "stop":
            logger.info("[BIDI] Audio input stopped (CMD key released, auto-send)")
        # Note: Audio chunks are streamed separately via audio_chunk events
        # ADK processes the audio in real-time through LiveRequestQueue

    async def _handle_audio_chunk_event(self, event: dict[str, Any]) -> None:
        """
        Handle 'audio_chunk' event: streaming audio data.

        Frontend sends raw PCM audio via AudioWorklet:
        - Format: 16-bit signed integer, 16kHz, mono
        - Encoded: base64
        - Sent to ADK via LiveRequestQueue
        """
        # Flat structure: payload fields at same level as metadata
        chunk_base64 = event.get("chunk")

        if chunk_base64:
            # Decode base64 PCM audio data
            audio_bytes = base64.b64decode(chunk_base64)

            # Frontend now sends raw PCM audio via AudioWorklet
            # Format: 16-bit signed integer, 16kHz, mono
            # This matches ADK Live API requirements

            # Create audio blob for ADK
            # Using audio/pcm mime type (raw PCM from AudioWorklet)
            audio_blob = types.Blob(mime_type="audio/pcm", data=audio_bytes)

            # Send to ADK via LiveRequestQueue
            self._live_request_queue.send_realtime(audio_blob)

    async def _handle_tool_result_event(self, event: dict[str, Any]) -> None:
        """
        Handle 'tool_result' event: frontend tool execution result.

        Resolves pending FrontendToolDelegate.execute_on_frontend() calls.
        This event is sent by frontend after executing tools like get_location, change_bgm.
        """
        # Flat structure: payload fields at same level as metadata
        tool_call_id = event.get("toolCallId")
        result = event.get("result")

        if tool_call_id and result:
            self._delegate.resolve_tool_result(tool_call_id, result)
            logger.info(f"[BIDI] Resolved tool result for {tool_call_id}")
            return

        log_implementation_gap(
            "Invalid tool_result event. should have toolCallId and result",
            event=event,
        )
