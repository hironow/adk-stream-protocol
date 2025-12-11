"""
ADK Backend Server with FastAPI (Phase 2 - ADK SSE Streaming)

This server provides AI capabilities using Google ADK.
Frontend connects directly to this backend in Phase 2 mode (adk-sse).
Phase 1 (gemini) uses direct Gemini API and doesn't require this backend.
"""

from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Literal, Union

import aiohttp
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from google.adk.agents import Agent, LiveRequestQueue
from google.adk.agents.run_config import RunConfig, StreamingMode
from google.adk.runners import InMemoryRunner
from google.genai import types
from loguru import logger
from pydantic import BaseModel, Field, field_validator

from stream_protocol import stream_adk_to_ai_sdk

# Load environment variables from .env.local
load_dotenv(".env.local")

logger.info("ADK Backend Server starting up...")

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
        location: City name or location to get weather for

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
    description="An intelligent assistant that can check weather, perform calculations, and get current time",
    instruction=(
        "You are a helpful AI assistant with access to real-time tools. "
        "Use the available tools when needed to provide accurate information:\n"
        "- get_weather: Check weather for any city\n"
        "- calculate: Perform mathematical calculations\n"
        "- get_current_time: Get the current time\n\n"
        "Always explain what you're doing when using tools."
    ),
    tools=[get_weather, calculate, get_current_time],
)

# BIDI Agent: Uses Live API model for bidirectional streaming
bidi_agent = Agent(
    name="adk_assistant_agent_bidi",
    model="gemini-2.5-flash-native-audio-preview-09-2025",  # Live API model for BIDI mode with audio support
    description="An intelligent assistant that can check weather, perform calculations, and get current time",
    instruction=(
        "You are a helpful AI assistant with access to real-time tools. "
        "Use the available tools when needed to provide accurate information:\n"
        "- get_weather: Check weather for any city\n"
        "- calculate: Perform mathematical calculations\n"
        "- get_current_time: Get the current time\n\n"
        "Always explain what you're doing when using tools."
    ),
    tools=[get_weather, calculate, get_current_time],
)

# Initialize InMemoryRunners for each agent
sse_agent_runner = InMemoryRunner(agent=sse_agent, app_name="agents")
bidi_agent_runner = InMemoryRunner(agent=bidi_agent, app_name="agents")

# Global session management (in-memory for now)
# In production, use persistent session storage
_sessions: dict[str, Any] = {}


async def get_or_create_session(
    user_id: str, agent_runner: InMemoryRunner, app_name: str = "adk_data_protocol"
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
    app_name: str = "adk_data_protocol",
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
    session = await get_or_create_session(
        user_id, sse_agent_runner, "adk_data_protocol_sse"
    )

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
    event_count = 0
    async for sse_event in stream_adk_to_ai_sdk(event_stream):
        event_count += 1
        yield sse_event

    logger.info(f"Stream completed with {event_count} SSE events")


class TextPart(BaseModel):
    """Text part in message"""

    type: Literal["text"] = "text"
    text: str


class ImagePart(BaseModel):
    """Image part in message"""

    type: Literal["image"] = "image"
    data: str  # base64 encoded image
    media_type: str = Field(default="image/png")  # image/png, image/jpeg, image/webp

    @field_validator("media_type")
    @classmethod
    def validate_media_type(cls, v: str) -> str:
        """Validate that media_type is one of the supported image formats."""
        allowed_types = {"image/png", "image/jpeg", "image/webp"}
        if v not in allowed_types:
            msg = f"Unsupported media_type: {v}. Allowed types: {', '.join(allowed_types)}"
            raise ValueError(msg)
        return v

    @field_validator("data")
    @classmethod
    def validate_data(cls, v: str) -> str:
        """Validate that data is not empty and is valid base64."""
        import base64

        if not v or len(v.strip()) == 0:
            msg = "Image data cannot be empty"
            raise ValueError(msg)

        # Validate base64 encoding
        try:
            base64.b64decode(v, validate=True)
        except Exception as e:
            msg = f"Invalid base64 encoding: {e}"
            raise ValueError(msg) from e

        return v


class FilePart(BaseModel):
    """File part in message (AI SDK v6 format)"""

    type: Literal["file"] = "file"
    filename: str
    url: str  # data URL with base64 content (e.g., "data:image/png;base64,...")
    mediaType: str  # MIME type (e.g., "image/png")


# Union type for message parts
MessagePart = Union[TextPart, ImagePart, FilePart]


class ChatMessage(BaseModel):
    """Chat message model - supports both simple content and AI SDK v6 parts format"""

    role: str
    content: str | None = None  # Simple format
    parts: list[MessagePart] | None = None  # AI SDK v6 format with discriminated union
    experimental_attachments: list[dict[str, Any]] | None = (
        None  # AI SDK experimental_attachments format
    )

    @field_validator("experimental_attachments", mode="before")
    @classmethod
    def normalize_attachments(cls, v: Any) -> Any:
        """Convert experimental_attachments to parts format if present."""
        if v is not None and isinstance(v, list):
            # Validate that each attachment has required fields
            for attachment in v:
                if not isinstance(attachment, dict):
                    msg = f"Invalid attachment format: {attachment}"
                    raise ValueError(msg)
                if "type" not in attachment:
                    msg = f"Attachment missing 'type' field: {attachment}"
                    raise ValueError(msg)
        return v

    def get_text_content(self) -> str:
        """Extract text content from either format"""
        if self.content:
            return self.content
        if self.parts is not None:
            return "".join(p.text or "" for p in self.parts if p.type == "text")
        return ""

    def to_adk_content(self) -> types.Content:
        """
        Convert AI SDK v6 message to ADK Content format.

        AI SDK v6 format:
        - Simple: { role: "user", content: "text" }
        - Parts: { role: "user", parts: [
            { type: "text", text: "..." },
            { type: "image", data: "base64...", media_type: "image/png" }
          ]}

        ADK format:
        - types.Content(role="user", parts=[types.Part(text="...")])
        - types.Content(role="user", parts=[
            types.Part(text="..."),
            types.Part(inline_data=InlineData(mime_type="image/png", data=bytes))
          ])
        """
        import base64

        adk_parts = []

        # Handle simple text content
        if self.content:
            adk_parts.append(types.Part(text=self.content))

        # Handle experimental_attachments (convert to parts format)
        if self.experimental_attachments:
            for attachment in self.experimental_attachments:
                if attachment.get("type") == "text":
                    adk_parts.append(types.Part(text=attachment.get("text", "")))
                elif attachment.get("type") == "image":
                    # Decode base64 and create inline_data with Blob
                    image_data = attachment.get("data", "")
                    media_type = attachment.get("media_type", "image/png")
                    image_bytes = base64.b64decode(image_data)

                    # Get image dimensions using PIL
                    from io import BytesIO
                    from PIL import Image

                    with Image.open(BytesIO(image_bytes)) as img:
                        width, height = img.size
                        image_format = img.format

                    logger.info(
                        f"[IMAGE INPUT] media_type={media_type}, "
                        f"size={len(image_bytes)} bytes, "
                        f"dimensions={width}x{height}, "
                        f"format={image_format}, "
                        f"base64_length={len(image_data)} chars"
                    )
                    adk_parts.append(
                        types.Part(
                            inline_data=types.Blob(
                                mimeType=media_type, data=image_bytes
                            )
                        )
                    )

        # Handle parts array (multimodal)
        if self.parts:
            for part in self.parts:
                if isinstance(part, TextPart):
                    adk_parts.append(types.Part(text=part.text))
                elif isinstance(part, ImagePart):
                    # Decode base64 and create inline_data with Blob
                    image_bytes = base64.b64decode(part.data)

                    # Get image dimensions using PIL
                    from io import BytesIO
                    from PIL import Image

                    with Image.open(BytesIO(image_bytes)) as img:
                        width, height = img.size
                        image_format = img.format

                    logger.info(
                        f"[IMAGE INPUT] media_type={part.media_type}, "
                        f"size={len(image_bytes)} bytes, "
                        f"dimensions={width}x{height}, "
                        f"format={image_format}, "
                        f"base64_length={len(part.data)} chars"
                    )
                    adk_parts.append(
                        types.Part(
                            inline_data=types.Blob(
                                mimeType=part.media_type, data=image_bytes
                            )
                        )
                    )
                elif isinstance(part, FilePart):
                    # AI SDK v6 file format: extract base64 from data URL
                    # Format: "data:image/png;base64,iVBORw0..."
                    if part.url.startswith("data:"):
                        # Extract base64 content after "base64,"
                        data_url_parts = part.url.split(",", 1)
                        if len(data_url_parts) == 2:
                            base64_data = data_url_parts[1]
                            file_bytes = base64.b64decode(base64_data)

                            # Get image dimensions if it's an image
                            if part.mediaType.startswith("image/"):
                                from io import BytesIO
                                from PIL import Image

                                with Image.open(BytesIO(file_bytes)) as img:
                                    width, height = img.size
                                    image_format = img.format

                                logger.info(
                                    f"[FILE INPUT] filename={part.filename}, "
                                    f"mediaType={part.mediaType}, "
                                    f"size={len(file_bytes)} bytes, "
                                    f"dimensions={width}x{height}, "
                                    f"format={image_format}"
                                )
                            else:
                                logger.info(
                                    f"[FILE INPUT] filename={part.filename}, "
                                    f"mediaType={part.mediaType}, "
                                    f"size={len(file_bytes)} bytes"
                                )

                            adk_parts.append(
                                types.Part(
                                    inline_data=types.Blob(
                                        mimeType=part.mediaType, data=file_bytes
                                    )
                                )
                            )

        return types.Content(role=self.role, parts=adk_parts)


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

    # Run ADK agent and get response
    try:
        response_text = await run_agent_chat(
            last_message, "default_user", sse_agent_runner, "adk_data_protocol_sse"
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

    # Stream ADK agent response (pass full message history)
    return StreamingResponse(
        stream_agent_chat(request.messages),
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
    import asyncio

    await websocket.accept()
    logger.info("[BIDI] WebSocket connection established")

    # Create session for BIDI mode
    session = await get_or_create_session(
        "live_user", bidi_agent_runner, "adk_data_protocol_bidi"
    )

    # Create LiveRequestQueue for bidirectional communication
    live_request_queue = LiveRequestQueue()

    # Configure response modality based on model type (following ADK bidi-demo pattern)
    # Native audio models require AUDIO modality with transcription config
    # Half-cascade models use TEXT modality for faster performance
    model_name = bidi_agent.model
    if "native-audio" in model_name:
        logger.info(
            f"[BIDI] Detected native-audio model: {model_name}, using AUDIO modality with transcription"
        )
        run_config = RunConfig(
            streaming_mode=StreamingMode.BIDI,
            response_modalities=[types.Modality.AUDIO],
            input_audio_transcription=types.AudioTranscriptionConfig(),
            output_audio_transcription=types.AudioTranscriptionConfig(),
            session_resumption=types.SessionResumptionConfig(),
        )
    else:
        logger.info(f"[BIDI] Using TEXT modality for model: {model_name}")
        run_config = RunConfig(
            streaming_mode=StreamingMode.BIDI,
            response_modalities=[types.Modality.TEXT],
            input_audio_transcription=None,
            output_audio_transcription=None,
            session_resumption=types.SessionResumptionConfig(),
        )

    try:
        # Start ADK BIDI streaming
        live_events = bidi_agent_runner.run_live(
            user_id="live_user",
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
                    logger.info(f"[BIDI] Received from client: {data[:100]}...")

                    # Parse AI SDK v6 message format
                    message_data = json.loads(data)

                    # Handle different message types
                    if "messages" in message_data:
                        # Full message history (initial request)
                        messages = message_data["messages"]
                        if messages:
                            # Get last message
                            last_msg = ChatMessage(**messages[-1])

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
                                            logger.info(
                                                f"[BIDI] Sending image via send_realtime(): {part.filename}, {part.mediaType}, {len(image_bytes)} bytes"
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
                                logger.info(
                                    f"[BIDI] Sending text via send_content(): {text_parts}"
                                )
                                live_request_queue.send_content(text_content)

                    elif "role" in message_data:
                        # Single message
                        msg = ChatMessage(**message_data)

                        # Separate image/video blobs from text parts
                        text_parts: list[types.Part] = []

                        for part in msg.parts:
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
                                            mime_type=part.mediaType, data=image_bytes
                                        )
                                        logger.info(
                                            f"[BIDI] Sending image via send_realtime(): {part.filename}, {part.mediaType}, {len(image_bytes)} bytes"
                                        )
                                        live_request_queue.send_realtime(image_blob)

                            # Handle text parts
                            elif isinstance(part, TextPart):
                                text_parts.append(types.Part(text=part.text))

                        # Send text content via send_content() if any text exists
                        if text_parts:
                            text_content = types.Content(role="user", parts=text_parts)
                            logger.info(
                                f"[BIDI] Sending text via send_content(): {text_parts}"
                            )
                            live_request_queue.send_content(text_content)

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
                async for sse_event in stream_adk_to_ai_sdk(live_events):
                    event_count += 1
                    # Send SSE-formatted event as WebSocket text message
                    # Frontend will parse "data: {...}" format and extract UIMessageChunk
                    await websocket.send_text(sse_event)

                logger.info(f"[BIDI] Sent {event_count} events to client")

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
