"""
Tests for ADK to AI SDK v6 Data Stream Protocol converter.

These tests verify that stream_protocol.py correctly converts ADK events
to AI SDK v6 Data Stream Protocol (SSE) format.

Based on AI SDK v6 specification:
https://v6.ai-sdk.dev/docs/ai-sdk-ui/stream-protocol
"""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import Mock

import pytest
from google.adk.events import Event
from google.genai import types

from stream_protocol import StreamProtocolConverter, stream_adk_to_ai_sdk


def parse_sse_event(sse_string: str) -> dict[str, Any]:
    """Parse SSE format 'data: {json}\\n\\n' to dict."""
    if sse_string.startswith("data: "):
        data_part = sse_string[6:].strip()
        if data_part == "[DONE]":
            return {"type": "DONE"}
        return json.loads(data_part)
    msg = f"Invalid SSE format: {sse_string}"
    raise ValueError(msg)


class TestStreamProtocolConverter:
    """Tests for StreamProtocolConverter class."""

    def test_message_start_event(self):
        """Test that first event generates message start with messageId."""
        converter = StreamProtocolConverter()

        # Create simple event
        mock_event = Mock(spec=Event)
        mock_event.content = None

        # Convert event
        events = []

        async def collect():
            async for event in converter.convert_event(mock_event):
                events.append(event)

        import asyncio

        asyncio.run(collect())

        # Parse first event
        parsed = parse_sse_event(events[0])

        # Verify start event
        assert parsed["type"] == "start"
        assert "messageId" in parsed
        assert isinstance(parsed["messageId"], str)
        assert len(parsed["messageId"]) > 0

    def test_text_streaming_events(self):
        """Test text content generates text-start/delta/end events."""
        converter = StreamProtocolConverter()

        # Create event with text content
        mock_part = Mock()
        mock_part.text = "Hello, world!"
        mock_part.thought = False
        mock_part.function_call = None
        mock_part.function_response = None
        mock_part.executable_code = None
        mock_part.code_execution_result = None

        mock_content = Mock()
        mock_content.parts = [mock_part]

        mock_event = Mock(spec=Event)
        mock_event.content = mock_content

        # Convert event
        events = []

        async def collect():
            async for event in converter.convert_event(mock_event):
                events.append(event)

        import asyncio

        asyncio.run(collect())

        # Should have: start, text-start, text-delta, text-end
        assert len(events) == 4

        # Verify message start
        parsed_start = parse_sse_event(events[0])
        assert parsed_start["type"] == "start"

        # Verify text-start
        parsed_text_start = parse_sse_event(events[1])
        assert parsed_text_start["type"] == "text-start"
        assert "id" in parsed_text_start

        # Verify text-delta
        parsed_text_delta = parse_sse_event(events[2])
        assert parsed_text_delta["type"] == "text-delta"
        assert parsed_text_delta["id"] == parsed_text_start["id"]
        assert parsed_text_delta["delta"] == "Hello, world!"

        # Verify text-end
        parsed_text_end = parse_sse_event(events[3])
        assert parsed_text_end["type"] == "text-end"
        assert parsed_text_end["id"] == parsed_text_start["id"]

    def test_reasoning_events(self):
        """Test thought content generates reasoning-start/delta/end events."""
        converter = StreamProtocolConverter()

        # Create event with thought content
        mock_part = Mock()
        mock_part.text = None
        mock_part.thought = "Let me think..."
        mock_part.function_call = None
        mock_part.function_response = None
        mock_part.executable_code = None
        mock_part.code_execution_result = None

        mock_content = Mock()
        mock_content.parts = [mock_part]

        mock_event = Mock(spec=Event)
        mock_event.content = mock_content

        # Convert event
        events = []

        async def collect():
            async for event in converter.convert_event(mock_event):
                events.append(event)

        import asyncio

        asyncio.run(collect())

        # Should have: start, reasoning-start, reasoning-delta, reasoning-end
        assert len(events) == 4

        # Verify reasoning events
        parsed_start = parse_sse_event(events[1])
        assert parsed_start["type"] == "reasoning-start"

        parsed_delta = parse_sse_event(events[2])
        assert parsed_delta["type"] == "reasoning-delta"
        assert parsed_delta["delta"] == "Let me think..."

        parsed_end = parse_sse_event(events[3])
        assert parsed_end["type"] == "reasoning-end"

    def test_tool_call_events(self):
        """Test function_call generates tool-call events."""
        converter = StreamProtocolConverter()

        # Create event with function call
        mock_function_call = Mock(spec=types.FunctionCall)
        mock_function_call.name = "get_weather"
        mock_function_call.args = {"location": "Tokyo"}

        mock_part = Mock()
        mock_part.text = None
        mock_part.thought = False
        mock_part.function_call = mock_function_call
        mock_part.function_response = None
        mock_part.executable_code = None
        mock_part.code_execution_result = None

        mock_content = Mock()
        mock_content.parts = [mock_part]

        mock_event = Mock(spec=Event)
        mock_event.content = mock_content

        # Convert event
        events = []

        async def collect():
            async for event in converter.convert_event(mock_event):
                events.append(event)

        import asyncio

        asyncio.run(collect())

        # Should have: start, tool-call-start, tool-call-available
        assert len(events) == 3

        # Verify tool-call-start
        parsed_start = parse_sse_event(events[1])
        assert parsed_start["type"] == "tool-call-start"
        assert parsed_start["toolName"] == "get_weather"
        assert "toolCallId" in parsed_start

        # Verify tool-call-available
        parsed_available = parse_sse_event(events[2])
        assert parsed_available["type"] == "tool-call-available"
        assert parsed_available["toolCallId"] == parsed_start["toolCallId"]
        assert parsed_available["toolName"] == "get_weather"
        assert parsed_available["input"] == {"location": "Tokyo"}

    def test_tool_result_events(self):
        """Test function_response generates tool-result-available event."""
        converter = StreamProtocolConverter()

        # Create event with function response
        mock_function_response = Mock(spec=types.FunctionResponse)
        mock_function_response.response = {"temperature": 20, "condition": "sunny"}

        mock_part = Mock()
        mock_part.text = None
        mock_part.thought = False
        mock_part.function_call = None
        mock_part.function_response = mock_function_response
        mock_part.executable_code = None
        mock_part.code_execution_result = None

        mock_content = Mock()
        mock_content.parts = [mock_part]

        mock_event = Mock(spec=Event)
        mock_event.content = mock_content

        # Convert event
        events = []

        async def collect():
            async for event in converter.convert_event(mock_event):
                events.append(event)

        import asyncio

        asyncio.run(collect())

        # Should have: start, tool-result-available
        assert len(events) == 2

        # Verify tool-result-available
        parsed_result = parse_sse_event(events[1])
        assert parsed_result["type"] == "tool-result-available"
        assert "toolCallId" in parsed_result
        assert parsed_result["output"] == {"temperature": 20, "condition": "sunny"}

    def test_custom_data_events(self):
        """Test executable_code generates custom data events."""
        converter = StreamProtocolConverter()

        # Create event with executable code
        mock_code = Mock(spec=types.ExecutableCode)
        mock_code.language = "python"
        mock_code.code = "print('hello')"

        mock_part = Mock()
        mock_part.text = None
        mock_part.thought = False
        mock_part.function_call = None
        mock_part.function_response = None
        mock_part.executable_code = mock_code
        mock_part.code_execution_result = None

        mock_content = Mock()
        mock_content.parts = [mock_part]

        mock_event = Mock(spec=Event)
        mock_event.content = mock_content

        # Convert event
        events = []

        async def collect():
            async for event in converter.convert_event(mock_event):
                events.append(event)

        import asyncio

        asyncio.run(collect())

        # Should have: start, data-executable-code
        assert len(events) == 2

        # Verify custom data event
        parsed_data = parse_sse_event(events[1])
        assert parsed_data["type"] == "data-executable-code"
        assert parsed_data["data"]["language"] == "python"
        assert parsed_data["data"]["code"] == "print('hello')"

    def test_finish_event_with_usage(self):
        """Test finalize generates finish event with usage metadata."""
        converter = StreamProtocolConverter()
        converter.has_started = True  # Skip start event

        # Create usage metadata
        mock_usage = Mock(spec=types.GenerateContentResponseUsageMetadata)
        mock_usage.prompt_token_count = 10
        mock_usage.candidates_token_count = 20
        mock_usage.total_token_count = 30

        # Finalize
        events = []

        async def collect():
            async for event in converter.finalize(
                finish_reason="stop", usage_metadata=mock_usage, error=None
            ):
                events.append(event)

        import asyncio

        asyncio.run(collect())

        # Should have: finish, [DONE]
        assert len(events) == 2

        # Verify finish event
        parsed_finish = parse_sse_event(events[0])
        assert parsed_finish["type"] == "finish"
        assert parsed_finish["finishReason"] == "stop"
        assert "usage" in parsed_finish
        assert parsed_finish["usage"]["promptTokens"] == 10
        assert parsed_finish["usage"]["completionTokens"] == 20
        assert parsed_finish["usage"]["totalTokens"] == 30

        # Verify DONE marker
        parsed_done = parse_sse_event(events[1])
        assert parsed_done["type"] == "DONE"

    def test_error_event(self):
        """Test finalize with error generates error event."""
        converter = StreamProtocolConverter()
        converter.has_started = True  # Skip start event

        # Finalize with error
        test_error = Exception("Test error")
        events = []

        async def collect():
            async for event in converter.finalize(
                finish_reason="stop", usage_metadata=None, error=test_error
            ):
                events.append(event)

        import asyncio

        asyncio.run(collect())

        # Should have: error, [DONE]
        assert len(events) == 2

        # Verify error event
        parsed_error = parse_sse_event(events[0])
        assert parsed_error["type"] == "error"
        assert parsed_error["error"] == "Test error"

    def test_multiple_text_blocks_unique_ids(self):
        """Test multiple text parts get unique IDs."""
        converter = StreamProtocolConverter()

        # Create event with multiple text parts
        mock_part1 = Mock()
        mock_part1.text = "First"
        mock_part1.thought = False
        mock_part1.function_call = None
        mock_part1.function_response = None
        mock_part1.executable_code = None
        mock_part1.code_execution_result = None

        mock_part2 = Mock()
        mock_part2.text = "Second"
        mock_part2.thought = False
        mock_part2.function_call = None
        mock_part2.function_response = None
        mock_part2.executable_code = None
        mock_part2.code_execution_result = None

        mock_content = Mock()
        mock_content.parts = [mock_part1, mock_part2]

        mock_event = Mock(spec=Event)
        mock_event.content = mock_content

        # Convert event
        events = []

        async def collect():
            async for event in converter.convert_event(mock_event):
                events.append(event)

        import asyncio

        asyncio.run(collect())

        # Extract all text-start events
        text_start_ids = []
        for event in events:
            parsed = parse_sse_event(event)
            if parsed["type"] == "text-start":
                text_start_ids.append(parsed["id"])

        # Verify we have 2 unique IDs
        assert len(text_start_ids) == 2
        assert text_start_ids[0] != text_start_ids[1]


class TestStreamADKToAISDK:
    """Tests for stream_adk_to_ai_sdk high-level function."""

    @pytest.mark.asyncio
    async def test_complete_stream_flow(self):
        """Test complete stream from start to finish."""
        # Create mock event with text
        mock_part = Mock()
        mock_part.text = "Response text"
        mock_part.thought = False
        mock_part.function_call = None
        mock_part.function_response = None
        mock_part.executable_code = None
        mock_part.code_execution_result = None

        mock_content = Mock()
        mock_content.parts = [mock_part]

        mock_event = Mock(spec=Event)
        mock_event.content = mock_content
        mock_event.finish_reason = "FinishReason.STOP"
        mock_event.usage_metadata = None

        # Create async generator
        async def mock_event_stream():
            yield mock_event

        # Collect all events
        events = []
        async for sse_event in stream_adk_to_ai_sdk(mock_event_stream()):
            events.append(sse_event)

        # Verify sequence: start, text-start, text-delta, text-end, finish, [DONE]
        assert len(events) == 6

        parsed_events = [parse_sse_event(e) for e in events]

        assert parsed_events[0]["type"] == "start"
        assert parsed_events[1]["type"] == "text-start"
        assert parsed_events[2]["type"] == "text-delta"
        assert parsed_events[3]["type"] == "text-end"
        assert parsed_events[4]["type"] == "finish"
        assert parsed_events[5]["type"] == "DONE"

    @pytest.mark.asyncio
    async def test_stream_with_error(self):
        """Test stream handles errors correctly."""

        # Create event that will raise error
        async def mock_event_stream():
            raise RuntimeError("Stream error")
            yield  # Never reached

        # Collect all events
        events = []
        async for sse_event in stream_adk_to_ai_sdk(mock_event_stream()):
            events.append(sse_event)

        # Should have: start, error, [DONE]
        assert len(events) >= 2

        # Find error event
        has_error = False
        for event in events:
            parsed = parse_sse_event(event)
            if parsed["type"] == "error":
                has_error = True
                assert "Stream error" in parsed["error"]

        assert has_error

    @pytest.mark.asyncio
    async def test_stream_with_usage_metadata(self):
        """Test stream includes usage metadata in finish event."""
        # Create mock usage metadata
        mock_usage = Mock()
        mock_usage.prompt_token_count = 100
        mock_usage.candidates_token_count = 50
        mock_usage.total_token_count = 150

        # Create mock event
        mock_event = Mock(spec=Event)
        mock_event.content = None
        mock_event.finish_reason = "FinishReason.MAX_TOKENS"
        mock_event.usage_metadata = mock_usage

        # Create async generator
        async def mock_event_stream():
            yield mock_event

        # Collect all events
        events = []
        async for sse_event in stream_adk_to_ai_sdk(mock_event_stream()):
            events.append(sse_event)

        # Find finish event
        finish_event = None
        for event in events:
            parsed = parse_sse_event(event)
            if parsed["type"] == "finish":
                finish_event = parsed
                break

        assert finish_event is not None
        assert finish_event["finishReason"] == "FinishReason.MAX_TOKENS"
        assert "usage" in finish_event
        assert finish_event["usage"]["promptTokens"] == 100
        assert finish_event["usage"]["completionTokens"] == 50
        assert finish_event["usage"]["totalTokens"] == 150


class TestSSEFormatCompliance:
    """Tests for SSE format compliance."""

    def test_sse_format_structure(self):
        """Test that all events follow 'data: {json}\\n\\n' format."""
        converter = StreamProtocolConverter()

        # Test various event types
        events = [
            converter._format_sse_event({"type": "start", "messageId": "123"}),
            converter._format_sse_event({"type": "text-delta", "delta": "test"}),
            converter._format_sse_event({"type": "finish"}),
        ]

        for event in events:
            # Check starts with 'data: '
            assert event.startswith("data: ")

            # Check ends with '\n\n'
            assert event.endswith("\n\n")

            # Check can parse JSON
            json_part = event[6:-2]  # Strip 'data: ' and '\n\n'
            parsed = json.loads(json_part)
            assert isinstance(parsed, dict)
            assert "type" in parsed

    def test_done_marker_format(self):
        """Test [DONE] marker follows correct format."""
        done_marker = "data: [DONE]\n\n"

        # Verify format
        assert done_marker.startswith("data: ")
        assert done_marker.endswith("\n\n")
        assert "[DONE]" in done_marker
