"""
Services Layer

This package provides the service layer for the ADK-AI-Data-Protocol backend.
It sits between the Transport Layer (server.py) and Protocol Conversion Layer.

Components:
    - FrontendToolService: Manages frontend tool execution
"""

from .adk_ag_runner import (
    BIDI_CONFIRMATION_TOOLS,
    SSE_CONFIRMATION_TOOLS,
    bidi_agent,
    bidi_agent_runner,
    get_tools_requiring_confirmation,
    sse_agent,
    sse_agent_runner,
)
from .adk_ag_tools import (
    _adk_request_confirmation,
    change_bgm,
    get_location,
    get_weather,
    process_payment,
)
from .adk_compat import (
    clear_sessions,
    get_or_create_session,
    sync_conversation_history_to_session,
)
from .adk_vercel_id_mapper import ADKVercelIDMapper
from .ai_sdk_v6_compat import (
    ChatMessage,
    GenericPart,
    StepPart,
    TextPart,
    ToolCallState,
    ToolUsePart,
    process_chat_message_for_bidi,
)
from .bidi_event_receiver import BidiEventReceiver
from .bidi_event_sender import BidiEventSender
from .chunk_logger import ChunkLogger, Mode, chunk_logger
from .chunk_player import ChunkPlayer, ChunkPlayerManager
from .confirmation_interceptor import ToolConfirmationInterceptor
from .frontend_tool_service import FrontendToolDelegate
from .sse_event_streamer import SseEventStreamer
from .tool_confirmation_service import ToolConfirmationDelegate
from .stream_protocol import (
    StreamProtocolConverter,
    _map_adk_finish_reason_to_ai_sdk,
    stream_adk_to_ai_sdk,
)


__all__ = [
    "BIDI_CONFIRMATION_TOOLS",
    "SSE_CONFIRMATION_TOOLS",
    "ADKVercelIDMapper",
    "BidiEventReceiver",
    "BidiEventSender",
    "ChatMessage",
    "ChunkLogger",
    "ChunkPlayer",
    "ChunkPlayerManager",
    "FrontendToolDelegate",
    "GenericPart",
    "Mode",
    "SseEventStreamer",
    "StepPart",
    "StreamProtocolConverter",
    "TextPart",
    "ToolCallState",
    "ToolConfirmationDelegate",
    "ToolConfirmationInterceptor",
    "ToolUsePart",
    "_adk_request_confirmation",
    "_map_adk_finish_reason_to_ai_sdk",
    "bidi_agent",
    "bidi_agent_runner",
    "change_bgm",
    "chunk_logger",
    "clear_sessions",
    "get_location",
    "get_or_create_session",
    "get_tools_requiring_confirmation",
    "get_weather",
    "process_chat_message_for_bidi",
    "process_payment",
    "sse_agent",
    "sse_agent_runner",
    "stream_adk_to_ai_sdk",
    "sync_conversation_history_to_session",
]
