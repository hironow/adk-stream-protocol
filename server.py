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

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from google.adk.agents import Agent
from google.adk.runners import InMemoryRunner
from google.genai import types
from loguru import logger
from pydantic import BaseModel

from stream_protocol import stream_adk_to_ai_sdk

# Load environment variables from .env.local
load_dotenv(".env.local")

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


def get_weather(location: str) -> dict[str, Any]:
    """
    Get weather information for a location.

    Args:
        location: City name or location to get weather for

    Returns:
        Weather information including temperature and conditions
    """
    # Mock weather data for demonstration
    # In production, this would call a real weather API
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
            "note": f"Weather data not available for {location}, showing default",
        },
    )

    logger.info(f"Tool call: get_weather({location}) -> {weather}")
    return weather


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
    model="gemini-2.0-flash-exp",
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
    async for sse_event in stream_adk_to_ai_sdk(event_stream):
        yield sse_event


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


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
