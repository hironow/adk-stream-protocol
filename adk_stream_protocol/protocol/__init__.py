"""
Protocol Layer - ADK to AI SDK v6 Data Stream Protocol conversion.

This subpackage handles format conversion between:
- ADK events (Google ADK format)
- AI SDK v6 Data Stream Protocol (Vercel format)

Components:
- StreamProtocolConverter: Converts ADK events to SSE format
- ADKVercelIDMapper: Bidirectional ID mapping
- ChatMessage, TextPart, etc.: AI SDK v6 type definitions
"""

from .id_mapper import ADKVercelIDMapper
from .message_types import (
    ChatMessage,
    FilePart,
    GenericPart,
    ImagePart,
    MessagePart,
    StepPart,
    TextPart,
    ToolApproval,
    ToolCallState,
    ToolResultPart,
    ToolUsePart,
    process_chat_message_for_bidi,
)
from .stream_protocol import (
    StreamProtocolConverter,
    format_sse_event,
    stream_adk_to_ai_sdk,
)


__all__ = [
    # ID Mapper
    "ADKVercelIDMapper",
    # AI SDK v6 Types
    "ChatMessage",
    "FilePart",
    "GenericPart",
    "ImagePart",
    "MessagePart",
    "StepPart",
    # Stream Protocol
    "StreamProtocolConverter",
    "TextPart",
    "ToolApproval",
    "ToolCallState",
    "ToolResultPart",
    "ToolUsePart",
    "format_sse_event",
    # Processing
    "process_chat_message_for_bidi",
    "stream_adk_to_ai_sdk",
]
