"""
Comprehensive parameterized tests for ADK to AI SDK v6 Data Stream Protocol converter.

This test file corresponds 1:1 with agents/reviews.md coverage table.
Each test case validates a specific event type conversion from ADK to AI SDK v6.

Based on AI SDK v6 specification:
https://v6.ai-sdk.dev/docs/ai-sdk-ui/stream-protocol
"""

from __future__ import annotations

import asyncio
import base64
import json
from typing import Any
from unittest.mock import Mock

import pytest
from google.adk.events import Event
from google.genai import types

from stream_protocol import StreamProtocolConverter


def parse_sse_event(sse_string: str) -> dict[str, Any]:
    """Parse SSE format 'data: {json}\\n\\n' to dict."""
    if sse_string.startswith("data: "):
        data_part = sse_string[6:].strip()
        if data_part == "[DONE]":
            return {"type": "DONE"}
        return json.loads(data_part)
    msg = f"Invalid SSE format: {sse_string}"
    raise ValueError(msg)


def create_mock_part(**kwargs: Any) -> Mock:
    """Create a mock part with all attributes set to None/False, then override with kwargs."""
    part = Mock()
    part.text = kwargs.get("text", None)
    part.thought = kwargs.get("thought", False)
    part.function_call = kwargs.get("function_call", None)
    part.function_response = kwargs.get("function_response", None)
    part.executable_code = kwargs.get("executable_code", None)
    part.code_execution_result = kwargs.get("code_execution_result", None)
    part.inline_data = kwargs.get("inline_data", None)
    return part


async def convert_and_collect(
    converter: StreamProtocolConverter, event: Mock | Event
) -> list[str]:
    """Helper to convert event and collect all SSE strings."""
    events = []
    async for sse_event in converter.convert_event(event):
        events.append(sse_event)
    return events


# ============================================================
# Real ADK Type Helpers (replacing Mocks for type safety)
# ============================================================


def create_text_part(text: str) -> types.Part:
    """Create real ADK Part with text content."""
    return types.Part(text=text)


def create_reasoning_part(reasoning: str) -> types.Part:
    """
    Create real ADK Part with reasoning/thought content.

    According to Gemini API docs:
    - thought (boolean): indicates if this is a thought summary
    - text (string): contains the actual reasoning content when thought=True
    """
    return types.Part(text=reasoning, thought=True)


def create_function_call_part(name: str, args: dict[str, Any]) -> types.Part:
    """Create real ADK Part with function call."""
    function_call = types.FunctionCall(name=name, args=args)
    return types.Part(function_call=function_call)


def create_function_response_part(name: str, response: Any) -> types.Part:
    """
    Create real ADK Part with function response.

    Note: FunctionResponse.response expects dict, but we allow Any for testing
    purposes. Invalid types will be caught by Pydantic validation.
    """
    function_response = types.FunctionResponse(name=name, response=response)
    return types.Part(function_response=function_response)


def create_inline_data_part(mime_type: str, data: bytes) -> types.Part:
    """Create real ADK Part with inline data (image/binary)."""
    blob = types.Blob(mime_type=mime_type, data=data)
    return types.Part(inline_data=blob)


def create_content(role: str, parts: list[types.Part]) -> types.Content:
    """Create real ADK Content with parts."""
    return types.Content(role=role, parts=parts)


def create_event(author: str, content: types.Content) -> Event:
    """Create real ADK Event."""
    return Event(author=author, content=content)


class TestTextContentConversion:
    """Test Category 1: Text Content (reviews.md section 1)"""

    @pytest.mark.parametrize(
        "text_content,expected_event_types",
        [
            pytest.param(
                "Hello, world!",
                ["start", "text-start", "text-delta", "text-end"],
                id="text-streaming-basic",
            ),
            pytest.param(
                "Multi\nline\ntext",
                ["start", "text-start", "text-delta", "text-end"],
                id="text-streaming-multiline",
            ),
            pytest.param(
                "Unicode: 日本語 🎉",
                ["start", "text-start", "text-delta", "text-end"],
                id="text-streaming-unicode",
            ),
        ],
    )
    def test_text_content_events(
        self, text_content: str, expected_event_types: list[str]
    ):
        """
        Test: ADK text content → AI SDK v6 text-start/delta/end events

        Coverage: reviews.md Section 1 - Text Content
        - text-start
        - text-delta
        - text-end
        """
        converter = StreamProtocolConverter()

        # Create event with text content (using real ADK types)
        part = create_text_part(text_content)
        content = create_content(role="model", parts=[part])
        event = create_event(author="model", content=content)

        # Convert event
        events = asyncio.run(convert_and_collect(converter, event))

        # Verify event sequence
        parsed_events = [parse_sse_event(e) for e in events]
        actual_types = [e["type"] for e in parsed_events]
        assert actual_types == expected_event_types

        # Verify text content in delta
        text_delta_events = [e for e in parsed_events if e["type"] == "text-delta"]
        assert len(text_delta_events) == 1
        assert text_delta_events[0]["delta"] == text_content

        # Verify ID consistency
        text_events = [e for e in parsed_events if e["type"].startswith("text-")]
        text_ids = [e.get("id") for e in text_events]
        assert all(tid == text_ids[0] for tid in text_ids)  # All same ID


class TestReasoningContentConversion:
    """Test Category 2: Reasoning / Thinking (reviews.md section 2)"""

    @pytest.mark.parametrize(
        "thought_content,expected_event_types",
        [
            pytest.param(
                "Let me think...",
                ["start", "reasoning-start", "reasoning-delta", "reasoning-end"],
                id="reasoning-basic",
            ),
            pytest.param(
                "Step 1: Analyze\nStep 2: Conclude",
                ["start", "reasoning-start", "reasoning-delta", "reasoning-end"],
                id="reasoning-multiline",
            ),
        ],
    )
    def test_reasoning_content_events(
        self, thought_content: str, expected_event_types: list[str]
    ):
        """
        Test: ADK thought content → AI SDK v6 reasoning-start/delta/end events

        Coverage: reviews.md Section 2 - Reasoning Content
        - reasoning-start
        - reasoning-delta
        - reasoning-end

        Uses real ADK types (thought=True with text content).
        """
        converter = StreamProtocolConverter()

        # given: Create event with reasoning content (thought=True, text=reasoning)
        part = create_reasoning_part(thought_content)
        content = create_content(role="model", parts=[part])
        event = create_event(author="model", content=content)

        # when: Convert event
        events = asyncio.run(convert_and_collect(converter, event))

        # then: Verify event sequence
        parsed_events = [parse_sse_event(e) for e in events]
        actual_types = [e["type"] for e in parsed_events]
        assert actual_types == expected_event_types

        # then: Verify thought content in delta
        reasoning_delta_events = [
            e for e in parsed_events if e["type"] == "reasoning-delta"
        ]
        assert len(reasoning_delta_events) == 1
        assert reasoning_delta_events[0]["delta"] == thought_content


class TestToolExecutionConversion:
    """Test Category 3: Tool Execution (reviews.md section 3)"""

    @pytest.mark.parametrize(
        "tool_name,tool_args,expected_event_types",
        [
            pytest.param(
                "get_weather",
                {"location": "Tokyo"},
                ["start", "tool-call-start", "tool-call-available"],
                id="tool-call-simple",
            ),
            pytest.param(
                "search",
                {"query": "AI SDK", "limit": 10},
                ["start", "tool-call-start", "tool-call-available"],
                id="tool-call-with-multiple-args",
            ),
        ],
    )
    def test_tool_call_events(
        self, tool_name: str, tool_args: dict, expected_event_types: list[str]
    ):
        """
        Test: ADK function_call → AI SDK v6 tool-call-start/available events

        Coverage: reviews.md Section 3 - Tool Execution
        - tool-call-start
        - tool-call-available
        """
        converter = StreamProtocolConverter()

        # Create event with function call (using real ADK types)
        part = create_function_call_part(tool_name, tool_args)
        content = create_content(role="model", parts=[part])
        event = create_event(author="model", content=content)

        # Convert event
        events = asyncio.run(convert_and_collect(converter, event))

        # Verify event sequence
        parsed_events = [parse_sse_event(e) for e in events]
        actual_types = [e["type"] for e in parsed_events]
        assert actual_types == expected_event_types

        # Verify tool-call-start
        tool_start = [e for e in parsed_events if e["type"] == "tool-call-start"][0]
        assert tool_start["toolName"] == tool_name
        assert "toolCallId" in tool_start

        # Verify tool-call-available
        tool_available = [
            e for e in parsed_events if e["type"] == "tool-call-available"
        ][0]
        assert tool_available["toolName"] == tool_name
        assert tool_available["input"] == tool_args
        assert tool_available["toolCallId"] == tool_start["toolCallId"]

    @pytest.mark.parametrize(
        "tool_output,expected_event_types",
        [
            pytest.param(
                {"temperature": 20, "condition": "sunny"},
                ["start", "tool-result-available"],
                id="tool-result-object",
            ),
            pytest.param(
                {"status": "success", "message": "Operation completed"},
                ["start", "tool-result-available"],
                id="tool-result-with-status",
            ),
        ],
    )
    def test_tool_result_events(
        self, tool_output: Any, expected_event_types: list[str]
    ):
        """
        Test: ADK function_response → AI SDK v6 tool-result-available event

        Coverage: reviews.md Section 3 - Tool Execution
        - tool-result-available
        """
        converter = StreamProtocolConverter()

        # Create event with function response (using real ADK types)
        part = create_function_response_part("test_function", tool_output)
        content = create_content(role="model", parts=[part])
        event = create_event(author="model", content=content)

        # Convert event
        events = asyncio.run(convert_and_collect(converter, event))

        # Verify event sequence
        parsed_events = [parse_sse_event(e) for e in events]
        actual_types = [e["type"] for e in parsed_events]
        assert actual_types == expected_event_types

        # Verify tool-result-available
        tool_result = [
            e for e in parsed_events if e["type"] == "tool-result-available"
        ][0]
        assert tool_result["output"] == tool_output
        assert "toolCallId" in tool_result

    def test_tool_call_and_result_id_consistency(self):
        """
        Test: Tool call and result MUST share the same toolCallId.

        This is CRITICAL for AI SDK UI to match calls with results.
        Current implementation generates different IDs, causing UI bugs.

        Coverage: reviews.md Issue #1 - Tool Call ID マッピング問題
        Priority: 🔴 HIGH
        """
        converter = StreamProtocolConverter()

        # Create function call (using real ADK types)
        function_call = types.FunctionCall(
            name="get_weather", args={"location": "Tokyo"}
        )

        # Create function response (for the same tool call)
        function_response = types.FunctionResponse(
            name="get_weather", response={"temperature": 20, "condition": "sunny"}
        )

        # Process function call
        call_events = converter._process_function_call(function_call)

        # Process function response
        result_events = converter._process_function_response(function_response)

        # Parse SSE events
        call_parsed = [parse_sse_event(e) for e in call_events]
        result_parsed = [parse_sse_event(e) for e in result_events]

        # Extract toolCallIds
        call_start = [e for e in call_parsed if e["type"] == "tool-call-start"][0]
        call_available = [e for e in call_parsed if e["type"] == "tool-call-available"][
            0
        ]
        result_available = [
            e for e in result_parsed if e["type"] == "tool-result-available"
        ][0]

        call_id = call_start["toolCallId"]
        available_id = call_available["toolCallId"]
        result_id = result_available["toolCallId"]

        # CRITICAL: All three MUST have the same ID for UI to work
        assert call_id == available_id, (
            f"Call start and available IDs differ: {call_id} != {available_id}"
        )
        assert call_id == result_id, (
            f"Tool call and result IDs MUST match: {call_id} != {result_id}"
        )


class TestAudioContentConversion:
    """Test Category 4: Audio Content (reviews.md section 4)"""

    @pytest.mark.parametrize(
        "mime_type,audio_data,expected_event_type",
        [
            pytest.param(
                "audio/pcm;rate=24000",
                b"\x00\x01" * 100,  # 200 bytes of PCM data
                "data-pcm",
                id="audio-pcm-24000",
            ),
            pytest.param(
                "audio/pcm;rate=16000",
                b"\x00\x01" * 50,  # 100 bytes of PCM data
                "data-pcm",
                id="audio-pcm-16000",
            ),
        ],
    )
    def test_pcm_audio_events(
        self, mime_type: str, audio_data: bytes, expected_event_type: str
    ):
        """
        Test: ADK inline_data (PCM audio) → AI SDK v6 data-pcm custom event

        Coverage: reviews.md Section 4.1 - PCM Audio Streaming
        - data-pcm (custom)
        """
        converter = StreamProtocolConverter()

        # Create event with PCM audio
        mock_blob = types.Blob(mime_type=mime_type, data=audio_data)
        part = create_mock_part(inline_data=mock_blob)
        mock_content = Mock()
        mock_content.parts = [part]
        mock_event = Mock(spec=Event)
        mock_event.content = mock_content

        # Convert event
        events = asyncio.run(convert_and_collect(converter, mock_event))

        # Verify event sequence
        parsed_events = [parse_sse_event(e) for e in events]

        # Find data-pcm event
        pcm_events = [e for e in parsed_events if e["type"] == expected_event_type]
        assert len(pcm_events) == 1

        pcm_event = pcm_events[0]
        assert "data" in pcm_event
        assert "content" in pcm_event["data"]
        assert "sampleRate" in pcm_event["data"]
        assert "channels" in pcm_event["data"]
        assert "bitDepth" in pcm_event["data"]

        # Verify base64 encoding
        decoded = base64.b64decode(pcm_event["data"]["content"])
        assert decoded == audio_data

    @pytest.mark.parametrize(
        "mime_type,audio_data,expected_event_type",
        [
            pytest.param(
                "audio/mp3",
                b"MP3 data placeholder",
                "data-audio",
                id="audio-mp3",
            ),
            pytest.param(
                "audio/wav",
                b"WAV data placeholder",
                "data-audio",
                id="audio-wav",
            ),
        ],
    )
    def test_other_audio_formats(
        self, mime_type: str, audio_data: bytes, expected_event_type: str
    ):
        """
        Test: ADK inline_data (non-PCM audio) → AI SDK v6 data-audio custom event

        Coverage: reviews.md Section 4.2 - Other Audio Formats
        - data-audio (custom)

        Note: Frontend rendering for non-PCM audio is NOT implemented yet.
        """
        converter = StreamProtocolConverter()

        # Create event with non-PCM audio
        mock_blob = types.Blob(mime_type=mime_type, data=audio_data)
        part = create_mock_part(inline_data=mock_blob)
        mock_content = Mock()
        mock_content.parts = [part]
        mock_event = Mock(spec=Event)
        mock_event.content = mock_content

        # Convert event
        events = asyncio.run(convert_and_collect(converter, mock_event))

        # Verify event sequence
        parsed_events = [parse_sse_event(e) for e in events]

        # Find data-audio event
        audio_events = [e for e in parsed_events if e["type"] == expected_event_type]
        assert len(audio_events) == 1

        audio_event = audio_events[0]
        assert "data" in audio_event
        assert audio_event["data"]["mediaType"] == mime_type
        assert "content" in audio_event["data"]

        # Verify base64 encoding
        decoded = base64.b64decode(audio_event["data"]["content"])
        assert decoded == audio_data


class TestImageContentConversion:
    """Test Category 5: Image Content (reviews.md section 5)"""

    @pytest.mark.parametrize(
        "mime_type,image_format",
        [
            pytest.param("image/png", "PNG", id="image-png"),
            pytest.param("image/jpeg", "JPEG", id="image-jpeg"),
            pytest.param("image/webp", "WebP", id="image-webp"),
        ],
    )
    def test_image_output_events(self, mime_type: str, image_format: str):
        """
        Test: ADK inline_data (image) → AI SDK v6 data-image custom event

        Coverage: reviews.md Section 5 - Image Content
        - data-image (custom)
        """
        converter = StreamProtocolConverter()

        # Create 1x1 pixel image (universal base64)
        # This is a valid 1x1 red pixel PNG
        png_data = base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="
        )

        # Create event with image
        mock_blob = types.Blob(mime_type=mime_type, data=png_data)
        part = create_mock_part(inline_data=mock_blob)
        mock_content = Mock()
        mock_content.parts = [part]
        mock_event = Mock(spec=Event)
        mock_event.content = mock_content

        # Convert event
        events = asyncio.run(convert_and_collect(converter, mock_event))

        # Verify event sequence
        parsed_events = [parse_sse_event(e) for e in events]

        # Find data-image event
        image_events = [e for e in parsed_events if e["type"] == "data-image"]
        assert len(image_events) == 1

        image_event = image_events[0]
        assert "data" in image_event
        assert image_event["data"]["mediaType"] == mime_type
        assert "content" in image_event["data"]

        # Verify base64 encoding
        decoded = base64.b64decode(image_event["data"]["content"])
        assert decoded == png_data


class TestCodeExecutionConversion:
    """Test Category 6: Code Execution (reviews.md section 6)"""

    @pytest.mark.parametrize(
        "language,code,expected_event_type",
        [
            pytest.param(
                "python",
                "print('hello')",
                "data-executable-code",
                id="code-python",
            ),
            pytest.param(
                "javascript",
                "console.log('hello')",
                "data-executable-code",
                id="code-javascript",
            ),
        ],
    )
    def test_executable_code_events(
        self, language: str, code: str, expected_event_type: str
    ):
        """
        Test: ADK executable_code → AI SDK v6 data-executable-code custom event

        Coverage: reviews.md Section 6 - Code Execution
        - data-executable-code (custom)

        Note: Frontend rendering for code execution is NOT implemented yet.
        """
        converter = StreamProtocolConverter()

        # Create event with executable code
        mock_code = Mock(spec=types.ExecutableCode)
        mock_code.language = language
        mock_code.code = code

        part = create_mock_part(executable_code=mock_code)
        mock_content = Mock()
        mock_content.parts = [part]
        mock_event = Mock(spec=Event)
        mock_event.content = mock_content

        # Convert event
        events = asyncio.run(convert_and_collect(converter, mock_event))

        # Verify event sequence
        parsed_events = [parse_sse_event(e) for e in events]

        # Find data-executable-code event
        code_events = [e for e in parsed_events if e["type"] == expected_event_type]
        assert len(code_events) == 1

        code_event = code_events[0]
        assert "data" in code_event
        assert code_event["data"]["language"] == language
        assert code_event["data"]["code"] == code

    @pytest.mark.parametrize(
        "outcome,output,expected_event_type",
        [
            pytest.param(
                "OUTCOME_OK",
                "Output text",
                "data-code-execution-result",
                id="code-result-success",
            ),
            pytest.param(
                "OUTCOME_FAILED",
                "Error message",
                "data-code-execution-result",
                id="code-result-error",
            ),
        ],
    )
    def test_code_execution_result_events(
        self, outcome: str, output: str, expected_event_type: str
    ):
        """
        Test: ADK code_execution_result → AI SDK v6 data-code-execution-result custom event

        Coverage: reviews.md Section 6 - Code Execution
        - data-code-execution-result (custom)

        Note: Frontend rendering for code execution results is NOT implemented yet.
        """
        converter = StreamProtocolConverter()

        # Create event with code execution result
        mock_result = Mock(spec=types.CodeExecutionResult)
        mock_result.outcome = outcome
        mock_result.output = output

        part = create_mock_part(code_execution_result=mock_result)
        mock_content = Mock()
        mock_content.parts = [part]
        mock_event = Mock(spec=Event)
        mock_event.content = mock_content

        # Convert event
        events = asyncio.run(convert_and_collect(converter, mock_event))

        # Verify event sequence
        parsed_events = [parse_sse_event(e) for e in events]

        # Find data-code-execution-result event
        result_events = [e for e in parsed_events if e["type"] == expected_event_type]
        assert len(result_events) == 1

        result_event = result_events[0]
        assert "data" in result_event
        assert result_event["data"]["outcome"] == outcome
        assert result_event["data"]["output"] == output


class TestMessageControlConversion:
    """Test Category 7: Message Control (reviews.md section 7)"""

    def test_start_event(self):
        """
        Test: First event generates message start

        Coverage: reviews.md Section 7 - Message Control
        - start
        """
        converter = StreamProtocolConverter()

        # Create simple event
        mock_event = Mock(spec=Event)
        mock_event.content = None

        # Convert event
        events = asyncio.run(convert_and_collect(converter, mock_event))

        # Verify first event is start
        parsed = parse_sse_event(events[0])
        assert parsed["type"] == "start"
        assert "messageId" in parsed
        assert isinstance(parsed["messageId"], str)
        assert len(parsed["messageId"]) > 0

    def test_finish_event(self):
        """
        Test: finalize() generates finish event

        Coverage: reviews.md Section 7 - Message Control
        - finish
        """
        converter = StreamProtocolConverter()
        converter.has_started = True  # Skip start event

        # Finalize
        events = []

        async def collect():
            async for event in converter.finalize(error=None):
                events.append(event)

        asyncio.run(collect())

        # Verify finish event
        parsed_events = [parse_sse_event(e) for e in events]
        finish_events = [e for e in parsed_events if e["type"] == "finish"]
        assert len(finish_events) == 1

    def test_error_event(self):
        """
        Test: finalize(error) generates error event

        Coverage: reviews.md Section 7 - Message Control
        - error
        """
        converter = StreamProtocolConverter()
        converter.has_started = True  # Skip start event

        # Finalize with error
        test_error = Exception("Test error")
        events = []

        async def collect():
            async for event in converter.finalize(error=test_error):
                events.append(event)

        asyncio.run(collect())

        # Verify error event
        parsed_events = [parse_sse_event(e) for e in events]
        error_events = [e for e in parsed_events if e["type"] == "error"]
        assert len(error_events) == 1
        assert "Test error" in error_events[0]["error"]

    def test_done_marker(self):
        """
        Test: finalize() generates [DONE] marker

        Coverage: reviews.md Section 7 - Message Control
        - [DONE] marker
        """
        converter = StreamProtocolConverter()
        converter.has_started = True  # Skip start event

        # Finalize
        events = []

        async def collect():
            async for event in converter.finalize(error=None):
                events.append(event)

        asyncio.run(collect())

        # Verify DONE marker
        parsed_events = [parse_sse_event(e) for e in events]
        done_events = [e for e in parsed_events if e["type"] == "DONE"]
        assert len(done_events) == 1

    @pytest.mark.parametrize(
        "prompt_tokens,completion_tokens,expected_total",
        [
            pytest.param(100, 50, 150, id="normal-usage"),
            pytest.param(1000, 500, 1500, id="large-usage"),
            pytest.param(0, 0, 0, id="zero-usage"),
        ],
    )
    def test_usage_metadata_in_finish_event(
        self, prompt_tokens: int, completion_tokens: int, expected_total: int
    ):
        """
        Test: usage_metadata is converted to AI SDK format in finish event

        Coverage: reviews.md Section 9.1 - Usage Metadata
        - finish event with usage field
        - promptTokens, completionTokens, totalTokens
        """
        converter = StreamProtocolConverter()
        converter.has_started = True  # Skip start event

        # Create usage metadata
        mock_usage = Mock()
        mock_usage.prompt_token_count = prompt_tokens
        mock_usage.candidates_token_count = completion_tokens
        mock_usage.total_token_count = expected_total

        # Finalize with usage
        events = []

        async def collect():
            async for event in converter.finalize(
                usage_metadata=mock_usage, error=None
            ):
                events.append(event)

        asyncio.run(collect())

        # Parse all events
        parsed_events = [parse_sse_event(e) for e in events]

        # Find finish event
        finish_events = [e for e in parsed_events if e["type"] == "finish"]
        assert len(finish_events) == 1

        finish_event = finish_events[0]
        assert finish_event["type"] == "finish"
        assert "usage" in finish_event, "finish event must include usage field"
        assert finish_event["usage"]["promptTokens"] == prompt_tokens
        assert finish_event["usage"]["completionTokens"] == completion_tokens
        assert finish_event["usage"]["totalTokens"] == expected_total


class TestMultiPartMessages:
    """Test Category: Multi-part Messages (Complex scenarios)"""

    def test_text_and_image_combined(self):
        """
        Test: Message with both text and image parts

        Coverage: Complex multi-part message handling
        """
        converter = StreamProtocolConverter()

        # Create 1x1 pixel image
        png_data = base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="
        )

        # Create text part
        text_part = create_mock_part(text="Here is an image:")

        # Create image part
        image_part = create_mock_part(
            inline_data=types.Blob(mime_type="image/png", data=png_data)
        )

        mock_content = Mock()
        mock_content.parts = [text_part, image_part]

        mock_event = Mock(spec=Event)
        mock_event.content = mock_content

        # Convert event
        events = asyncio.run(convert_and_collect(converter, mock_event))

        # Verify event sequence
        parsed_events = [parse_sse_event(e) for e in events]
        event_types = [e["type"] for e in parsed_events]

        # Should have: start, text-start, text-delta, text-end, data-image
        assert event_types == [
            "start",
            "text-start",
            "text-delta",
            "text-end",
            "data-image",
        ]

        # Verify text content
        text_delta = [e for e in parsed_events if e["type"] == "text-delta"][0]
        assert text_delta["delta"] == "Here is an image:"

        # Verify image content
        image_event = [e for e in parsed_events if e["type"] == "data-image"][0]
        assert image_event["data"]["mediaType"] == "image/png"

    def test_text_and_tool_call_combined(self):
        """
        Test: Message with text and tool call parts

        Coverage: Complex multi-part message handling
        """
        converter = StreamProtocolConverter()

        # Create text part
        text_part = create_mock_part(text="Let me check the weather.")

        # Create tool call part
        mock_function_call = Mock(spec=types.FunctionCall)
        mock_function_call.name = "get_weather"
        mock_function_call.args = {"location": "Tokyo"}
        tool_part = create_mock_part(function_call=mock_function_call)

        mock_content = Mock()
        mock_content.parts = [text_part, tool_part]

        mock_event = Mock(spec=Event)
        mock_event.content = mock_content

        # Convert event
        events = asyncio.run(convert_and_collect(converter, mock_event))

        # Verify event sequence
        parsed_events = [parse_sse_event(e) for e in events]
        event_types = [e["type"] for e in parsed_events]

        # Should have: start, text events, tool-call events
        assert "start" in event_types
        assert "text-delta" in event_types
        assert "tool-call-start" in event_types
        assert "tool-call-available" in event_types

    def test_multiple_text_blocks_unique_ids(self):
        """
        Test: Multiple text parts get unique IDs

        Coverage: ID generation consistency
        """
        converter = StreamProtocolConverter()

        # Create multiple text parts
        part1 = create_mock_part(text="First")
        part2 = create_mock_part(text="Second")

        mock_content = Mock()
        mock_content.parts = [part1, part2]

        mock_event = Mock(spec=Event)
        mock_event.content = mock_content

        # Convert event
        events = asyncio.run(convert_and_collect(converter, mock_event))

        # Extract all text-start events
        parsed_events = [parse_sse_event(e) for e in events]
        text_start_ids = []
        for event in parsed_events:
            if event["type"] == "text-start":
                text_start_ids.append(event["id"])

        # Verify we have 2 unique IDs
        assert len(text_start_ids) == 2
        assert text_start_ids[0] != text_start_ids[1]
