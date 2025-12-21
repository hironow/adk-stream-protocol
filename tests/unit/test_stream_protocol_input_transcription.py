"""
Tests for input_transcription processing with ADK Event data.

Input transcription handles user's audio input → text conversion.
This is relevant for BIDI mode where user sends audio and ADK transcribes it.

Expected behavior:
- input_transcription appears at Event level (like output_transcription)
- Contains `text` and `finished` fields
- Should be mapped to AI SDK v6 events for client display

AI SDK v6 Protocol mapping (TBD):
- Option 1: text-start/delta/end with role indicator
- Option 2: Custom data-input-transcription event
- Option 3: Part of message reconstruction

RED phase: These tests will fail until implementation is added.
"""

from typing import Any

import pytest

from adk_stream_protocol import StreamProtocolConverter
from tests.utils import MockTranscription, parse_sse_event
from tests.utils.mocks import create_custom_event


class TestInputTranscription:
    """Tests for input_transcription processing."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "transcription_data,expected_event_types",
        [
            pytest.param(
                {
                    "text": "京都の天気は",
                    "finished": False,
                },
                ["text-delta"],
                id="input_transcription_not_finished",
            ),
            pytest.param(
                {
                    "text": "？",
                    "finished": True,
                },
                ["text-delta", "text-end"],
                id="input_transcription_finished",
            ),
        ],
    )
    async def test_input_transcription_conversion(
        self,
        transcription_data: dict[str, Any],
        expected_event_types: list[str],
    ):
        """
        Test: event.input_transcription → text events (for user audio input)

        RED phase: Will fail until implementation is added.

        Expected behavior:
        - input_transcription.text → text-delta event
        - input_transcription.finished=True → text-end event
        - Should track text blocks like output_transcription
        """

        # given: ADK Event with input_transcription (user audio input)
        converter = StreamProtocolConverter()

        mock_event = create_custom_event(
            content=None,  # No content, only transcription
            turn_complete=False,
            input_transcription=MockTranscription(
                text=transcription_data["text"],
                finished=transcription_data["finished"],
            ),
            output_transcription=None,
            error_code=None,
        )

        # when: Convert event to AI SDK format
        events = []
        async for sse_event in converter._convert_event(mock_event):
            events.append(sse_event)

        # then: Should generate expected event types
        parsed_events = [parse_sse_event(e) for e in events]
        event_types = [e["type"] for e in parsed_events]

        # Should always include text-start on first chunk (new converter)
        assert "text-start" in event_types, "Missing text-start event"

        for expected_type in expected_event_types:
            assert expected_type in event_types, f"Missing event type: {expected_type}"

        # Verify text-delta contains the transcription text
        text_delta_events = [e for e in parsed_events if e["type"] == "text-delta"]
        assert len(text_delta_events) > 0
        assert text_delta_events[0]["delta"] == transcription_data["text"]

    @pytest.mark.asyncio
    async def test_input_transcription_multiple_chunks(self):
        """
        Test: Multiple input_transcription chunks form complete message

        RED phase: Will fail until implementation is added.

        Scenario: User says "京都の天気は？" in multiple chunks
        - Chunk 1: "京都の" (finished=False)
        - Chunk 2: "天気は" (finished=False)
        - Chunk 3: "？" (finished=True)
        """

        # given: Converter instance
        converter = StreamProtocolConverter()

        # Chunk 1: "京都の" (not finished)
        mock_event1 = create_custom_event(
            content=None,
            turn_complete=False,
            input_transcription=MockTranscription("京都の", finished=False),
            output_transcription=None,
            error_code=None,
        )

        # Chunk 2: "天気は" (not finished)
        mock_event2 = create_custom_event(
            content=None,
            turn_complete=False,
            input_transcription=MockTranscription("天気は", finished=False),
            output_transcription=None,
            error_code=None,
        )

        # Chunk 3: "？" (finished)
        mock_event3 = create_custom_event(
            content=None,
            turn_complete=False,
            input_transcription=MockTranscription("？", finished=True),
            output_transcription=None,
            error_code=None,
        )

        # when: Convert all events
        all_events = []
        for mock_event in [mock_event1, mock_event2, mock_event3]:
            async for sse_event in converter._convert_event(mock_event):
                all_events.append(sse_event)

        # then: Should generate text-start, 3 deltas, text-end
        parsed_events = [parse_sse_event(e) for e in all_events]
        event_types = [e["type"] for e in parsed_events]

        assert "text-start" in event_types
        assert event_types.count("text-delta") == 3
        assert "text-end" in event_types

        # Verify text deltas contain correct text
        text_deltas = [e for e in parsed_events if e["type"] == "text-delta"]
        assert text_deltas[0]["delta"] == "京都の"
        assert text_deltas[1]["delta"] == "天気は"
        assert text_deltas[2]["delta"] == "？"

        # CRITICAL: Verify ID stability across multiple events
        # All text events (start/delta/end) MUST use the same text block ID
        # This prevents accidental use of event.id which changes per event
        text_events = [
            e for e in parsed_events if e["type"] in ["text-start", "text-delta", "text-end"]
        ]
        unique_ids = {e["id"] for e in text_events}
        assert len(unique_ids) == 1, (
            f"Text block ID must be stable across multiple events. "
            f"Got {len(unique_ids)} different IDs: {unique_ids}. "
            f"This likely means event.id is being used instead of converter.message_id"
        )

    @pytest.mark.asyncio
    async def test_text_block_id_must_not_use_event_id(self):
        """
        REGRESSION GUARD: Text block ID must NOT use event.id

        Why this test exists:
        - Transcription streams across MULTIPLE events
        - Each event has a DIFFERENT event.id
        - AI SDK v6 requires STABLE text block IDs (same ID for start/delta/end)
        - Using event.id would break text reconstruction on client

        Bad implementation (DO NOT DO THIS):
            self._text_block_id = f"{event.id}_input"  # ❌ WRONG!

        Correct implementation:
            self._text_block_id = f"{self.message_id}_input_text"  # ✅ CORRECT

        This test verifies ID stability across events to catch such mistakes.
        """
        # given: Multiple events with DIFFERENT mock event.id values
        converter = StreamProtocolConverter()

        mock_event1 = create_custom_event(
            content=None,
            turn_complete=False,
            input_transcription=MockTranscription("First", finished=False),
            output_transcription=None,
            error_code=None,
            id="event-001",  # Different ID
        )

        mock_event2 = create_custom_event(
            content=None,
            turn_complete=False,
            input_transcription=MockTranscription("Second", finished=True),
            output_transcription=None,
            error_code=None,
            id="event-002",  # Different ID
        )

        # when: Convert events with DIFFERENT event.id values
        all_events = []
        for mock_event in [mock_event1, mock_event2]:
            async for sse_event in converter._convert_event(mock_event):
                all_events.append(sse_event)

        # then: Text block ID MUST be the same despite different event.id
        parsed_events = [parse_sse_event(e) for e in all_events]
        text_events = [
            e for e in parsed_events if e["type"] in ["text-start", "text-delta", "text-end"]
        ]

        # Extract unique text block IDs
        unique_ids = {e["id"] for e in text_events}

        # CRITICAL: Must be exactly 1 unique ID (not 2, even though we have 2 events)
        assert len(unique_ids) == 1, (
            f"Text block IDs must be stable across events with different event.id. "
            f"Expected 1 unique ID, got {len(unique_ids)}: {unique_ids}. "
            f"Event IDs were: event-001, event-002. "
            f"If you see 2 different text block IDs, event.id is likely being used (WRONG!)"
        )

    @pytest.mark.asyncio
    async def test_no_input_transcription(self):
        """
        Test: Event without input_transcription should not generate transcription events

        This should PASS even before implementing input transcription.
        Ensures backward compatibility.
        """

        # given: Event without input_transcription
        converter = StreamProtocolConverter()

        mock_event = create_custom_event(
            content=None,
            turn_complete=False,
            # No transcription fields
            input_transcription=None,
            output_transcription=None,
            error_code=None,
        )

        # when: Convert event
        events = []
        async for sse_event in converter._convert_event(mock_event):
            events.append(sse_event)

        # then: Should not generate any transcription events (text-start/delta/end)
        # but may generate other events like "start"
        parsed_events = [parse_sse_event(e) for e in events]
        transcription_event_types = [
            e["type"]
            for e in parsed_events
            if e["type"] in ["text-start", "text-delta", "text-end"]
        ]
        assert len(transcription_event_types) == 0, (
            f"Unexpected transcription events: {transcription_event_types}"
        )
