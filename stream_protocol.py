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
        return f"data: {json.dumps(event_data)}\n\n"

    async def convert_event(self, event: Event) -> AsyncGenerator[str, None]:
        """
        Convert a single ADK event to AI SDK v6 SSE events.

        Args:
            event: ADK Event object

        Yields:
            SSE-formatted event strings
        """
        # DEBUG: Log event details
        logger.debug(f"[CONVERT_EVENT] Event type: {type(event)}, has content: {event.content is not None}")
        if event.content:
            logger.debug(f"[CONVERT_EVENT] Content has {len(event.content.parts) if event.content.parts else 0} parts")
            if event.content.parts:
                for i, part in enumerate(event.content.parts):
                    part_attrs = [attr for attr in dir(part) if not attr.startswith('_') and hasattr(part, attr) and getattr(part, attr) is not None]
                    logger.debug(f"[CONVERT_EVENT] Part {i}: type={type(part)}, attrs={part_attrs}")
                    if hasattr(part, "text") and part.text:
                        logger.debug(f"[CONVERT_EVENT] Part {i} has TEXT: {part.text[:100]}...")
                    if hasattr(part, "inline_data") and part.inline_data:
                        logger.debug(f"[CONVERT_EVENT] Part {i} has INLINE_DATA: mime={getattr(part.inline_data, 'mime_type', None)}, size={len(part.inline_data.data) if hasattr(part.inline_data, 'data') else 0}")

        # Send start event on first event
        if not self.has_started:
            yield self._format_sse_event(
                {"type": "start", "messageId": self.message_id}
            )
            self.has_started = True

        # Process event content parts
        if event.content and event.content.parts:
            for part in event.content.parts:
                # Text content
                if hasattr(part, "text") and part.text:
                    for sse_event in self._process_text_part(part.text):
                        yield sse_event

                # Thought/Reasoning content (Gemini 2.0)
                if (
                    hasattr(part, "thought")
                    and part.thought
                    and isinstance(part.thought, str)
                ):
                    for sse_event in self._process_thought_part(part.thought):
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

    def _process_text_part(self, text: str) -> list[str]:
        """Process text part into text-* events."""
        part_id = self._generate_part_id()
        logger.info(f"[TEXT PART] Processing text (part_id={part_id}): {text[:100]}...")
        events = [
            self._format_sse_event({"type": "text-start", "id": part_id}),
            self._format_sse_event(
                {"type": "text-delta", "id": part_id, "delta": text}
            ),
            self._format_sse_event({"type": "text-end", "id": part_id}),
        ]
        return events

    def _process_thought_part(self, thought: str) -> list[str]:
        """Process thought part into reasoning-* events."""
        part_id = self._generate_part_id()
        events = [
            self._format_sse_event({"type": "reasoning-start", "id": part_id}),
            self._format_sse_event(
                {"type": "reasoning-delta", "id": part_id, "delta": thought}
            ),
            self._format_sse_event({"type": "reasoning-end", "id": part_id}),
        ]
        return events

    def _process_function_call(self, function_call: types.FunctionCall) -> list[str]:
        """Process function call into tool-call-* events."""
        tool_call_id = self._generate_tool_call_id()
        tool_name = function_call.name
        tool_args = function_call.args

        # Store mapping so function_response can use the same ID
        self.tool_call_id_map[tool_name] = tool_call_id

        events = [
            self._format_sse_event(
                {
                    "type": "tool-call-start",
                    "toolCallId": tool_call_id,
                    "toolName": tool_name,
                }
            ),
            self._format_sse_event(
                {
                    "type": "tool-call-available",
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
        """Process function response into tool-result-available event."""
        # Retrieve the tool call ID from the map to match with the function call
        tool_name = function_response.name
        tool_call_id = self.tool_call_id_map.get(tool_name)

        # Fallback: generate new ID if not found (shouldn't happen in normal flow)
        if tool_call_id is None:
            logger.warning(
                f"[TOOL RESULT] No matching tool call ID found for {tool_name}, generating new ID"
            )
            tool_call_id = self._generate_tool_call_id()

        output = function_response.response

        event = self._format_sse_event(
            {
                "type": "tool-result-available",
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
        from io import BytesIO

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

            logger.info(
                f"[AUDIO PCM] Sending chunk #{self.pcm_chunk_count}: "
                f"size={len(inline_data.data)} bytes, "
                f"total={self.pcm_total_bytes} bytes"
            )

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

            logger.info(
                f"[AUDIO OUTPUT] media_type={mime_type}, "
                f"size={len(inline_data.data)} bytes, "
                f"base64_size={len(base64_content)} chars"
            )

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
            from PIL import Image

            # Convert bytes to base64 string
            base64_content = base64.b64encode(inline_data.data).decode("utf-8")

            # Get image dimensions using PIL
            with Image.open(BytesIO(inline_data.data)) as img:
                width, height = img.size
                image_format = img.format

            logger.info(
                f"[IMAGE OUTPUT] media_type={mime_type}, "
                f"size={len(inline_data.data)} bytes, "
                f"dimensions={width}x{height}, "
                f"format={image_format}, "
                f"base64_size={len(base64_content)} chars"
            )

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
        error: Exception | None = None,
    ) -> AsyncGenerator[str, None]:
        """
        Send final events to close the stream.

        Args:
            finish_reason: Reason for stream completion
            usage_metadata: Optional token usage information
            error: Optional error that occurred

        Yields:
            Final SSE events
        """
        # Log PCM streaming completion
        if self.pcm_chunk_count > 0:
            duration = self.pcm_total_bytes / (self.pcm_sample_rate or 24000) / 2  # 16-bit = 2 bytes per sample
            logger.info(
                f"[AUDIO PCM] Streaming completed: "
                f"chunks={self.pcm_chunk_count}, "
                f"total_bytes={self.pcm_total_bytes}, "
                f"duration={duration:.2f}s, "
                f"sample_rate={self.pcm_sample_rate}Hz"
            )

        if error:
            yield self._format_sse_event({"type": "error", "error": str(error)})
        else:
            # Send finish event (AI SDK v6 format)
            # Per v6 spec: finish event is simple {"type":"finish"} without finishReason or usage
            # Reference: https://v6.ai-sdk.dev/docs/ai-sdk-ui/stream-protocol
            yield self._format_sse_event({"type": "finish"})

        # Always send [DONE] marker
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
    error = None

    try:
        async for event in event_stream:
            # Convert and yield event
            async for sse_event in converter.convert_event(event):
                yield sse_event

    except Exception as e:
        logger.error(f"Error in ADK stream conversion: {e}")
        error = e

    finally:
        # Send final events
        async for final_event in converter.finalize(error):
            yield final_event
