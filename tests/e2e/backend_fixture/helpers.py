"""Helper functions for backend fixture-based E2E tests.

Provides utilities for:
- Loading frontend baseline fixtures
- Sending requests to backend (SSE/BIDI)
- Collecting and comparing rawEvents
- Validating [DONE] markers
"""

import asyncio
import json
from pathlib import Path
from typing import Any

import httpx
from loguru import logger


async def load_frontend_fixture(fixture_path: Path) -> dict[str, Any]:
    """Load frontend baseline fixture file.

    Args:
        fixture_path: Path to fixture JSON file

    Returns:
        Fixture dictionary with input/output fields
    """
    with fixture_path.open() as f:
        return json.load(f)


async def send_sse_request(
    messages: list[dict[str, Any]],
    backend_url: str = "http://localhost:8000/stream",
) -> list[str]:
    """Send SSE request to backend and collect rawEvents.

    Args:
        messages: Message history to send
        backend_url: Backend SSE endpoint URL

    Returns:
        List of SSE-format event strings (e.g., 'data: {...}\\n\\n')
    """
    raw_events: list[str] = []

    async with httpx.AsyncClient(timeout=30.0) as client:
        async with client.stream(
            "POST",
            backend_url,
            json={"messages": messages},
        ) as response:
            response.raise_for_status()

            async for line in response.aiter_lines():
                if line:  # Skip empty lines
                    # Reconstruct SSE format: "data: {...}\n\n"
                    raw_events.append(f"{line}\n\n")

    return raw_events


def extract_tool_call_ids_from_turn1(
    raw_events: list[str],
) -> tuple[str | None, str | None]:
    """Extract original and confirmation tool call IDs from Turn 1 events.

    Args:
        raw_events: List of SSE-format event strings from Turn 1

    Returns:
        Tuple of (original_tool_call_id, confirmation_id)
        - original_tool_call_id: ID of the original tool (e.g., process_payment)
        - confirmation_id: ID of the adk_request_confirmation tool
    """
    original_id = None
    confirmation_id = None

    for event in raw_events:
        if not event.startswith("data: "):
            continue
        if "[DONE]" in event:
            continue

        try:
            json_str = event[6:].strip()
            event_obj = json.loads(json_str)

            if event_obj.get("type") != "tool-input-available":
                continue

            tool_name = event_obj.get("toolName")
            tool_call_id = event_obj.get("toolCallId")

            # Extract original tool ID (first non-confirmation tool)
            if tool_name != "adk_request_confirmation" and original_id is None:
                original_id = tool_call_id

            # Extract confirmation tool ID
            if tool_name == "adk_request_confirmation":
                confirmation_id = tool_call_id

        except (json.JSONDecodeError, KeyError):
            continue

    return (original_id, confirmation_id)


def create_assistant_message_from_turn1(
    raw_events: list[str],
) -> dict[str, Any]:
    """Reconstruct assistant message from Turn 1 events.

    This creates an assistant message representing the Turn 1 response,
    which includes tool calls (both original tool and confirmation request).

    Args:
        raw_events: List of SSE-format event strings from Turn 1

    Returns:
        Assistant message dict with tool use parts
    """
    tool_parts = []

    for event in raw_events:
        if not event.startswith("data: "):
            continue
        if "[DONE]" in event:
            continue

        try:
            json_str = event[6:].strip()
            event_obj = json.loads(json_str)

            # Only process tool-input-available events
            if event_obj.get("type") != "tool-input-available":
                continue

            tool_name = event_obj.get("toolName")
            tool_call_id = event_obj.get("toolCallId")
            tool_input = event_obj.get("input", {})

            # Create tool use part
            if tool_name == "adk_request_confirmation":
                # Confirmation tool - use approval-requested state
                tool_parts.append(
                    {
                        "type": f"tool-{tool_name}",
                        "toolCallId": tool_call_id,
                        "toolName": tool_name,
                        "state": "approval-requested",
                        "input": tool_input,
                    }
                )
            else:
                # Regular tool - use call state
                tool_parts.append(
                    {
                        "type": f"tool-{tool_name}",
                        "toolCallId": tool_call_id,
                        "toolName": tool_name,
                        "state": "call",
                        "input": tool_input,
                    }
                )

        except (json.JSONDecodeError, KeyError):
            continue

    return {
        "role": "assistant",
        "parts": tool_parts,
    }


def create_approval_message(
    confirmation_id: str,
    original_tool_call_id: str,
) -> dict[str, Any]:
    """Create approval response message for Turn 2.

    Args:
        confirmation_id: Confirmation tool call ID from Turn 1
        original_tool_call_id: Original tool call ID (e.g., process_payment ID)

    Returns:
        Message dict with approval response
    """
    return {
        "role": "user",
        "parts": [
            {
                "type": "tool-adk_request_confirmation",
                "toolCallId": confirmation_id,
                "toolName": "adk_request_confirmation",
                "state": "approval-responded",
                "approval": {
                    "id": confirmation_id,
                    "approved": True,
                },
            }
        ],
    }


def create_denial_message(
    confirmation_id: str,
    original_tool_call_id: str,
    reason: str = "User rejected the operation",
) -> dict[str, Any]:
    """Create denial response message for Turn 2.

    Args:
        confirmation_id: Confirmation tool call ID from Turn 1
        original_tool_call_id: Original tool call ID (e.g., process_payment ID)
        reason: Optional reason for denial

    Returns:
        Message dict with denial response
    """
    return {
        "role": "user",
        "parts": [
            {
                "type": "tool-adk_request_confirmation",
                "toolCallId": confirmation_id,
                "toolName": "adk_request_confirmation",
                "state": "approval-responded",
                "approval": {
                    "id": confirmation_id,
                    "approved": False,
                    "reason": reason,
                },
            }
        ],
    }


async def send_bidi_request(
    messages: list[dict[str, Any]],
    backend_url: str = "ws://localhost:8000/live",
    timeout: float = 30.0,
) -> list[str]:
    """Send BIDI WebSocket request to backend and collect rawEvents.

    Note: WebSocket sends events in SSE format over WebSocket messages.

    Args:
        messages: Message history to send
        backend_url: Backend WebSocket endpoint URL
        timeout: Timeout in seconds for WebSocket operations (default: 30.0)

    Returns:
        List of SSE-format event strings (e.g., 'data: {...}\\n\\n')
    """
    import websockets

    raw_events = []
    websocket = None

    try:
        # Connect with timeout configuration to prevent lingering connections
        websocket = await websockets.connect(
            backend_url,
            open_timeout=timeout,
            close_timeout=10.0,
        )

        # Send message event with type field (BIDI protocol requirement)
        # BidiEventReceiver expects {"type": "message", "messages": [...]}
        await websocket.send(json.dumps({
            "type": "message",
            "messages": messages
        }))

        # Receive events until [DONE]
        while True:
            try:
                event = await asyncio.wait_for(websocket.recv(), timeout=timeout)
                raw_events.append(event)

                # Check for [DONE] marker
                if "[DONE]" in event:
                    break
            except websockets.exceptions.ConnectionClosed:
                break
            except TimeoutError:
                logger.warning(f"WebSocket recv timeout after {timeout}s")
                break
    finally:
        # Ensure WebSocket is properly closed to prevent lingering connections
        if websocket is not None:
            try:
                await websocket.close()
            except Exception as e:
                logger.debug(f"Error closing WebSocket: {e}")

    return raw_events


def count_done_markers(raw_events: list[str]) -> int:
    """Count [DONE] markers in rawEvents.

    Args:
        raw_events: List of SSE-format event strings

    Returns:
        Number of [DONE] markers found
    """
    return sum(1 for event in raw_events if "[DONE]" in event)


def normalize_event(event_str: str) -> str:
    """Normalize event for comparison by removing dynamic fields.

    Dynamic fields that change between runs:
    - messageId (UUIDs are always different)
    - toolCallId (contains UUIDs like "adk-...")
    - timestamp (ISO8601 strings)

    Args:
        event_str: SSE-format event string

    Returns:
        Normalized event string with dynamic fields replaced
    """
    # If it's a [DONE] marker, return as-is
    if "[DONE]" in event_str:
        return event_str

    # Parse JSON from "data: {...}\n\n" format
    if not event_str.startswith("data: "):
        return event_str

    try:
        json_str = event_str[6:].strip()  # Remove "data: " prefix
        event_obj = json.loads(json_str)

        # Replace dynamic messageId with placeholder
        if "messageId" in event_obj:
            event_obj["messageId"] = "DYNAMIC_MESSAGE_ID"

        # Replace dynamic toolCallId with placeholder
        if "toolCallId" in event_obj:
            # Keep tool name prefix if exists (e.g., "adk-...")
            if isinstance(event_obj["toolCallId"], str) and event_obj["toolCallId"].startswith("adk-"):
                event_obj["toolCallId"] = "adk-DYNAMIC_ID"
            else:
                event_obj["toolCallId"] = "DYNAMIC_TOOL_CALL_ID"

        # Replace timestamps in nested structures
        if "messageMetadata" in event_obj:
            # Keep usage and modelVersion, but these are usually stable
            pass

        # Reconstruct SSE format
        return f"data: {json.dumps(event_obj, separators=(',', ': '))}\n\n"

    except (json.JSONDecodeError, KeyError):
        # If parsing fails, return original
        return event_str


def validate_event_structure(
    actual_event: str,
    expected_event: str,
) -> tuple[bool, str]:
    """Validate that event structure matches, ignoring dynamic content.

    For tools with dynamic output (e.g., get_weather), we only validate:
    - Event type matches
    - Required fields exist
    - Field structure matches (nested objects)
    - Static metadata fields match (e.g., modelVersion)

    We ignore:
    - Dynamic output content (temperature, weather description, etc.)
    - AI response text (text-delta content)
    - Token counts (may vary with response length)

    Args:
        actual_event: Actual SSE event string
        expected_event: Expected SSE event string

    Returns:
        Tuple of (is_match, diff_message)
    """
    # Handle [DONE] markers
    if "[DONE]" in actual_event and "[DONE]" in expected_event:
        return (True, "")
    if "[DONE]" in actual_event or "[DONE]" in expected_event:
        return (False, "One event is [DONE], other is not")

    # Parse JSON from "data: {...}\n\n" format
    if not actual_event.startswith("data: ") or not expected_event.startswith("data: "):
        return (actual_event == expected_event, "Non-data event mismatch")

    try:
        actual_json = json.loads(actual_event[6:].strip())
        expected_json = json.loads(expected_event[6:].strip())

        # 1. Event type must match
        if actual_json.get("type") != expected_json.get("type"):
            return (
                False,
                f"Event type mismatch: actual={actual_json.get('type')}, "
                f"expected={expected_json.get('type')}",
            )

        event_type = actual_json.get("type")

        # 2. For tool-input-start: check structure (toolCallId and toolName exist)
        if event_type == "tool-input-start":
            if "toolCallId" not in actual_json or "toolCallId" not in expected_json:
                return (False, "Missing toolCallId field in tool-input-start")
            if "toolName" not in actual_json or "toolName" not in expected_json:
                return (False, "Missing toolName field in tool-input-start")
            # toolName should match (not dynamic)
            if actual_json.get("toolName") != expected_json.get("toolName"):
                return (
                    False,
                    f"toolName mismatch: actual={actual_json.get('toolName')}, "
                    f"expected={expected_json.get('toolName')}",
                )
            return (True, "")

        # 3. For tool-input-available: check structure but not input content
        if event_type == "tool-input-available":
            # toolCallId and toolName should exist
            if "toolCallId" not in actual_json or "toolCallId" not in expected_json:
                return (False, "Missing toolCallId field in tool-input-available")
            if "toolName" not in actual_json or "toolName" not in expected_json:
                return (False, "Missing toolName field in tool-input-available")
            # input field should exist
            if "input" not in actual_json or "input" not in expected_json:
                return (False, "Missing input field in tool-input-available")
            # toolName should match (not dynamic)
            if actual_json.get("toolName") != expected_json.get("toolName"):
                return (
                    False,
                    f"toolName mismatch: actual={actual_json.get('toolName')}, "
                    f"expected={expected_json.get('toolName')}",
                )
            # Input content is dynamic (LLM parameters vary), so don't validate exact values
            return (True, "")

        # 4. For tool-output-available: check structure but not content
        if event_type == "tool-output-available":
            # toolCallId should exist (normalized)
            if "toolCallId" not in actual_json or "toolCallId" not in expected_json:
                return (False, "Missing toolCallId field")
            # output field should exist
            if "output" not in actual_json or "output" not in expected_json:
                return (False, "Missing output field")
            # Both should have "cached" field with same value
            actual_cached = actual_json.get("output", {}).get("cached")
            expected_cached = expected_json.get("output", {}).get("cached")
            if actual_cached != expected_cached:
                return (
                    False,
                    f"Cached flag mismatch: actual={actual_cached}, expected={expected_cached}",
                )
            return (True, "")

        # 5. For text-delta: check structure only (not delta content)
        if event_type == "text-delta":
            if "id" not in actual_json or "delta" not in actual_json:
                return (False, "Missing id or delta field in text-delta")
            return (True, "")

        # 5.5. For text-start and text-end: check structure only (id field can vary between SSE and BIDI)
        if event_type in ("text-start", "text-end"):
            if "id" not in actual_json or "id" not in expected_json:
                return (False, f"Missing id field in {event_type}")
            # ID value can differ (SSE: "0", BIDI: "UUID_output_text"), so only check existence
            return (True, "")

        # 6. For finish: check structure and static fields
        if event_type == "finish":
            # finishReason should match
            if actual_json.get("finishReason") != expected_json.get("finishReason"):
                return (
                    False,
                    f"finishReason mismatch: actual={actual_json.get('finishReason')}, "
                    f"expected={expected_json.get('finishReason')}",
                )
            # modelVersion should match (required field)
            actual_version = actual_json.get("messageMetadata", {}).get("modelVersion")
            expected_version = expected_json.get("messageMetadata", {}).get("modelVersion")
            if actual_version != expected_version:
                return (
                    False,
                    f"modelVersion mismatch: actual={actual_version}, expected={expected_version}",
                )
            # usage is optional - only check if expected has it
            expected_metadata = expected_json.get("messageMetadata", {})
            if "usage" in expected_metadata:
                # If expected has usage, actual should also have it (but values can differ)
                if "usage" not in actual_json.get("messageMetadata", {}):
                    return (False, "Missing usage field in messageMetadata")
            return (True, "")

        # 7. For other event types: exact match after normalization
        return (actual_event == expected_event, "Event content mismatch")

    except (json.JSONDecodeError, KeyError) as e:
        return (False, f"Failed to parse event: {e}")


def compare_raw_events(
    actual: list[str],
    expected: list[str],
    normalize: bool = True,
    dynamic_content_tools: list[str] | None = None,
) -> tuple[bool, str]:
    """Compare actual vs expected rawEvents.

    Args:
        actual: Actual rawEvents from backend
        expected: Expected rawEvents from fixture
        normalize: Whether to normalize dynamic fields (default: True)
        dynamic_content_tools: List of tool names with dynamic output content.
                              For these tools, only event structure is validated,
                              not exact content (e.g., ['get_weather']).

    Returns:
        Tuple of (is_match, diff_message)
        - is_match: True if events match
        - diff_message: Human-readable diff if not match, empty if match
    """
    # Filter out audio and reasoning events from actual events
    # Baseline fixtures exclude these audio/thinking-specific events
    # Also filter text events with simple numeric IDs (thinking text display)
    actual_filtered = [
        e for e in actual
        if '"type": "data-pcm"' not in e
        and '"type": "reasoning-start"' not in e
        and '"type": "reasoning-delta"' not in e
        and '"type": "reasoning-end"' not in e
        and not ('"type": "text-' in e and '"id": "1"' in e)  # Filter thinking text display
    ]

    # Merge consecutive text-delta events with same id (for structure validation)
    # Native-audio models stream text character-by-character, but baseline fixtures
    # only care about structure (text-delta exists), not the exact count
    merged = []
    i = 0
    while i < len(actual_filtered):
        event = actual_filtered[i]

        # Check if this is a text-delta event
        if '"type": "text-delta"' in event:
            # Extract id from current event
            import json

            try:
                data = event.replace("data: ", "").strip()
                event_data = json.loads(data)
                current_id = event_data.get("id")

                # Skip all consecutive text-delta events with same id
                j = i + 1
                while j < len(actual_filtered) and '"type": "text-delta"' in actual_filtered[j]:
                    try:
                        next_data = actual_filtered[j].replace("data: ", "").strip()
                        next_event_data = json.loads(next_data)
                        next_id = next_event_data.get("id")

                        if current_id == next_id:
                            j += 1
                        else:
                            break
                    except (json.JSONDecodeError, KeyError):
                        break

                # Keep only the first text-delta with this id
                merged.append(event)
                i = j
            except (json.JSONDecodeError, KeyError):
                # If parsing fails, keep the event as-is
                merged.append(event)
                i += 1
        else:
            merged.append(event)
            i += 1

    actual_filtered = merged

    if len(actual_filtered) != len(expected):
        return (
            False,
            f"Event count mismatch (after filtering audio): actual={len(actual_filtered)}, expected={len(expected)}",
        )

    # Detect if we're testing a dynamic content tool
    use_structure_validation = False
    if dynamic_content_tools:
        # Check if any of the events contain these tool names OR are tool output/text events
        for event in actual_filtered + expected:
            # tool-output-available and text-delta always have dynamic content
            if '"type": "tool-output-available"' in event or '"type": "text-delta"' in event:
                use_structure_validation = True
                break
            # Also check for tool names in tool-input events
            for tool_name in dynamic_content_tools:
                if tool_name in event:
                    use_structure_validation = True
                    break
            if use_structure_validation:
                break

    if normalize:
        actual_normalized = [normalize_event(e) for e in actual_filtered]
        expected_normalized = [normalize_event(e) for e in expected]
    else:
        actual_normalized = actual_filtered
        expected_normalized = expected

    mismatches = []
    for i, (a, e) in enumerate(zip(actual_normalized, expected_normalized, strict=True)):
        # Use structure validation for dynamic content tools
        if use_structure_validation:
            is_match, diff_msg = validate_event_structure(a, e)
            if not is_match:
                mismatches.append(f"Event {i} structure mismatch: {diff_msg}")
        # Exact match for deterministic tools
        elif a != e:
            mismatches.append(
                f"Event {i} mismatch:\n"
                f"  Actual:   {a}\n"
                f"  Expected: {e}"
            )

    if mismatches:
        diff_msg = "\n".join(mismatches)
        return (False, diff_msg)

    return (True, "")


async def run_backend_fixture_test(
    fixture_path: Path,
    backend_url: str | None = None,
) -> tuple[bool, str]:
    """Run complete backend fixture test.

    This is a high-level helper that:
    1. Loads fixture
    2. Sends request to backend
    3. Compares rawEvents
    4. Validates [DONE] count

    Args:
        fixture_path: Path to frontend fixture JSON file
        backend_url: Backend URL (auto-detected from fixture mode if None)

    Returns:
        Tuple of (success, message)
    """
    # Given: Load fixture
    fixture = await load_frontend_fixture(fixture_path)

    mode = fixture.get("mode", "sse")
    input_messages = fixture["input"]["messages"]
    expected_events = fixture["output"]["rawEvents"]
    expected_done_count = fixture["output"]["expectedDoneCount"]

    # When: Send request to backend
    if backend_url is None:
        backend_url = "http://localhost:8000/stream" if mode == "sse" else "ws://localhost:8000/live"

    if mode == "sse":
        actual_events = await send_sse_request(input_messages, backend_url)
    elif mode == "bidi":
        actual_events = await send_bidi_request(input_messages, backend_url)
    else:
        return (False, f"Unknown mode: {mode}")

    # Then: Compare rawEvents
    is_match, diff_msg = compare_raw_events(actual_events, expected_events)
    if not is_match:
        return (False, f"rawEvents mismatch:\n{diff_msg}")

    # And: Validate [DONE] count
    actual_done_count = count_done_markers(actual_events)
    if actual_done_count != expected_done_count:
        return (
            False,
            f"[DONE] count mismatch: actual={actual_done_count}, expected={expected_done_count}",
        )

    return (True, "")
