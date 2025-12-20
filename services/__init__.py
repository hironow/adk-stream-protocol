"""
Services Layer

This package provides the service layer for the ADK-AI-Data-Protocol backend.
It sits between the Transport Layer (server.py) and Protocol Conversion Layer.

Components:
    - FrontendToolService: Manages frontend tool execution
"""

from services.bidi_event_receiver import BidiEventReceiver
from services.bidi_event_sender import BidiEventSender
from services.frontend_tool_service import FrontendToolDelegate
from services.sse_event_streamer import SseEventStreamer


__all__ = ["BidiEventReceiver", "BidiEventSender", "FrontendToolDelegate", "SseEventStreamer"]
