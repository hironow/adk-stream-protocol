"""
Transport Layer

This package provides transport-level event handlers for streaming data.

Components:
    - BidiEventReceiver: WebSocket upstream (Frontend → ADK)
    - BidiEventSender: WebSocket downstream (ADK → Frontend)
    - SseEventStreamer: HTTP SSE streaming (ADK → Frontend)
"""

from .bidi_event_receiver import BidiEventReceiver
from .bidi_event_sender import BidiEventSender
from .sse_event_streamer import SseEventStreamer


__all__ = [
    "BidiEventReceiver",
    "BidiEventSender",
    "SseEventStreamer",
]
