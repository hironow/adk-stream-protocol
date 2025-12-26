"""
ADK Agent Tools

This module contains tool function definitions for ADK agents.
Tools are functions that the AI can call to perform actions or retrieve information.

Tools included:
- get_weather: Fetch weather information from OpenWeatherMap API (or mock data)
- process_payment: Process payment transactions (requires user approval via ADK confirmation)
- change_bgm: Change background music (auto-executes on frontend)
- get_location: Get user's location (auto-executes on frontend via Geolocation API)
"""

import json
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, assert_never

import aiohttp
from google.adk.tools.tool_context import ToolContext
from loguru import logger

from .frontend_tool_registry import get_delegate
from .result import Error, Ok


# ========== Weather Tool Configuration ==========
WEATHER_CACHE_TTL = 43200  # 12 hours in seconds
CACHE_DIR = Path(".cache")


def _get_weather_from_cache(location: str) -> dict[str, Any] | None:
    """Get weather data from file cache if available and not expired."""
    import time

    CACHE_DIR.mkdir(exist_ok=True)
    cache_file = CACHE_DIR / f"weather_{location.lower().replace(' ', '_')}.json"

    try:
        if cache_file.exists():
            cache_data = json.loads(cache_file.read_text())
            if time.time() - cache_data["timestamp"] < WEATHER_CACHE_TTL:
                return cache_data["data"]
    except Exception as e:
        logger.warning(f"Failed to read cache for {location}: {e!s}")

    return None


def _set_weather_cache(location: str, data: dict[str, Any]) -> None:
    """Save weather data to file cache."""
    import time

    CACHE_DIR.mkdir(exist_ok=True)
    cache_file = CACHE_DIR / f"weather_{location.lower().replace(' ', '_')}.json"

    try:
        cache_data = {"data": data, "timestamp": time.time()}
        cache_file.write_text(json.dumps(cache_data, indent=2))
    except Exception as e:
        logger.warning(f"Failed to write cache for {location}: {e!s}")


async def get_weather(location: str) -> dict[str, Any]:
    """
    Get weather information for a location using OpenWeatherMap API.

    Args:
        location: City name or location to get weather for (must be in English)

    Returns:
        Weather information including temperature and conditions
    """
    # Check cache first
    cached_data = _get_weather_from_cache(location)
    if cached_data:
        logger.info(f"Tool call: get_weather({location}) -> {cached_data} (cached)")
        return {**cached_data, "cached": True}

    # Get API key from environment
    api_key = os.getenv("OPENWEATHERMAP_API_KEY")

    if not api_key:
        logger.warning("OPENWEATHERMAP_API_KEY not set, using mock data")
        # Fallback to mock data
        mock_weather = {
            "Tokyo": {"temperature": 18, "condition": "Cloudy", "humidity": 65},
            "San Francisco": {"temperature": 15, "condition": "Foggy", "humidity": 80},
            "London": {"temperature": 12, "condition": "Rainy", "humidity": 85},
            "New York": {"temperature": 10, "condition": "Sunny", "humidity": 50},
        }
        weather = mock_weather.get(
            location,
            {
                "temperature": 20,
                "condition": "Unknown",
                "humidity": 60,
                "note": f"Mock data for {location}",
            },
        )
        # Cache mock data as well
        _set_weather_cache(location, weather)
        logger.info(f"Tool call: get_weather({location}) -> {weather} (mock)")
        return weather

    # Call OpenWeatherMap API
    url = "https://api.openweathermap.org/data/2.5/weather"
    params = {
        "q": location,
        "appid": api_key,
        "units": "metric",  # Get temperature in Celsius
    }

    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, params=params) as response:
                if response.status == 200:  # noqa: PLR2004 - HTTP OK status code
                    data = await response.json()
                    weather = {
                        "temperature": round(data["main"]["temp"], 1),
                        "condition": data["weather"][0]["main"],
                        "description": data["weather"][0]["description"],
                        "humidity": data["main"]["humidity"],
                        "feels_like": round(data["main"]["feels_like"], 1),
                        "wind_speed": data["wind"]["speed"],
                    }
                    # Cache the result
                    _set_weather_cache(location, weather)
                    logger.info(f"Tool call: get_weather({location}) -> {weather} (API)")
                    return weather
                else:
                    error_msg = f"API returned status {response.status}"
                    logger.error(f"Tool call: get_weather({location}) failed: {error_msg}")
                    return {
                        "error": error_msg,
                        "location": location,
                        "note": "Failed to fetch weather data from API",
                    }
    except Exception as e:
        logger.error(f"Tool call: get_weather({location}) exception: {e!s}")
        return {
            "error": str(e),
            "location": location,
            "note": "Exception occurred while fetching weather data",
        }


async def process_payment(
    amount: float,
    recipient: str,
    tool_context: ToolContext,
    currency: str = "USD",
    description: str = "",
) -> dict[str, Any]:
    """
    Process a payment transaction (server-side execution with user approval required).

    This tool requires user approval before execution:
    - SSE mode: Uses ADK native confirmation (require_confirmation=True)
    - BIDI mode: Uses ADK request_confirmation() pattern (2-call pattern)

    Implementation follows ADK official pattern:
    - 1st call: Request confirmation, return error, stream continues
    - 2nd call: Check tool_confirmation, execute if approved

    Args:
        amount: Payment amount (must be positive)
        recipient: Recipient identifier (email, username, or wallet address)
        tool_context: ADK ToolContext (automatically injected)
        currency: Currency code (default: USD)
        description: Optional payment description

    Returns:
        Payment processing result with transaction details
    """
    logger.info(f"[process_payment] ===== TOOL FUNCTION CALLED =====")
    logger.info(f"[process_payment] Processing payment: {amount} {currency} to {recipient}")
    logger.info(f"[process_payment] tool_context attributes: {dir(tool_context)}")

    # BIDI mode: Check if confirmation is required and handle accordingly
    confirmation_delegate = tool_context.session.state.get("confirmation_delegate")
    logger.info(f"[process_payment] confirmation_delegate present: {confirmation_delegate is not None}")

    if confirmation_delegate:
        logger.info("[process_payment] BIDI mode detected")
        logger.info(f"[process_payment] tool_context.tool_confirmation value: {tool_context.tool_confirmation}")

        # Check if tool_confirmation is set (2nd call after user approved/rejected)
        if tool_context.tool_confirmation is not None:
            # This is the 2nd call - user has responded to confirmation request
            logger.info(f"[process_payment] 2nd call detected - tool_confirmation.confirmed={tool_context.tool_confirmation.confirmed}")
            if tool_context.tool_confirmation.confirmed:
                logger.info("[process_payment] Confirmation approved, proceeding with execution")
            else:
                logger.info("[process_payment] Confirmation rejected by user")
                return {
                    "success": False,
                    "error": "Payment rejected by user",
                    "transaction_id": None,
                }
        else:
            # This is the 1st call - request confirmation and return error immediately
            logger.info("[process_payment] 1st call detected - requesting confirmation")
            logger.info(f"[process_payment] BEFORE request_confirmation() call")

            # Use ADK's built-in request_confirmation() method
            tool_context.request_confirmation(
                hint=f"Approve payment of {amount} {currency} to {recipient}?"
            )

            logger.info(f"[process_payment] AFTER request_confirmation() call")

            # Skip summarization to prevent LLM from processing the error
            tool_context.actions.skip_summarization = True
            logger.info(f"[process_payment] Set skip_summarization=True")

            # Return error immediately - this allows stream to continue
            # ADK will handle the confirmation flow and call this function again
            logger.info(f"[process_payment] Returning error response to ADK")
            return {
                "error": "This tool call requires confirmation, please approve or reject."
            }

    # SSE mode: ADK handles confirmation automatically via require_confirmation=True
    # Continue with payment processing logic...

    # Mock wallet balance (in real app, this would come from a database)
    mock_wallet_balance = 1000.0

    # Validation
    if amount <= 0:
        error_msg = f"Invalid amount: {amount}. Amount must be positive."
        logger.error(f"[process_payment] {error_msg}")
        return {
            "success": False,
            "error": error_msg,
            "transaction_id": None,
        }

    if amount > mock_wallet_balance:
        error_msg = (
            f"Insufficient funds. Balance: {mock_wallet_balance} {currency}, "
            f"Requested: {amount} {currency}"
        )
        logger.error(f"[process_payment] {error_msg}")
        return {
            "success": False,
            "error": error_msg,
            "transaction_id": None,
            "wallet_balance": mock_wallet_balance,
        }

    # Process payment (mock implementation)
    import uuid

    transaction_id = f"txn_{uuid.uuid4().hex[:12]}"
    new_balance = mock_wallet_balance - amount

    result = {
        "success": True,
        "transaction_id": transaction_id,
        "amount": amount,
        "currency": currency,
        "recipient": recipient,
        "description": description,
        "wallet_balance": new_balance,
        "timestamp": datetime.now(UTC).isoformat(),
    }

    logger.info(f"[process_payment] Payment successful: {transaction_id}")
    return result


async def change_bgm(track: int, tool_context: ToolContext | None = None) -> dict[str, Any]:
    """
    Change background music track.

    - SSE mode: Direct execution (no delegate needed)
    - BIDI mode: Frontend delegate (via tool_context)

    Args:
        track: Track number (1 or 2) - matches frontend "BGM 1" and "BGM 2" labels
        tool_context: ADK ToolContext (required for BIDI delegate)

    Returns:
        Success confirmation
    """
    logger.info("[change_bgm] ========== TOOL FUNCTION CALLED ==========")
    logger.info(f"[change_bgm] track={track}, tool_context={tool_context}")

    if tool_context:
        logger.info("[change_bgm] tool_context exists, checking for delegate")
        # Get delegate from global registry using session.id
        delegate = get_delegate(tool_context.session.id)
        logger.info(f"[change_bgm] delegate={delegate} (session_id={tool_context.session.id})")
        if delegate:
            # BIDI mode - delegate to frontend
            logger.info("[change_bgm] BIDI mode detected - delegating to frontend")
            logger.info("[change_bgm] Calling delegate.execute_on_frontend()")
            result_or_error = await delegate.execute_on_frontend(
                tool_name="change_bgm",
                args={"track": track},
            )
            match result_or_error:
                case Ok(result):
                    logger.info("[change_bgm] ========== DELEGATE RETURNED ==========")
                    logger.info(f"[change_bgm] BIDI delegated: track={track}, result={result}")
                    return result
                case Error(error_msg):
                    logger.error(f"[change_bgm] Delegate execution failed: {error_msg}")
                    return {"success": False, "error": error_msg}
                case _:
                    assert_never(result_or_error)

    # TODO: remove suspicious execution path if not needed
    # SSE mode or no delegate - direct return (frontend handles via onToolCall)
    logger.info(f"[change_bgm] SSE mode: track={track} (frontend auto-executes)")
    return {
        "success": True,
        "track": track,
        "message": f"BGM change to track {track} initiated (frontend handles execution)",
    }


async def get_location(tool_context: ToolContext) -> dict[str, Any]:
    """
    Get user's current location (requires user approval).

    This tool requires user approval before execution:
    - SSE mode: Uses ADK native confirmation (require_confirmation=True) + frontend delegation
    - BIDI mode: Uses ToolConfirmationDelegate (manual confirmation) + frontend delegation

    The actual location retrieval is handled by the frontend's browser Geolocation API.

    Args:
        tool_context: ADK ToolContext (automatically injected)

    Returns:
        User's location information from browser Geolocation API
    """
    logger.info("[get_location] ========== TOOL FUNCTION CALLED ==========")
    logger.info(f"[get_location] tool_context={tool_context}")

    # BIDI mode: Request confirmation via ToolConfirmationDelegate
    confirmation_delegate = tool_context.session.state.get("confirmation_delegate")
    if confirmation_delegate:
        logger.info("[get_location] BIDI mode detected - requesting confirmation")

        # Get function_call.id from session.state (saved by BidiEventSender)
        function_call_id = tool_context.session.state.get("current_function_call_id")
        if not function_call_id:
            error_msg = "Missing current_function_call_id in session.state"
            logger.error(f"[get_location] {error_msg}")
            return {"success": False, "error": error_msg}

        # Request confirmation and await user decision
        approved = await confirmation_delegate.request_confirmation(
            tool_call_id=function_call_id,
            tool_name="get_location",
            args={},
        )

        if not approved:
            logger.info("[get_location] Location access rejected by user")
            return {
                "success": False,
                "error": "Location access rejected by user",
            }

        logger.info("[get_location] Location access approved by user, proceeding with execution")

    # SSE mode: ADK handles confirmation automatically via require_confirmation=True
    # Continue with location retrieval via frontend delegation...

    # Delegate execution to frontend and await result
    # Note: Gets delegate from global registry using session.id
    # ID resolution is handled automatically by execute_on_frontend via id_mapper
    delegate = get_delegate(tool_context.session.id)
    logger.info(f"[get_location] delegate={delegate} (session_id={tool_context.session.id})")

    if not delegate:
        error_msg = f"Missing frontend_delegate for session_id={tool_context.session.id}"
        logger.error(f"[get_location] {error_msg}")
        return {"success": False, "error": error_msg}

    logger.info("[get_location] Calling delegate.execute_on_frontend()")
    result_or_error = await delegate.execute_on_frontend(
        tool_name="get_location",
        args={},
    )
    match result_or_error:
        case Ok(result):
            logger.info("[get_location] ========== DELEGATE RETURNED ==========")
            logger.info(f"[get_location] Received result from frontend: {result}")
            return result
        case Error(error_msg):
            logger.error(f"[get_location] Delegate execution failed: {error_msg}")
            return {"success": False, "error": error_msg}
        case _:
            assert_never(result_or_error)


async def _adk_request_confirmation(
    originalFunctionCall: dict[str, Any],  # noqa: N803 - ADK API spec uses camelCase
    toolConfirmation: dict[str, Any],  # noqa: N803 - ADK API spec uses camelCase
    tool_context: ToolContext,
) -> dict[str, Any]:
    """
    Request user confirmation for a tool execution (BIDI mode only).

    This tool delegates the confirmation request to the frontend and blocks
    until the user approves or rejects the action. It is automatically called
    by ADK when a tool has require_confirmation=True.

    In BIDI mode, this tool must be implemented as an actual Python function
    to block AI processing until user responds. In SSE mode, ADK handles this
    automatically.

    Args:
        originalFunctionCall: Dict with 'id', 'name', and 'args' of the tool requiring confirmation
        toolConfirmation: Dict with 'confirmed' boolean (initial value: False)
        tool_context: ADK ToolContext (automatically injected)

    Returns:
        Confirmation result: {'confirmed': bool}
    """
    tool_call_id = tool_context.invocation_id
    if not tool_call_id:
        error_msg = "Missing invocation_id in ToolContext"
        logger.error(f"[adk_request_confirmation] {error_msg}")
        return {"confirmed": False, "error": error_msg}

    logger.info(
        f"[adk_request_confirmation] Requesting confirmation for tool_call_id={tool_call_id}, "
        f"original_tool={originalFunctionCall.get('name')}"
    )

    # Get frontend delegate from global registry
    delegate = get_delegate(tool_context.session.id)
    if not delegate:
        error_msg = f"Missing frontend_delegate for session_id={tool_context.session.id}"
        logger.error(f"[adk_request_confirmation] {error_msg}")
        return {"confirmed": False, "error": error_msg}

    # TODO: 利用されるtoolが request_confirmation = true にした場合のみ、機能が前段に入る想定をかなり超えてしまっている
    # Delegate to frontend and await user decision
    # This blocks AI processing until user approves/rejects
    result_or_error = await delegate.execute_on_frontend(
        tool_call_id=tool_call_id,
        tool_name="adk_request_confirmation",
        args={
            "originalFunctionCall": originalFunctionCall,
            "toolConfirmation": toolConfirmation,
        },
    )
    match result_or_error:
        case Ok(result):
            logger.info(f"[adk_request_confirmation] User decision received: {result}")
            return result
        case Error(error_msg):
            logger.error(f"[adk_request_confirmation] Delegate execution failed: {error_msg}")
            return {"confirmed": False, "error": error_msg}
        case _:
            assert_never(result_or_error)


# ========== LongRunningFunctionTool Reference Implementation ==========


def approval_test_tool(amount: float, recipient: str) -> None:
    """
    Reference implementation for LongRunningFunctionTool pattern.

    This tool demonstrates how to create a tool that requires user approval
    in BIDI mode. It returns None to trigger ADK's long-running tool pause
    mechanism, which pauses agent execution until the frontend sends approval.

    Usage pattern:
    1. Tool executes immediately on server
    2. Returns None → ADK pauses agent execution
    3. Frontend auto-displays approval UI (any tool returning None)
    4. User approves/denies → frontend sends function_response via WebSocket
    5. ADK resumes agent with user's decision

    How to create your own long-running tool:
        from google.adk.tools.long_running_tool import LongRunningFunctionTool

        def my_approval_tool(data: str) -> None:
            # Your validation/processing logic here
            logger.info(f"Tool waiting for approval: {data}")
            return None  # Triggers pause

        # Register with LongRunningFunctionTool wrapper
        tools = [LongRunningFunctionTool(my_approval_tool)]

    Args:
        amount: Payment amount in USD
        recipient: Payment recipient name

    Returns:
        None - Signals to ADK that tool is waiting for user action

    Frontend receives:
        {"approved": bool, "user_message": str, "timestamp": str}
    """
    import uuid

    approval_id = f"approval-{uuid.uuid4().hex[:8]}"

    logger.info(
        f"[approval_test_tool] Tool executed, returning None to pause: "
        f"approval_id={approval_id}, amount=${amount}, recipient={recipient}"
    )

    # CRITICAL: Must return None to trigger pause!
    # Returning data would create function_response and complete the tool immediately.
    return None  # noqa: PLR1711 - Explicit None return required for LongRunningFunctionTool pattern
