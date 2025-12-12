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

import json
import uuid
from pprint import pformat
from typing import Any, AsyncGenerator

from google.adk.events import Event
from google.genai import types
from loguru import logger


def map_adk_finish_reason_to_ai_sdk(finish_reason: Any) -> str:
    """
    Map ADK FinishReason enum to AI SDK v6 finish reason string.

    ADK uses FinishReason enum (e.g., FinishReason.STOP)
    AI SDK v6 expects lowercase strings: "stop", "length", "content-filter", etc.
    """
    if not finish_reason:
        return "stop"

    # Get the enum name (e.g., "STOP" from FinishReason.STOP)
    reason_name = getattr(finish_reason, "name", str(finish_reason))

    # Map ADK finish reasons to AI SDK v6 format
    reason_map = {
        "STOP": "stop",
        "MAX_TOKENS": "length",
        "SAFETY": "content-filter",
        "RECITATION": "content-filter",
        "OTHER": "other",
        "BLOCKLIST": "content-filter",
        "PROHIBITED_CONTENT": "content-filter",
        "SPII": "content-filter",
    }

    # Return mapped value or default to lowercase name
    return reason_map.get(reason_name, reason_name.lower())


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

    def __init__(self, message_id: str | None = None):
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
        # Track output transcription text blocks (for native-audio models)
        self._text_block_id: str | None = None
        self._text_block_started = False

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
        logger.debug(f"[ADK→SSE] {event_data}")
        return f"data: {json.dumps(event_data)}\n\n"

    async def convert_event(self, event: Event) -> AsyncGenerator[str, None]:
        """
        Convert a single ADK event to AI SDK v6 SSE events.

        Args:
            event: ADK Event object

        Yields:
            SSE-formatted event strings
        """
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
            event_attrs = vars(event) if hasattr(event, "__dict__") else {}
            logger.debug(
                f"[convert_event INPUT] Event attributes:\n{pformat(event_attrs, width=120, depth=3)}"
            )
        except Exception as e:
            logger.debug(f"[convert_event INPUT] Could not pformat event: {e}")

        # Log content parts if present
        if has_content and event.content.parts:
            for idx, part in enumerate(event.content.parts):
                part_types = []
                if hasattr(part, "text") and part.text:
                    part_types.append(f"text({len(part.text)} chars)")
                if hasattr(part, "thought") and part.thought:
                    part_types.append("thought")
                if hasattr(part, "function_call") and part.function_call:
                    part_types.append(f"function_call({part.function_call.name})")
                if hasattr(part, "function_response") and part.function_response:
                    part_types.append(
                        f"function_response({part.function_response.name})"
                    )
                if hasattr(part, "inline_data") and part.inline_data:
                    part_types.append("inline_data")
                    # [DEBUG] Pretty print Part and inline_data to find transcription
                    try:
                        part_attrs = vars(part) if hasattr(part, "__dict__") else {}
                        logger.debug(
                            f"[convert_event INPUT]   Part[{idx}] attributes:\n{pformat(part_attrs, width=120, depth=2)}"
                        )
                    except Exception as e:
                        logger.debug(
                            f"[convert_event INPUT]   Part[{idx}] Could not pformat: {e}"
                        )
                if hasattr(part, "executable_code") and part.executable_code:
                    part_types.append("executable_code")
                if hasattr(part, "code_execution_result") and part.code_execution_result:
                    part_types.append("code_execution_result")

                if part_types:
                    logger.debug(
                        f"[convert_event INPUT]   Part[{idx}]: {', '.join(part_types)}"
                    )

        # Send start event on first event
        if not self.has_started:
            yield self._format_sse_event(
                {"type": "start", "messageId": self.message_id}
            )
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
                    for sse_event in self._process_function_response(
                        part.function_response
                    ):
                        yield sse_event

                # Code execution
                if hasattr(part, "executable_code") and part.executable_code:
                    for sse_event in self._process_executable_code(
                        part.executable_code
                    ):
                        yield sse_event

                if (
                    hasattr(part, "code_execution_result")
                    and part.code_execution_result
                ):
                    for sse_event in self._process_code_result(
                        part.code_execution_result
                    ):
                        yield sse_event

                # Inline data (images, etc.)
                if (
                    hasattr(part, "inline_data")
                    and part.inline_data
                    and isinstance(part.inline_data, types.Blob)
                ):
                    for sse_event in self._process_inline_data_part(part.inline_data):
                        yield sse_event

        # [EXPERIMENT] Output transcription (audio response text from native-audio models)
        # Check event.output_transcription at the top level (not in content.parts)
        if hasattr(event, "output_transcription") and event.output_transcription:
            transcription = event.output_transcription
            if hasattr(transcription, "text") and transcription.text:
                logger.debug(
                    f"[TRANSCRIPTION] text='{transcription.text}', finished={getattr(transcription, 'finished', None)}"
                )

                # Send text-start if this is the first transcription chunk
                if not self._text_block_started:
                    self._text_block_id = f"{self.message_id}_text"
                    self._text_block_started = True
                    logger.debug(f"[TRANSCRIPTION] Sending text-start with id={self._text_block_id}")
                    yield self._format_sse_event({
                        "type": "text-start",
                        "id": self._text_block_id
                    })

                # Send text-delta with the transcription text (AI SDK v6 protocol)
                logger.debug(f"[TRANSCRIPTION] Sending text-delta with id={self._text_block_id}")
                yield self._format_sse_event({
                    "type": "text-delta",
                    "id": self._text_block_id,
                    "delta": transcription.text
                })

                # Send text-end if transcription is finished
                if hasattr(transcription, "finished") and transcription.finished:
                    logger.debug(f"[TRANSCRIPTION] Sending text-end with id={self._text_block_id}")
                    yield self._format_sse_event({
                        "type": "text-end",
                        "id": self._text_block_id
                    })
                    self._text_block_started = False

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
            self._format_sse_event(
                {"type": f"{event_type_prefix}-start", "id": part_id}
            ),
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
        """Process function call into tool-input-* events (AI SDK v6 spec)."""
        tool_call_id = self._generate_tool_call_id()
        tool_name = function_call.name
        tool_args = function_call.args

        # Store mapping so function_response can use the same ID
        self.tool_call_id_map[tool_name] = tool_call_id

        # [EXPERIMENT] Log tool call for investigation
        logger.info(f"[EXPERIMENT] Tool call detected: {tool_name}")
        logger.info(f"[EXPERIMENT] Tool call ID: {tool_call_id}")
        logger.info(f"[EXPERIMENT] Tool arguments: {json.dumps(tool_args, indent=2, ensure_ascii=False)}")

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

    def _process_function_response(
        self, function_response: types.FunctionResponse
    ) -> list[str]:
        """Process function response into tool-output-available event (AI SDK v6 spec)."""
        # Retrieve the tool call ID from the map to match with the function call
        tool_name = function_response.name
        tool_call_id = self.tool_call_id_map.get(tool_name)

        # Fallback: generate new ID if not found (shouldn't happen in normal flow)
        if tool_call_id is None:
            logger.warning(
                f"[TOOL OUTPUT] No matching tool call ID found for {tool_name}, generating new ID"
            )
            tool_call_id = self._generate_tool_call_id()

        output = function_response.response

        # [EXPERIMENT] Log tool response for investigation
        logger.info(f"[EXPERIMENT] Tool response received: {tool_name}")
        logger.info(f"[EXPERIMENT] Tool call ID: {tool_call_id}")
        logger.info(f"[EXPERIMENT] Tool output: {json.dumps(output, indent=2, ensure_ascii=False)}")

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

            event = self._format_sse_event(
                {
                    "type": "data-image",
                    "data": {
                        "mediaType": mime_type,
                        "content": base64_content,
                    },
                }
            )
            return [event]

        # Unknown mime type - log warning and skip
        logger.warning(
            f"[INLINE DATA] Unknown mime_type={mime_type}, size={len(inline_data.data)} bytes - skipping"
        )
        return []

    async def finalize(
        self,
        usage_metadata: Any | None = None,
        error: Exception | None = None,
        finish_reason: Any | None = None,
    ) -> AsyncGenerator[str, None]:
        """
        Send final events to close the stream.

        Args:
            usage_metadata: Optional token usage information
            error: Optional error that occurred
            finish_reason: Optional ADK FinishReason enum

        Yields:
            Final SSE events
        """
        if error:
            yield self._format_sse_event({"type": "error", "error": str(error)})
        else:
            # Close any open text blocks (output transcription)
            if self._text_block_started and self._text_block_id:
                logger.debug(f"[TRANSCRIPTION] Closing text block in finalize: id={self._text_block_id}")
                yield self._format_sse_event({
                    "type": "text-end",
                    "id": self._text_block_id
                })
                self._text_block_started = False

            # Build finish event
            finish_event: dict[str, Any] = {"type": "finish"}

            # Add finish reason if available
            if finish_reason:
                finish_event["finishReason"] = map_adk_finish_reason_to_ai_sdk(
                    finish_reason
                )

            # Add usage metadata if available (via messageMetadata field)
            # AI SDK v6 finish event doesn't have a direct usage field,
            # but supports messageMetadata for arbitrary metadata
            if usage_metadata:
                finish_event["messageMetadata"] = {
                    "usage": {
                        "promptTokens": usage_metadata.prompt_token_count,
                        "completionTokens": usage_metadata.candidates_token_count,
                        "totalTokens": usage_metadata.total_token_count,
                    }
                }

            yield self._format_sse_event(finish_event)

        # Always send [DONE] marker
        logger.debug("[ADK→SSE] Sending [DONE] marker")
        yield "data: [DONE]\n\n"


async def stream_adk_to_ai_sdk(
    event_stream: AsyncGenerator[Event, None], message_id: str | None = None
) -> AsyncGenerator[str, None]:
    """
    Convert ADK event stream to AI SDK v6 Data Stream Protocol.

    Args:
        event_stream: AsyncGenerator of ADK Event objects
        message_id: Optional message ID

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

    try:
        async for event in event_stream:
            # Convert and yield event: all event should be processed here!!
            async for sse_event in converter.convert_event(event):
                yield sse_event

            # But, extract usage metadata if present (for finalization)
            if hasattr(event, "usage_metadata") and event.usage_metadata:
                usage_metadata_list.append(event.usage_metadata)
            # Extract finish reason if present
            if hasattr(event, "finish_reason") and event.finish_reason:
                finish_reason_list.append(event.finish_reason)

    except Exception as e:
        logger.error(f"Error in ADK stream conversion: {e}")
        error_list.append(e)
    finally:
        # Send final events with usage metadata and finish reason
        # (For SSE mode or error cases)
        # TODO: finalize event send from not convert_event() logic to be move carefully!
        # async for final_event in converter.finalize(
        #     usage_metadata=usage_metadata, error=error, finish_reason=finish_reason
        # ):
        #     yield final_event
        for error in error_list:
            logger.error(f"[stream_adk_to_ai_sdk] try finally: error {error}")
        for usage_metadata in usage_metadata_list:
            logger.error(f"[stream_adk_to_ai_sdk] try finally: usage_metadata {usage_metadata}")
        for finish_reason in finish_reason_list:
            logger.error(f"[stream_adk_to_ai_sdk] try finally: finish_reason {finish_reason}")

