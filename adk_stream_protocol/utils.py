import json
from typing import Any

from .result import Error, Ok, Result


def _parse_json_safely(json_str: str) -> Result[dict[str, Any], str]:
    """
    Safely parse JSON string, returning Result instead of raising.

    Args:
        json_str: JSON string to parse

    Returns:
        Ok(dict) if parsing succeeds, Error(str) if parsing fails
    """
    try:  # nosemgrep: forbid-try-except
        parsed = json.loads(json_str)
        return Ok(parsed)
    except json.JSONDecodeError as e:
        return Error(f"JSON decode error: {e!s}")


def _parse_sse_event_data(sse_event: str) -> Result[dict[str, Any], str]:
    """
    Parse SSE event data from formatted string.

    Args:
        sse_event: SSE-formatted string like 'data: {...}\\n\\n'

    Returns:
        Ok(event_data) if parsing succeeds, Error(str) if parsing fails
    """
    if not sse_event.startswith("data:"):
        return Error("Event does not start with 'data:'")

    json_str = sse_event[5:].strip()  # Remove "data:" prefix
    return _parse_json_safely(json_str)
