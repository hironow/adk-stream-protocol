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

from adk_compat import sync_conversation_history_to_session
from ai_sdk_v6_compat import ChatMessage, process_chat_message_for_bidi
from services.frontend_tool_service import FrontendToolDelegate
from stream_protocol import Event


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
            session: ADK Session object
            frontend_delegate: Frontend tool delegate for tool execution
            live_request_queue: ADK LiveRequestQueue for sending data to Live API
            bidi_agent_runner: ADK Runner with session_service
        """
        self._session = session
        self._delegate = frontend_delegate
        self._live_request_queue = live_request_queue
        self._ag_runner = bidi_agent_runner

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
        message_data = event.get("data", {})

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
        image_blobs, text_content = process_chat_message_for_bidi(message_data)

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
            logger.error("[BIDI] ========== IMPLEMENTATION GAP DETECTED ==========")
            logger.error("[BIDI] Message event received but NO queue operation was performed!")
            logger.error(f"[BIDI] Event data: {message_data}")
            logger.error(
                f"[BIDI] image_blobs count: {len(image_blobs)}, text_content: {text_content is not None}"
            )
            logger.error(
                "[BIDI] This likely indicates a missing implementation for this event structure."
            )
            logger.error("[BIDI] Possible causes:")
            logger.error(
                "[BIDI]   1. New message format not handled in process_chat_message_for_bidi()"
            )
            logger.error("[BIDI]   2. Empty message_data with no content")
            logger.error("[BIDI]   3. Logic bug in event processing path")
            logger.error("[BIDI] =================================================")

    async def _handle_function_response(self, text_content: types.Content) -> None:
        """
        Handle FunctionResponse parts in message event.

        FunctionResponse must be added to session history, not sent via send_content().
        ADK documentation: "send_content() is for text; FunctionResponse handled automatically"
        This matches SSE mode behavior.

        Reference: experiments/2025-12-18_bidi_function_response_investigation.md
        """
        logger.info("[BIDI] Creating Event with FunctionResponse, author='user'")
        event = Event(author="user", content=text_content)

        logger.info(
            f"[BIDI] Calling session_service.append_event() with session={self._session.id}"
        )
        await self._ag_runner.session_service.append_event(self._session, event)
        logger.info(
            "[BIDI] ✓ Successfully added FunctionResponse to session history via append_event()"
        )

        for part in text_content.parts or []:
            if hasattr(part, "function_response") and part.function_response:
                func_resp = part.function_response
                tool_call_id = func_resp.id
                response_data = func_resp.response

                # Resolve frontend tool request (skip if id or response is None)
                if tool_call_id and response_data is not None:
                    self._delegate.resolve_tool_result(tool_call_id, response_data)
                    logger.info(f"[BIDI] Resolved tool result for {tool_call_id}")
                    continue

                logger.error("[BIDI] ========== IMPLEMENTATION GAP DETECTED ==========")
                logger.error(
                    f"[BIDI] Cannot resolve frontend request, missing id or response: "
                    f"tool_call_id={tool_call_id}, response_data={response_data}"
                )

            continue

    async def _handle_interrupt_event(self, event: dict[str, Any]) -> None:
        """
        Handle 'interrupt' event: user cancellation.

        Closes the LiveRequestQueue to stop AI generation.
        WebSocket stays open for next turn.
        """
        reason = event.get("reason", "user_abort")
        logger.info(f"[BIDI] User interrupted (reason: {reason})")

        # Close the request queue to stop AI generation
        self._live_request_queue.close()
        # Note: WebSocket stays open for next turn

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
        chunk_data = event.get("data", {})
        chunk_base64 = chunk_data.get("chunk")

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
        tool_result_data = event.get("data", {})
        tool_call_id = tool_result_data.get("toolCallId")
        result = tool_result_data.get("result")

        if tool_call_id and result:
            self._delegate.resolve_tool_result(tool_call_id, result)
            logger.info(f"[BIDI] Resolved tool result for {tool_call_id}")
            return

        logger.error("[BIDI] ========== IMPLEMENTATION GAP DETECTED ==========")
        logger.error(
            f"[BIDI] Invalid tool_result event. should have toolCallId and result: {event}"
        )
