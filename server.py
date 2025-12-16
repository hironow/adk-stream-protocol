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
import uuid
from datetime import UTC, datetime
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
    TOOLS_REQUIRING_APPROVAL,
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
    process_chat_message_for_bidi,
    process_tool_use_parts,
)
from stream_protocol import stream_adk_to_ai_sdk  # noqa: E402
from tool_delegate import FrontendToolDelegate, frontend_delegate  # noqa: E402


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
log_file = log_dir / f"server_{datetime.now(UTC).strftime('%Y%m%d_%H%M%S')}.log"
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


# ========== Module Dependencies ==========
# Agent and tool definitions have been moved to adk_ag_runner.py for better modularity
# Session management has been moved to adk_compat.py
# Frontend delegation is managed by tool_delegate.py
# Helper functions have been inlined into endpoints for transaction script pattern


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


@app.post("/clear-sessions")
async def clear_backend_sessions():
    """
    Clear all backend sessions (for testing/development)

    This endpoint clears the global _sessions dictionary, resetting
    all conversation history and session state. Useful for E2E tests
    that need clean state between test runs.
    """
    logger.info("[/clear-sessions] Clearing all backend sessions")
    clear_sessions()
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


@app.post("/stream")
async def stream(request: ChatRequest):
    """
    SSE streaming endpoint (Phase 2 - FINAL)

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
        msg_context = msg.to_adk_content()
        logger.info(
            f"[/stream] Message {i}: role={msg_context.role}, "
            f"parts={len(msg_context.parts) if msg_context.parts else 0}"
        )

    # 1. Validate input messages
    if not request.messages:
        # Return error as SSE stream
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

    # Create SSE stream generator inline (transaction script pattern)
    async def generate_sse_stream():
        # Explicitly declare global variable access for nested function scope
        global frontend_delegate

        # 2. Session management
        # Get user ID (single user mode for demo environment without database)
        user_id = get_user()
        session = await get_or_create_session(user_id, sse_agent_runner, "agents")
        logger.info(f"[/stream] Session ID: {session.id}")

        # 3. Sync conversation history (BUG-006 FIX)
        # When switching modes (e.g., Gemini Direct -> ADK SSE), sync history
        await sync_conversation_history_to_session(
            session=session,
            session_service=sse_agent_runner.session_service,
            messages=request.messages,
            current_mode="SSE",
        )

        # 3.5. Process tool outputs from request messages (FRONTEND DELEGATE FIX)
        # When frontend executes tools locally and sends results via addToolOutput,
        # those results are included in the next request's messages array.
        # We need to process these tool outputs BEFORE running the agent,
        # otherwise the backend delegate will hang forever waiting for results.
        logger.debug(f"[/stream] Processing tool outputs from {len(request.messages)} messages")
        for i, msg in enumerate(request.messages):
            if msg.role == "assistant":
                # Process tool outputs and resolve pending delegate futures
                # Note: msg is already a ChatMessage instance from ChatRequest.messages
                approval_processed = process_tool_use_parts(msg, frontend_delegate)
                if approval_processed:
                    logger.info(f"[/stream] Processed tool approval response from message {i}")

        # 4. Process the latest message
        last_user_message_obj = request.messages[-1]
        last_user_message_text = last_user_message_obj.get_text_content()
        if not last_user_message_text:
            logger.warning("[/stream] Last message has no text content")
            return

        logger.info(f"[/stream] Processing: {last_user_message_text[:50]}...")
        logger.info(
            f"[/stream] Agent model: {sse_agent.model}, "
            f"tools: {[tool.__name__ if callable(tool) else str(tool) for tool in sse_agent.tools]}"
        )

        # Create ADK message content (includes images and other parts)
        message_content = last_user_message_obj.to_adk_content()

        # 5. Run ADK agent with streaming
        event_stream = sse_agent_runner.run_async(
            user_id=user_id,
            session_id=session.id,
            new_message=message_content,
        )

        # 6. Convert ADK events to AI SDK format and yield SSE events
        event_count = 0
        async for sse_event in stream_adk_to_ai_sdk(
            event_stream, tools_requiring_approval=TOOLS_REQUIRING_APPROVAL
        ):
            event_count += 1
            yield sse_event

        logger.info(f"[/stream] Completed with {event_count} SSE events")

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

    # Phase 2: Generate unique connection signature to prevent race conditions
    # Each WebSocket connection gets its own session and delegate
    # Reference: ADK Discussion #2784 - https://github.com/google/adk-python/discussions/2784
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

    # Create connection-specific FrontendToolDelegate
    connection_delegate = FrontendToolDelegate()
    logger.info(f"[BIDI] Created FrontendToolDelegate for connection: {connection_signature}")

    # Store delegate and client_identifier directly in the session state
    # Using temp: prefix for delegate (not persisted, session-lifetime only)
    # According to ADK docs, modifications to session.state before run_live()
    # will be available in tool_context.state during tool execution
    session.state["temp:delegate"] = connection_delegate
    session.state["client_identifier"] = connection_signature
    logger.info(
        f"[BIDI] Stored delegate and client_identifier in session state (session_id={session.id})"
    )
    logger.info(f"[BIDI] Session state after modification: {dict(session.state)}")

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

        # Task 1: Receive messages from WebSocket → send to LiveRequestQueue
        async def receive_from_client():  # noqa: C901, PLR0912
            try:
                while True:
                    data = await websocket.receive_text()
                    # Parse structured event format (P2-T2)
                    event = json.loads(data)
                    event_type = event.get("type")
                    event_version = event.get("version", "1.0")

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

                    # ignore ping events in logs
                    logger.info(f"[BIDI] Received event: {event_type} (v{event_version})")

                    # Handle message event (chat messages)
                    if event_type == "message":
                        message_data = event.get("data", {})

                        # BUG-006 FIX: Also sync history for BIDI mode
                        # When switching from Gemini Direct or ADK SSE to BIDI
                        messages = message_data.get("messages", [])
                        if messages:
                            # Convert to ChatMessage objects for sync function
                            chat_messages = [ChatMessage(**msg) for msg in messages]

                            # Sync conversation history
                            await sync_conversation_history_to_session(
                                session=session,
                                session_service=bidi_agent_runner.session_service,
                                messages=chat_messages,
                                current_mode="BIDI",
                            )

                        # Process AI SDK v6 message format → ADK format
                        # Separates image blobs from text parts (Live API requirement)
                        image_blobs, text_content, approval_processed = (
                            process_chat_message_for_bidi(message_data, connection_delegate)
                        )

                        # Note: We don't send finish-step directly from backend
                        # The model/agent should handle step completion naturally
                        if approval_processed:
                            logger.info(
                                "[BIDI] Tool approval processed, agent will handle continuation"
                            )

                        # Send to ADK LiveRequestQueue
                        # Images/videos: send_realtime(blob)
                        # Text: send_content(content)
                        for blob in image_blobs:
                            live_request_queue.send_realtime(blob)

                        if text_content:
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
                            logger.info("[BIDI] Audio input stopped (CMD key released, auto-send)")
                        # Note: Audio chunks are streamed separately via audio_chunk events
                        # ADK processes the audio in real-time through LiveRequestQueue

                    # Handle audio chunk event (P2-T2 Phase 3)
                    elif event_type == "audio_chunk":
                        chunk_data = event.get("data", {})
                        chunk_base64 = chunk_data.get("chunk")

                        if chunk_base64:
                            import base64

                            # Decode base64 PCM audio data
                            audio_bytes = base64.b64decode(chunk_base64)
                            # Commented out to reduce log noise during recording
                            # logger.debug(
                            #     f"[BIDI] Received PCM chunk: {len(audio_bytes)} bytes "
                            #     f"({sample_rate}Hz, {channels}ch, {bit_depth}bit)"
                            # )

                            # Frontend now sends raw PCM audio via AudioWorklet
                            # Format: 16-bit signed integer, 16kHz, mono
                            # This matches ADK Live API requirements

                            # Create audio blob for ADK
                            # Using audio/pcm mime type (raw PCM from AudioWorklet)
                            audio_blob = types.Blob(mime_type="audio/pcm", data=audio_bytes)
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
                logger.info("[BIDI] Starting to stream ADK events to WebSocket")
                async for sse_event in stream_adk_to_ai_sdk(
                    live_events,
                    tools_requiring_approval=TOOLS_REQUIRING_APPROVAL,
                    mode="adk-bidi",  # Chunk logger: distinguish from adk-sse mode
                ):
                    event_count += 1
                    # Send SSE-formatted event as WebSocket text message
                    # Frontend will parse "data: {...}" format and extract UIMessageChunk

                    # [DEBUG] Log all event types to see what's being sent
                    if sse_event.startswith("data:"):
                        try:
                            import json

                            event_data = json.loads(sse_event[5:].strip())  # Remove "data:" prefix
                            event_type = event_data.get("type", "unknown")
                            logger.info(f"[BIDI-SEND] Sending event type: {event_type}")

                            # Log tool-approval-request specifically with full data
                            if event_type == "tool-approval-request":
                                logger.warning(
                                    f"[BIDI-SEND] ⚠️ ⚠️ ⚠️  SENDING tool-approval-request: {event_data}"
                                )
                        except Exception as e:
                            logger.debug(f"[BIDI-SEND] Could not parse event data: {e}")

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
