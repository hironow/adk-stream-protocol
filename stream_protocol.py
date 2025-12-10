"""
ADK to AI SDK v6 Data Stream Protocol Converter

This module provides utilities to convert ADK agent events to
AI SDK v6 Data Stream Protocol format (SSE).
"""

from __future__ import annotations

import json
import uuid
from typing import Any, AsyncGenerator

from google.adk.events import Event
from google.genai import types
from loguru import logger


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
        return f'data: {json.dumps(event_data)}\n\n'

    async def convert_event(self, event: Event) -> AsyncGenerator[str, None]:
        """
        Convert a single ADK event to AI SDK v6 SSE events.

        Args:
            event: ADK Event object

        Yields:
            SSE-formatted event strings
        """
        # Send start event on first event
        if not self.has_started:
            yield self._format_sse_event({
                "type": "start",
                "messageId": self.message_id
            })
            self.has_started = True

        # Process event content parts
        if event.content and event.content.parts:
            for part in event.content.parts:
                # Text content
                if hasattr(part, 'text') and part.text:
                    for sse_event in self._process_text_part(part.text):
                        yield sse_event

                # Thought/Reasoning content (Gemini 2.0)
                if hasattr(part, 'thought') and part.thought and isinstance(part.thought, str):
                    for sse_event in self._process_thought_part(part.thought):
                        yield sse_event

                # Function call (Tool call)
                if hasattr(part, 'function_call') and part.function_call:
                    for sse_event in self._process_function_call(part.function_call):
                        yield sse_event

                # Function response (Tool result)
                if hasattr(part, 'function_response') and part.function_response:
                    for sse_event in self._process_function_response(part.function_response):
                        yield sse_event

                # Code execution
                if hasattr(part, 'executable_code') and part.executable_code:
                    for sse_event in self._process_executable_code(part.executable_code):
                        yield sse_event

                if hasattr(part, 'code_execution_result') and part.code_execution_result:
                    for sse_event in self._process_code_result(part.code_execution_result):
                        yield sse_event

    def _process_text_part(self, text: str) -> list[str]:
        """Process text part into text-* events."""
        part_id = self._generate_part_id()
        events = [
            self._format_sse_event({"type": "text-start", "id": part_id}),
            self._format_sse_event({"type": "text-delta", "id": part_id, "delta": text}),
            self._format_sse_event({"type": "text-end", "id": part_id})
        ]
        return events

    def _process_thought_part(self, thought: str) -> list[str]:
        """Process thought part into reasoning-* events."""
        part_id = self._generate_part_id()
        events = [
            self._format_sse_event({"type": "reasoning-start", "id": part_id}),
            self._format_sse_event({"type": "reasoning-delta", "id": part_id, "delta": thought}),
            self._format_sse_event({"type": "reasoning-end", "id": part_id})
        ]
        return events

    def _process_function_call(self, function_call: types.FunctionCall) -> list[str]:
        """Process function call into tool-call-* events."""
        tool_call_id = self._generate_tool_call_id()
        tool_name = function_call.name
        tool_args = function_call.args

        events = [
            self._format_sse_event({
                "type": "tool-call-start",
                "toolCallId": tool_call_id,
                "toolName": tool_name
            }),
            self._format_sse_event({
                "type": "tool-call-available",
                "toolCallId": tool_call_id,
                "toolName": tool_name,
                "input": tool_args
            })
        ]
        return events

    def _process_function_response(self, function_response: types.FunctionResponse) -> list[str]:
        """Process function response into tool-result-available event."""
        tool_call_id = self._generate_tool_call_id()
        output = function_response.response

        event = self._format_sse_event({
            "type": "tool-result-available",
            "toolCallId": tool_call_id,
            "output": output
        })
        return [event]

    def _process_executable_code(self, code: types.ExecutableCode) -> list[str]:
        """Process executable code as custom data event."""
        event = self._format_sse_event({
            "type": "data-executable-code",
            "data": {
                "language": code.language,
                "code": code.code
            }
        })
        return [event]

    def _process_code_result(self, result: types.CodeExecutionResult) -> list[str]:
        """Process code execution result as custom data event."""
        event = self._format_sse_event({
            "type": "data-code-execution-result",
            "data": {
                "outcome": result.outcome,
                "output": result.output
            }
        })
        return [event]

    async def finalize(
        self,
        finish_reason: str = "stop",
        usage_metadata: types.GenerateContentResponseUsageMetadata | None = None,
        error: Exception | None = None
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
        if error:
            yield self._format_sse_event({
                "type": "error",
                "error": str(error)
            })
        else:
            # Send finish event with reason
            finish_event: dict[str, Any] = {"type": "finish", "finishReason": finish_reason}

            # Add usage metadata if available
            if usage_metadata:
                finish_event["usage"] = {
                    "promptTokens": getattr(usage_metadata, 'prompt_token_count', 0),
                    "completionTokens": getattr(usage_metadata, 'candidates_token_count', 0),
                    "totalTokens": getattr(usage_metadata, 'total_token_count', 0)
                }

            yield self._format_sse_event(finish_event)

        # Always send [DONE] marker
        yield 'data: [DONE]\n\n'


async def stream_adk_to_ai_sdk(
    event_stream: AsyncGenerator[Event, None],
    message_id: str | None = None
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
    finish_reason = "stop"
    usage_metadata = None
    error = None

    try:
        async for event in event_stream:
            # Convert and yield event
            async for sse_event in converter.convert_event(event):
                yield sse_event

            # Track finish reason and usage metadata
            if hasattr(event, 'finish_reason') and event.finish_reason:
                finish_reason = str(event.finish_reason)
            if hasattr(event, 'usage_metadata') and event.usage_metadata:
                usage_metadata = event.usage_metadata

    except Exception as e:
        logger.error(f"Error in ADK stream conversion: {e}")
        error = e

    finally:
        # Send final events
        async for final_event in converter.finalize(finish_reason, usage_metadata, error):
            yield final_event
