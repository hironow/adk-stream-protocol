"""
ADK Backend Server with FastAPI

This server provides AI capabilities using Google ADK.
Frontend connects directly to this backend(adk-sse).
gemini uses direct Gemini API and doesn't require this backend.
"""


import asyncio
import json
import os
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv


# Load environment variables from .env.local BEFORE any local imports
# This ensures ChunkLogger reads the correct environment variables
load_dotenv(".env.local")

# All following imports have
# ChunkLogger and other modules depend on environment variables being loaded first
from fastapi import FastAPI, WebSocket, WebSocketDisconnect  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import StreamingResponse  # noqa: E402
from google.adk.agents import LiveRequestQueue  # noqa: E402
from google.adk.agents.run_config import RunConfig, StreamingMode  # noqa: E402
from google.genai import types  # noqa: E402
from loguru import logger  # noqa: E402
from pydantic import BaseModel  # noqa: E402

from adk_ag_runner import (  # noqa: E402
    BIDI_CONFIRMATION_TOOLS,
    SSE_CONFIRMATION_TOOLS,
    bidi_agent,
    bidi_agent_runner,
    sse_agent,
    sse_agent_runner,
)
from adk_compat import (  # noqa: E402
    clear_sessions,
    get_or_create_session,
    sync_conversation_history_to_session,
)
from ai_sdk_v6_compat import (  # noqa: E402
    ChatMessage,
    ToolCallState,
    ToolUsePart,
)
from chunk_logger import chunk_logger  # noqa: E402
from services.bidi_event_receiver import BidiEventReceiver  # noqa: E402
from services.bidi_event_sender import BidiEventSender  # noqa: E402
from services.frontend_tool_service import FrontendToolDelegate  # noqa: E402
from stream_protocol import StreamProtocolConverter  # noqa: E402


# ========== Frontend Tool Delegate (now imported from services) ==========

# FrontendToolDelegate has been moved to services/frontend_tool_service.py
# This section previously contained the class definition (lines 63-208)
# Now it's imported from the services layer


# ========== User Management ==========


def get_user() -> str:
    """
    Get the current user ID.

    IMPORTANT: This is a simplified implementation for a demo/development environment.
    In production, this would:
    - Extract user ID from JWT token, session cookie, or OAuth token
    - Query a user database or authentication service
    - Handle multi-tenancy and user isolation

    Since this backend has no persistence layer (no database), we're using a fixed
    user ID for all requests. This means:
    - All requests share the same ADK session
    - Conversation history persists across page refreshes
    - This is suitable for single-user demo environments only

    Returns:
        str: User ID (currently fixed for demo purposes)
    """
    # TODO: In production, implement proper user authentication
    # Examples:
    # - return extract_user_from_jwt(request.headers.get("Authorization"))
    # - return get_user_from_session(request.cookies.get("session_id"))
    # - return oauth_provider.get_current_user()

    # For now, return a fixed user ID for the demo environment
    # This creates a single persistent session for all requests
    return "demo_user_001"


# Configure file logging
log_dir = Path("logs")
log_dir.mkdir(exist_ok=True)
# session id or time jst format for uniqueness
jst_format = "%Y%m%d_%H%M%S"
jst_time_str = datetime.now(timezone(timedelta(hours=9))).strftime(jst_format)
log_file = log_dir / f"server_{os.getenv('CHUNK_LOGGER_SESSION_ID', jst_time_str)}.log"
logger.add(
    log_file,
    rotation="100 MB",
    retention="7 days",
    level="DEBUG",
    format="{time:YYYY-MM-DD HH:mm:ss.SSS} | {level: <8} | {name}:{function}:{line} - {message}",
)

logger.info("ADK Backend Server starting up...")
logger.info(f"Logging to: {log_file}")

# Log chunk logger configuration
chunk_info = chunk_logger.get_info()
logger.info(f"Chunk Logger: enabled={chunk_info['enabled']}")
if chunk_info["enabled"]:
    logger.info(f"Chunk Logger: session_id={chunk_info['session_id']}")
    logger.info(f"Chunk Logger: output_path={chunk_info['output_path']}")

# Explicitly ensure API key is in os.environ for Google GenAI SDK
if not os.getenv("GOOGLE_GENERATIVE_AI_API_KEY"):
    # Try loading again with override
    load_dotenv(".env.local", override=True)


# Check if using Vertex AI (session_resumption is only supported on Vertex AI)
use_vertexai = os.getenv("GOOGLE_GENAI_USE_VERTEXAI", "0") == "1"


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

# ========== Global Frontend Tool Delegate ==========
# Shared delegate instance for both SSE and BIDI modes
# Note: Past implementation pattern - delegate resolves via WebSocket for both modes
frontend_delegate = FrontendToolDelegate()


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


@app.post("/clear-sessions")
async def clear_backend_sessions():
    """
    Clear all backend sessions (for testing/development)

    This endpoint clears the global _sessions dictionary, resetting
    all conversation history and session state. Useful for E2E tests
    that need clean state between test runs.

    Also closes chunk logger file handles to allow tests to delete
    and recreate log files between test runs.
    """
    logger.info("[/clear-sessions] Clearing all backend sessions")
    clear_sessions()

    # Close chunk logger file handles so tests can delete/recreate log files
    chunk_logger.close()

    return {"status": "success", "message": "All sessions cleared"}


@app.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """
    Non-streaming chat endpoint (NOT USED - for reference only)

    Transaction Script Pattern:
    1. Validate input
    2. Get or create session
    3. Create message content
    4. Run agent and collect response
    5. Return response

    Current architecture uses /stream endpoint exclusively.
    This endpoint is kept for reference but not actively used.
    Use /stream for production.
    """
    logger.info(f"[/chat] Received request with {len(request.messages)} messages")

    # 1. Validate input - get the last user message
    last_message = request.messages[-1].get_text_content() if request.messages else ""
    if not last_message:
        return ChatResponse(message="No message provided")

    # 2. Session management
    # Get user ID (single user mode for demo environment without database)
    user_id = get_user()
    app_name = "agents"
    session = await get_or_create_session(user_id, sse_agent_runner, app_name)
    logger.info(f"[/chat] Session ID: {session.id}")

    # 3. Create ADK message content from user input
    message_content = types.Content(role="user", parts=[types.Part(text=last_message)])

    # 4. Run ADK agent and collect response
    response_text = ""
    try:
        async for event in sse_agent_runner.run_async(
            user_id=user_id,
            session_id=session.id,
            new_message=message_content,
        ):
            # Collect final response text
            if event.is_final_response() and event.content and event.content.parts:
                for part in event.content.parts:
                    if hasattr(part, "text") and part.text:
                        response_text += part.text

        # 5. Return collected response
        response_text = response_text.strip()
        logger.info(f"[/chat] Response: {response_text[:100]}...")
        return ChatResponse(message=response_text)

    except Exception as e:
        logger.error(f"[/chat] Error running ADK agent: {e}")
        return ChatResponse(message=f"Error: {e!s}")


def _create_error_sse_response(error_message: str) -> StreamingResponse:
    """
    Create an SSE error response using StreamProtocolConverter.

    Design Principle: [DONE] should ONLY be sent from finalize(), not directly from server.py
    """

    async def error_stream():
        # Use StreamProtocolConverter.finalize() to ensure consistent [DONE] handling
        converter = StreamProtocolConverter()
        async for event in converter.finalize(error=error_message):
            yield event

    return StreamingResponse(
        error_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )


def _process_latest_message(last_message: ChatMessage) -> types.Content | None:
    """
    Process the latest message and convert to ADK Content.

    Handle assistant messages with tool confirmations.
    Returns None if message should be skipped.
    """
    # When user approves adk_request_confirmation, AI SDK sends assistant message back
    # with tool output (not a new user message). We need to send the confirmation
    # to ADK so it can continue processing.
    if last_message.role == "assistant":
        # Check if this is a tool confirmation response
        has_confirmation = last_message.parts is not None and any(
            isinstance(part, ToolUsePart)
            and part.tool_name == "adk_request_confirmation"
            and part.state == ToolCallState.OUTPUT_AVAILABLE
            for part in last_message.parts
        )

        if has_confirmation:
            # Convert confirmation to ADK content
            # This will be a FunctionResponse that ADK can process
            message_content = last_message.to_adk_content()
            logger.info(f"[/stream] Processing confirmation response: {message_content}")
            return message_content
        else:
            # Assistant message without confirmation output
            logger.warning("[/stream] Last message is assistant but has no confirmation")
            return None
    else:
        # Normal user message processing
        last_user_message_text = last_message.get_text_content()
        if not last_user_message_text:
            logger.warning("[/stream] Last message has no text content")
            return None

        logger.info(f"[/stream] Processing: {last_user_message_text[:50]}...")
        # Create ADK message content (includes images and other parts)
        return last_message.to_adk_content()


@app.post("/stream")
async def stream(request: ChatRequest):
    """
    SSE streaming endpoint

    Transaction Script Pattern:
    1. Validate input messages
    2. Get or create session
    3. Sync conversation history (mode switching support)
    4. Create ADK message content from latest message
    5. Run ADK agent in streaming mode
    6. Convert ADK events to AI SDK format and stream

    AI SDK v6 Data Stream Protocol compliant endpoint.
    - Request: UIMessage[] (full message history)
    - Response: SSE stream (text-start, text-delta, text-end, finish)
    """
    logger.info(f"[/stream] Received request with {len(request.messages)} messages")

    # Debug logging for message parts
    for i, msg in enumerate(request.messages):
        logger.info(f"[/stream] Processing Message {i}: role={msg.role}")
        try:
            msg_context = msg.to_adk_content()
            logger.info(
                f"[/stream] Message {i}: role={msg_context.role}, "
                f"parts={len(msg_context.parts) if msg_context.parts else 0}"
            )
        except Exception as e:
            logger.error(f"[/stream] Failed to convert Message {i}: {e}", exc_info=True)
            return _create_error_sse_response(f"Failed to convert message: {e!s}")

    # Validate input messages
    if not request.messages:
        return _create_error_sse_response("No messages provided")

    # Create SSE stream generator inline (transaction script pattern)
    async def generate_sse_stream():
        # 2. Session management
        # Get user ID (single user mode for demo environment without database)
        user_id = get_user()
        session = await get_or_create_session(user_id, sse_agent_runner, "agents")
        logger.info(f"[/stream] Session ID: {session.id}")

        # Use global frontend tool delegate (shared across SSE and BIDI modes)
        session.state["frontend_delegate"] = frontend_delegate
        logger.info("[/stream] Global FrontendToolDelegate stored in session.state")

        # Sync conversation history (BUG-006 FIX)
        # When switching modes (e.g., Gemini Direct -> ADK SSE), sync history
        await sync_conversation_history_to_session(
            session=session,
            session_service=sse_agent_runner.session_service,
            messages=request.messages,
            current_mode="SSE",
        )

        # Process the latest message
        message_content = _process_latest_message(request.messages[-1])
        if message_content is None:
            return

        logger.info(
            f"[/stream] Agent model: {sse_agent.model}, "
            f"tools: {[tool.__name__ if callable(tool) else str(tool) for tool in sse_agent.tools]}"
        )

        # Run ADK agent with streaming
        event_stream = sse_agent_runner.run_async(
            user_id=user_id,
            session_id=session.id,
            new_message=message_content,
        )

        # Create SSE event streamer with confirmation support
        from services.sse_event_streamer import SseEventStreamer

        streamer = SseEventStreamer(
            frontend_delegate=frontend_delegate,
            confirmation_tools=SSE_CONFIRMATION_TOOLS,
            session=session,
            sse_agent_runner=sse_agent_runner,
        )

        # Stream events to client (handles conversion, confirmation, ID mapping)
        async for sse_event in streamer.stream_events(event_stream):
            yield sse_event

        logger.info("[/stream] Completed streaming events")

    # Return streaming response
    return StreamingResponse(
        generate_sse_stream(),
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
async def live_chat(websocket: WebSocket):  # noqa: C901, PLR0915
    """
    WebSocket endpoint for bidirectional streaming with ADK BIDI mode

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

    connection_signature = str(uuid.uuid4())
    logger.info(f"[BIDI] New connection: {connection_signature}")

    # Create connection-specific session
    # ADK Design: session = connection (prevents concurrent run_live() race conditions)
    # Get user ID (single user mode for demo environment without database)
    user_id = get_user()
    session = await get_or_create_session(
        user_id,
        bidi_agent_runner,
        "agents",
        connection_signature=connection_signature,  # KEY: Creates unique session per connection
    )
    logger.info(f"[BIDI] Session created: {session.id}")

    # Use global frontend tool delegate (shared across SSE and BIDI modes)
    session.state["frontend_delegate"] = frontend_delegate
    logger.info("[BIDI] Global FrontendToolDelegate stored in session.state")

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
        if use_vertexai:
            logger.info("[BIDI] Using Vertex AI with session resumption enabled")
        else:
            logger.info("[BIDI] Using Google AI Studio (session resumption not available)")
        logger.info("[BIDI] Context window compression enabled - unlimited session duration")

        # Context window compression enables unlimited session duration
        # Reference: https://google.github.io/adk-docs/streaming/dev-guide/part4/#streamingmode-bidi-or-sse
        # - Without compression: 15min (Gemini) / 10min (Vertex AI) session limit
        # - With compression: Unlimited session duration (both platforms)
        run_config = RunConfig(
            streaming_mode=StreamingMode.BIDI,
            response_modalities=["AUDIO"],
            input_audio_transcription=types.AudioTranscriptionConfig(),
            output_audio_transcription=types.AudioTranscriptionConfig(),
            session_resumption=types.SessionResumptionConfig() if use_vertexai else None,
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
            logger.info("[BIDI] Using Google AI Studio (session resumption not available)")
        logger.info("[BIDI] Context window compression enabled - unlimited session duration")

        # Context window compression enables unlimited session duration
        # Reference: https://google.github.io/adk-docs/streaming/dev-guide/part4/#streamingmode-bidi-or-sse
        # - Without compression: 15min (Gemini) / 10min (Vertex AI) session limit
        # - With compression: Unlimited session duration (both platforms)
        run_config = RunConfig(
            streaming_mode=StreamingMode.BIDI,
            response_modalities=["TEXT"],
            input_audio_transcription=None,
            output_audio_transcription=None,
            session_resumption=types.SessionResumptionConfig() if use_vertexai else None,
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
            session=session,  # IMPORTANT: Pass the session object explicitly. If not passed, tool_context.state will be empty
        )

        logger.info("[BIDI] ADK live stream started")

        # Create BidiEventReceiver for upstream (WebSocket → ADK)
        bidi_event_receiver = BidiEventReceiver(
            session=session,
            frontend_delegate=frontend_delegate,
            live_request_queue=live_request_queue,
            bidi_agent_runner=bidi_agent_runner,
        )
        logger.info("[BIDI] BidiEventReceiver created (upstream: WebSocket → ADK)")

        # Create BidiEventSender for downstream (ADK → WebSocket)
        bidi_event_sender = BidiEventSender(
            websocket=websocket,
            frontend_delegate=frontend_delegate,
            confirmation_tools=BIDI_CONFIRMATION_TOOLS,
            session=session,
            live_request_queue=live_request_queue,  # Pass queue for continuation trigger
            bidi_agent_runner=bidi_agent_runner,
        )
        logger.info("[BIDI] BidiEventSender created (downstream: ADK → WebSocket)")

        # Receive messages from WebSocket → send to LiveRequestQueue
        async def receive_from_client():
            try:
                while True:
                    data = await websocket.receive_text()
                    # Parse structured event format
                    event = json.loads(data)
                    event_type = event.get("type")

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

                    # Delegate event handling to BidiEventReceiver (upstream: WebSocket → ADK)
                    # Handles: message, interrupt, audio_control, audio_chunk, tool_result
                    await bidi_event_receiver.handle_event(event)

            except WebSocketDisconnect:
                logger.info("[BIDI] Client disconnected")
                live_request_queue.close()
            except json.JSONDecodeError as e:
                logger.error(f"[BIDI] Invalid JSON from client: {e}")
                live_request_queue.close()
                raise
            except Exception as e:
                logger.error(f"[BIDI] Error receiving from client: {e}")
                live_request_queue.close()
                raise

        # Task 2: Receive ADK events → send to WebSocket
        async def send_to_client():
            # Delegate to BidiEventSender (downstream: ADK → WebSocket)
            await bidi_event_sender.send_events(live_events)

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
        except Exception as close_error:
            logger.debug(f"[BIDI] Could not close WebSocket: {close_error}")  # Connection might already be closed
    finally:
        # Ensure queue is closed
        try:
            live_request_queue.close()
        except Exception as queue_error:
            logger.debug(f"[BIDI] Could not close queue: {queue_error}")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")  # noqa: S104
