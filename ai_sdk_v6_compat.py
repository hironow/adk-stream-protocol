"""
AI SDK v6 Compatibility Layer - Type Definitions and ADK Conversion.

This module provides Python types that correspond to AI SDK v6 (by Vercel)
and conversion logic to Google ADK format. By keeping types and their
conversion logic together, we maintain consistency and reduce breakage.

Purpose:
- Define AI SDK v6 message part types (TextPart, FilePart, ToolUsePart, etc.)
- Provide ChatMessage type (AI SDK v6 UIMessage equivalent)
- Convert AI SDK v6 types to Google ADK types (to_adk_content())

Reference:
- AI SDK v6 Source: https://github.com/vercel/ai
- Type definitions: packages/ui-utils/src/types.ts (UIMessagePart, UIToolInvocation)
- Documentation: https://ai-sdk.dev/docs/ai-sdk-ui/overview

Type Hierarchy (AI SDK v6):
- UIMessagePart (discriminated union)
  - TextPart (type: "text")
  - FilePart (type: "file")
  - ToolUIPart (type: "tool-{toolName}")
  - DynamicToolUIPart (type: "tool-use")
  - ...other part types

Tool Call States (UIToolInvocation):
- "input-streaming": Tool input is being streamed
- "input-available": Tool input is complete
- "approval-requested": Tool requires user approval
- "approval-responded": User approved/denied the tool
- "output-available": Tool execution completed with output
- "output-error": Tool execution failed
- "output-denied": User denied tool execution
"""

from __future__ import annotations

import base64
from enum import Enum
from typing import TYPE_CHECKING, Any, Literal

from google.genai import types
from loguru import logger
from pydantic import BaseModel, Field, field_validator

if TYPE_CHECKING:
    from tool_delegate import FrontendToolDelegate


# ============================================================
# Tool Call States
# ============================================================


class ToolCallState(str, Enum):
    """
    Tool call state values (AI SDK v6 UIToolInvocation states).

    These states represent the lifecycle of a tool invocation from
    initial call through completion or error.

    Reference:
    - AI SDK v6 Source: packages/ui-utils/src/types.ts (UIToolInvocation)
    - Documentation: https://ai-sdk.dev/docs/ai-sdk-ui/tool-approval
    """

    CALL = "call"  # Tool called, waiting for output (legacy state)
    INPUT_STREAMING = "input-streaming"  # Tool input is being streamed
    INPUT_AVAILABLE = "input-available"  # Tool input is complete
    APPROVAL_REQUESTED = "approval-requested"  # Tool requires user approval
    APPROVAL_RESPONDED = "approval-responded"  # User approved/denied the tool
    OUTPUT_AVAILABLE = "output-available"  # Tool execution completed with output
    OUTPUT_ERROR = "output-error"  # Tool execution failed
    OUTPUT_DENIED = "output-denied"  # User denied tool execution


# ============================================================
# Text and File Parts
# ============================================================


class TextPart(BaseModel):
    """
    Text part in message (AI SDK v6 format).

    Corresponds to: UIMessagePart with type="text"
    """

    type: Literal["text"] = "text"
    text: str


class ImagePart(BaseModel):
    """
    Image part in message (internal format, converted to FilePart).

    Note: This is an internal representation used during message processing.
    Frontend sends images as FilePart with mediaType="image/*".
    """

    type: Literal["image"] = "image"
    data: str  # base64 encoded image
    media_type: str = Field(default="image/png")  # image/png, image/jpeg, image/webp

    @field_validator("media_type")
    @classmethod
    def validate_media_type(cls, v: str) -> str:
        """Validate that media_type is one of the supported image formats."""
        allowed_types = {"image/png", "image/jpeg", "image/webp"}
        if v not in allowed_types:
            msg = f"Unsupported media_type: {v}. Allowed types: {', '.join(allowed_types)}"
            raise ValueError(msg)
        return v

    @field_validator("data")
    @classmethod
    def validate_data(cls, v: str) -> str:
        """Validate that data is not empty and is valid base64."""
        import base64

        if not v or len(v.strip()) == 0:
            msg = "Image data cannot be empty"
            raise ValueError(msg)

        # Validate base64 encoding
        try:
            base64.b64decode(v, validate=True)
        except Exception as e:
            msg = f"Invalid base64 encoding: {e}"
            raise ValueError(msg) from e

        return v


class FilePart(BaseModel):
    """
    File part in message (AI SDK v6 format).

    Corresponds to: UIMessagePart with type="file"

    Reference:
    - AI SDK v6 Source: packages/ui-utils/src/types.ts (FileUIPart)
    """

    model_config = {"populate_by_name": True}

    type: Literal["file"] = "file"
    filename: str
    url: str  # data URL with base64 content (e.g., "data:image/png;base64,...")
    media_type: str = Field(alias="mediaType")  # MIME type (e.g., "image/png")


# ============================================================
# Tool Call Parts (UIToolInvocation)
# ============================================================


class ToolApproval(BaseModel):
    """
    Tool approval metadata (AI SDK v6 format).

    Used in tool-use parts with state="approval-requested" or "approval-responded".

    Reference:
    - AI SDK v6 Source: packages/ui-utils/src/types.ts (UIToolInvocation)
    - Documentation: https://ai-sdk.dev/docs/ai-sdk-ui/tool-approval
    """

    id: str
    approved: bool | None = None  # None for "approval-requested", bool for "approval-responded"
    reason: str | None = None


class ToolUsePart(BaseModel):
    """
    Tool use part in message (AI SDK v6 format).

    Corresponds to: ToolUIPart or DynamicToolUIPart extending UIToolInvocation

    Represents a tool call in various states:
    - "call": Tool called, waiting for output (AI SDK v6: "input-available")
    - "approval-requested": Tool requires user approval
    - "approval-responded": User approved/denied the tool
    - "output-available": Tool execution completed with output

    Reference:
    - AI SDK v6 Source: packages/ui-utils/src/types.ts
      - ToolUIPart: Statically defined tools
      - DynamicToolUIPart: Dynamically defined tools
      - UIToolInvocation: Base type with state-based discriminated union
    - Frontend test: lib/use-chat-integration.test.tsx:463-592

    Type property:
    - ToolUIPart: "tool-{toolName}" (e.g., "tool-web_search", "tool-change_bgm")
    - DynamicToolUIPart: "tool-use"
    """

    model_config = {"populate_by_name": True}

    type: str  # e.g., "tool-web_search", "tool-change_bgm", or "tool-use"
    tool_call_id: str = Field(alias="toolCallId")
    tool_name: str = Field(alias="toolName")
    args: dict[str, Any] | None = None  # AI SDK v6: "input"
    state: ToolCallState
    approval: ToolApproval | None = (
        None  # Present when state="approval-requested" or "approval-responded"
    )
    output: dict[str, Any] | None = None  # Present when state="output-available"


# ============================================================
# Message Part Union
# ============================================================


MessagePart = TextPart | ImagePart | FilePart | ToolUsePart
"""
Union type for all message parts (AI SDK v6 format).

Corresponds to: UIMessagePart (discriminated union)

This is the Python equivalent of AI SDK v6's UIMessagePart type.
It includes all possible message part types that can be sent
between frontend and backend.
"""


# ============================================================
# Chat Message (AI SDK v6 UIMessage + ADK Conversion)
# ============================================================


class ChatMessage(BaseModel):
    """
    Chat message model (AI SDK v6 UIMessage format) with ADK conversion.

    Corresponds to: UIMessage in AI SDK v6
    Reference: https://github.com/vercel/ai/blob/main/packages/ui-utils/src/types.ts

    Supports two formats:
    - Simple: { role: "user", content: "text" }
    - Parts: { role: "user", parts: [...] } (AI SDK v6 format)

    This class combines AI SDK v6 type definition with ADK conversion logic
    (to_adk_content method) to keep type and transformation together.
    """

    role: str
    content: str | None = None  # Simple format
    parts: list[MessagePart] | None = None  # AI SDK v6 format with discriminated union

    def get_text_content(self) -> str:
        """Extract text content from either format"""
        if self.content:
            return self.content
        if self.parts is not None:
            return "".join(p.text or "" for p in self.parts if isinstance(p, TextPart))
        return ""

    def to_adk_content(self) -> types.Content:
        """
        Convert AI SDK v6 message to ADK Content format.

        AI SDK v6 format:
        - Simple: { role: "user", content: "text" }
        - Parts: { role: "user", parts: [
            { type: "text", text: "..." },
            { type: "image", data: "base64...", media_type: "image/png" }
          ]}

        ADK format:
        - types.Content(role="user", parts=[types.Part(text="...")])
        - types.Content(role="user", parts=[
            types.Part(text="..."),
            types.Part(inline_data=InlineData(mime_type="image/png", data=bytes))
          ])
        """
        import base64

        adk_parts = []

        # Handle simple text content
        if self.content:
            adk_parts.append(types.Part(text=self.content))

        # Handle parts array (AI SDK v6 multimodal format)
        if self.parts:
            for part in self.parts:
                if isinstance(part, TextPart):
                    adk_parts.append(types.Part(text=part.text))
                elif isinstance(part, ImagePart):
                    # Decode base64 and create inline_data with Blob
                    image_bytes = base64.b64decode(part.data)

                    # Get image dimensions using PIL
                    from io import BytesIO

                    from PIL import Image

                    with Image.open(BytesIO(image_bytes)) as img:
                        width, height = img.size
                        image_format = img.format

                    logger.info(
                        f"[IMAGE INPUT] media_type={part.media_type}, "
                        f"size={len(image_bytes)} bytes, "
                        f"dimensions={width}x{height}, "
                        f"format={image_format}, "
                        f"base64_length={len(part.data)} chars"
                    )
                    adk_parts.append(
                        types.Part(
                            inline_data=types.Blob(mime_type=part.media_type, data=image_bytes)
                        )
                    )
                elif isinstance(part, FilePart):
                    # AI SDK v6 file format: extract base64 from data URL
                    # Format: "data:image/png;base64,iVBORw0..."
                    if part.url.startswith("data:"):
                        # Extract base64 content after "base64,"
                        data_url_parts = part.url.split(",", 1)
                        if len(data_url_parts) == 2:  # noqa: PLR2004 - data URL format: "data:type;base64,content"
                            base64_data = data_url_parts[1]
                            file_bytes = base64.b64decode(base64_data)

                            # Get image dimensions if it's an image
                            if part.media_type.startswith("image/"):
                                from io import BytesIO

                                from PIL import Image

                                with Image.open(BytesIO(file_bytes)) as img:
                                    width, height = img.size
                                    image_format = img.format

                                logger.info(
                                    f"[FILE INPUT] filename={part.filename}, "
                                    f"mediaType={part.media_type}, "
                                    f"size={len(file_bytes)} bytes, "
                                    f"dimensions={width}x{height}, "
                                    f"format={image_format}"
                                )
                            else:
                                logger.info(
                                    f"[FILE INPUT] filename={part.filename}, "
                                    f"mediaType={part.media_type}, "
                                    f"size={len(file_bytes)} bytes"
                                )

                            adk_parts.append(
                                types.Part(
                                    inline_data=types.Blob(
                                        mime_type=part.media_type, data=file_bytes
                                    )
                                )
                            )

        return types.Content(role=self.role, parts=adk_parts)


# ============================================================
# WebSocket Message Processing for BIDI Mode
# ============================================================


def process_tool_use_parts(message: ChatMessage, delegate: FrontendToolDelegate) -> None:
    """
    Process tool-use parts from frontend messages and route to delegate.

    This function extracts tool-use parts from AI SDK v6 messages and calls
    appropriate FrontendToolDelegate methods based on the tool state:
    - "approval-responded" with approved=False → reject_tool_call()
    - "output-available" → resolve_tool_result()

    Args:
        message: ChatMessage containing tool-use parts
        delegate: FrontendToolDelegate instance to route tool results to

    Reference:
    - Frontend behavior: lib/use-chat-integration.test.tsx:463-592
    - Gap analysis: experiments/2025-12-13_frontend_backend_integration_gap_analysis.md
    """
    if not message.parts:
        return

    for part in message.parts:
        if isinstance(part, ToolUsePart):
            tool_call_id = part.tool_call_id

            # Handle approval-responded state (user approved/denied)
            if part.state == ToolCallState.APPROVAL_RESPONDED:
                if part.approval and part.approval.approved is False:
                    # User rejected the tool
                    reason = part.approval.reason or "User denied permission"
                    delegate.reject_tool_call(tool_call_id, reason)
                    logger.info(f"[Tool] Rejected tool {tool_call_id}: {reason}")
                # Note: approved=True doesn't trigger delegate action here
                # Tool execution happens on backend, then output is sent via output-available

            # Handle output-available state (tool execution completed)
            elif part.state == ToolCallState.OUTPUT_AVAILABLE:
                if part.output is not None:
                    delegate.resolve_tool_result(tool_call_id, part.output)
                    logger.info(f"[Tool] Resolved tool {tool_call_id} with output")


def process_chat_message_for_bidi(
    message_data: dict,
    delegate: FrontendToolDelegate,
) -> tuple[list[types.Blob], types.Content | None]:
    """
    Process AI SDK v6 message data for BIDI streaming.

    This function handles AI SDK v6 message format conversion for WebSocket BIDI mode:
    1. Parse ChatMessage from message data
    2. Process tool-use parts (approval/rejection responses)
    3. Separate image/video blobs from text parts
    4. Return separated data ready for ADK LiveRequestQueue

    Responsibility Separation:
    - This function: AI SDK v6 message processing (protocol layer)
    - Caller (server.py): ADK LiveRequestQueue operations (transport layer)

    Args:
        message_data: Message data from WebSocket event (AI SDK v6 format)
                     Example: {"messages": [{"role": "user", "parts": [...]}]}
        delegate: FrontendToolDelegate instance for tool approval handling

    Returns:
        (image_blobs, text_content): Tuple of separated message parts
            - image_blobs: List of Blob objects to send via send_realtime()
            - text_content: Content object to send via send_content(), or None if no text

    Reference:
    - ADK Live API requirements: https://google.github.io/adk-docs/streaming/dev-guide/part2/
    - AI SDK v6 message format: https://ai-sdk.dev/docs/ai-sdk-ui/overview
    """
    messages = message_data.get("messages", [])
    if not messages:
        return ([], None)

    # Parse last message from AI SDK v6 format
    last_msg = ChatMessage(**messages[-1])

    # Process tool-use parts (approval/rejection responses from frontend)
    process_tool_use_parts(last_msg, delegate)

    # Separate image/video blobs from text parts
    # IMPORTANT: Live API requires separation
    # - Images/videos: Send via send_realtime(blob)
    # - Text: Send via send_content(content)
    image_blobs: list[types.Blob] = []
    text_parts: list[types.Part] = []

    if last_msg.parts:
        for part in last_msg.parts:
            # Handle file parts (images/videos)
            if isinstance(part, FilePart):
                # Decode data URL format: "data:image/png;base64,..."
                if part.url.startswith("data:"):
                    data_url_parts = part.url.split(",", 1)
                    if len(data_url_parts) == 2:  # noqa: PLR2004 - data URL format: "data:type;base64,content"
                        file_data_base64 = data_url_parts[1]
                        file_bytes = base64.b64decode(file_data_base64)

                        # Create Blob for ADK
                        blob = types.Blob(mime_type=part.media_type, data=file_bytes)
                        image_blobs.append(blob)

            # Handle text parts
            elif isinstance(part, TextPart):
                text_parts.append(types.Part(text=part.text))

    # Create text content if any text exists
    text_content = None
    if text_parts:
        text_content = types.Content(role="user", parts=text_parts)

    return (image_blobs, text_content)
