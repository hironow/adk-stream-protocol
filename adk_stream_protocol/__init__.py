"""
Services Layer

This package provides the service layer for the ADK-AI-Data-Protocol backend.
It sits between the Transport Layer (server.py) and Protocol Conversion Layer.

Components:
    - FrontendToolService: Manages frontend tool execution
"""

# Re-export from ags/ subpackage
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
    TextPart,
    ToolUsePart,
)
from .bidi_event_receiver import BidiEventReceiver
from .bidi_event_sender import BidiEventSender
from .chunk_logger import ChunkLogger
from .frontend_tool_service import FrontendToolDelegate
from .sse_event_streamer import SseEventStreamer
from .stream_protocol import (
    StreamProtocolConverter,
    stream_adk_to_ai_sdk,
)


__all__ = [
    # Public API - Constants
    "BIDI_CONFIRMATION_TOOLS",
    "SSE_CONFIRMATION_TOOLS",
    # Public API - Event Handlers
    "BidiEventReceiver",
    "BidiEventSender",
    # Public API - Data Types
    "ChatMessage",
    # Public API - Logging (class only, not instance)
    "ChunkLogger",
    "Error",
    # Public API - Services
    "FrontendToolDelegate",
    # Public API - Result Types
    "Ok",
    "Result",
    "SseEventStreamer",
    # Public API - Protocol Conversion
    "StreamProtocolConverter",
    "TextPart",
    "ToolUsePart",
    # Public API - Agents and Runners
    "bidi_agent",
    "bidi_agent_runner",
    # Public API - Tools
    "change_bgm",
    # Public API - Registry
    "get_delegate",
    "get_location",
    "get_weather",
    "process_payment",
    "register_delegate",
    "sse_agent",
    "sse_agent_runner",
    "stream_adk_to_ai_sdk",
]
