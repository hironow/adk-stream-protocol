"""Helper functions for backend fixture-based E2E tests.

Provides utilities for:
- Loading frontend baseline fixtures
- Sending requests to backend (SSE/BIDI)
- Collecting and comparing rawEvents
- Validating [DONE] markers
"""

import asyncio
import json
import os
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


async def receive_events_until_approval_request(
    websocket: Any,
    original_tool_name: str,
    timeout: float = 5.0,
) -> tuple[list[str], str | None, str | None]:
    """Receive WebSocket events until tool-approval-request is found (BIDI mode).

    This helper extracts common logic for BIDI mode approval flow tests.
    It receives events in a loop until tool-approval-request is detected.

    Args:
        websocket: WebSocket connection (websockets.WebSocketClientProtocol)
        original_tool_name: Name of the original tool requiring approval (e.g., "get_location", "process_payment")
        timeout: Timeout for each recv() call in seconds

    Returns:
        Tuple of (all_events, confirmation_id, original_tool_call_id)
        - all_events: List of all received event strings
        - confirmation_id: approvalId from tool-approval-request event
        - original_tool_call_id: toolCallId of the original tool

    Raises:
        AssertionError: If [DONE] is received before tool-approval-request (Phase 12 BLOCKING violation)
        asyncio.TimeoutError: If timeout waiting for tool-approval-request
    """
    all_events = []
    confirmation_id = None
    original_tool_call_id = None

    print(
        f"\n=== Receiving events until tool-approval-request (original tool: {original_tool_name}) ==="
    )
    while True:
        try:
            event_raw = await asyncio.wait_for(websocket.recv(), timeout=timeout)
            # Ensure event is str (websocket.recv() can return bytes or str)
            event = event_raw.decode("utf-8") if isinstance(event_raw, bytes) else event_raw
            all_events.append(event)
            print(f"Event {len(all_events)}: {event.strip()}")

            # ERROR: If we get [DONE] before approval response, that's wrong!
            if "[DONE]" in event:
                raise AssertionError(
                    "Received [DONE] before approval response in Phase 12 BLOCKING mode! "
                    "This indicates the tool returned early instead of BLOCKING."
                )

            # Parse event to extract tool call IDs
            if "data:" in event and event.strip() != "data: [DONE]":
                try:
                    event_data = json.loads(event.strip().replace("data: ", ""))

                    # Look for tool-approval-request (AI SDK v6 standard)
                    if event_data.get("type") == "tool-approval-request":
                        confirmation_id = event_data.get("approvalId")
                        print("\n✓ Found tool-approval-request:")
                        print(f"  approvalId: {confirmation_id}")
                        # IMPORTANT: Don't wait for [DONE], break immediately
                        break

                    # Also track original tool call ID from tool-input-available
                    if event_data.get("type") == "tool-input-available":
                        tool_name = event_data.get("toolName")
                        if tool_name == original_tool_name:
                            original_tool_call_id = event_data.get("toolCallId")
                            print(f"  original_tool_call_id: {original_tool_call_id}")
                except json.JSONDecodeError:
                    pass

        except TimeoutError:
            print(f"\n✗ Timeout waiting for tool-approval-request after {len(all_events)} events")
            raise

    return (all_events, confirmation_id, original_tool_call_id)


def extract_tool_call_ids_from_turn1(
    raw_events: list[str],
) -> tuple[str | None, str | None]:
    """Extract original and confirmation tool call IDs from Turn 1 events.

    Args:
        raw_events: List of SSE-format event strings from Turn 1

    Returns:
        Tuple of (original_tool_call_id, confirmation_id)
        - original_tool_call_id: ID of the original tool (e.g., process_payment)
        - confirmation_id: ID from tool-approval-request event (AI SDK v6 standard)
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
            event_type = event_obj.get("type")

            # Extract original tool ID from tool-input-available
            if event_type == "tool-input-available":
                tool_name = event_obj.get("toolName")
                tool_call_id = event_obj.get("toolCallId")

                # Only get first non-confirmation tool (original tool)
                if tool_name != "adk_request_confirmation" and original_id is None:
                    original_id = tool_call_id

            # Extract confirmation ID from tool-approval-request (AI SDK v6 standard)
            # Note: adk_request_confirmation tool events are no longer sent to frontend
            elif event_type == "tool-approval-request":
                confirmation_id = event_obj.get("approvalId")

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
    tool_result: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Create approval response message for Turn 2.

    Args:
        confirmation_id: Confirmation tool call ID from Turn 1
        original_tool_call_id: Original tool call ID (e.g., process_payment ID)
        tool_result: Optional tool execution result (for frontend-delegated tools)

    Returns:
        Message dict with approval response (and optionally tool result)
    """
    parts = [
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
    ]

    # Add tool result if provided (for frontend-delegated tools like get_location)
    if tool_result is not None:
        parts.append(
            {
                "type": "tool-result",
                "toolCallId": original_tool_call_id,
                "result": tool_result,
            }
        )

    return {
        "role": "user",
        "parts": parts,
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


def create_tool_result_message(
    tool_call_id: str,
    tool_result: dict[str, Any],
) -> dict[str, Any]:
    """Create tool result message (Pattern B: separate tool result request).

    Args:
        tool_call_id: Original tool call ID
        tool_result: Tool execution result

    Returns:
        Message dict with tool result
    """
    return {
        "role": "user",
        "parts": [
            {
                "type": "tool-result",
                "toolCallId": tool_call_id,
                "result": tool_result,
            }
        ],
    }


async def send_bidi_request(
    messages: list[dict[str, Any]],
    backend_url: str = "ws://localhost:8000/live",
    timeout: float = 30.0,
    frontend_delegate_tools: dict[str, dict[str, Any]] | None = None,
    confirmation_response: str | None = "approve",
) -> list[str]:
    """Send BIDI WebSocket request to backend and collect rawEvents.

    Note: WebSocket sends events in SSE format over WebSocket messages.

    Args:
        messages: Message history to send
        backend_url: Backend WebSocket endpoint URL
        timeout: Timeout in seconds for WebSocket operations (default: 30.0)
        frontend_delegate_tools: Dict of tool names to mock outputs for frontend-executed tools.
                                 Example: {"change_bgm": {"success": True, "track": 1}}
                                 When a tool-input-available event is received for these tools,
                                 a tool result will be automatically sent back to the backend.
        confirmation_response: How to respond to adk_request_confirmation events
                               - "approve": Auto-approve confirmations (default)
                               - "deny": Auto-deny confirmations
                               - None: Don't handle confirmations (single-turn tests)

    Returns:
        List of SSE-format event strings (e.g., 'data: {...}\\n\\n')
    """
    import websockets

    raw_events = []
    confirmation_data = None  # Store confirmation IDs for multi-turn flow (dict with confirmation_id and original_id)
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
        await websocket.send(json.dumps({"type": "message", "messages": messages}))

        # Receive events until all turns complete
        while True:
            try:
                event_raw = await asyncio.wait_for(websocket.recv(), timeout=timeout)
                # Ensure event is str (websocket.recv() can return bytes or str)
                event = event_raw.decode("utf-8") if isinstance(event_raw, bytes) else event_raw
                raw_events.append(event)

                # Check for tool-input-available events
                if "tool-input-available" in event:
                    try:
                        # Parse event to extract tool info
                        json_str = event.replace("data: ", "").strip()
                        event_data = json.loads(json_str)

                        tool_name = event_data.get("toolName")
                        tool_call_id = event_data.get("toolCallId")

                        # Handle adk_request_confirmation (ADK confirmation pattern)
                        if tool_name == "adk_request_confirmation" and confirmation_response:
                            # Extract confirmation IDs from the event stream
                            confirmation_id = tool_call_id
                            # Extract original tool ID from the confirmation input
                            original_id = (
                                event_data.get("input", {})
                                .get("originalFunctionCall", {})
                                .get("id")
                            )

                            if confirmation_id and original_id:
                                confirmation_data = {
                                    "confirmation_id": confirmation_id,
                                    "original_id": original_id,
                                }
                                logger.info(
                                    f"[Confirmation] Detected confirmation request: {confirmation_id} for {original_id}"
                                )

                        # Handle frontend-delegate tools (frontend execution pattern)
                        elif frontend_delegate_tools and tool_name in frontend_delegate_tools:
                            logger.info(f"[Frontend Delegate] Simulating {tool_name} execution")

                            # Create tool result message (BidiEventReceiver format)
                            tool_result_message = {
                                "type": "tool_result",  # underscore, not hyphen!
                                "toolCallId": tool_call_id,
                                "result": frontend_delegate_tools[
                                    tool_name
                                ],  # object, not JSON string
                            }

                            # Send tool result back to backend
                            await websocket.send(json.dumps(tool_result_message))
                            logger.info(f"[Frontend Delegate] Sent tool result for {tool_name}")
                    except (json.JSONDecodeError, KeyError) as e:
                        logger.warning(f"Failed to parse tool-input-available event: {e}")

                # Check for [DONE] marker (end of turn)
                if "[DONE]" in event:
                    # If we have confirmation data, send approval/denial and continue to next turn
                    if confirmation_data and confirmation_response:
                        logger.info(
                            f"[Confirmation] Turn ended. Sending {confirmation_response} response"
                        )

                        # Create approval or denial message
                        if confirmation_response == "approve":
                            response_msg = create_approval_message(
                                confirmation_data["confirmation_id"],
                                confirmation_data["original_id"],
                            )
                        else:  # deny
                            response_msg = create_denial_message(
                                confirmation_data["confirmation_id"],
                                confirmation_data["original_id"],
                            )

                        # Send approval/denial message to trigger next turn
                        await websocket.send(
                            json.dumps({"type": "message", "messages": [response_msg]})
                        )
                        logger.info(
                            f"[Confirmation] Sent {confirmation_response} response, continuing to next turn"
                        )

                        # Clear confirmation data (only respond once)
                        confirmation_data = None
                        continue  # Continue receiving events for next turn
                    else:
                        # No confirmation pending, this is the final turn
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
            if isinstance(event_obj["toolCallId"], str) and event_obj["toolCallId"].startswith(
                "adk-"
            ):
                event_obj["toolCallId"] = "adk-DYNAMIC_ID"
            else:
                event_obj["toolCallId"] = "DYNAMIC_TOOL_CALL_ID"

        # Replace dynamic approvalId with placeholder (for tool-approval-request events)
        if "approvalId" in event_obj:
            if isinstance(event_obj["approvalId"], str) and event_obj["approvalId"].startswith(
                "adk-"
            ):
                event_obj["approvalId"] = "adk-DYNAMIC_ID"
            else:
                event_obj["approvalId"] = "DYNAMIC_APPROVAL_ID"

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
            # Skip cached field validation - it's dynamic and may vary between runs
            # (cached depends on whether data was already in cache, which is non-deterministic)
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
            # audio metadata is dynamic (native-audio models include audio stats)
            # Skip validation - it may or may not be present depending on the model
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
    include_text_events: bool = False,
) -> tuple[bool, str]:
    """Compare actual vs expected rawEvents.

    Args:
        actual: Actual rawEvents from backend
        expected: Expected rawEvents from fixture
        normalize: Whether to normalize dynamic fields (default: True)
        dynamic_content_tools: List of tool names with dynamic output content.
                              For these tools, only event structure is validated,
                              not exact content (e.g., ['get_weather']).
        include_text_events: Whether to include text-* events in validation (default: False).
                           If False, text-* events are filtered out (for BIDI mode).
                           If True, text-* events are validated (for SSE mode Turn 2).

    Returns:
        Tuple of (is_match, diff_message)
        - is_match: True if events match
        - diff_message: Human-readable diff if not match, empty if match
    """

    # Filter out audio and reasoning events from both actual and expected events
    # Baseline fixtures exclude these audio/thinking-specific events
    # Optionally filter text-* events based on include_text_events flag
    # Note: BIDI mode fixtures don't include text-* events, but SSE mode fixtures do
    def filter_events(events: list[str]) -> list[str]:
        """Filter out audio, reasoning, and optionally text events."""
        return [
            e
            for e in events
            if '"type": "data-pcm"' not in e
            and '"type": "reasoning-start"' not in e
            and '"type": "reasoning-delta"' not in e
            and '"type": "reasoning-end"' not in e
            and (
                include_text_events or '"type": "text-' not in e
            )  # Conditionally filter text-* events
        ]

    actual_filtered = filter_events(actual)
    expected_filtered = filter_events(expected)

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

    # Debug: Print filtered events for comparison
    print(f"\n=== ACTUAL EVENTS (filtered, count={len(actual_filtered)}) ===")
    for i, event in enumerate(actual_filtered):
        print(f"{i}: {event.strip()}")

    print(f"\n=== EXPECTED EVENTS (filtered, count={len(expected_filtered)}) ===")
    for i, event in enumerate(expected_filtered):
        print(f"{i}: {event.strip()}")

    if len(actual_filtered) != len(expected_filtered):
        return (
            False,
            f"Event count mismatch (after filtering audio/reasoning/text): actual={len(actual_filtered)}, expected={len(expected_filtered)}",
        )

    # Detect if we're testing a dynamic content tool
    use_structure_validation = False
    if dynamic_content_tools:
        # Check if any of the events contain these tool names OR are tool output/text events
        for event in actual_filtered + expected_filtered:
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
        expected_normalized = [normalize_event(e) for e in expected_filtered]
    else:
        actual_normalized = actual_filtered
        expected_normalized = expected_filtered

    mismatches = []
    for i, (a, e) in enumerate(zip(actual_normalized, expected_normalized, strict=True)):
        # Use structure validation for dynamic content tools
        if use_structure_validation:
            is_match, diff_msg = validate_event_structure(a, e)
            if not is_match:
                mismatches.append(f"Event {i} structure mismatch: {diff_msg}")
        # Exact match for deterministic tools
        elif a != e:
            mismatches.append(f"Event {i} mismatch:\n  Actual:   {a}\n  Expected: {e}")

    if mismatches:
        diff_msg = "\n".join(mismatches)
        return (False, diff_msg)

    return (True, "")


def save_frontend_fixture(
    fixture_path: Path,
    description: str,
    mode: str,
    input_messages: list[dict[str, Any]],
    raw_events: list[str],
    expected_done_count: int,
    source: str | None = None,
    scenario: str | None = None,
    note: str | None = None,
) -> None:
    """Save frontend baseline fixture file from backend E2E test output.

    This function generates frontend baseline fixtures by:
    1. Parsing raw SSE events into expectedChunks
    2. Constructing fixture metadata (description, mode, source, etc.)
    3. Writing JSON file to fixtures/frontend/ directory

    Note: Fixture updates are controlled by E2E_REFRESH_FIXTURE environment variable.
    Only saves fixture when E2E_REFRESH_FIXTURE=true to prevent accidental overwrites.

    Args:
        fixture_path: Path to save fixture JSON file (e.g., fixtures/frontend/xxx.json)
        description: Brief description of the fixture
        mode: Transport mode ("sse" or "bidi")
        input_messages: Input messages sent to backend
        raw_events: SSE-format event strings collected from backend
        expected_done_count: Expected number of [DONE] markers
        source: Optional source information (e.g., test file name)
        scenario: Optional scenario description
        note: Optional implementation notes
    """
    # Check E2E_REFRESH_FIXTURE environment variable
    # Only save fixture when explicitly enabled to prevent accidental overwrites
    refresh_fixture = os.environ.get("E2E_REFRESH_FIXTURE", "").lower() == "true"
    if not refresh_fixture:
        logger.debug(
            f"Skipping fixture save (E2E_REFRESH_FIXTURE not enabled): {fixture_path.name}"
        )
        return

    # Filter audio chunks from raw events to ensure test consistency
    # (MockWebSocket will replay these events, so they must match expectedChunks)
    filtered_raw_events = []
    for event in raw_events:
        if event.strip() == "data: [DONE]":
            filtered_raw_events.append(event)
            continue
        if "data:" in event:
            try:
                event_data = json.loads(event.strip().replace("data: ", ""))
                chunk_type = event_data.get("type", "")
                # Skip audio chunks (binary data not relevant for protocol testing)
                if chunk_type == "data-pcm":
                    continue
                if chunk_type == "file" and event_data.get("mediaType", "").startswith("audio/"):
                    continue
                filtered_raw_events.append(event)
            except json.JSONDecodeError:
                # Keep non-JSON events as-is
                filtered_raw_events.append(event)
        else:
            filtered_raw_events.append(event)

    # Parse events into chunks for expectedChunks
    # Audio chunks already filtered from raw events above
    expected_chunks = []
    for event in filtered_raw_events:
        if event.strip() == "data: [DONE]":
            continue
        if "data:" in event:
            try:
                event_data = json.loads(event.strip().replace("data: ", ""))
                expected_chunks.append(event_data)
            except json.JSONDecodeError:
                pass

    # Construct fixture data
    fixture_data: dict[str, Any] = {
        "description": description,
        "mode": mode,
    }

    if source:
        fixture_data["source"] = source
    if scenario:
        fixture_data["scenario"] = scenario
    if note:
        fixture_data["note"] = note

    fixture_data["input"] = {"messages": input_messages, "trigger": "submit-message"}
    fixture_data["output"] = {
        "rawEvents": filtered_raw_events,
        "expectedChunks": expected_chunks,
        "expectedDoneCount": expected_done_count,
        "expectedStreamCompletion": True,
    }

    # Ensure directory exists
    fixture_path.parent.mkdir(parents=True, exist_ok=True)

    # Write fixture file
    fixture_path.write_text(json.dumps(fixture_data, indent=2, ensure_ascii=False) + "\n")
    logger.info(f"✓ Saved frontend baseline fixture to {fixture_path}")


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
        backend_url = (
            "http://localhost:8000/stream" if mode == "sse" else "ws://localhost:8000/live"
        )

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


def validate_tool_approval_request_toolcallid(raw_events: list[str]) -> tuple[bool, str]:
    """Validate that tool-approval-request toolCallId matches the original tool's toolCallId.

    This ensures that the tool-approval-request event references the correct tool call.
    If there's a mismatch, the frontend cannot properly associate the approval request
    with the original tool call.

    Args:
        raw_events: List of SSE-format event strings

    Returns:
        Tuple of (is_valid, error_message)
        - is_valid: True if validation passes
        - error_message: Empty string if valid, error description if invalid
    """
    # Collect all toolCallIds from tool-input-available events
    # Use a set to handle multiple tool calls with the same tool name
    tool_call_ids: set[str] = set()

    # Find tool-approval-request events
    approval_requests: list[tuple[str, str]] = []  # (toolCallId, approvalId)

    for event in raw_events:
        if not event.startswith("data: "):
            continue
        if "[DONE]" in event:
            continue

        try:
            json_str = event[6:].strip()
            event_obj = json.loads(json_str)
            event_type = event_obj.get("type")

            # Track tool-input-available events
            if event_type == "tool-input-available":
                tool_name = event_obj.get("toolName")
                tool_call_id = event_obj.get("toolCallId")
                if tool_name and tool_call_id:
                    # Skip adk_request_confirmation - it should never appear as tool-input-available
                    if tool_name != "adk_request_confirmation":
                        tool_call_ids.add(tool_call_id)

            # Track tool-approval-request events
            elif event_type == "tool-approval-request":
                tool_call_id = event_obj.get("toolCallId")
                approval_id = event_obj.get("approvalId")
                if tool_call_id and approval_id:
                    approval_requests.append((tool_call_id, approval_id))

        except (json.JSONDecodeError, KeyError):
            continue

    # Validate each approval request
    for approval_toolcallid, _approval_id in approval_requests:
        # The toolCallId in tool-approval-request should match one of the tool-input-available toolCallIds
        if approval_toolcallid not in tool_call_ids:
            return (
                False,
                f"tool-approval-request has toolCallId '{approval_toolcallid}' which does not match any "
                f"tool-input-available toolCallId. Available tool call IDs: {tool_call_ids}. "
                f"This indicates the approval request is not properly linked to the original tool call.",
            )

    return (True, "")


def validate_no_adk_request_confirmation_tool_input(
    raw_events: list[str],
) -> tuple[bool, str]:
    """Validate that adk_request_confirmation tool-input events do NOT exist.

    According to ADR 0002 (Tool Approval Architecture), adk_request_confirmation is
    an internal tool that should be hidden from the frontend. Only tool-approval-request
    events should be exposed.

    Args:
        raw_events: List of SSE-format event strings

    Returns:
        Tuple of (is_valid, error_message)
        - is_valid: True if validation passes (no adk_request_confirmation tool-input events)
        - error_message: Empty string if valid, error description if invalid
    """
    forbidden_events: list[str] = []

    for idx, event in enumerate(raw_events):
        if not event.startswith("data: "):
            continue
        if "[DONE]" in event:
            continue

        try:
            json_str = event[6:].strip()
            event_obj = json.loads(json_str)
            event_type = event_obj.get("type")

            # Check for forbidden tool-input-* events with adk_request_confirmation
            if event_type in ("tool-input-start", "tool-input-available"):
                tool_name = event_obj.get("toolName")
                if tool_name == "adk_request_confirmation":
                    forbidden_events.append(
                        f"Event {idx}: {event_type} for adk_request_confirmation"
                    )

        except (json.JSONDecodeError, KeyError):
            continue

    if forbidden_events:
        return (
            False,
            "Found forbidden adk_request_confirmation tool-input events:\n"
            + "\n".join(forbidden_events)
            + "\n\nAccording to ADR 0002, adk_request_confirmation is internal and should be hidden. "
            + "Only tool-approval-request events should be exposed to frontend.",
        )

    return (True, "")
