"""
Tests for output_transcription processing with real ADK response data.

This test suite uses actual ADK Event data captured from live BIDI sessions
to ensure correct handling of output_transcription fields from native-audio models.

Real response data source:
- Captured from: logs/server_20251212_112952.log (Kyoto weather query)
- Model: gemini-2.5-flash-native-audio-preview-09-2025
- Configuration: AUDIO modality with AudioTranscriptionConfig

Key finding:
- output_transcription appears at Event level (not in content.parts)
- Contains `text` and `finished` fields
- Generated when native-audio model produces audio responses

AI SDK v6 Protocol mapping:
- output_transcription → text-start/delta/end events
- Requires unique `id` field for text block tracking
- Uses `delta` field (not `textDelta`) per AI SDK v6 spec
"""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import Mock

import pytest
from google.adk.events import Event

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


class MockTranscription:
    """Mock Transcription object matching ADK structure."""

    def __init__(self, text: str, finished: bool):
        self.text = text
        self.finished = finished

    def __repr__(self) -> str:
        return f"Transcription(finished={self.finished}, text='{self.text}')"


class TestOutputTranscriptionRealResponse:
    """Tests using real ADK Event data with output_transcription."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "transcription_text,transcription_finished,expected_events",
        [
            pytest.param(
                # Real data from Kyoto weather query (logs/server_20251212_112952.log:144-147)
                "The weather in Kyoto is broken clouds with a temperature of 7.3°C. "
                "It feels like 7.3°C, humidity is 60%, and the wind speed is 0.89 m/s.",
                False,  # finished=False in real response
                [
                    {
                        "type": "text-start",
                        "id": "test_text",  # Will be generated dynamically
                    },
                    {
                        "type": "text-delta",
                        "id": "test_text",
                        "delta": "The weather in Kyoto is broken clouds with a temperature of 7.3°C. "
                        "It feels like 7.3°C, humidity is 60%, and the wind speed is 0.89 m/s.",
                    },
                    # No text-end because finished=False
                ],
                id="kyoto_weather_finished_false",
            ),
            pytest.param(
                "Test transcription with finish marker",
                True,  # finished=True
                [
                    {"type": "text-start", "id": "test_text"},
                    {
                        "type": "text-delta",
                        "id": "test_text",
                        "delta": "Test transcription with finish marker",
                    },
                    {"type": "text-end", "id": "test_text"},  # text-end because finished=True
                ],
                id="transcription_finished_true",
            ),
        ],
    )
    async def test_output_transcription_conversion(
        self,
        transcription_text: str,
        transcription_finished: bool,
        expected_events: list[dict[str, Any]],
    ):
        """
        Test output_transcription → AI SDK v6 events conversion.

        Verifies:
        - text-start event is sent first (with unique id)
        - text-delta event contains transcription text (in `delta` field)
        - text-end event is sent only if finished=True
        - All events share the same id for text block tracking
        """
        # given: Real ADK Event with output_transcription
        converter = StreamProtocolConverter()
        mock_event = Mock(spec=Event)
        mock_event.content = None
        mock_event.turn_complete = None
        mock_event.usage_metadata = None
        mock_event.finish_reason = None

        # Create transcription object matching real ADK structure
        mock_event.output_transcription = MockTranscription(
            text=transcription_text, finished=transcription_finished
        )

        # when: Convert event to AI SDK v6 format
        sse_events = []
        async for event in converter.convert_event(mock_event):
            sse_events.append(event)

        # then: Verify correct AI SDK v6 events
        parsed_events = [parse_sse_event(sse) for sse in sse_events]

        # First event should be message start (always sent by converter)
        assert parsed_events[0]["type"] == "start"
        assert "messageId" in parsed_events[0]

        # Remaining events are transcription events
        text_events = parsed_events[1:]

        # Extract text block id from first text event (dynamically generated)
        assert text_events[0]["type"] == "text-start"
        text_block_id = text_events[0]["id"]

        # Verify all text events match expected format
        assert len(text_events) == len(expected_events)

        for i, expected in enumerate(expected_events):
            actual = text_events[i]
            assert actual["type"] == expected["type"]

            if "id" in expected:
                assert actual["id"] == text_block_id

            if "delta" in expected:
                assert actual["delta"] == expected["delta"]

    @pytest.mark.asyncio
    async def test_output_transcription_multiple_chunks(self):
        """
        Test handling of multiple output_transcription events (streaming).

        In real BIDI sessions, ADK may send multiple Events with output_transcription
        as the audio response is generated. Each should produce a text-delta event.
        """
        # given: Converter and multiple transcription chunks
        converter = StreamProtocolConverter()

        chunks = [
            ("The weather in", False),
            (" Kyoto is broken clouds", False),
            (" with a temperature of 7.3°C.", True),
        ]

        all_events = []

        # when: Process each chunk
        for text, finished in chunks:
            mock_event = Mock(spec=Event)
            mock_event.content = None
            mock_event.turn_complete = None
            mock_event.usage_metadata = None
            mock_event.finish_reason = None
            mock_event.output_transcription = MockTranscription(text=text, finished=finished)

            async for event in converter.convert_event(mock_event):
                all_events.append(event)

        # then: Verify event sequence
        parsed = [parse_sse_event(e) for e in all_events]

        # Note: Converter only sends "start" event for the FIRST event it processes
        # First chunk: start (message start) + text-start + text-delta
        assert parsed[0]["type"] == "start"  # message start (only on first chunk)
        assert parsed[1]["type"] == "text-start"
        text_id = parsed[1]["id"]
        assert parsed[2]["type"] == "text-delta"
        assert parsed[2]["delta"] == "The weather in"

        # Second chunk: text-delta only (converter.has_started=True, so no "start")
        assert parsed[3]["type"] == "text-delta"
        assert parsed[3]["id"] == text_id
        assert parsed[3]["delta"] == " Kyoto is broken clouds"

        # Third chunk: text-delta + text-end (finished=True)
        assert parsed[4]["type"] == "text-delta"
        assert parsed[4]["delta"] == " with a temperature of 7.3°C."
        assert parsed[5]["type"] == "text-end"
        assert parsed[5]["id"] == text_id

    @pytest.mark.asyncio
    async def test_no_output_transcription(self):
        """
        Test that Events without output_transcription don't produce text events.

        Most ADK Events don't have output_transcription (only native-audio models
        in AUDIO modality generate them). Events without this field should not
        produce any text-start/delta/end events.
        """
        # given: Event without output_transcription
        converter = StreamProtocolConverter()
        mock_event = Mock(spec=Event)
        mock_event.content = None
        mock_event.turn_complete = None
        mock_event.usage_metadata = None
        mock_event.finish_reason = None
        # No output_transcription attribute

        # when: Convert event
        sse_events = []
        async for event in converter.convert_event(mock_event):
            sse_events.append(event)

        # then: Should only have message start event (no text events)
        parsed = [parse_sse_event(e) for e in sse_events]
        assert len(parsed) == 1
        assert parsed[0]["type"] == "start"
        assert "messageId" in parsed[0]
