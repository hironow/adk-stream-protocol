"""
Services Layer

This package provides the service layer for the ADK-AI-Data-Protocol backend.
It sits between the Transport Layer (server.py) and Protocol Conversion Layer.

Components:
    - FrontendToolService: Manages frontend tool execution
"""

# Re-export from ags/ subpackage
from .adk_compat import (
    clear_sessions,
    get_or_create_session,
    sync_conversation_history_to_session,
)
from .adk_vercel_id_mapper import ADKVercelIDMapper
from .ags import (
    BIDI_CONFIRMATION_TOOLS,
    SSE_CONFIRMATION_TOOLS,
    Error,
    Ok,
    Result,
    bidi_agent,
    bidi_agent_runner,
    change_bgm,
    get_delegate,
    get_location,
    get_weather,
    process_payment,
    register_delegate,
    sse_agent,
    sse_agent_runner,
)
from .ai_sdk_v6_compat import (
    ChatMessage,
    GenericPart,
    StepPart,
    TextPart,
    ToolCallState,
    ToolUsePart,
    process_chat_message_for_bidi,
)
from .approval_queue import ApprovalQueue
from .bidi_event_receiver import BidiEventReceiver
from .bidi_event_sender import BidiEventSender
from .chunk_logger import ChunkLogger, Mode, chunk_logger
from .chunk_player import ChunkPlayer, ChunkPlayerManager
from .frontend_tool_service import FrontendToolDelegate
from .sse_event_streamer import SseEventStreamer
from .stream_protocol import (
    StreamProtocolConverter,
    stream_adk_to_ai_sdk,
)
from .tool_confirmation_service import ToolConfirmationDelegate


__all__ = [
    "BIDI_CONFIRMATION_TOOLS",
    "SSE_CONFIRMATION_TOOLS",
    "ADKVercelIDMapper",
    "ApprovalQueue",
    "BidiEventReceiver",
    "BidiEventSender",
    "ChatMessage",
    "ChunkLogger",
    "ChunkPlayer",
    "ChunkPlayerManager",
    "Error",
    "FrontendToolDelegate",
    "GenericPart",
    "Mode",
    # Result types
    "Ok",
    "Result",
    "SseEventStreamer",
    "StepPart",
    "StreamProtocolConverter",
    "TextPart",
    "ToolCallState",
    "ToolConfirmationDelegate",
    "ToolUsePart",
    "bidi_agent",
    "bidi_agent_runner",
    "change_bgm",
    "chunk_logger",
    "clear_sessions",
    "get_delegate",
    "get_location",
    "get_or_create_session",
    "get_weather",
    "process_chat_message_for_bidi",
    "process_payment",
    "register_delegate",
    "sse_agent",
    "sse_agent_runner",
    "stream_adk_to_ai_sdk",
    "sync_conversation_history_to_session",
]
