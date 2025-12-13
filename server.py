"""
ADK Backend Server with FastAPI (Phase 2 - ADK SSE Streaming)

This server provides AI capabilities using Google ADK.
Frontend connects directly to this backend in Phase 2 mode (adk-sse).
Phase 1 (gemini) uses direct Gemini API and doesn't require this backend.
"""

from __future__ import annotations

import asyncio
import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any

import aiohttp
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from google.adk.agents import Agent, LiveRequestQueue
from google.adk.agents.run_config import RunConfig, StreamingMode
from google.adk.runners import InMemoryRunner
from google.adk.tools.tool_context import ToolContext
from google.genai import types
from loguru import logger
from pydantic import BaseModel

from ai_sdk_v6_compat import (
    ChatMessage,
    FilePart,
    TextPart,
)
from stream_protocol import stream_adk_to_ai_sdk
from tool_delegate import FrontendToolDelegate

# Load environment variables from .env.local
load_dotenv(".env.local")

# Configure file logging
log_dir = Path("logs")
log_dir.mkdir(exist_ok=True)
log_file = log_dir / f"server_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"
logger.add(
    log_file,
    rotation="10 MB",
    retention="7 days",
    level="DEBUG",
    format="{time:YYYY-MM-DD HH:mm:ss.SSS} | {level: <8} | {name}:{function}:{line} - {message}",
)

logger.info("ADK Backend Server starting up...")
logger.info(f"Logging to: {log_file}")

# Explicitly ensure API key is in os.environ for Google GenAI SDK
if not os.getenv("GOOGLE_GENERATIVE_AI_API_KEY"):
    # Try loading again with override
    load_dotenv(".env.local", override=True)

app = FastAPI(
    title="ADK Data Protocol Server",
    description="Google ADK backend for AI SDK v6 integration",
    version="0.1.0",
)

# CORS middleware for frontend communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:3002",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ========== Frontend Tool Delegation (Phase 4 - Awaitable Pattern) ==========
# Implements AP2-style awaitable delegation for client-side tools


# Global frontend delegate instance
# Note: FrontendToolDelegate is now defined in tool_delegate.py
frontend_delegate = FrontendToolDelegate()


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
                if response.status == 200:
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
                    logger.info(
                        f"Tool call: get_weather({location}) -> {weather} (API)"
                    )
                    return weather
                else:
                    error_msg = f"API returned status {response.status}"
                    logger.error(
                        f"Tool call: get_weather({location}) failed: {error_msg}"
                    )
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
    now = datetime.now()
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
    tool_call_id = tool_context.function_call_id
    if not tool_call_id:
        error_msg = "Missing function_call_id in ToolContext"
        logger.error(f"[change_bgm] {error_msg}")
        return {"success": False, "error": error_msg}

    logger.info(
        f"[change_bgm] Delegating to frontend: tool_call_id={tool_call_id}, track={track}"
    )

    # Delegate execution to frontend and await result
    result = await frontend_delegate.execute_on_frontend(
        tool_call_id=tool_call_id,
        tool_name="change_bgm",
        args={"track": track}
    )

    logger.info(f"[change_bgm] Received result from frontend: {result}")
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
    tool_call_id = tool_context.function_call_id
    if not tool_call_id:
        error_msg = "Missing function_call_id in ToolContext"
        logger.error(f"[get_location] {error_msg}")
        return {"success": False, "error": error_msg}

    logger.info(
        f"[get_location] Delegating to frontend: tool_call_id={tool_call_id}"
    )

    # Delegate execution to frontend and await result
    result = await frontend_delegate.execute_on_frontend(
        tool_call_id=tool_call_id,
        tool_name="get_location",
        args={}
    )

    logger.info(f"[get_location] Received result from frontend: {result}")
    return result


# ========== Tool Approval Configuration ==========
# Tools that require user approval before execution (Phase 4)
TOOLS_REQUIRING_APPROVAL = {"change_bgm", "get_location"}


# ========== ADK Agent Setup ==========
# Based on official ADK quickstart examples
# https://google.github.io/adk-docs/get-started/quickstart/

# Verify API key is set in environment
# ADK reads GOOGLE_API_KEY (not GOOGLE_GENERATIVE_AI_API_KEY like AI SDK)
API_KEY = os.getenv("GOOGLE_API_KEY")
if not API_KEY:
    logger.error("GOOGLE_API_KEY not found in environment! ADK will fail.")
    logger.error(
        "Note: ADK uses GOOGLE_API_KEY, while AI SDK uses GOOGLE_GENERATIVE_AI_API_KEY"
    )
else:
    logger.info(f"ADK API key loaded: {API_KEY[:10]}...")

# SSE Agent: Uses stable model for generateContent API (SSE streaming)
sse_agent = Agent(
    name="adk_assistant_agent_sse",
    model="gemini-2.5-flash",  # Stable Gemini 2.5 Flash for generateContent API (SSE mode)
    description="An intelligent assistant that can check weather, perform calculations, control BGM, and access location",
    instruction=(
        "You are a helpful AI assistant with access to real-time tools. "
        "Use the available tools when needed to provide accurate information:\n"
        "- get_weather: Check weather for any city\n"
        "- calculate: Perform mathematical calculations\n"
        "- get_current_time: Get the current time\n"
        "- change_bgm: Change background music track (requires user approval)\n"
        "- get_location: Get user's location (requires user approval)\n\n"
        "Note: change_bgm and get_location require user approval before execution.\n"
        "Always explain what you're doing when using tools."
    ),
    tools=[get_weather, calculate, get_current_time, change_bgm, get_location],
)

# BIDI Agent: Uses Live API model for bidirectional streaming
bidi_agent = Agent(
    name="adk_assistant_agent_bidi",
    model="gemini-2.5-flash-native-audio-preview-09-2025",  # Live API model for BIDI mode with audio support
    description="An intelligent assistant that can check weather, perform calculations, control BGM, and access location",
    instruction=(
        "You are a helpful AI assistant with access to real-time tools. "
        "Use the available tools when needed to provide accurate information:\n"
        "- get_weather: Check weather for any city\n"
        "- calculate: Perform mathematical calculations\n"
        "- get_current_time: Get the current time\n"
        "- change_bgm: Change background music track (requires user approval)\n"
        "- get_location: Get user's location (requires user approval)\n\n"
        "Note: change_bgm and get_location require user approval before execution.\n"
        "Always explain what you're doing when using tools."
    ),
    tools=[get_weather, calculate, get_current_time, change_bgm, get_location],
)

# Initialize InMemoryRunners for each agent
sse_agent_runner = InMemoryRunner(agent=sse_agent, app_name="agents")
bidi_agent_runner = InMemoryRunner(agent=bidi_agent, app_name="agents")

# Global session management (in-memory for now)
# In production, use persistent session storage
_sessions: dict[str, Any] = {}


async def get_or_create_session(
    user_id: str, agent_runner: InMemoryRunner, app_name: str = "agents"
) -> Any:
    """Get or create a session for a user with specific agent runner"""
    session_id = f"session_{user_id}_{app_name}"

    if session_id not in _sessions:
        logger.info(f"Creating new session for user: {user_id} with app: {app_name}")
        session = await agent_runner.session_service.create_session(
            app_name=app_name,
            user_id=user_id,
            session_id=session_id,
        )
        _sessions[session_id] = session

    return _sessions[session_id]


async def run_agent_chat(
    user_message: str,
    user_id: str,
    agent_runner: InMemoryRunner,
    app_name: str = "agents",
) -> str:
    """
    Run the ADK agent with a user message and return the response.
    Based on official ADK examples using InMemoryRunner.
    """
    session = await get_or_create_session(user_id, agent_runner, app_name)

    # Create message content
    message_content = types.Content(role="user", parts=[types.Part(text=user_message)])

    # Run agent and collect response
    response_text = ""
    async for event in agent_runner.run_async(
        user_id=user_id,
        session_id=session.id,
        new_message=message_content,
    ):
        # Collect final response
        if event.is_final_response() and event.content and event.content.parts:
            for part in event.content.parts:
                if hasattr(part, "text") and part.text:
                    response_text += part.text

    return response_text.strip()


async def stream_agent_chat(messages: list[ChatMessage], user_id: str = "default_user"):
    """
    Stream ADK agent responses as SSE events in AI SDK v6 format.
    Accepts full message history (AI SDK v6 Data Stream Protocol).
    Converts to ADK format internally (implementation detail).
    Yields SSE-formatted events compatible with AI SDK's Data Stream Protocol.

    Note: ADK session management preserves conversation history internally.
    Frontend sends full history (AI SDK protocol), but ADK uses session-based history.

    This implementation now supports:
    - Text streaming
    - Tool calls (function_call/function_response)
    - Reasoning (thought)
    - Dynamic finish reasons
    - Usage metadata
    """
    # Reuse session for the same user (ADK manages conversation history)
    session = await get_or_create_session(user_id, sse_agent_runner, "agents")

    # Extract last user message (ADK session already has full history)
    if not messages:
        return

    last_user_message_obj = messages[-1]
    last_user_message_text = last_user_message_obj.get_text_content()
    if not last_user_message_text:
        return

    logger.info(
        f"Streaming chat for user {user_id}, message: {last_user_message_text[:50]}..."
    )
    logger.info(
        f"Agent model: {sse_agent.model}, tools: {[tool.__name__ if callable(tool) else str(tool) for tool in sse_agent.tools]}"
    )

    # Create ADK message content for the latest user input (includes images!)
    message_content = last_user_message_obj.to_adk_content()

    # Create ADK event stream
    event_stream = sse_agent_runner.run_async(
        user_id=user_id,
        session_id=session.id,
        new_message=message_content,
    )

    # Convert ADK stream to AI SDK v6 format using protocol converter
    # Phase 4: Pass tools_requiring_approval for tool approval flow
    event_count = 0
    async for sse_event in stream_adk_to_ai_sdk(
        event_stream, tools_requiring_approval=TOOLS_REQUIRING_APPROVAL
    ):
        event_count += 1
        yield sse_event

    logger.info(f"Stream completed with {event_count} SSE events")


# Message types imported from ai_sdk_v6_compat.py
# - TextPart, ImagePart, FilePart: Content parts
# - ToolUsePart, ToolApproval: Tool call parts
# - MessagePart: Union of all part types
# - ChatMessage: AI SDK v6 UIMessage with to_adk_content() conversion


class ChatRequest(BaseModel):
    """Chat request model"""

    messages: list[ChatMessage]


class ChatResponse(BaseModel):
    """Chat response model"""

    message: str


@app.get("/")
async def root():
    """Root endpoint"""
    return {
        "service": "ADK Data Protocol Server",
        "version": "0.1.0",
        "status": "running",
    }


@app.get("/health")
async def health():
    """Health check endpoint"""
    return {"status": "healthy"}


@app.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """
    Non-streaming chat endpoint (NOT USED - for reference only)

    Current architecture uses /stream endpoint exclusively.
    This endpoint is kept for reference but not actively used.
    Use /stream for production.
    """
    logger.info(f"Received chat request with {len(request.messages)} messages")

    # Get the last user message
    last_message = request.messages[-1].get_text_content() if request.messages else ""

    if not last_message:
        return ChatResponse(message="No message provided")
    
    user_id = "chat_user"

    # Run ADK agent and get response
    try:
        response_text = await run_agent_chat(
            last_message, user_id, sse_agent_runner, "agents"
        )
        logger.info(f"ADK agent response: {response_text[:100]}...")
        return ChatResponse(message=response_text)
    except Exception as e:
        logger.error(f"Error running ADK agent: {e}")
        return ChatResponse(message=f"Error: {str(e)}")


@app.post("/stream")
async def stream(request: ChatRequest):
    """
    SSE streaming endpoint (Phase 2 - FINAL)

    AI SDK v6 Data Stream Protocol compliant endpoint.
    - Request: UIMessage[] (full message history)
    - Response: SSE stream (text-start, text-delta, text-end, finish)

    Internal ADK processing is hidden from the API consumer.
    """
    logger.info(f"Received stream request with {len(request.messages)} messages")

    if not request.messages:
        # Return error as SSE
        async def error_stream():
            yield f"data: {json.dumps({'type': 'error', 'error': 'No messages provided'})}\n\n"
            yield "data: [DONE]\n\n"

        return StreamingResponse(
            error_stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
            },
        )
        
    user_id = "stream_user"

    # Stream ADK agent response (pass full message history)
    return StreamingResponse(
        stream_agent_chat(request.messages, user_id),
        media_type="text/event-stream",
        headers={
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
            "x-vercel-ai-ui-message-stream": "v1",  # AI SDK v6 Data Stream Protocol marker
        },
    )


@app.websocket("/live")
async def live_chat(websocket: WebSocket):
    """
    WebSocket endpoint for bidirectional streaming with ADK BIDI mode (Phase 3).

    This endpoint enables real-time bidirectional communication between
    AI SDK v6 useChat and ADK's run_live() method. It bridges the two systems:
    - Frontend → Backend: useChat messages via WebSocket
    - Backend → Frontend: ADK live events via WebSocket

    Protocol Flow (IMPORTANT - Read carefully):

    1. Client → Server (Upstream):
       - Client sends: AI SDK v6 ChatMessage as JSON
       - Server converts: JSON → ADK Content format
       - Server enqueues: Content → LiveRequestQueue

    2. Server → Client (Downstream):
       - ADK generates: Events from run_live()
       - stream_adk_to_ai_sdk() converts: ADK events → SSE format
         (Same converter as /stream endpoint - 100% code reuse!)
       - WebSocket sends: SSE-formatted strings like 'data: {...}\n\n'
       - Client parses: SSE format → UIMessageChunk

    Architecture: "SSE format over WebSocket"
    - Protocol: AI SDK v6 Data Stream Protocol (SSE format)
    - Transport: WebSocket (instead of HTTP SSE)
    - Benefit: Reuses all existing conversion logic from SSE mode

    Supports:
    - Text streaming (text-delta)
    - Tool calling (tool-call-available, tool-result-available)
    - Reasoning (thought)
    - Usage metadata
    """

    await websocket.accept()
    logger.info("[BIDI] WebSocket connection established")

    # Create session for BIDI mode
    user_id = "live_user"
    session = await get_or_create_session(user_id, bidi_agent_runner, "agents")

    # Create LiveRequestQueue for bidirectional communication
    live_request_queue = LiveRequestQueue()

    # Configure response modality based on model type (following ADK bidi-demo pattern)
    # Native audio models require AUDIO modality with transcription config
    # Half-cascade models use TEXT modality for faster performance

    # Check if using Vertex AI (session_resumption is only supported on Vertex AI)
    use_vertexai = os.getenv("GOOGLE_GENAI_USE_VERTEXAI", "0") == "1"

    model_name = bidi_agent.model
    if "native-audio" in model_name:
        logger.info(
            f"[BIDI] Detected native-audio model: {model_name}, using AUDIO modality with transcription"
        )
        if use_vertexai:
            logger.info("[BIDI] Using Vertex AI with session resumption enabled")
        else:
            logger.info(
                "[BIDI] Using Google AI Studio (session resumption not available)"
            )
        logger.info(
            "[BIDI] Context window compression enabled - unlimited session duration"
        )

        # Context window compression enables unlimited session duration
        # Reference: https://google.github.io/adk-docs/streaming/dev-guide/part4/#streamingmode-bidi-or-sse
        # - Without compression: 15min (Gemini) / 10min (Vertex AI) session limit
        # - With compression: Unlimited session duration (both platforms)
        run_config = RunConfig(
            streaming_mode=StreamingMode.BIDI,
            response_modalities=["AUDIO"],
            input_audio_transcription=types.AudioTranscriptionConfig(),
            output_audio_transcription=types.AudioTranscriptionConfig(),
            session_resumption=types.SessionResumptionConfig()
            if use_vertexai
            else None,
            context_window_compression=types.ContextWindowCompressionConfig(
                trigger_tokens=100000,
                sliding_window=types.SlidingWindow(target_tokens=80000),
            ),
        )
    else:
        logger.info(f"[BIDI] Using TEXT modality for model: {model_name}")
        if use_vertexai:
            logger.info("[BIDI] Using Vertex AI with session resumption enabled")
        else:
            logger.info(
                "[BIDI] Using Google AI Studio (session resumption not available)"
            )
        logger.info(
            "[BIDI] Context window compression enabled - unlimited session duration"
        )

        # Context window compression enables unlimited session duration
        # Reference: https://google.github.io/adk-docs/streaming/dev-guide/part4/#streamingmode-bidi-or-sse
        # - Without compression: 15min (Gemini) / 10min (Vertex AI) session limit
        # - With compression: Unlimited session duration (both platforms)
        run_config = RunConfig(
            streaming_mode=StreamingMode.BIDI,
            response_modalities=["TEXT"],
            input_audio_transcription=None,
            output_audio_transcription=None,
            session_resumption=types.SessionResumptionConfig()
            if use_vertexai
            else None,
            context_window_compression=types.ContextWindowCompressionConfig(
                trigger_tokens=100000,
                sliding_window=types.SlidingWindow(target_tokens=80000),
            ),
        )

    try:
        # Start ADK BIDI streaming
        live_events = bidi_agent_runner.run_live(
            user_id=user_id,
            session_id=session.id,
            live_request_queue=live_request_queue,
            run_config=run_config,
        )

        logger.info("[BIDI] ADK live stream started")

        # Task 1: Receive messages from WebSocket → send to LiveRequestQueue
        async def receive_from_client():
            try:
                while True:
                    data = await websocket.receive_text()
                    # Parse structured event format (P2-T2)
                    event = json.loads(data)
                    event_type = event.get("type")
                    event_version = event.get("version", "1.0")

                    logger.info(f"[BIDI] Received event: {event_type} (v{event_version})")

                    # Handle ping/pong for latency monitoring
                    if event_type == "ping":
                        await websocket.send_text(
                            json.dumps(
                                {
                                    "type": "pong",
                                    "timestamp": event.get("timestamp"),
                                }
                            )
                        )
                        continue

                    # Handle message event (chat messages)
                    if event_type == "message":
                        message_data = event.get("data", {})
                        messages = message_data.get("messages", [])
                        if messages:
                            # Get last message
                            last_msg = ChatMessage(**messages[-1])

                            # Process tool-use parts (approval/rejection responses from frontend)
                            from tool_delegate import process_tool_use_parts

                            process_tool_use_parts(last_msg, connection_delegate)

                            # IMPORTANT: Live API requires separation of image/video blobs and text
                            # - Images/videos: Use send_realtime(blob)
                            # - Text: Use send_content(content)
                            # Reference: https://google.github.io/adk-docs/streaming/dev-guide/part2/

                            # Separate image/video blobs from text parts
                            text_parts: list[types.Part] = []

                            for part in last_msg.parts:
                                # Handle file parts (images)
                                if isinstance(part, FilePart):
                                    # Send image blob via send_realtime()
                                    import base64

                                    # Decode data URL
                                    if part.url.startswith("data:"):
                                        data_url_parts = part.url.split(",", 1)
                                        if len(data_url_parts) == 2:
                                            image_data_base64 = data_url_parts[1]
                                            image_bytes = base64.b64decode(
                                                image_data_base64
                                            )

                                            # Create blob and send via send_realtime()
                                            image_blob = types.Blob(
                                                mime_type=part.mediaType,
                                                data=image_bytes,
                                            )
                                            live_request_queue.send_realtime(image_blob)

                                # Handle text parts
                                elif isinstance(part, TextPart):
                                    text_parts.append(types.Part(text=part.text))

                            # Send text content via send_content() if any text exists
                            if text_parts:
                                text_content = types.Content(
                                    role="user", parts=text_parts
                                )
                                live_request_queue.send_content(text_content)

                    # Handle interrupt event (P2-T2 Phase 2)
                    elif event_type == "interrupt":
                        reason = event.get("reason", "user_abort")
                        logger.info(f"[BIDI] User interrupted (reason: {reason})")
                        # Close the request queue to stop AI generation
                        live_request_queue.close()
                        # Note: WebSocket stays open for next turn

                    # Handle audio control event (P2-T2 Phase 3)
                    elif event_type == "audio_control":
                        action = event.get("action")
                        if action == "start":
                            logger.info("[BIDI] Audio input started (CMD key pressed)")
                        elif action == "stop":
                            logger.info(
                                "[BIDI] Audio input stopped (CMD key released, auto-send)"
                            )
                        # Note: Audio chunks are streamed separately via audio_chunk events
                        # ADK processes the audio in real-time through LiveRequestQueue

                    # Handle audio chunk event (P2-T2 Phase 3)
                    elif event_type == "audio_chunk":
                        chunk_data = event.get("data", {})
                        chunk_base64 = chunk_data.get("chunk")
                        sample_rate = chunk_data.get("sampleRate", 16000)
                        channels = chunk_data.get("channels", 1)
                        bit_depth = chunk_data.get("bitDepth", 16)

                        if chunk_base64:
                            import base64

                            # Decode base64 PCM audio data
                            audio_bytes = base64.b64decode(chunk_base64)
                            logger.debug(
                                f"[BIDI] Received PCM chunk: {len(audio_bytes)} bytes "
                                f"({sample_rate}Hz, {channels}ch, {bit_depth}bit)"
                            )

                            # Frontend now sends raw PCM audio via AudioWorklet
                            # Format: 16-bit signed integer, 16kHz, mono
                            # This matches ADK Live API requirements

                            # Create audio blob for ADK
                            # Using audio/pcm mime type (raw PCM from AudioWorklet)
                            audio_blob = types.Blob(
                                mime_type="audio/pcm", data=audio_bytes
                            )
                            # Send to ADK via LiveRequestQueue
                            live_request_queue.send_realtime(audio_blob)

                    # Note: "tool_result" event handler removed (dead code)
                    # Frontend uses AI SDK v6's standard flow with tool-use parts in messages
                    # Tool approval/rejection is now handled via process_tool_use_parts()
                    # Reference: experiments/2025-12-13_frontend_backend_integration_gap_analysis.md

                    # Unknown event type
                    else:
                        logger.warning(f"[BIDI] Unknown event type: {event_type}")

            except WebSocketDisconnect:
                logger.info("[BIDI] Client disconnected")
                live_request_queue.close()
            except Exception as e:
                logger.error(f"[BIDI] Error receiving from client: {e}")
                live_request_queue.close()
                raise

        # Task 2: Receive ADK events → send to WebSocket
        async def send_to_client():
            try:
                event_count = 0
                # IMPORTANT: Protocol conversion happens here!
                # stream_adk_to_ai_sdk() converts ADK events to AI SDK v6 Data Stream Protocol
                # Output: SSE-formatted strings like 'data: {"type":"text-delta","text":"..."}\n\n'
                # This is the SAME converter used in SSE mode (/stream endpoint)
                # We reuse 100% of the conversion logic - only transport layer differs
                # WebSocket mode: Send SSE format over WebSocket (instead of HTTP SSE)
                # Phase 4: Pass tools_requiring_approval for tool approval flow
                async for sse_event in stream_adk_to_ai_sdk(
                    live_events, tools_requiring_approval=TOOLS_REQUIRING_APPROVAL
                ):
                    event_count += 1
                    # Send SSE-formatted event as WebSocket text message
                    # Frontend will parse "data: {...}" format and extract UIMessageChunk
                    await websocket.send_text(sse_event)

                logger.info(f"[BIDI] Sent {event_count} events to client")

            except WebSocketDisconnect:
                # Client disconnected during streaming - this is expected during page reload
                pass
            except ValueError as e:
                # ADK connection errors (e.g., session resumption errors)
                # Silently handle expected errors when client disconnects
                if "Transparent session resumption" not in str(e):
                    logger.error(f"[BIDI] ADK connection error: {e}")
            except Exception as e:
                logger.error(f"[BIDI] Error sending to client: {e}")
                raise

        # Run both tasks concurrently
        await asyncio.gather(
            receive_from_client(),
            send_to_client(),
            return_exceptions=True,
        )

    except WebSocketDisconnect:
        logger.info("[BIDI] WebSocket connection closed")
    except Exception as e:
        logger.error(f"[BIDI] WebSocket error: {e}")
        try:
            await websocket.close(code=1011, reason=str(e))
        except Exception:
            pass  # Connection might already be closed
    finally:
        # Ensure queue is closed
        try:
            live_request_queue.close()
        except Exception:
            pass


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
