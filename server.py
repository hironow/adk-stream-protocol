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
from typing import Any

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

from adk_stream_protocol import (  # noqa: E402  # noqa: E402  # noqa: E402
    SSE_CONFIRMATION_TOOLS,
    BidiEventReceiver,
    BidiEventSender,
    ChatMessage,
    FrontendToolDelegate,
    SseEventStreamer,
    StreamProtocolConverter,
    ToolCallState,
    ToolConfirmationDelegate,
    ToolUsePart,
    bidi_agent,
    bidi_agent_runner,
    chunk_logger,
    clear_sessions,
    get_delegate,
    get_or_create_session,
    register_delegate,
    sse_agent,
    sse_agent_runner,
)


def _get_user() -> str:
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
    last_message = request.messages[-1]._get_text_content() if request.messages else ""
    if not last_message:
        return ChatResponse(message="No message provided")

    # 2. Session management
    # Get user ID (single user mode for demo environment without database)
    user_id = _get_user()
    # App-based runner requires app_name to match the App's name
    app_name = "adk_assistant_app_sse"
    session = await get_or_create_session(user_id, sse_agent_runner, app_name)
    logger.info(f"[/chat] Session ID: {session.id}")

    # 3. Create ADK message content from user input
    message_content = types.Content(role="user", parts=[types.Part(text=last_message)])

    # 4. Run ADK agent and collect response
    response_text = ""
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
    return ChatResponse(message=response_text)


def _create_error_sse_response(error_message: str) -> StreamingResponse:
    """
    Create an SSE error response

    Design Principle: [DONE] should ONLY be sent from finalize(), not directly from server.py
    """

    async def error_stream():
        async for event in StreamProtocolConverter().finalize(error=error_message):
            yield event

    return StreamingResponse(
        error_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )


def _process_latest_message(
    last_message: ChatMessage, session: Any, id_mapper: Any = None, delegate: Any = None
) -> types.Content | None:
    """
    Process the latest message and convert to ADK Content.

    Handle assistant messages with tool confirmations.
    Returns None if message should be skipped.

    Args:
        last_message: Message to process
        session: ADK session (for accessing pending_confirmations in Turn 2)
        id_mapper: Optional ID mapper for resolving tool_call_id → tool_name
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
            message_content = last_message.to_adk_content(id_mapper=id_mapper, delegate=delegate)
            logger.info(f"[/stream] Processing confirmation response: {message_content}")
            return message_content
        else:
            # Assistant message without confirmation output
            logger.warning("[/stream] Last message is assistant but has no confirmation")
            return None
    else:
        # User message processing
        # Create ADK message content (includes text, images, function responses, etc.)
        message_content = last_message.to_adk_content(id_mapper=id_mapper, delegate=delegate)

        # Log processing type
        last_user_message_text = last_message._get_text_content()
        if last_user_message_text:
            logger.info(f"[/stream] Processing text: {last_user_message_text[:50]}...")
        else:
            logger.info("[/stream] Processing non-text message (function response, etc.)")

        return message_content


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
    logger.info("[/stream] ===== API REQUEST RECEIVED =====")
    logger.info(f"[/stream] Total messages: {len(request.messages)}")

    # Debug logging for all incoming messages with detailed parts
    # Note: Pass ID mapper for tool-result part resolution
    for i, msg in enumerate(request.messages):
        logger.info(f"[/stream] --- Message {i} ---")
        logger.info(f"[/stream] role: {msg.role}")

        msg_context = msg.to_adk_content(id_mapper=frontend_delegate._id_mapper, delegate=frontend_delegate)
        logger.info(f"[/stream] parts count: {len(msg_context.parts) if msg_context.parts else 0}")

        if msg_context.parts:
            for j, part in enumerate(msg_context.parts):
                if part.text:
                    logger.info(f"[/stream] part[{j}]: text='{part.text[:50]}...'")
                elif part.function_response:
                    logger.info(
                        f"[/stream] part[{j}]: FunctionResponse("
                        f"id={part.function_response.id}, "
                        f"name={part.function_response.name}, "
                        f"response={part.function_response.response})"
                    )
                elif part.function_call:
                    logger.info(
                        f"[/stream] part[{j}]: FunctionCall("
                        f"id={part.function_call.id}, "
                        f"name={part.function_call.name}, "
                        f"args={part.function_call.args})"
                    )
    logger.info("[/stream] ===================================")

    # Validate input messages
    if not request.messages:
        return _create_error_sse_response("No messages provided")

    # Create SSE stream generator inline (transaction script pattern)
    async def generate_sse_stream():
        # 2. Session management
        # Get user ID (single user mode for demo environment without database)
        user_id = _get_user()
        # App-based runner requires app_name to match the App's name
        session = await get_or_create_session(user_id, sse_agent_runner, "adk_assistant_app_sse")
        logger.info(f"[/stream] Session ID: {session.id}")

        # DEBUG: Check session state persistence
        try:
            events = await sse_agent_runner.session_service.get_events(
                session=session,
                after_event_index=0
            )
            event_count = len(list(events))
            logger.info(f"[/stream] Session has {event_count} events in history")
        except Exception as e:
            logger.warning(f"[/stream] Could not get session events: {e}")

        # Get or create session-specific frontend delegate
        # Delegate must persist across turns so Futures created in Turn 1 can be resolved in Turn 2
        # Note: Cannot store in session.state (not serializable - contains asyncio.Future)
        # Tools access delegate via frontend_tool_registry.get_delegate(session.id)
        existing_delegate = get_delegate(session.id)
        if existing_delegate:
            frontend_delegate = existing_delegate
            logger.info(f"[/stream] Reusing existing FrontendToolDelegate for session_id={session.id}")
        else:
            frontend_delegate = FrontendToolDelegate()
            register_delegate(session.id, frontend_delegate)
            logger.info(f"[/stream] Created new FrontendToolDelegate for session_id={session.id}")

        # Process the latest message (pass ID mapper and delegate for tool-result resolution)
        message_content = _process_latest_message(
            request.messages[-1], session, id_mapper=frontend_delegate._id_mapper, delegate=frontend_delegate
        )
        if message_content is None:
            return

        logger.info("[/stream] ===== ADK INPUT (new_message) =====")
        logger.info(f"[/stream] role: {message_content.role}")
        logger.info(f"[/stream] parts count: {len(message_content.parts) if message_content.parts else 0}")
        if message_content.parts:
            for i, part in enumerate(message_content.parts):
                if part.text:
                    logger.info(f"[/stream] part[{i}]: text='{part.text[:50]}...'")
                elif part.function_response:
                    logger.info(
                        f"[/stream] part[{i}]: FunctionResponse("
                        f"id={part.function_response.id}, "
                        f"name={part.function_response.name}, "
                        f"response={part.function_response.response})"
                    )
                elif part.function_call:
                    logger.info(
                        f"[/stream] part[{i}]: FunctionCall("
                        f"id={part.function_call.id}, "
                        f"name={part.function_call.name}, "
                        f"args={part.function_call.args})"
                    )
        logger.info("[/stream] =======================================")

        # ID変換: confirmation-adk-xxx → adk-xxx (for adk_request_confirmation approval responses)
        # This converts frontend confirmation IDs back to original ADK tool call IDs
        if message_content.parts:
            for part in message_content.parts:
                if (hasattr(part, "function_response")
                    and part.function_response is not None
                    and part.function_response.name == "adk_request_confirmation"
                    and part.function_response.id.startswith("confirmation-")):

                    original_id = part.function_response.id.replace("confirmation-", "", 1)
                    logger.info(
                        f"[/stream] ID変換: {part.function_response.id} → {original_id}"
                    )
                    part.function_response.id = original_id

        logger.info(
            f"[/stream] Agent model: {sse_agent.model}, "
            f"tools: {[tool.__name__ if callable(tool) else str(tool) for tool in sse_agent.tools]}"
        )

        # Detect if this is Turn 2 (confirmation response) by checking for adk_request_confirmation FunctionResponse
        is_confirmation_response = False
        if message_content.parts:
            for part in message_content.parts:
                if (hasattr(part, "function_response")
                    and part.function_response is not None
                    and part.function_response.name == "adk_request_confirmation"):
                    is_confirmation_response = True
                    break

        # Get last invocation_id for continuation (ONLY if this is Turn 2)
        last_invocation_id = None
        if is_confirmation_response:
            last_invocation_id = session.state.get("last_invocation_id")
            if last_invocation_id:
                logger.info(f"[/stream] Turn 2: Continuing from invocation_id: {last_invocation_id}")
            else:
                logger.warning("[/stream] Turn 2 detected but no invocation_id found!")
        # Turn 1: Clear any old invocation_id and start fresh
        elif "last_invocation_id" in session.state:
            del session.state["last_invocation_id"]
            logger.info("[/stream] Turn 1: Cleared old invocation_id, starting new invocation")
        else:
            logger.info("[/stream] Turn 1: Starting new invocation")

        # Run ADK agent with streaming
        # Use invocation_id for multi-turn continuation
        event_stream = sse_agent_runner.run_async(
            user_id=user_id,
            session_id=session.id,
            new_message=message_content,
            invocation_id=last_invocation_id,
        )

        streamer = SseEventStreamer(
            frontend_delegate=frontend_delegate,
            confirmation_tools=SSE_CONFIRMATION_TOOLS,
            session=session,
            sse_agent_runner=sse_agent_runner,
        )

        # Stream events to client (handles conversion, confirmation, ID mapping)
        async for sse_event in streamer.stream_events(event_stream):
            yield sse_event

        # After streaming, save invocation_id from SseEventStreamer for Turn 2 continuation
        current_invocation_id = getattr(streamer, '_current_invocation_id', None)
        if current_invocation_id:
            session.state["last_invocation_id"] = current_invocation_id
            logger.info(f"[/stream] Saved invocation_id for continuation: {current_invocation_id}")
        else:
            logger.warning("[/stream] No invocation_id captured")

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
async def live_chat(websocket: WebSocket):  # noqa: PLR0915
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
       - ADK events → SSE format
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
    user_id = _get_user()
    session = await get_or_create_session(
        user_id,
        bidi_agent_runner,
        "agents",
        connection_signature=connection_signature,  # KEY: Creates unique session per connection
    )
    logger.info(f"[BIDI] Session created: {session.id}")

    # Get or create session-specific frontend delegate
    # Delegate must persist across turns so Futures created in Turn 1 can be resolved in Turn 2
    # Note: Cannot store in session.state (not serializable - contains asyncio.Future)
    # Tools access delegate via frontend_tool_registry.get_delegate(session.id)
    existing_delegate = get_delegate(session.id)
    if existing_delegate:
        frontend_delegate = existing_delegate
        logger.info(f"[BIDI] Reusing existing FrontendToolDelegate for session_id={session.id}")
    else:
        frontend_delegate = FrontendToolDelegate()
        register_delegate(session.id, frontend_delegate)
        logger.info(f"[BIDI] Created new FrontendToolDelegate for session_id={session.id}")

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

    # Initialize ToolConfirmationDelegate for BIDI mode
    # Tool functions (process_payment, get_location) use this to await user confirmation
    confirmation_delegate = ToolConfirmationDelegate()
    session.state["confirmation_delegate"] = confirmation_delegate
    logger.info("[BIDI] ToolConfirmationDelegate initialized")

    # Initialize confirmation_id_mapping for BidiEventSender/Receiver
    # Maps confirmation_id → original_tool_call_id for approval resolution
    session.state["confirmation_id_mapping"] = {}
    logger.info("[BIDI] confirmation_id_mapping dict initialized")

    # Create BidiEventReceiver (upstream: WebSocket → ADK)
    # Single receiver handles all messages across all turns
    bidi_event_receiver = BidiEventReceiver(
        session=session,
        frontend_delegate=frontend_delegate,
        live_request_queue=live_request_queue,
        bidi_agent_runner=bidi_agent_runner,
    )
    session.state["bidi_event_receiver"] = bidi_event_receiver
    logger.info("[BIDI] BidiEventReceiver created (upstream: WebSocket → ADK)")

    # Convert model to string if needed (bidi_agent.model is str | BaseLlm)
    agent_model_str = (
        bidi_agent.model if isinstance(bidi_agent.model, str) else str(bidi_agent.model)
    )

    # Create BidiEventSender for downstream (ADK → WebSocket)
    bidi_event_sender = BidiEventSender(
        websocket=websocket,
        frontend_delegate=frontend_delegate,
        session=session,
        agent_model=agent_model_str,  # Pass agent model for modelVersion fallback
        confirmation_tools=["process_payment", "get_location"],  # Tools requiring user approval
    )
    logger.info("[BIDI] BidiEventSender created (downstream: ADK → WebSocket)")

    # Downstream task: Stream ADK events → WebSocket (following official bidi-demo pattern)
    async def downstream_task():
        """Receives Events from run_live() and sends to WebSocket."""
        logger.info("[BIDI] downstream_task started, calling runner.run_live()")
        logger.info(f"[BIDI] Starting run_live with user_id={user_id}, session_id={session.id}")

        # Single run_live() call handles ALL turns
        # Turn 1: Initial message via live_request_queue
        # Turn 2+: Continuation via send_content() on same queue
        live_events = bidi_agent_runner.run_live(
            user_id=user_id,
            session_id=session.id,
            live_request_queue=live_request_queue,
            run_config=run_config,
            session=session,
        )
        await bidi_event_sender.send_events(live_events)
        logger.info("[BIDI] run_live() generator completed")

    # Upstream task: Receive WebSocket messages and send to LiveRequestQueue
    async def upstream_task():
        """Receives messages from WebSocket and sends to LiveRequestQueue."""
        logger.info("[BIDI] upstream_task started")
        while True:
            data = await websocket.receive_text()
            event = json.loads(data)
            event_type = event.get("type")

            # Handle ping/pong
            if event_type == "ping":
                await websocket.send_text(
                    json.dumps({"type": "pong", "timestamp": event.get("timestamp")})
                )
                continue

            # Get current receiver from session.state
            receiver = session.state.get("bidi_event_receiver")
            if receiver:
                await receiver.handle_event(event)
            else:
                logger.warning(f"[BIDI] No receiver available for event: {event_type}")

    try:
        # Run both tasks concurrently (following official bidi-demo pattern)
        logger.info("[BIDI] Starting asyncio.gather() for upstream/downstream tasks")
        await asyncio.gather(upstream_task(), downstream_task())

    except WebSocketDisconnect:
        logger.error("[BIDI] WebSocket disconnected")
    except Exception as e:
        logger.error(f"[live_chat] Exception: {e!s}")
    finally:
        live_request_queue.close()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")  # noqa: S104
