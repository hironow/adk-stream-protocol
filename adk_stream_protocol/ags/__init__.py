"""
ADK Agent(ag) Package

This package provides ADK agents, runners, and tools.

Usage (as package):
  from adk_stream_protocol.ags import sse_agent, bidi_agent

For adk web debugging:
  adk web adk_stream_protocol/ags
"""

# Internal utilities (Result types, Frontend tool registry)
from ._internal import Error, Ok, Result, get_delegate, register_delegate
from .runner import (
    AGENT_DESCRIPTION,
    AGENT_INSTRUCTION,
    BIDI_CONFIRMATION_TOOLS,
    BIDI_TOOLS,
    SSE_CONFIRMATION_TOOLS,
    SSE_SESSION_DB_PATH,
    SSE_TOOLS,
    bidi_agent,
    bidi_agent_runner,
    bidi_app,
    sse_agent,
    sse_agent_runner,
    sse_app,
    sse_session_service,
)
from .tools import (
    change_bgm,
    get_location,
    get_weather,
    process_payment,
)


# root_agent for adk web (same as sse_agent)
root_agent = sse_agent

__all__ = [
    # Constants
    "AGENT_DESCRIPTION",
    "AGENT_INSTRUCTION",
    "BIDI_CONFIRMATION_TOOLS",
    "BIDI_TOOLS",
    "SSE_CONFIRMATION_TOOLS",
    "SSE_SESSION_DB_PATH",
    # Tools
    "SSE_TOOLS",
    "Error",
    # Result types
    "Ok",
    "Result",
    "bidi_agent",
    "bidi_agent_runner",
    "bidi_app",
    "change_bgm",
    # Frontend tool registry
    "get_delegate",
    "get_location",
    # Tool functions (public)
    "get_weather",
    "process_payment",
    "register_delegate",
    # adk web entry point
    "root_agent",
    # Agents
    "sse_agent",
    # Runners
    "sse_agent_runner",
    # Apps
    "sse_app",
    # Session
    "sse_session_service",
]
