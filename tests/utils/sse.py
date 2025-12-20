"""SSE (Server-Sent Events) test utilities.

This module provides helper functions and mock objects for testing
SSE protocol conversion in the ADK to AI SDK v6 data stream protocol.
"""


import json
from typing import Any


def parse_sse_event(sse_string: str) -> dict[str, Any]:
    """Parse SSE format 'data: {json}\\n\\n' to dict.

    Args:
        sse_string: SSE formatted string (e.g., "data: {...}\\n\\n")

    Returns:
        Parsed JSON dict from the SSE data field

    Raises:
        ValueError: If the string is not in valid SSE format

    Examples:
        >>> parse_sse_event('data: {"type": "start"}\\n\\n')
        {'type': 'start'}
        >>> parse_sse_event('data: [DONE]\\n\\n')
        {'type': 'DONE'}
    """
    if sse_string.startswith("data: "):
        data_part = sse_string[6:].strip()
        if data_part == "[DONE]":
            return {"type": "DONE"}
        return json.loads(data_part)
    msg = f"Invalid SSE format: {sse_string}"
    raise ValueError(msg)


class MockTranscription:
    """Mock Transcription object matching ADK structure.

    ADK's Event.input_transcription and Event.output_transcription
    fields use a Transcription object with text and finished fields.
    This mock allows testing without real ADK objects.

    Attributes:
        text: The transcribed text content
        finished: Whether the transcription is complete
    """

    def __init__(self, text: str, finished: bool):
        """Initialize mock transcription.

        Args:
            text: The transcribed text
            finished: Whether transcription is complete
        """
        self.text = text
        self.finished = finished

    def __repr__(self) -> str:
        """Return string representation."""
        return f"Transcription(finished={self.finished}, text='{self.text}')"
