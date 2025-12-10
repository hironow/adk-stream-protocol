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
from typing import Any

import aiohttp
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from google.adk.agents import Agent, LiveRequestQueue
from google.adk.agents.run_config import RunConfig
from google.adk.runners import InMemoryRunner
from google.genai import types
from loguru import logger
from pydantic import BaseModel

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
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ========== Tool Definitions ==========
# Real-world example tools that demonstrate tool calling and tool results

# Simple in-memory cache for weather data
_weather_cache: dict[str, tuple[dict[str, Any], float]] = {}
WEATHER_CACHE_TTL = 43200  # 12 hours in seconds


async def get_weather(location: str) -> dict[str, Any]:
    """
    Get weather information for a location using OpenWeatherMap API.

    Args:
        location: City name or location to get weather for

    Returns:
        Weather information including temperature and conditions
    """
    # Check cache first
    import time

    cache_key = location.lower()
    if cache_key in _weather_cache:
        cached_data, timestamp = _weather_cache[cache_key]
        if time.time() - timestamp < WEATHER_CACHE_TTL:
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
        import time

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
                    _weather_cache[cache_key] = (weather, time.time())
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

# Real-world agent with tools
# This agent can call functions and return results via tool-call and tool-result events
# Functions are passed directly - ADK automatically wraps them as FunctionTool
chat_agent = Agent(
    name="adk_assistant_agent",
    model="gemini-3-pro-preview",  # Latest Gemini 3 Pro with advanced tool calling support
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

# Initialize InMemoryRunner for programmatic agent invocation
agent_runner = InMemoryRunner(agent=chat_agent, app_name="adk_data_protocol")

# Global session management (in-memory for now)
# In production, use persistent session storage
_sessions: dict[str, Any] = {}


async def get_or_create_session(user_id: str = "default_user") -> Any:
    """Get or create a session for a user"""
    session_id = f"session_{user_id}"

    if session_id not in _sessions:
        logger.info(f"Creating new session for user: {user_id}")
        session = await agent_runner.session_service.create_session(
            app_name="adk_data_protocol",
            user_id=user_id,
            session_id=session_id,
        )
        _sessions[session_id] = session

    return _sessions[session_id]


async def run_agent_chat(user_message: str, user_id: str = "default_user") -> str:
    """
    Run the ADK agent with a user message and return the response.
    Based on official ADK examples using InMemoryRunner.
    """
    session = await get_or_create_session(user_id)

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
    session = await get_or_create_session(user_id)

    # Extract last user message (ADK session already has full history)
    if not messages:
        return

    last_user_message = messages[-1].get_text_content()
    if not last_user_message:
        return

    logger.info(
        f"Streaming chat for user {user_id}, message: {last_user_message[:50]}..."
    )
    logger.info(
        f"Agent model: {chat_agent.model}, tools: {[tool.__name__ if callable(tool) else str(tool) for tool in chat_agent.tools]}"
    )

    # Create ADK message content for the latest user input
    message_content = types.Content(
        role="user", parts=[types.Part(text=last_user_message)]
    )

    # Create ADK event stream
    event_stream = agent_runner.run_async(
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


class MessagePart(BaseModel):
    """Message part model for AI SDK v6 UIMessage format"""

    type: str
    text: str | None = None


class ChatMessage(BaseModel):
    """Chat message model - supports both simple content and AI SDK v6 parts format"""

    role: str
    content: str | None = None  # Simple format
    parts: list[MessagePart] | None = None  # AI SDK v6 format

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
        - Parts: { role: "user", parts: [{ type: "text", text: "..." }] }

        ADK format:
        - types.Content(role="user", parts=[types.Part(text="...")])
        """
        text_content = self.get_text_content()
        return types.Content(
            role=self.role,
            parts=[types.Part(text=text_content)] if text_content else [],
        )


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
        response_text = await run_agent_chat(last_message)
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

    Protocol:
    - Client sends AI SDK v6 ChatMessage as JSON
    - Server streams ADK events as UIMessageChunk (SSE format over WebSocket)
    - Supports tool calling in live conversation context
    """
    import asyncio

    await websocket.accept()
    logger.info("[BIDI] WebSocket connection established")

    # Create session for BIDI mode
    session = await get_or_create_session("live_user")

    # Create LiveRequestQueue for bidirectional communication
    live_request_queue = LiveRequestQueue()

    # Configure for text response (can add AUDIO later)
    run_config = RunConfig(response_modalities=["TEXT"])

    try:
        # Start ADK BIDI streaming
        live_events = agent_runner.run_live(
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
                            content = last_msg.to_adk_content()
                            logger.info(f"[BIDI] Sending to ADK: {content}")
                            live_request_queue.send_content(content)
                    elif "role" in message_data:
                        # Single message
                        msg = ChatMessage(**message_data)
                        content = msg.to_adk_content()
                        logger.info(f"[BIDI] Sending to ADK: {content}")
                        live_request_queue.send_content(content)

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
                async for sse_event in stream_adk_to_ai_sdk(live_events):
                    event_count += 1
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
