"""
ADK Agent and Runner Configuration

This module contains:
- Tool definitions for ADK agents
- Agent configurations (SSE and BIDI modes)
- InMemoryRunner initialization
"""

import json
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import aiohttp
from google.adk.agents import Agent
from google.adk.runners import InMemoryRunner
from google.adk.tools.tool_context import ToolContext
from loguru import logger

# ========== Tool Definitions ==========
# Real-world example tools that demonstrate tool calling and tool results

# File-based cache for weather data
WEATHER_CACHE_TTL = 43200  # 12 hours in seconds
CACHE_DIR = Path(".cache")


async def _get_weather_from_cache(location: str) -> dict[str, Any] | None:
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


async def _set_weather_cache(location: str, data: dict[str, Any]) -> None:
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
    cached_data = await _get_weather_from_cache(location)
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
        await _set_weather_cache(location, weather)
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
                    await _set_weather_cache(location, weather)
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


def calculate(expression: str) -> dict[str, Any]:
    """
    Calculate a mathematical expression.

    Args:
        expression: Mathematical expression to evaluate (e.g., "2 + 2", "10 * 5")

    Returns:
        Calculation result
    """
    try:
        # Safe evaluation - only allows basic math operations
        # In production, use a proper math expression parser
        result = eval(expression, {"__builtins__": {}}, {})
        logger.info(f"Tool call: calculate({expression}) -> {result}")
        return {"expression": expression, "result": result, "success": True}
    except Exception as e:
        logger.error(f"Tool call: calculate({expression}) failed: {e}")
        return {"expression": expression, "error": str(e), "success": False}


def get_current_time(timezone: str = "UTC") -> dict[str, Any]:
    """
    Get the current time.

    Args:
        timezone: Timezone name (default: UTC)

    Returns:
        Current time information
    """
    now = datetime.now(UTC)
    result = {
        "datetime": now.isoformat(),
        "timezone": timezone,
        "formatted": now.strftime("%Y-%m-%d %H:%M:%S"),
    }
    logger.info(f"Tool call: get_current_time({timezone}) -> {result}")
    return result


async def change_bgm(track: int, tool_context: ToolContext) -> dict[str, Any]:
    """
    Change background music track (executed on frontend via browser AudioContext API).

    This tool requires user approval before execution and delegates actual
    execution to the frontend browser.

    Args:
        track: Track number (0 or 1)
        tool_context: ADK ToolContext (automatically injected)

    Returns:
        Result of BGM change operation from frontend
    """
    # Import here to avoid circular dependency
    from tool_delegate import frontend_delegate

    # Phase 3: Access connection-specific delegate from session state
    # Fall back to global delegate for SSE mode (backward compatibility)
    state_dict = (
        tool_context.state if isinstance(tool_context.state, dict) else tool_context.state.to_dict()
    )
    logger.info(f"[change_bgm] tool_context.state: {state_dict}")
    if tool_context.state.get("temp:delegate"):
        delegate = tool_context.state.get("temp:delegate")
        logger.info("[change_bgm] Using connection-specific delegate from session state")
    else:
        delegate = frontend_delegate
        logger.info("[change_bgm] Using global frontend_delegate for SSE mode")

    client_id = tool_context.state.get("client_identifier", "sse_mode")
    logger.info(f"[change_bgm] Using delegate: {delegate}, client_id: {client_id}")

    # Get tool_call_id from ToolContext
    tool_call_id = tool_context.function_call_id
    if not tool_call_id:
        error_msg = "Missing function_call_id in ToolContext"
        logger.error(f"[change_bgm] {error_msg}")
        return {"success": False, "error": error_msg}

    logger.info(f"[change_bgm] client={client_id}, tool_call_id={tool_call_id}, track={track}")

    # Delegate execution to frontend and await result
    result = await delegate.execute_on_frontend(
        tool_call_id=tool_call_id,
        tool_name="change_bgm",
        args={"track": track},
    )

    logger.info(f"[change_bgm] client={client_id}, result={result}")
    return result


async def get_location(tool_context: ToolContext) -> dict[str, Any]:
    """
    Get user's current location (executed on frontend via browser Geolocation API).

    This tool requires user approval before execution due to privacy sensitivity
    and delegates actual execution to the frontend browser.

    Args:
        tool_context: ADK ToolContext (automatically injected)

    Returns:
        User's location information from browser Geolocation API
    """
    # Import here to avoid circular dependency
    from tool_delegate import frontend_delegate

    # Phase 3: Access connection-specific delegate from session state
    # Fall back to global delegate for SSE mode (backward compatibility)
    state_dict = (
        tool_context.state if isinstance(tool_context.state, dict) else tool_context.state.to_dict()
    )
    logger.info(f"[get_location] tool_context.state: {state_dict}")
    delegate = tool_context.state.get("temp:delegate") or frontend_delegate
    client_id = tool_context.state.get("client_identifier", "sse_mode")
    logger.info(f"[get_location] Using delegate: {delegate}, client_id: {client_id}")

    # Get tool_call_id from ToolContext
    tool_call_id = tool_context.function_call_id
    if not tool_call_id:
        error_msg = "Missing function_call_id in ToolContext"
        logger.error(f"[get_location] {error_msg}")
        return {"success": False, "error": error_msg}

    logger.info(f"[get_location] client={client_id}, tool_call_id={tool_call_id}")

    # Delegate execution to frontend and await result
    result = await delegate.execute_on_frontend(
        tool_call_id=tool_call_id,
        tool_name="get_location",
        args={},
    )

    logger.info(f"[get_location] client={client_id}, result={result}")
    return result


# ========== Tool Approval Configuration ==========
# Tools that require user approval before execution (Phase 4)
TOOLS_REQUIRING_APPROVAL = {"change_bgm", "get_location"}


# ========== Constants for Agent Configuration ==========
# Fixed values for reproducible behavior

# Note: ADK Agent doesn't support seed and temperature parameters
# These would be used for deterministic responses if supported:
# ADK_SEED = 42
# ADK_TEMPERATURE = 0.7

# Common agent description
AGENT_DESCRIPTION = "An intelligent assistant that can check weather, perform calculations, control BGM, and access location"

# Common agent instruction
AGENT_INSTRUCTION = (
    "You are a helpful AI assistant with access to real-time tools. "
    "Use the available tools when needed to provide accurate information:\n"
    "- get_weather: Check weather for any city\n"
    "- calculate: Perform mathematical calculations\n"
    "- get_current_time: Get the current time\n"
    "- change_bgm: Change background music track (requires user approval)\n"
    "- get_location: Get user's location (requires user approval)\n\n"
    "Note: change_bgm and get_location require user approval before execution.\n"
    "Always explain what you're doing when using tools."
)

# ========== ADK Agent Setup ==========
# Based on official ADK quickstart examples
# https://google.github.io/adk-docs/get-started/quickstart/

# Verify API key is set in environment
# ADK reads GOOGLE_API_KEY (not GOOGLE_GENERATIVE_AI_API_KEY like AI SDK)
API_KEY = os.getenv("GOOGLE_API_KEY")
if not API_KEY:
    logger.error("GOOGLE_API_KEY not found in environment! ADK will fail.")
    logger.error("Note: ADK uses GOOGLE_API_KEY, while AI SDK uses GOOGLE_GENERATIVE_AI_API_KEY")
else:
    logger.info(f"ADK API key loaded: {API_KEY[:10]}...")

# SSE Agent: Uses stable model for generateContent API (SSE streaming)
sse_agent = Agent(
    name="adk_assistant_agent_sse",
    model="gemini-2.5-flash",  # Stable Gemini 2.5 Flash for generateContent API (SSE mode)
    description=AGENT_DESCRIPTION,
    instruction=AGENT_INSTRUCTION,
    tools=[get_weather, calculate, get_current_time, change_bgm, get_location],
    # Note: ADK Agent doesn't support seed and temperature parameters
)

# BIDI Agent: Uses Live API model for bidirectional streaming
# Model can be configured via ADK_BIDI_MODEL env var, defaults to native-audio model for audio support
bidi_model = os.getenv("ADK_BIDI_MODEL", "gemini-2.5-flash-native-audio-preview-09-2025")
bidi_agent = Agent(
    name="adk_assistant_agent_bidi",
    model=bidi_model,  # Configurable model for BIDI mode
    description=AGENT_DESCRIPTION,
    instruction=AGENT_INSTRUCTION,
    tools=[get_weather, calculate, get_current_time, change_bgm, get_location],
    # Note: ADK Agent doesn't support seed and temperature parameters
)

# Initialize InMemoryRunners for each agent
sse_agent_runner = InMemoryRunner(agent=sse_agent, app_name="agents")
bidi_agent_runner = InMemoryRunner(agent=bidi_agent, app_name="agents")

logger.info("ADK agents and runners initialized successfully")
