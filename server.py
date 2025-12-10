"""
ADK Backend Server with FastAPI
Phase 1: Independent operation with simple LLM chat
Phase 2: JSONRPC integration
Phase 3: SSE streaming with ADK LLM
"""

import asyncio
import os
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from loguru import logger
from dotenv import load_dotenv
import json

# Load environment variables from .env.local
load_dotenv(".env.local")

# Explicitly ensure API key is in os.environ for Google GenAI SDK
if not os.getenv("GOOGLE_GENERATIVE_AI_API_KEY"):
    # Try loading again with override
    load_dotenv(".env.local", override=True)

# ADK imports
from google.adk.agents import Agent
from google.adk.runners import InMemoryRunner
from google.genai import types

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

# Simple chat agent using ADK
# Note: Agent reads API key from GOOGLE_API_KEY environment variable
chat_agent = Agent(
    name="adk_chat_agent",
    model="gemini-2.0-flash-exp",
    description="A helpful chat agent powered by Google ADK",
    instruction="You are a helpful AI assistant. Respond naturally and helpfully to user queries.",
    tools=[],  # No tools for basic chat
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
    message_content = types.Content(
        role="user",
        parts=[types.Part(text=user_message)]
    )

    # Run agent and collect response
    response_text = ""
    async for event in agent_runner.run_async(
        user_id=user_id,
        session_id=session.id,
        new_message=message_content,
    ):
        # Collect final response
        if event.is_final_response() and event.content:
            for part in event.content.parts:
                if hasattr(part, 'text') and part.text:
                    response_text += part.text

    return response_text.strip()


async def stream_agent_chat(user_message: str, user_id: str = "default_user"):
    """
    Stream ADK agent responses as SSE events in AI SDK v6 format.
    Yields SSE-formatted events compatible with AI SDK's Data Stream Protocol.
    """
    session = await get_or_create_session(user_id)

    # Create message content
    message_content = types.Content(
        role="user",
        parts=[types.Part(text=user_message)]
    )

    # Track if we've sent any text
    text_id = "0"
    has_started = False

    try:
        # Stream events from ADK agent
        async for event in agent_runner.run_async(
            user_id=user_id,
            session_id=session.id,
            new_message=message_content,
        ):
            # Extract text from event
            if event.content and event.content.parts:
                for part in event.content.parts:
                    if hasattr(part, 'text') and part.text:
                        # Send text-start event on first text
                        if not has_started:
                            yield f'data: {json.dumps({"type": "text-start", "id": text_id})}\n\n'
                            has_started = True

                        # Send text-delta event for each chunk
                        yield f'data: {json.dumps({"type": "text-delta", "id": text_id, "delta": part.text})}\n\n'

        # Send text-end and finish events
        if has_started:
            yield f'data: {json.dumps({"type": "text-end", "id": text_id})}\n\n'

        yield f'data: {json.dumps({"type": "finish", "finishReason": "stop"})}\n\n'
        yield 'data: [DONE]\n\n'

    except Exception as e:
        logger.error(f"Error streaming ADK agent: {e}")
        # Send error event
        yield f'data: {json.dumps({"type": "error", "error": str(e)})}\n\n'
        yield 'data: [DONE]\n\n'


class ChatMessage(BaseModel):
    """Chat message model"""

    role: str
    content: str


class ChatRequest(BaseModel):
    """Chat request model"""

    messages: list[ChatMessage]


class ChatResponse(BaseModel):
    """Chat response model"""

    message: str


# JSONRPC 2.0 Models
class JSONRPCRequest(BaseModel):
    """JSONRPC 2.0 request model"""

    jsonrpc: str = Field(default="2.0", pattern="^2\\.0$")
    method: str
    params: dict[str, Any] | None = None
    id: str | int | None = None


class JSONRPCError(BaseModel):
    """JSONRPC 2.0 error model"""

    code: int
    message: str
    data: Any | None = None


class JSONRPCResponse(BaseModel):
    """JSONRPC 2.0 response model"""

    jsonrpc: str = Field(default="2.0")
    result: Any | None = None
    error: JSONRPCError | None = None
    id: str | int | None = None


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
    Chat endpoint with ADK LLM (Phase 1: Non-streaming)
    Uses Google ADK with InMemoryRunner for actual LLM responses
    """
    logger.info(f"Received chat request with {len(request.messages)} messages")

    # Get the last user message
    last_message = request.messages[-1].content if request.messages else ""

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
    SSE streaming endpoint (Phase 3)
    Streams ADK agent responses in AI SDK v6 Data Stream Protocol format
    """
    logger.info(f"Received stream request with {len(request.messages)} messages")

    # Get the last user message
    last_message = request.messages[-1].content if request.messages else ""

    if not last_message:
        # Return error as SSE
        async def error_stream():
            yield f'data: {json.dumps({"type": "error", "error": "No message provided"})}\n\n'
            yield 'data: [DONE]\n\n'

        return StreamingResponse(
            error_stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
            }
        )

    # Stream ADK agent response
    return StreamingResponse(
        stream_agent_chat(last_message),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
        }
    )


@app.post("/jsonrpc", response_model=JSONRPCResponse)
async def jsonrpc(request: JSONRPCRequest):
    """
    JSONRPC 2.0 endpoint (Phase 2)
    Handles chat requests via JSONRPC protocol
    """
    logger.info(f"Received JSONRPC request: method={request.method}, id={request.id}")

    try:
        if request.method == "chat":
            # Extract messages from params
            if not request.params or "messages" not in request.params:
                return JSONRPCResponse(
                    jsonrpc="2.0",
                    error=JSONRPCError(
                        code=-32602,
                        message="Invalid params: 'messages' field required",
                    ),
                    id=request.id,
                )

            messages_data = request.params["messages"]
            messages = [ChatMessage(**msg) for msg in messages_data]

            # Get last user message and run ADK agent
            last_message = messages[-1].content if messages else ""
            response_text = await run_agent_chat(last_message)

            logger.info(f"Sending JSONRPC response: {response_text[:100]}...")

            return JSONRPCResponse(
                jsonrpc="2.0",
                result={"message": response_text, "role": "assistant"},
                id=request.id,
            )

        else:
            # Method not found
            return JSONRPCResponse(
                jsonrpc="2.0",
                error=JSONRPCError(
                    code=-32601, message=f"Method not found: {request.method}"
                ),
                id=request.id,
            )

    except Exception as e:
        logger.error(f"Error processing JSONRPC request: {e}")
        return JSONRPCResponse(
            jsonrpc="2.0",
            error=JSONRPCError(code=-32603, message="Internal error", data=str(e)),
            id=request.id,
        )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
