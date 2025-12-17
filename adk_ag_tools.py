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
from typing import Any

import aiohttp
from google.adk.tools.tool_context import ToolContext
from loguru import logger

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
        logger.warning(f"Failed to read cache for {location}: {e}")

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
        logger.warning(f"Failed to write cache for {location}: {e}")


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
        logger.error(f"Tool call: get_weather({location}) exception: {e}")
        return {
            "error": str(e),
            "location": location,
            "note": "Exception occurred while fetching weather data",
        }


def process_payment(
    amount: float,
    recipient: str,
    tool_context: ToolContext,
    currency: str = "USD",
    description: str = "",
) -> dict[str, Any]:
    """
    Process a payment transaction (server-side execution with user approval required).

    This tool requires user approval before execution. The actual payment
    processing happens on the server after the user approves the transaction.

    Args:
        amount: Payment amount (must be positive)
        recipient: Recipient identifier (email, username, or wallet address)
        tool_context: ADK ToolContext (automatically injected)
        currency: Currency code (default: USD)
        description: Optional payment description

    Returns:
        Payment processing result with transaction details
    """
    logger.info(f"[process_payment] Processing payment: {amount} {currency} to {recipient}")

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


def change_bgm(track: int) -> dict[str, Any]:
    """
    Change background music track (auto-executes on frontend via onToolCall).

    This tool auto-executes on the frontend without requiring approval.
    The backend immediately returns success, while the actual BGM change
    is handled by the frontend's onToolCall callback.

    Args:
        track: Track number (0 or 1)

    Returns:
        Success confirmation (actual execution happens on frontend)
    """
    logger.info(f"[change_bgm] Tool called with track={track} (frontend auto-executes)")
    return {
        "success": True,
        "track": track,
        "message": f"BGM change to track {track} initiated (frontend handles execution)",
    }


def get_location() -> dict[str, Any]:
    """
    Get user's current location (executed on frontend via browser Geolocation API).

    This tool auto-executes on the frontend without requiring approval.
    The backend immediately returns success, while the actual location retrieval
    is handled by the frontend's onToolCall callback via browser Geolocation API.

    Returns:
        Success confirmation (actual execution happens on frontend)
    """
    logger.info("[get_location] Tool called (frontend auto-executes)")
    return {
        "success": True,
        "message": "Location request initiated (frontend handles execution via Geolocation API)",
    }
