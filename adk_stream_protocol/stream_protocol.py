"""
ADK to AI SDK v6 Data Stream Protocol Converter

This module provides utilities to convert ADK agent events to
AI SDK v6 Data Stream Protocol format (SSE).

IMPORTANT: This converter is used by BOTH streaming modes:
  1. SSE Mode (/stream endpoint):
     - ADK events → SSE format → HTTP SSE → Browser EventSource
  2. BIDI Mode (/live WebSocket endpoint):
     - ADK events → SSE format → WebSocket → WebSocketChatTransport

The same conversion logic is reused in both cases.
Only the transport layer differs (HTTP SSE vs WebSocket).
This ensures protocol consistency across all modes.
"""

import base64
import enum
import json
import uuid
from collections.abc import AsyncGenerator
from typing import Any

from google.adk.events import Event
from google.genai import types
from loguru import logger

from .chunk_logger import Mode, chunk_logger


# Type alias for SSE-formatted event strings
# Example: 'data: {"type":"text-delta","id":"1","delta":"Hello"}\n\n'
type SseFormattedEvent = str

# Log truncation threshold for base64 and long content fields
LOG_FIELD_TRUNCATE_THRESHOLD = 20
# Maximum length for debug log messages before truncation
DEBUG_LOG_MAX_LENGTH = 100


def format_sse_event(event_data: dict[str, Any]) -> SseFormattedEvent:
    """
    Format event data as SSE-formatted string.

    This function is used by:
    - StreamProtocolConverter: For converting ADK events
    - BidiEventSender: For formatting confirmation events
    - SseEventStreamer: For formatting confirmation events

    Args:
        event_data: Event data dictionary (AI SDK v6 format)

    Returns:
        SSE-formatted string: 'data: {...}\\n\\n'
    """
    # Debug: Log event before SSE formatting
    # For binary data events, truncate the content to avoid huge logs
    log_data = event_data
    event_type = event_data.get("type")

    # Handle data-pcm, data-audio, and data-image events with large binary content
    if event_type in {"data-pcm", "data-audio", "data-image"} and "data" in event_data:
        log_data = event_data.copy()
        data_copy = log_data["data"].copy()

        # Truncate base64 content fields
        for field in ["content", "data", "url"]:
            if (
                field in data_copy
                and isinstance(data_copy[field], str)
                and len(data_copy[field]) > LOG_FIELD_TRUNCATE_THRESHOLD
            ):
                data_copy[field] = (
                    f"{data_copy[field][:50]}... (truncated {len(data_copy[field])} chars)"
                )

        log_data["data"] = data_copy

    # If log_data is too long, show only the beginning
    # logger.debug(
    #     f"[ADK→SSE] {str(log_data)[:DEBUG_LOG_MAX_LENGTH]}"
    #     f"{'... (truncated)' if len(str(log_data)) > DEBUG_LOG_MAX_LENGTH else ''}"
    # )
    return f"data: {json.dumps(event_data)}\n\n"


class AISdkFinishReason(str, enum.Enum):
    """
    AI SDK v6 FinishReason values.

    Based on: https://sdk.vercel.ai/docs/ai-sdk-core/language-model#finishreason

    These are the target values that ADK FinishReasons are mapped to.
    """

    STOP = "stop"
    LENGTH = "length"
    CONTENT_FILTER = "content-filter"
    TOOL_CALLS = "tool-calls"
    ERROR = "error"
    OTHER = "other"


def _map_adk_finish_reason_to_ai_sdk(finish_reason: types.FinishReason | None) -> str:
    """
    Map ADK FinishReason enum to AI SDK v6 finish reason string.

    ADK uses types.FinishReason enum (e.g., types.FinishReason.STOP)
    AI SDK v6 expects AISdkFinishReason values: stop, length, content-filter, error, other

    Mappings:
        - STOP, FINISH_REASON_UNSPECIFIED → stop
        - MAX_TOKENS → length
        - SAFETY, RECITATION, BLOCKLIST, PROHIBITED_CONTENT, SPII → content-filter
        - IMAGE_SAFETY, IMAGE_RECITATION, IMAGE_PROHIBITED_CONTENT → content-filter
        - LANGUAGE → content-filter
        - MALFORMED_FUNCTION_CALL, NO_IMAGE, UNEXPECTED_TOOL_CALL → error
        - OTHER, IMAGE_OTHER → other
        - Unknown → lowercase fallback
    """
    if not finish_reason:
        return AISdkFinishReason.STOP.value

    # Map ADK finish reasons to AI SDK v6 format
    # Complete mapping for all types.FinishReason enum values using enum members
    reason_map: dict[types.FinishReason, AISdkFinishReason] = {
        # Standard completion reasons
        types.FinishReason.STOP: AISdkFinishReason.STOP,
        types.FinishReason.FINISH_REASON_UNSPECIFIED: AISdkFinishReason.STOP,
        types.FinishReason.MAX_TOKENS: AISdkFinishReason.LENGTH,
        types.FinishReason.OTHER: AISdkFinishReason.OTHER,
        # Content filtering (text)
        types.FinishReason.SAFETY: AISdkFinishReason.CONTENT_FILTER,
        types.FinishReason.RECITATION: AISdkFinishReason.CONTENT_FILTER,
        types.FinishReason.BLOCKLIST: AISdkFinishReason.CONTENT_FILTER,
        types.FinishReason.PROHIBITED_CONTENT: AISdkFinishReason.CONTENT_FILTER,
        types.FinishReason.SPII: AISdkFinishReason.CONTENT_FILTER,
        # Content filtering (image)
        types.FinishReason.IMAGE_SAFETY: AISdkFinishReason.CONTENT_FILTER,
        types.FinishReason.IMAGE_RECITATION: AISdkFinishReason.CONTENT_FILTER,
        types.FinishReason.IMAGE_PROHIBITED_CONTENT: AISdkFinishReason.CONTENT_FILTER,
        # Language restrictions
        types.FinishReason.LANGUAGE: AISdkFinishReason.CONTENT_FILTER,
        # Image-related other
        types.FinishReason.IMAGE_OTHER: AISdkFinishReason.OTHER,
        # Tool/function call errors
        types.FinishReason.MALFORMED_FUNCTION_CALL: AISdkFinishReason.ERROR,
        types.FinishReason.UNEXPECTED_TOOL_CALL: AISdkFinishReason.ERROR,
        # Missing requirements
        types.FinishReason.NO_IMAGE: AISdkFinishReason.ERROR,
    }

    # Return mapped value or default to lowercase name
    if finish_reason in reason_map:
        return reason_map[finish_reason].value
    # Fallback for unknown reasons
    reason_name = getattr(finish_reason, "name", str(finish_reason))
    return reason_name.lower()


class StreamProtocolConverter:
    """
    Converts ADK agent events to AI SDK v6 Data Stream Protocol.

    Supports:
    - Text streaming (text-start/delta/end)
    - Tool calls (function_call)
    - Tool results (function_response)
    - Reasoning (thought)
    - Dynamic finish reasons
    - Usage metadata
    """

    def __init__(
        self,
        message_id: str | None = None,
        agent_model: str | None = None,
    ):
        """
        Initialize converter.

        Args:
            message_id: Optional message ID. Generated if not provided.
            agent_model: Optional agent model name for modelVersion fallback.
        """
        self.message_id = message_id or str(uuid.uuid4())
        self.agent_model = agent_model
        self.part_id_counter = 0
        self.tool_call_id_counter = 0
        self.has_started = False
        # Track PCM streaming stats
        self.pcm_chunk_count = 0
        self.pcm_total_bytes = 0
        self.pcm_sample_rate: int | None = None
        # Map function names to tool call IDs for matching calls with results
        self.tool_call_id_map: dict[str, str] = {}
        # Track input transcription text blocks (user audio input in BIDI mode)
        self._input_text_block_id: str | None = None
        self._input_text_block_started = False
        # Track output transcription text blocks (AI audio response in native-audio models)
        self._output_text_block_id: str | None = None
        self._output_text_block_started = False
        # Track cumulative output transcription text to filter duplicate final summary
        # Gemini 2.0 sends final transcription with finished=True containing full text
        self._output_transcription_accumulated = ""
        # Track ALL reasoning texts to filter duplicate text-delta events
        # In BIDI mode, Gemini 2.0 sometimes sends reasoning parts followed by a text part
        # containing the concatenation of all reasoning parts
        self._accumulated_reasoning_texts: list[str] = []

        # Track metadata for BIDI mode finalization
        # In BIDI mode (WebSocket), stream doesn't end until connection closes,
        # so finally block in stream_adk_to_ai_sdk doesn't execute per turn.
        # We need to accumulate metadata in the converter instance instead.
        self._usage_metadata: Any | None = None
        self._finish_reason: Any | None = None
        self._grounding_metadata: Any | None = None
        self._citation_metadata: Any | None = None
        self._cache_metadata: Any | None = None
        self._model_version: str | None = None

    def _generate_part_id(self) -> str:
        """Generate unique part ID."""
        part_id = str(self.part_id_counter)
        self.part_id_counter += 1
        return part_id

    def _generate_tool_call_id(self) -> str:
        """Generate unique tool call ID."""
        tool_call_id = f"call_{self.tool_call_id_counter}"
        self.tool_call_id_counter += 1
        return tool_call_id

    @staticmethod
    def format_sse_event(event_data: dict) -> str:
        """Format event data as SSE. Delegates to module-level format_sse_event()."""
        return format_sse_event(event_data)

    async def _convert_event(self, event: Event) -> AsyncGenerator[str]:  # noqa: C901, PLR0912, PLR0915
        """
        Convert a single ADK event to AI SDK v6 SSE events.

        Args:
            event: ADK Event object

        Yields:
            SSE-formatted event strings
        """
        # Check for errors FIRST (before any other processing)
        if hasattr(event, "error_code") and event.error_code:
            error_message = getattr(event, "error_message", None) or "Unknown error"
            logger.error(f"[ERROR] ADK error detected: {event.error_code} - {error_message}")
            yield self.format_sse_event(
                {
                    "type": "error",
                    "error": {"code": event.error_code, "message": error_message},
                }
            )
            return

        # Accumulate metadata from events for BIDI mode finalization
        # In BIDI mode, usage_metadata may arrive in a different event than turn_complete
        if hasattr(event, "usage_metadata") and event.usage_metadata:
            self._usage_metadata = event.usage_metadata
            logger.info(f"[CONVERTER] Accumulated usage_metadata: {self._usage_metadata!r}")
        if hasattr(event, "finish_reason") and event.finish_reason:
            self._finish_reason = event.finish_reason
        if hasattr(event, "grounding_metadata") and event.grounding_metadata:
            self._grounding_metadata = event.grounding_metadata
        if hasattr(event, "citation_metadata") and event.citation_metadata:
            self._citation_metadata = event.citation_metadata
        if hasattr(event, "cache_metadata") and event.cache_metadata:
            self._cache_metadata = event.cache_metadata
        if hasattr(event, "model_version") and event.model_version:
            self._model_version = event.model_version
            logger.debug(f"[CONVERTER] Accumulated model_version: {self._model_version}")
        elif not self._model_version and self.agent_model:
            # Use agent_model as fallback only if not already set
            self._model_version = self.agent_model
            logger.debug(f"[CONVERTER] Using agent_model fallback: {self._model_version}")

        has_content = hasattr(event, "content") and event.content

        # Log content parts if present
        if has_content and event.content is not None and event.content.parts:
            for _idx, part in enumerate(event.content.parts):
                part_types = []
                if hasattr(part, "text") and part.text:
                    part_types.append(f"text({len(part.text)} chars)")
                if hasattr(part, "thought") and part.thought:
                    part_types.append("thought")
                if hasattr(part, "function_call") and part.function_call:
                    part_types.append(f"function_call({part.function_call.name})")
                if hasattr(part, "function_response") and part.function_response:
                    part_types.append(f"function_response({part.function_response.name})")
                if hasattr(part, "inline_data") and part.inline_data:
                    part_types.append("inline_data")
                if hasattr(part, "executable_code") and part.executable_code:
                    part_types.append("executable_code")
                if hasattr(part, "code_execution_result") and part.code_execution_result:
                    part_types.append("code_execution_result")

        # Send start event on first event
        if not self.has_started:
            yield self.format_sse_event({"type": "start", "messageId": self.message_id})
            self.has_started = True

        # Process event content parts
        if event.content and event.content.parts:
            for part in event.content.parts:
                # Thought/Reasoning content (Gemini 2.0)
                # - thought (boolean): indicates if this is a thought summary
                # - text (string): contains the actual reasoning content when thought=True
                if (
                    hasattr(part, "thought")
                    and part.thought is True
                    and hasattr(part, "text")
                    and part.text
                ):
                    logger.info(
                        f"[THOUGHT PART] Processing thought text: length={len(part.text)}, preview='{part.text[:50]}...'"
                    )
                    # Accumulate reasoning text to filter duplicate text-delta
                    self._accumulated_reasoning_texts.append(part.text)
                    for sse_event in self._process_thought_part(part.text):
                        yield sse_event
                # Text content (regular answer when thought=False or None)
                elif hasattr(part, "text") and part.text:
                    # Filter duplicate text-delta if it matches accumulated reasoning texts
                    # This handles BIDI mode where Gemini 2.0 sends reasoning parts followed by text parts
                    # containing either:
                    # 1. The concatenation of all reasoning texts
                    # 2. Individual reasoning texts repeated as separate text parts
                    should_skip = False
                    if self._accumulated_reasoning_texts:
                        # Check if text matches concatenation of all reasoning texts
                        accumulated_reasoning = "".join(self._accumulated_reasoning_texts)
                        if part.text == accumulated_reasoning:
                            logger.info(
                                f"[TEXT PART] Filtering duplicate text-delta (matches concatenated reasoning): "
                                f"length={len(part.text)}, reasoning_parts={len(self._accumulated_reasoning_texts)}, "
                                f"preview='{part.text[:50]}...'"
                            )
                            should_skip = True

                        # Also check if text matches any individual reasoning text
                        if not should_skip:
                            for idx, reasoning_text in enumerate(self._accumulated_reasoning_texts):
                                if part.text == reasoning_text:
                                    logger.info(
                                        f"[TEXT PART] Filtering duplicate text-delta (matches reasoning[{idx}]): "
                                        f"length={len(part.text)}, preview='{part.text[:50]}...'"
                                    )
                                    should_skip = True
                                    break

                    if should_skip:
                        continue

                    thought_value = getattr(part, "thought", None)
                    logger.info(
                        f"[TEXT PART] Processing text (thought={thought_value}): length={len(part.text)}, preview='{part.text[:50]}...'"
                    )
                    for sse_event in self._process_text_part(part.text):
                        yield sse_event

                # Function call (Tool call)
                if hasattr(part, "function_call") and part.function_call:
                    for sse_event in self._process_function_call(part.function_call):
                        yield sse_event

                # Function response (Tool result)
                if hasattr(part, "function_response") and part.function_response:
                    for sse_event in self._process_function_response(part.function_response):
                        yield sse_event

                # Code execution
                if hasattr(part, "executable_code") and part.executable_code:
                    for sse_event in self._process_executable_code(part.executable_code):
                        yield sse_event

                if hasattr(part, "code_execution_result") and part.code_execution_result:
                    for sse_event in self._process_code_result(part.code_execution_result):
                        yield sse_event

                # Inline data (images, etc.)
                if (
                    hasattr(part, "inline_data")
                    and part.inline_data
                    and isinstance(part.inline_data, types.Blob)
                ):
                    # logger.info("[INLINE DATA] Processing inline data part")
                    for sse_event in self._process_inline_data_part(part.inline_data):
                        yield sse_event

        # ========================================================================
        # [P3-T1] Live API Transcriptions - Input Transcription
        # ========================================================================
        # Handles user audio input transcription in BIDI mode (ADK Live API).
        # When user speaks, ADK generates input_transcription events with the
        # recognized text. This converts it to AI SDK v6 text-delta events.
        #
        # Flow: User speaks → ADK Live API → input_transcription event
        #       → text-start/text-delta/text-end → Frontend displays as text
        #
        # Reference: server.py:800 - input_audio_transcription config
        # ========================================================================
        if hasattr(event, "input_transcription") and event.input_transcription:
            transcription = event.input_transcription
            if hasattr(transcription, "text") and transcription.text:
                logger.debug(
                    f"[INPUT TRANSCRIPTION] text='{transcription.text}', finished={getattr(transcription, 'finished', None)}"
                )

                # Send text-start if this is the first transcription chunk
                if not self._input_text_block_started:
                    self._input_text_block_id = f"{self.message_id}_input_text"
                    self._input_text_block_started = True
                    yield self.format_sse_event(
                        {"type": "text-start", "id": self._input_text_block_id}
                    )

                # Send text-delta with the transcription text (AI SDK v6 protocol)
                yield self.format_sse_event(
                    {
                        "type": "text-delta",
                        "id": self._input_text_block_id,
                        "delta": transcription.text,
                    }
                )

                # Send text-end if transcription is finished
                if hasattr(transcription, "finished") and transcription.finished:
                    yield self.format_sse_event(
                        {"type": "text-end", "id": self._input_text_block_id}
                    )
                    self._input_text_block_started = False

        # ========================================================================
        # [P3-T1] Live API Transcriptions - Output Transcription
        # ========================================================================
        # Handles AI audio output transcription from native-audio models.
        # When AI speaks (audio response), models like Gemini 2.0 Flash can
        # generate output_transcription events with the spoken text.
        #
        # Flow: AI audio response → Native-audio model → output_transcription
        #       → text-start/text-delta/text-end → Frontend displays as text
        #
        # Reference: server.py:801 - output_audio_transcription config
        # Note: Only available with native-audio models (AUDIO modality)
        # ========================================================================
        if hasattr(event, "output_transcription") and event.output_transcription:
            transcription = event.output_transcription
            if hasattr(transcription, "text") and transcription.text:
                finished = getattr(transcription, "finished", None)
                text_length = len(transcription.text)
                logger.info(
                    f"[OUTPUT TRANSCRIPTION] text_length={text_length}, "
                    f"finished={finished}, "
                    f"accumulated_length={len(self._output_transcription_accumulated)}, "
                    f"text_preview='{transcription.text[:100]}...'"
                )

                # Check if this is final transcription with full text (Gemini 2.0 behavior)
                # If finished=True and text matches accumulated, skip (duplicate summary)
                if finished and transcription.text == self._output_transcription_accumulated:
                    logger.info(
                        "[OUTPUT TRANSCRIPTION] Filtering duplicate final summary "
                        "(finished=True, matches accumulated text)"
                    )
                    # Send text-end and skip text-delta
                    yield self.format_sse_event(
                        {"type": "text-end", "id": self._output_text_block_id}
                    )
                    self._output_text_block_started = False
                    # Don't send text-delta for this duplicate
                else:
                    # Send text-start if this is the first transcription chunk
                    if not self._output_text_block_started:
                        self._output_text_block_id = f"{self.message_id}_output_text"
                        self._output_text_block_started = True
                        yield self.format_sse_event(
                            {"type": "text-start", "id": self._output_text_block_id}
                        )

                    # Send text-delta with the transcription text (AI SDK v6 protocol)
                    yield self.format_sse_event(
                        {
                            "type": "text-delta",
                            "id": self._output_text_block_id,
                            "delta": transcription.text,
                        }
                    )

                    # Accumulate text for duplicate detection
                    self._output_transcription_accumulated += transcription.text

                    # Send text-end if transcription is finished
                    if hasattr(transcription, "finished") and transcription.finished:
                        yield self.format_sse_event(
                            {"type": "text-end", "id": self._output_text_block_id}
                        )
                        self._output_text_block_started = False

        # BIDI mode: Handle turn completion within convert_event
        # This ensures content and turn_complete are processed in correct order
        if hasattr(event, "turn_complete") and event.turn_complete:
            logger.info("[TURN COMPLETE] Detected turn_complete in convert_event")

            # Use accumulated metadata from instance variables
            # In BIDI mode, usage_metadata may have arrived in a previous event
            logger.info(
                f"[TURN COMPLETE] Using accumulated metadata - usage: {self._usage_metadata!r}"
            )

            # Send finish event with accumulated metadata
            async for final_event in self.finalize(
                usage_metadata=self._usage_metadata,
                error=None,
                finish_reason=self._finish_reason,
                grounding_metadata=self._grounding_metadata,
                citation_metadata=self._citation_metadata,
                cache_metadata=self._cache_metadata,
                model_version=self._model_version,
            ):
                yield final_event

    def _create_streaming_events(
        self,
        event_type_prefix: str,
        content: str,
        log_prefix: str | None = None,
    ) -> list[str]:
        """
        Generic helper for start/delta/end event sequences.

        Args:
            event_type_prefix: Prefix for event types (e.g., "text", "reasoning")
            content: Content to stream
            log_prefix: Optional logging prefix (e.g., "[TEXT PART]")

        Returns:
            List of SSE-formatted events
        """
        part_id = self._generate_part_id()

        events = [
            self.format_sse_event({"type": f"{event_type_prefix}-start", "id": part_id}),
            self.format_sse_event(
                {"type": f"{event_type_prefix}-delta", "id": part_id, "delta": content}
            ),
            self.format_sse_event({"type": f"{event_type_prefix}-end", "id": part_id}),
        ]
        return events

    def _process_text_part(self, text: str) -> list[str]:
        """Process text part into text-* events."""
        return self._create_streaming_events("text", text, log_prefix="[TEXT PART]")

    def _process_thought_part(self, thought: str) -> list[str]:
        """Process thought part into reasoning-* events."""
        return self._create_streaming_events("reasoning", thought)

    @staticmethod
    def format_tool_approval_request(original_tool_call_id: str, approval_id: str) -> str:
        """Generate tool-approval-request event (AI SDK v6 standard).

        This method centralizes the generation of tool-approval-request events,
        ensuring consistent format across SSE and BIDI modes.

        Args:
            original_tool_call_id: ID of the original tool call that needs approval
                (e.g., the get_location or process_payment tool call ID)
            approval_id: Unique ID for this approval request
                (e.g., adk_request_confirmation's tool call ID)

        Returns:
            SSE-formatted tool-approval-request event string

        Reference:
            - ADR 0002: Tool Approval Architecture
            - AI SDK v6: tool-approval-request event specification
        """
        import json

        event_data = {
            "type": "tool-approval-request",
            "toolCallId": original_tool_call_id,  # Must match the original tool's ID
            "approvalId": approval_id,  # Unique ID for this approval request
        }
        return f"data: {json.dumps(event_data)}\n\n"

    def _process_function_call(self, function_call: types.FunctionCall) -> list[str]:
        """
        Process FunctionCall and generate AI SDK v6 SSE events.

        For ADK RequestConfirmation
        - adk_request_confirmation is exposed as a regular tool call
        - Frontend shows approval UI for this tool call
        - User approval/denial is sent back as FunctionResponse for adk_request_confirmation

        Args:
            function_call: ADK FunctionCall object

        Returns:
            List of SSE event strings
        """
        tool_name = function_call.name
        tool_call_id = function_call.id
        tool_args = dict(function_call.args) if function_call.args else {}

        logger.debug(f"[TOOL CALL] {tool_name}(id={tool_call_id}, args={tool_args})")

        # adk_request_confirmation is treated as a regular tool call
        # No special processing needed here - frontend handles it via lib/adk_compat.ts
        # Backend conversion happens in ai_sdk_v6_compat.py
        # Reference: assets/adk/action-confirmation.txt, experiments/2025-12-17_tool_architecture_refactoring.md

        # Store mapping so function_response can use the same ID
        if tool_name and tool_call_id:
            self.tool_call_id_map[tool_name] = tool_call_id

        # Debug: Log tool_args for adk_request_confirmation
        if tool_name == "adk_request_confirmation":
            logger.info(f"[DEBUG] adk_request_confirmation tool_args: {tool_args}")

        # For adk_request_confirmation: Send ONLY tool-approval-request (AI SDK v6 standard)
        # Do NOT send tool-input-* events - adk_request_confirmation is internal, not exposed to frontend
        # Reference: ADR 0002 - Tool Approval Architecture
        if tool_name == "adk_request_confirmation":
            # Ensure tool_call_id is not None (required for approval flow)
            if tool_call_id is None:
                logger.error(
                    "[adk_request_confirmation] tool_call_id is None, cannot create approval request"
                )
                return []

            # Extract original tool call ID from tool_args
            # adk_request_confirmation args contain: {"originalFunctionCall": {"id": "...", "name": "...", "args": {...}}}
            original_call_id = tool_args.get("originalFunctionCall", {}).get("id", tool_call_id)

            return [
                StreamProtocolConverter.format_tool_approval_request(
                    original_tool_call_id=original_call_id, approval_id=tool_call_id
                )
            ]

        # For regular tools: Send tool-input-* events as normal
        events = [
            self.format_sse_event(
                {
                    "type": "tool-input-start",
                    "toolCallId": tool_call_id,
                    "toolName": tool_name,
                }
            ),
            self.format_sse_event(
                {
                    "type": "tool-input-available",
                    "toolCallId": tool_call_id,
                    "toolName": tool_name,
                    "input": tool_args,
                }
            ),
        ]

        return events

    def _process_function_response(self, function_response: types.FunctionResponse) -> list[str]:
        """
        Process function response into tool-output-available or tool-output-error event (AI SDK v6 spec).

        Suppress ADK confirmation error responses
        - When ADK generates RequestConfirmation, it also generates a FunctionResponse with error
        - We suppress this error because we're exposing adk_request_confirmation as a normal tool call
        - The frontend will handle the approval UI for adk_request_confirmation directly
        """
        # Use function_response.id directly (ADK provides correct ID)
        # This ensures tool results are mapped to the correct tool invocation,
        # especially important for confirmation flow where the same tool may be called multiple times
        tool_call_id = function_response.id
        tool_name = function_response.name

        # Ensure tool_name is not None
        if tool_name is None:
            logger.warning("[FUNCTION RESPONSE] Tool name is None, skipping")
            return []

        output = function_response.response

        # Check if function response contains error
        # ADK tool errors often have { "error": "...", "success": false } structure
        is_error = False
        error_message = None

        if isinstance(output, dict):
            # Pattern 1: success=false (common in tool implementations)
            if output.get("success") is False:
                is_error = True
                error_message = output.get("error", "Unknown tool error")
            # Pattern 2: error field present without result field
            elif "error" in output and output.get("result") is None:
                is_error = True
                error_message = output.get("error", "Unknown tool error")

        # Suppress ADK confirmation error
        # When ADK generates RequestConfirmation, it sends an error FunctionResponse
        # We suppress this because adk_request_confirmation is exposed as a normal tool call
        if (
            is_error
            and error_message == "This tool call requires confirmation, please approve or reject."
        ):
            logger.info(
                f"[ADK Confirmation] Suppressing confirmation error for {tool_name} "
                f"(handled by adk_request_confirmation tool call)"
            )
            return []

        # Send error event if error detected
        if is_error:
            event = self.format_sse_event(
                {
                    "type": "tool-output-error",
                    "toolCallId": tool_call_id,
                    "errorText": str(error_message),
                }
            )
            logger.error(f"[TOOL ERROR] {tool_name}: {error_message}")
            return [event]

        # Normal success response
        event = self.format_sse_event(
            {
                "type": "tool-output-available",
                "toolCallId": tool_call_id,
                "output": output,
            }
        )
        return [event]

    def _process_executable_code(self, code: types.ExecutableCode) -> list[str]:
        """Process executable code as custom data event."""
        event = self.format_sse_event(
            {
                "type": "data-executable-code",
                "data": {"language": code.language, "code": code.code},
            }
        )
        return [event]

    def _process_code_result(self, result: types.CodeExecutionResult) -> list[str]:
        """Process code execution result as custom data event."""
        event = self.format_sse_event(
            {
                "type": "data-code-execution-result",
                "data": {"outcome": result.outcome, "output": result.output},
            }
        )
        return [event]

    def _process_inline_data_part(self, inline_data: types.Blob) -> list[str]:
        """Process inline data (image or audio) as appropriate custom event."""
        # Ensure data is not None
        if inline_data.data is None:
            logger.warning("[INLINE DATA] Data is None, skipping")
            return []

        mime_type = inline_data.mime_type or ""

        # Process audio data - send PCM chunks directly without buffering
        if mime_type.startswith("audio/pcm"):
            # Extract sample rate from mime type (e.g., "audio/pcm;rate=24000")
            sample_rate = None
            if ";rate=" in mime_type:
                rate_str = mime_type.split(";rate=")[1]
                sample_rate = int(rate_str)
                if self.pcm_sample_rate is None:
                    self.pcm_sample_rate = sample_rate

            # Track stats
            self.pcm_chunk_count += 1
            self.pcm_total_bytes += len(inline_data.data)

            # Send PCM chunk immediately as data-pcm event (AI SDK v6 Stream Protocol)
            base64_content = base64.b64encode(inline_data.data).decode("utf-8")

            # TODO: before: pcm data is plain data, after: dict with metadata
            event = self.format_sse_event(
                {
                    "type": "data-pcm",
                    "data": {
                        "content": base64_content,
                        "sampleRate": sample_rate or 24000,
                        "channels": 1,
                        "bitDepth": 16,
                    },
                }
            )
            return [event]

        # Process other audio formats (non-PCM) - send directly
        if mime_type.startswith("audio/"):
            # Convert bytes to base64 string
            base64_content = base64.b64encode(inline_data.data).decode("utf-8")

            event = self.format_sse_event(
                {
                    "type": "data-audio",
                    "data": {
                        "mediaType": mime_type,
                        "content": base64_content,
                    },
                }
            )
            return [event]

        # Process image data
        if mime_type.startswith("image/"):
            # Convert bytes to base64 string
            base64_content = base64.b64encode(inline_data.data).decode("utf-8")

            # Use AI SDK v6 standard 'file' event with data URL
            # This matches the input format (symmetric input/output)
            event = self.format_sse_event(
                {
                    "type": "file",
                    "url": f"data:{mime_type};base64,{base64_content}",
                    "mediaType": mime_type,
                }
            )
            logger.debug(
                f"[IMAGE OUTPUT] mime_type={mime_type}, size={len(inline_data.data)} bytes"
            )
            return [event]

        # Unknown mime type - log warning and skip
        logger.warning(
            f"[INLINE DATA] Unknown mime_type={mime_type}, size={len(inline_data.data)} bytes - skipping"
        )
        return []

    async def finalize(  # noqa: C901, PLR0912, PLR0915, PLR0913
        self,
        usage_metadata: Any | None = None,
        error: Exception | None = None,
        finish_reason: Any | None = None,
        grounding_metadata: Any | None = None,
        citation_metadata: Any | None = None,
        cache_metadata: Any | None = None,
        model_version: str | None = None,
    ) -> AsyncGenerator[str]:
        """
        Send final events to close the stream.

        Args:
            usage_metadata: Optional token usage information
            error: Optional error that occurred
            finish_reason: Optional ADK FinishReason enum
            grounding_metadata: Optional grounding sources (RAG, web search)
            citation_metadata: Optional citation information
            cache_metadata: Optional context cache statistics
            model_version: Optional model version string

        Yields:
            Final SSE events
        """
        if error:
            yield self.format_sse_event({"type": "error", "error": str(error)})
        else:
            # Close any open text blocks (input transcription)
            if self._input_text_block_started and self._input_text_block_id:
                logger.debug(
                    f"[INPUT TRANSCRIPTION] Closing text block in finalize: id={self._input_text_block_id}"
                )
                yield self.format_sse_event({"type": "text-end", "id": self._input_text_block_id})
                self._input_text_block_started = False

            # Close any open text blocks (output transcription)
            if self._output_text_block_started and self._output_text_block_id:
                yield self.format_sse_event({"type": "text-end", "id": self._output_text_block_id})
                self._output_text_block_started = False

            # Build finish event
            finish_event: dict[str, Any] = {"type": "finish"}

            # Add finish reason (always, defaults to "stop" if None)
            finish_event["finishReason"] = _map_adk_finish_reason_to_ai_sdk(finish_reason)

            # Build messageMetadata with usage and audio stats
            metadata: dict[str, Any] = {}

            # DEBUG: Log usage_metadata value
            logger.info(f"[FINALIZE-METADATA] usage_metadata={usage_metadata!r}")

            # Add usage metadata if available
            if usage_metadata:
                metadata["usage"] = {
                    "promptTokens": usage_metadata.prompt_token_count,
                    "completionTokens": usage_metadata.candidates_token_count,
                    "totalTokens": usage_metadata.total_token_count,
                }

            # Add audio streaming metadata if present
            if self.pcm_chunk_count > 0:
                sample_rate = self.pcm_sample_rate or 24000
                # Calculate duration: bytes / (sample_rate * bytes_per_sample)
                # PCM16: 2 bytes per sample, 1 channel
                duration_seconds = self.pcm_total_bytes / (sample_rate * 2)

                metadata["audio"] = {
                    "chunks": self.pcm_chunk_count,
                    "bytes": self.pcm_total_bytes,
                    "sampleRate": sample_rate,
                    "duration": duration_seconds,
                }
                logger.info(
                    f"[AUDIO COMPLETE] chunks={self.pcm_chunk_count}, "
                    f"bytes={self.pcm_total_bytes}, "
                    f"sampleRate={sample_rate}, "
                    f"duration={duration_seconds:.2f}s"
                )

            # Add grounding sources (RAG, web search results)
            if grounding_metadata:
                sources = []
                grounding_chunks = getattr(grounding_metadata, "grounding_chunks", None)
                if grounding_chunks:
                    for chunk in grounding_chunks:
                        if hasattr(chunk, "web"):
                            web = chunk.web
                            sources.append(
                                {
                                    "type": "web",
                                    "uri": getattr(web, "uri", ""),
                                    "title": getattr(web, "title", ""),
                                }
                            )
                if sources:
                    metadata["grounding"] = {"sources": sources}
                    logger.debug(f"[GROUNDING] Added {len(sources)} grounding sources to metadata")

            # Add citations
            if citation_metadata:
                citations = []
                citation_sources = getattr(citation_metadata, "citation_sources", None)
                if citation_sources:
                    for source in citation_sources:
                        citations.append(
                            {
                                "startIndex": getattr(source, "start_index", 0),
                                "endIndex": getattr(source, "end_index", 0),
                                "uri": getattr(source, "uri", ""),
                                "license": getattr(source, "license", ""),
                            }
                        )
                if citations:
                    metadata["citations"] = citations
                    logger.debug(f"[CITATIONS] Added {len(citations)} citations to metadata")

            # Add cache metadata (context cache statistics)
            if cache_metadata:
                cache_hits = getattr(cache_metadata, "cache_hits", 0)
                cache_misses = getattr(cache_metadata, "cache_misses", 0)
                metadata["cache"] = {
                    "hits": cache_hits,
                    "misses": cache_misses,
                }
                logger.debug(
                    f"[CACHE] Added cache metadata: hits={cache_hits}, misses={cache_misses}"
                )

            # Add model version
            if model_version:
                metadata["modelVersion"] = model_version
                logger.debug(f"[MODEL] Added model version: {model_version}")

            # Add messageMetadata to finish event if we have any metadata
            if metadata:
                finish_event["messageMetadata"] = metadata

            yield self.format_sse_event(finish_event)

        # Always send [DONE] marker
        logger.debug("[ADK→SSE] Sending [DONE] marker")
        yield "data: [DONE]\n\n"


async def stream_adk_to_ai_sdk(  # noqa: C901, PLR0912, PLR0915
    event_stream: AsyncGenerator[Event | SseFormattedEvent],
    message_id: str | None = None,
    mode: Mode = "adk-sse",  # "adk-sse" or "adk-bidi" for chunk logger
    agent_model: str | None = None,  # Agent model name as fallback when event.model_version is None
) -> AsyncGenerator[SseFormattedEvent]:
    """
    Convert ADK event stream to AI SDK v6 Data Stream Protocol.

    Accepts two types of events:
    - Event: ADK native events from run_live() (unconverted, requires conversion)
    - SseFormattedEvent (str): Pre-converted SSE format strings (pass-through)

    Confirmation events are pre-converted to SSE format by:
    - BIDI mode: BidiEventSender._handle_confirmation_if_needed()
    - SSE mode: SseEventStreamer._handle_confirmation_if_needed()

    This design maintains type-based conversion state:
    - Event type = unconverted (needs converter)
    - str type = already converted (pass-through)

    Args:
        event_stream: AsyncGenerator of Event or SseFormattedEvent
        message_id: Optional message ID
        mode: Backend mode ("adk-sse" or "adk-bidi") for chunk logger

    Yields:
        SSE-formatted event strings
    """
    converter = StreamProtocolConverter(message_id, agent_model=agent_model)
    error_list: list[Exception] = []
    usage_metadata_list = []
    finish_reason_list = []
    grounding_metadata_list = []
    citation_metadata_list = []
    cache_metadata_list = []
    model_version_list = []

    try:
        async for event in event_stream:
            # Type-based handling: str (pre-converted) vs Event (needs conversion)
            if isinstance(event, str):
                # Chunk Logger: Record SSE event (already converted)
                chunk_logger.log_chunk(
                    location="backend-sse-event",
                    direction="out",
                    chunk=event,
                    mode=mode,
                )
                yield event
                continue

            # Chunk Logger: Record ADK event (input)
            chunk_logger.log_chunk(
                location="backend-adk-event",
                direction="in",
                chunk=repr(event),
                mode=mode,
            )

            # Convert ADK Event to SSE format
            async for sse_event in converter._convert_event(event):
                # Chunk Logger: Record SSE event (output)
                chunk_logger.log_chunk(
                    location="backend-sse-event",
                    direction="out",
                    chunk=sse_event,
                    mode=mode,
                )
                yield sse_event

            # Extract metadata from Event for finalization
            if hasattr(event, "usage_metadata") and event.usage_metadata:
                usage_metadata_list.append(event.usage_metadata)
                # DEBUG: Log usage_metadata contents
                logger.info(
                    f"[USAGE_METADATA] Found usage_metadata (list size now: {len(usage_metadata_list)}): {event.usage_metadata!r}"
                )
            else:
                # Log when usage_metadata is NOT found
                logger.info(f"[USAGE_METADATA] No usage_metadata in event: {type(event).__name__}")
            if hasattr(event, "custom_metadata") and event.custom_metadata:
                # DEBUG: Log custom_metadata contents
                logger.debug(f"[CUSTOM_METADATA] Found custom_metadata: {event.custom_metadata!r}")
            if hasattr(event, "finish_reason") and event.finish_reason:
                finish_reason_list.append(event.finish_reason)
            if hasattr(event, "grounding_metadata") and event.grounding_metadata:
                grounding_metadata_list.append(event.grounding_metadata)
            if hasattr(event, "citation_metadata") and event.citation_metadata:
                citation_metadata_list.append(event.citation_metadata)
            if hasattr(event, "cache_metadata") and event.cache_metadata:
                cache_metadata_list.append(event.cache_metadata)
            # Extract model_version from event or use agent_model fallback
            if hasattr(event, "model_version") and event.model_version:
                model_version_list.append(event.model_version)
                logger.debug(f"[MODEL_VERSION] Using event.model_version: {event.model_version}")
            elif agent_model and not model_version_list:
                # Use agent_model as fallback only once (if list is empty)
                model_version_list.append(agent_model)
                logger.debug(f"[MODEL_VERSION] Using agent_model fallback: {agent_model}")

    except Exception as e:
        import traceback

        logger.error(f"[stream_adk_to_ai_sdk] Exception: {e!s}")
        logger.error(f"[stream_adk_to_ai_sdk] Traceback:\n{traceback.format_exc()}")
        error_list.append(e)
    finally:
        logger.info("[FINALIZE] Entering finally block")
        # Send final events with all collected metadata
        # Extract last values from lists (most recent)
        error = error_list[-1] if len(error_list) > 0 else None
        logger.info(f"[FINALIZE] usage_metadata_list length: {len(usage_metadata_list)}")
        usage_metadata = usage_metadata_list[-1] if len(usage_metadata_list) > 0 else None
        logger.info(
            f"[FINALIZE] usage_metadata_list count: {len(usage_metadata_list)}, selected: {usage_metadata!r}"
        )
        finish_reason = finish_reason_list[-1] if len(finish_reason_list) > 0 else None
        grounding_metadata = (
            grounding_metadata_list[-1] if len(grounding_metadata_list) > 0 else None
        )
        citation_metadata = citation_metadata_list[-1] if len(citation_metadata_list) > 0 else None
        cache_metadata = cache_metadata_list[-1] if len(cache_metadata_list) > 0 else None
        model_version = model_version_list[-1] if len(model_version_list) > 0 else None

        # DEBUG: Log final model_version
        logger.debug(
            f"[MODEL_VERSION] Final values - "
            f"list={model_version_list!r}, "
            f"selected={model_version!r}"
        )

        if error:
            logger.error(f"[FINALIZE] Sending error: {error!s}")

        async for final_event in converter.finalize(
            usage_metadata=usage_metadata,
            error=error,
            finish_reason=finish_reason,
            grounding_metadata=grounding_metadata,
            citation_metadata=citation_metadata,
            cache_metadata=cache_metadata,
            model_version=model_version,
        ):
            # Chunk Logger: Record final SSE event (output)
            # Log raw SSE string to avoid encoding/decoding issues
            chunk_logger.log_chunk(
                location="backend-sse-event",
                direction="out",
                chunk=final_event,
                mode=mode,
            )

            yield final_event
