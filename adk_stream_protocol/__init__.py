"""
ADK Stream Protocol - Backend service layer for ADK-AI-Data-Protocol.

This package provides protocol conversion between Google ADK and Vercel AI SDK,
enabling seamless communication between backend agents and frontend applications.

Subpackages:
    - transport/: Data transfer layer (WebSocket/HTTP event handling)
    - protocol/: Protocol conversion layer (ADK <-> AI SDK format)
    - tools/: Tool coordination layer (approval, confirmation, execution)
    - adk/: ADK integration layer (session management)
    - ags/: ADK Agents (agent definitions and runners)
    - testing/: Test utilities (ChunkLogger, ChunkPlayer)

Public API:
    Transport: BidiEventReceiver, BidiEventSender, SseEventStreamer
    Protocol: StreamProtocolConverter, ChatMessage, TextPart, ToolUsePart
    Tools: FrontendToolDelegate
    Agents: bidi_agent, sse_agent, bidi_agent_runner, sse_agent_runner
    Testing: ChunkLogger
"""

# === Transport Layer ===
from .transport import BidiEventReceiver, BidiEventSender, SseEventStreamer

# === Protocol Layer ===
from .protocol import (
    ChatMessage,
    StreamProtocolConverter,
    TextPart,
    ToolUsePart,
    stream_adk_to_ai_sdk,
)

# === Tools Layer ===
from .tools import FrontendToolDelegate

# === Agents Layer (from ags/) ===
from .ags import (
    # Agent instances
    bidi_agent,
    sse_agent,
    # Agent runners
    bidi_agent_runner,
    sse_agent_runner,
    # Tool functions
    change_bgm,
    get_location,
    get_weather,
    process_payment,
    # Delegate registry
    get_delegate,
    register_delegate,
    # Result types
    Error,
    Ok,
    Result,
    # Constants
    BIDI_CONFIRMATION_TOOLS,
    SSE_CONFIRMATION_TOOLS,
)

# === Testing Utilities ===
from .testing import ChunkLogger


__all__ = [
    # --- Transport Layer ---
    "BidiEventReceiver",
    "BidiEventSender",
    "SseEventStreamer",
    # --- Protocol Layer ---
    "ChatMessage",
    "StreamProtocolConverter",
    "TextPart",
    "ToolUsePart",
    "stream_adk_to_ai_sdk",
    # --- Tools Layer ---
    "FrontendToolDelegate",
    # --- Agents Layer ---
    # Agent instances
    "bidi_agent",
    "sse_agent",
    # Agent runners
    "bidi_agent_runner",
    "sse_agent_runner",
    # Tool functions
    "change_bgm",
    "get_location",
    "get_weather",
    "process_payment",
    # Delegate registry
    "get_delegate",
    "register_delegate",
    # Result types
    "Error",
    "Ok",
    "Result",
    # Constants
    "BIDI_CONFIRMATION_TOOLS",
    "SSE_CONFIRMATION_TOOLS",
    # --- Testing Utilities ---
    "ChunkLogger",
]
