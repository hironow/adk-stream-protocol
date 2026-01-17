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


# Import from _internal which handles dual-mode compatibility
# (package mode vs standalone mode for adk web)
try:
    from ._internal import Error, Ok, get_delegate
except ImportError:
    from _internal import Error, Ok, get_delegate  # type: ignore[no-redef]


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


def execute_process_payment(
    amount: float,
    recipient: str,
    currency: str = "USD",
    description: str = "",
) -> dict[str, Any]:
    """
    Execute payment processing logic (separated for reuse in BIDI mode).

    This function contains the actual payment logic without confirmation handling.
    Used by:
    - SSE mode: Called directly after ADK native confirmation
    - BIDI mode: Called by BidiEventReceiver after manual approval

    Args:
        amount: Payment amount (must be positive)
        recipient: Recipient identifier
        currency: Currency code (default: USD)
        description: Optional payment description

    Returns:
        Payment processing result with transaction details
    """
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


async def process_payment(
    amount: float,
    recipient: str,
    tool_context: ToolContext,
    currency: str = "USD",
    description: str = "",
) -> dict[str, Any]:
    """
    Process a payment transaction (server-side execution with user approval required).

    Phase 12: BLOCKING behavior mode for BIDI mode:
    - SSE mode: Uses ADK native confirmation (require_confirmation=True)
    - BIDI mode: Uses BLOCKING behavior to await approval inside function

    Implementation by mode:
    - SSE: ADK handles confirmation automatically, this function executes after approval
    - BIDI: Awaits approval via approval_queue, returns final result after approval/denial
           (Uses types.Behavior.BLOCKING to allow awaiting without blocking event loop)

    Args:
        amount: Payment amount (must be positive)
        recipient: Recipient identifier (email, username, or wallet address)
        tool_context: ADK ToolContext (automatically injected)
        currency: Currency code (default: USD)
        description: Optional payment description

    Returns:
        - SSE mode: Actual payment result after confirmation
        - BIDI mode: Final result after approval/denial (no pending status)
    """
    logger.info("[process_payment] ===== TOOL FUNCTION CALLED =====")
    logger.info(f"[process_payment] Processing payment: {amount} {currency} to {recipient}")

    # Mode detection: Check mode from tool_context.session.state
    mode = tool_context.session.state.get("mode", "sse")
    is_bidi_mode = mode == "bidi"

    logger.info(f"[process_payment] Mode: {mode}")

    if is_bidi_mode:
        # BIDI mode: BLOCKING behavior - await approval inside function
        logger.info("[process_payment] BIDI mode - using BLOCKING behavior to await approval")

        tool_call_id = tool_context.function_call_id

        # Get approval_queue from session state
        approval_queue = tool_context.session.state.get("approval_queue")

        if not approval_queue:
            logger.error("[process_payment] No approval_queue in session state!")
            return {
                "success": False,
                "error": "approval_queue not configured",
                "transaction_id": None,
            }

        # Register this tool call for approval
        approval_queue.request_approval(
            tool_call_id,
            "process_payment",
            {
                "amount": amount,
                "recipient": recipient,
                "currency": currency,
                "description": description,
            },
        )
        logger.info(f"[process_payment] Registered approval request for {tool_call_id}")

        # Await approval (BLOCKING behavior allows this without blocking event loop)
        try:
            logger.info("[process_payment] ⏳ Awaiting approval...")
            approval_result = await approval_queue.wait_for_approval(tool_call_id, timeout=30.0)
            logger.info(f"[process_payment] ✓ Approval received: {approval_result}")

            if approval_result.get("approved"):
                logger.info("[process_payment] ✅ APPROVED - executing payment")
                return execute_process_payment(amount, recipient, currency, description)
            else:
                logger.info("[process_payment] ❌ DENIED - rejecting payment")
                return {
                    "success": False,
                    "error": "User denied the payment",
                    "transaction_id": None,
                }

        except TimeoutError:
            logger.error("[process_payment] ⏰ Timeout waiting for approval")
            return {
                "success": False,
                "error": "Approval request timed out",
                "transaction_id": None,
            }

    # SSE mode: ADK handles confirmation automatically via require_confirmation=True
    # Execute payment logic directly (ADK has already handled approval)
    logger.info("[process_payment] SSE mode - executing payment logic")
    return execute_process_payment(amount, recipient, currency, description)


async def change_bgm(track: int, tool_context: ToolContext | None = None) -> dict[str, Any]:
    """
    Change background music track.

    - SSE mode: Direct execution (no frontend delegation)
    - BIDI mode: Frontend delegation (via FrontendToolDelegate)

    Mode Detection:
    - BIDI mode: confirmation_delegate exists in session.state
    - SSE mode: No confirmation_delegate

    Args:
        track: Track number (1 or 2) - matches frontend "BGM 1" and "BGM 2" labels
        tool_context: ADK ToolContext (automatically injected)

    Returns:
        Success confirmation
    """
    logger.info("[change_bgm] ========== TOOL FUNCTION CALLED ==========")
    logger.info(f"[change_bgm] track={track}, tool_context={tool_context}")

    if tool_context:
        # Detect BIDI mode by checking for confirmation_delegate
        confirmation_delegate = tool_context.session.state.get("confirmation_delegate")
        if confirmation_delegate:
            # BIDI mode - delegate execution to frontend
            logger.info("[change_bgm] BIDI mode detected - delegating to frontend")
            delegate = get_delegate(tool_context.session.id)
            logger.info(f"[change_bgm] delegate={delegate} (session_id={tool_context.session.id})")

            if not delegate:
                error_msg = f"Missing frontend_delegate for session_id={tool_context.session.id}"
                logger.error(f"[change_bgm] {error_msg}")
                return {"success": False, "error": error_msg}

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

    # SSE mode - direct return (frontend handles audio playback separately)
    logger.info(f"[change_bgm] SSE mode: track={track} (frontend handles execution separately)")
    return {
        "success": True,
        "track": track,
        "message": f"BGM change to track {track} initiated (frontend handles execution)",
    }


async def execute_get_location(session_id: str) -> dict[str, Any]:
    """
    Execute location retrieval logic via frontend delegation (separated for reuse in BIDI mode).

    This function contains the actual frontend delegation logic without confirmation handling.
    Used by:
    - SSE mode: Called directly after ADK native confirmation
    - BIDI mode: Called by BidiEventReceiver after manual approval

    Args:
        session_id: Session ID to get the frontend delegate

    Returns:
        User's location information from browser Geolocation API
    """
    # Delegate execution to frontend and await result
    # Note: Gets delegate from global registry using session_id
    # ID resolution is handled automatically by execute_on_frontend via id_mapper
    delegate = get_delegate(session_id)
    logger.info(f"[get_location] delegate={delegate} (session_id={session_id})")

    if not delegate:
        error_msg = f"Missing frontend_delegate for session_id={session_id}"
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


async def get_location(tool_context: ToolContext) -> dict[str, Any]:
    """
    Get user's current location (requires user approval).

    Phase 12: BLOCKING behavior mode for BIDI mode:
    - SSE mode: Uses ADK native confirmation (require_confirmation=True) + frontend delegation
    - BIDI mode: Uses BLOCKING behavior to await approval inside function

    The actual location retrieval is handled by the frontend's browser Geolocation API.

    Args:
        tool_context: ADK ToolContext (automatically injected)

    Returns:
        - SSE mode: User's location information from browser Geolocation API
        - BIDI mode: Final result after approval/denial (no pending status)
    """
    logger.info("[get_location] ========== TOOL FUNCTION CALLED ==========")

    # Mode detection: Check mode from tool_context.session.state
    mode = tool_context.session.state.get("mode", "sse")
    is_bidi_mode = mode == "bidi"

    logger.info(f"[get_location] Mode: {mode}")

    if is_bidi_mode:
        # BIDI mode: BLOCKING behavior - await approval inside function
        logger.info("[get_location] BIDI mode - using BLOCKING behavior to await approval")

        tool_call_id = tool_context.function_call_id

        # Get approval_queue from session state
        approval_queue = tool_context.session.state.get("approval_queue")

        if not approval_queue:
            logger.error("[get_location] No approval_queue in session state!")
            return {
                "success": False,
                "error": "approval_queue not configured",
            }

        # Register this tool call for approval
        approval_queue.request_approval(
            tool_call_id,
            "get_location",
            {},
        )
        logger.info(f"[get_location] Registered approval request for {tool_call_id}")

        # Await approval (BLOCKING behavior allows this without blocking event loop)
        try:
            logger.info("[get_location] ⏳ Awaiting approval...")
            approval_result = await approval_queue.wait_for_approval(tool_call_id, timeout=30.0)
            logger.info(f"[get_location] ✓ Approval received: {approval_result}")

            if approval_result.get("approved"):
                logger.info("[get_location] ✅ APPROVED - executing frontend delegation")
                return await execute_get_location(tool_context.session.id)
            else:
                logger.info("[get_location] ❌ DENIED - rejecting location access")
                return {
                    "success": False,
                    "error": "User denied location access",
                }

        except TimeoutError:
            logger.error("[get_location] ⏰ Timeout waiting for approval")
            return {
                "success": False,
                "error": "Approval request timed out",
            }

    # SSE mode: ADK handles confirmation automatically via require_confirmation=True
    # Execute frontend delegation directly (ADK has already handled approval)
    logger.info("[get_location] SSE mode - executing frontend delegation")
    return await execute_get_location(tool_context.session.id)
