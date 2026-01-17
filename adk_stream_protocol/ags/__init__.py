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
    BIDI_CONFIRMATION_TOOLS,
    SSE_CONFIRMATION_TOOLS,
    bidi_agent,
    bidi_agent_runner,
    bidi_app,
    sse_agent,
    sse_agent_runner,
    sse_app,
)
from .tools import (
    change_bgm,
    execute_get_location,
    execute_process_payment,
    get_location,
    get_weather,
    process_payment,
)


# root_agent for adk web (same as sse_agent)
root_agent = sse_agent

__all__ = [
    # Public API - Constants
    "BIDI_CONFIRMATION_TOOLS",
    "SSE_CONFIRMATION_TOOLS",
    "Error",
    # Public API - Result Types
    "Ok",
    "Result",
    "bidi_agent",
    "bidi_agent_runner",
    "bidi_app",
    # Public API - Tools
    "change_bgm",
    "execute_get_location",
    "execute_process_payment",
    # Public API - Registry
    "get_delegate",
    "get_location",
    "get_weather",
    "process_payment",
    "register_delegate",
    # Public API - adk web entry point
    "root_agent",
    # Public API - Agents
    "sse_agent",
    # Public API - Runners
    "sse_agent_runner",
    # Public API - Apps
    "sse_app",
]
