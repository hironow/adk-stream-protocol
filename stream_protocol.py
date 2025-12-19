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

from __future__ import annotations

import enum
import json
import uuid
from collections.abc import AsyncGenerator
from pprint import pformat
from typing import Any

from google.adk.events import Event
from google.genai import types
from loguru import logger

from adk_compat import inject_confirmation_for_bidi
from chunk_logger import Mode, chunk_logger

# Log truncation threshold for base64 and long content fields
LOG_FIELD_TRUNCATE_THRESHOLD = 100
# Maximum length for debug log messages before truncation
DEBUG_LOG_MAX_LENGTH = 200


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


def map_adk_finish_reason_to_ai_sdk(finish_reason: types.FinishReason | None) -> str:
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
    ):
        """
        Initialize converter.

        Args:
            message_id: Optional message ID. Generated if not provided.
        """
        self.message_id = message_id or str(uuid.uuid4())
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

    def _format_sse_event(self, event_data: dict) -> str:
        """Format event data as SSE."""
        # Debug: Log event before SSE formatting
        # For binary data events, truncate the content to avoid huge logs
        log_data = event_data
        event_type = event_data.get("type")

        # Handle data-pcm, data-audio, and data-image events with large binary content
        if event_type in ["data-pcm", "data-audio", "data-image"] and "data" in event_data:
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
        logger.debug(
            f"[ADK→SSE] {str(log_data)[:DEBUG_LOG_MAX_LENGTH]}{'... (truncated)' if len(str(log_data)) > DEBUG_LOG_MAX_LENGTH else ''}"
        )
        return f"data: {json.dumps(event_data)}\n\n"

    async def convert_event(self, event: Event) -> AsyncGenerator[str, None]:  # noqa: C901, PLR0912, PLR0915
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
            yield self._format_sse_event(
                {
                    "type": "error",
                    "error": {"code": event.error_code, "message": error_message},
                }
            )
            return

        # [INPUT] Log incoming ADK event
        event_type = type(event).__name__
        has_content = hasattr(event, "content") and event.content
        is_turn_complete = hasattr(event, "turn_complete") and event.turn_complete
        has_usage = hasattr(event, "usage_metadata") and event.usage_metadata
        has_finish = hasattr(event, "finish_reason") and event.finish_reason

        logger.debug(
            f"[convert_event INPUT] type={event_type}, "
            f"content={has_content}, turn_complete={is_turn_complete}, "
            f"usage={has_usage}, finish_reason={has_finish}"
        )

        # [DEBUG] Pretty print entire Event object to find transcription fields
        try:
            # Filter out private attributes (starting with _) for cleaner logs
            event_attrs = (
                {k: v for k, v in vars(event).items() if not k.startswith("_")}
                if hasattr(event, "__dict__")
                else {}
            )
            logger.debug(
                f"[convert_event INPUT] Event attributes:\n{pformat(event_attrs, width=120, depth=3)}"
            )
        except Exception as e:
            logger.debug(f"[convert_event INPUT] Could not pformat event: {e}")

        # Log content parts if present
        if has_content and event.content is not None and event.content.parts:
            for idx, part in enumerate(event.content.parts):
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
                    # [DEBUG] Pretty print Part and inline_data to find transcription
                    try:
                        # Filter out private attributes (starting with _) for cleaner logs
                        part_attrs = (
                            {k: v for k, v in vars(part).items() if not k.startswith("_")}
                            if hasattr(part, "__dict__")
                            else {}
                        )
                        logger.debug(
                            f"[convert_event INPUT]   Part[{idx}] attributes:\n{pformat(part_attrs, width=120, depth=2)}"
                        )
                    except Exception as e:
                        logger.debug(f"[convert_event INPUT]   Part[{idx}] Could not pformat: {e}")
                if hasattr(part, "executable_code") and part.executable_code:
                    part_types.append("executable_code")
                if hasattr(part, "code_execution_result") and part.code_execution_result:
                    part_types.append("code_execution_result")

                if part_types:
                    logger.debug(f"[convert_event INPUT]   Part[{idx}]: {', '.join(part_types)}")

        # Send start event on first event
        if not self.has_started:
            yield self._format_sse_event({"type": "start", "messageId": self.message_id})
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
                    for sse_event in self._process_thought_part(part.text):
                        yield sse_event
                # Text content (regular answer when thought=False or None)
                elif hasattr(part, "text") and part.text:
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
                    yield self._format_sse_event(
                        {"type": "text-start", "id": self._input_text_block_id}
                    )

                # Send text-delta with the transcription text (AI SDK v6 protocol)
                yield self._format_sse_event(
                    {
                        "type": "text-delta",
                        "id": self._input_text_block_id,
                        "delta": transcription.text,
                    }
                )

                # Send text-end if transcription is finished
                if hasattr(transcription, "finished") and transcription.finished:
                    yield self._format_sse_event(
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
                logger.debug(
                    f"[OUTPUT TRANSCRIPTION] text='{transcription.text}', finished={getattr(transcription, 'finished', None)}"
                )

                # Send text-start if this is the first transcription chunk
                if not self._output_text_block_started:
                    self._output_text_block_id = f"{self.message_id}_output_text"
                    self._output_text_block_started = True
                    yield self._format_sse_event(
                        {"type": "text-start", "id": self._output_text_block_id}
                    )

                # Send text-delta with the transcription text (AI SDK v6 protocol)
                yield self._format_sse_event(
                    {
                        "type": "text-delta",
                        "id": self._output_text_block_id,
                        "delta": transcription.text,
                    }
                )

                # Send text-end if transcription is finished
                if hasattr(transcription, "finished") and transcription.finished:
                    yield self._format_sse_event(
                        {"type": "text-end", "id": self._output_text_block_id}
                    )
                    self._output_text_block_started = False

        # BIDI mode: Handle turn completion within convert_event
        # This ensures content and turn_complete are processed in correct order
        if hasattr(event, "turn_complete") and event.turn_complete:
            logger.info("[TURN COMPLETE] Detected turn_complete in convert_event")

            # Extract metadata from event if present
            usage_metadata = None
            finish_reason = None
            if hasattr(event, "usage_metadata") and event.usage_metadata:
                usage_metadata = event.usage_metadata
            if hasattr(event, "finish_reason") and event.finish_reason:
                finish_reason = event.finish_reason

            # Send finish event
            async for final_event in self.finalize(
                usage_metadata=usage_metadata, error=None, finish_reason=finish_reason
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
            self._format_sse_event({"type": f"{event_type_prefix}-start", "id": part_id}),
            self._format_sse_event(
                {"type": f"{event_type_prefix}-delta", "id": part_id, "delta": content}
            ),
            self._format_sse_event({"type": f"{event_type_prefix}-end", "id": part_id}),
        ]
        return events

    def _process_text_part(self, text: str) -> list[str]:
        """Process text part into text-* events."""
        return self._create_streaming_events("text", text, log_prefix="[TEXT PART]")

    def _process_thought_part(self, thought: str) -> list[str]:
        """Process thought part into reasoning-* events."""
        return self._create_streaming_events("reasoning", thought)

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

        events = [
            self._format_sse_event(
                {
                    "type": "tool-input-start",
                    "toolCallId": tool_call_id,
                    "toolName": tool_name,
                }
            ),
            self._format_sse_event(
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
            event = self._format_sse_event(
                {
                    "type": "tool-output-error",
                    "toolCallId": tool_call_id,
                    "errorText": str(error_message),
                }
            )
            logger.error(f"[TOOL ERROR] {tool_name}: {error_message}")
            return [event]

        # Normal success response
        event = self._format_sse_event(
            {
                "type": "tool-output-available",
                "toolCallId": tool_call_id,
                "output": output,
            }
        )
        return [event]

    def _process_executable_code(self, code: types.ExecutableCode) -> list[str]:
        """Process executable code as custom data event."""
        event = self._format_sse_event(
            {
                "type": "data-executable-code",
                "data": {"language": code.language, "code": code.code},
            }
        )
        return [event]

    def _process_code_result(self, result: types.CodeExecutionResult) -> list[str]:
        """Process code execution result as custom data event."""
        event = self._format_sse_event(
            {
                "type": "data-code-execution-result",
                "data": {"outcome": result.outcome, "output": result.output},
            }
        )
        return [event]

    def _process_inline_data_part(self, inline_data: types.Blob) -> list[str]:
        """Process inline data (image or audio) as appropriate custom event."""
        import base64

        # Ensure data is not None
        if inline_data.data is None:
            logger.warning("[INLINE DATA] Data is None, skipping")
            return []

        mime_type = inline_data.mime_type or ""

        # Process audio data - send PCM chunks directly without buffering
        if mime_type.startswith("audio/pcm"):
            import base64

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

            event = self._format_sse_event(
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

            event = self._format_sse_event(
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
            event = self._format_sse_event(
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
    ) -> AsyncGenerator[str, None]:
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
            yield self._format_sse_event({"type": "error", "error": str(error)})
        else:
            # Close any open text blocks (input transcription)
            if self._input_text_block_started and self._input_text_block_id:
                logger.debug(
                    f"[INPUT TRANSCRIPTION] Closing text block in finalize: id={self._input_text_block_id}"
                )
                yield self._format_sse_event({"type": "text-end", "id": self._input_text_block_id})
                self._input_text_block_started = False

            # Close any open text blocks (output transcription)
            if self._output_text_block_started and self._output_text_block_id:
                yield self._format_sse_event({"type": "text-end", "id": self._output_text_block_id})
                self._output_text_block_started = False

            # Build finish event
            finish_event: dict[str, Any] = {"type": "finish"}

            # Add finish reason if available
            if finish_reason:
                finish_event["finishReason"] = map_adk_finish_reason_to_ai_sdk(finish_reason)

            # Build messageMetadata with usage and audio stats
            metadata: dict[str, Any] = {}

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

            yield self._format_sse_event(finish_event)

        # Always send [DONE] marker
        logger.debug("[ADK→SSE] Sending [DONE] marker")
        yield "data: [DONE]\n\n"


async def _convert_to_sse_events(
    processed_event: Event | dict[str, Any] | str,
    original_event: Event,
    converter: StreamProtocolConverter,
) -> AsyncGenerator[str, None]:
    """
    Convert ADK Event or injected dict to SSE event strings.

    This helper function unifies the conversion logic for:
    - Original ADK Event objects (converted via converter)
    - Injected confirmation dicts (already in AI SDK v6 format)
    - Raw SSE strings (like [DONE] markers - passed through directly)

    Args:
        processed_event: ADK Event object, injected dict, or raw SSE string
        original_event: The original ADK Event (for identity check)
        converter: The StreamProtocolConverter instance

    Yields:
        SSE formatted event strings
    """
    logger.debug(
        f"[_convert_to_sse_events] Received: type={type(processed_event).__name__}, "
        f"is_str={isinstance(processed_event, str)}"
    )
    if isinstance(processed_event, str):
        # Raw SSE string (e.g., "data: [DONE]\n\n") - pass through directly
        logger.info(f"[_convert_to_sse_events] Passing through raw string: {processed_event!r}")
        yield processed_event
    elif processed_event is original_event:
        # Original ADK Event - convert normally via converter
        # Type assertion: identity check guarantees this is an Event
        assert isinstance(processed_event, Event)
        async for sse_event in converter.convert_event(processed_event):
            yield sse_event
    else:
        # Injected confirmation event (dict in AI SDK v6 format)
        # Convert directly to SSE without going through converter
        yield f"data: {json.dumps(processed_event)}\n\n"


async def stream_adk_to_ai_sdk(  # noqa: C901, PLR0912
    event_stream: AsyncGenerator[Event, None],
    message_id: str | None = None,
    mode: Mode = "adk-sse",  # "adk-sse" or "adk-bidi" for chunk logger
    interceptor: Any = None,  # ToolConfirmationInterceptor | None
    confirmation_tools: list[str] | None = None,
    session: Any = None,  # Starlette session for BIDI mode (to access frontend_delegate)
) -> AsyncGenerator[str, None]:
    """
    Convert ADK event stream to AI SDK v6 Data Stream Protocol.

    Args:
        event_stream: AsyncGenerator of ADK Event objects
        message_id: Optional message ID
        mode: Backend mode ("adk-sse" or "adk-bidi") for chunk logger
        interceptor: ToolConfirmationInterceptor for BIDI mode (None for SSE mode)
        confirmation_tools: List of tool names requiring confirmation
        session: Starlette session (for BIDI mode to access frontend_delegate)

    Yields:
        SSE-formatted event strings

    Example:
        >>> async for sse_event in stream_adk_to_ai_sdk(agent_runner.run_async(...)):
        ...     yield sse_event
    """
    converter = StreamProtocolConverter(message_id)
    error_list = []
    usage_metadata_list = []
    finish_reason_list = []
    grounding_metadata_list = []
    citation_metadata_list = []
    cache_metadata_list = []
    model_version_list = []

    try:
        async for event in event_stream:
            # Chunk Logger: Record ADK event (input)
            chunk_logger.log_chunk(
                location="backend-adk-event",
                direction="in",
                chunk=repr(event),  # Use repr() for Event object
                mode=mode,
            )

            # BIDI Confirmation Injection: Unify SSE and BIDI tool confirmation flows
            # SSE: Passes through original event only (ADK generates confirmation)
            # BIDI: Intercepts confirmation-required tools and executes frontend confirmation
            async for processed_event in inject_confirmation_for_bidi(
                event,
                is_bidi=(mode == "adk-bidi"),
                interceptor=interceptor,
                confirmation_tools=confirmation_tools,
                session=session,
            ):
                logger.debug(
                    f"[stream_adk_to_ai_sdk] Received from inject_confirmation_for_bidi: "
                    f"type={type(processed_event).__name__}, is_str={isinstance(processed_event, str)}"
                )
                # Convert to SSE events (unified path for both Event objects and dicts)
                async for sse_event in _convert_to_sse_events(processed_event, event, converter):
                    # Chunk Logger: Record SSE event (output)
                    chunk_logger.log_chunk(
                        location="backend-sse-event",
                        direction="out",
                        chunk=sse_event,
                        mode=mode,
                    )
                    yield sse_event

            # But, extract metadata if present (for finalization)
            if hasattr(event, "usage_metadata") and event.usage_metadata:
                usage_metadata_list.append(event.usage_metadata)
            if hasattr(event, "finish_reason") and event.finish_reason:
                finish_reason_list.append(event.finish_reason)
            if hasattr(event, "grounding_metadata") and event.grounding_metadata:
                grounding_metadata_list.append(event.grounding_metadata)
            if hasattr(event, "citation_metadata") and event.citation_metadata:
                citation_metadata_list.append(event.citation_metadata)
            if hasattr(event, "cache_metadata") and event.cache_metadata:
                cache_metadata_list.append(event.cache_metadata)
            if hasattr(event, "model_version") and event.model_version:
                model_version_list.append(event.model_version)

    except Exception as e:
        logger.error(f"Error in ADK stream conversion: {e}")
        error_list.append(e)
    finally:
        # Send final events with all collected metadata
        # Extract last values from lists (most recent)
        error = error_list[-1] if error_list else None
        usage_metadata = usage_metadata_list[-1] if usage_metadata_list else None
        finish_reason = finish_reason_list[-1] if finish_reason_list else None
        grounding_metadata = grounding_metadata_list[-1] if grounding_metadata_list else None
        citation_metadata = citation_metadata_list[-1] if citation_metadata_list else None
        cache_metadata = cache_metadata_list[-1] if cache_metadata_list else None
        model_version = model_version_list[-1] if model_version_list else None

        # Log what we're finalizing with
        if error:
            logger.error(f"[FINALIZE] Sending error: {error}")

        # Send finalize events with all metadata
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
