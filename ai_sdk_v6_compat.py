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

from enum import Enum
from typing import Any, Literal, Union

from google.genai import types
from loguru import logger
from pydantic import BaseModel, Field, field_validator


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

    type: Literal["file"] = "file"
    filename: str
    url: str  # data URL with base64 content (e.g., "data:image/png;base64,...")
    mediaType: str  # MIME type (e.g., "image/png")


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

    type: str  # e.g., "tool-web_search", "tool-change_bgm", or "tool-use"
    toolCallId: str
    toolName: str
    args: dict[str, Any] | None = None  # AI SDK v6: "input"
    state: ToolCallState
    approval: ToolApproval | None = None  # Present when state="approval-requested" or "approval-responded"
    output: dict[str, Any] | None = None  # Present when state="output-available"


# ============================================================
# Message Part Union
# ============================================================


MessagePart = Union[TextPart, ImagePart, FilePart, ToolUsePart]
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
            return "".join(
                p.text or "" for p in self.parts if isinstance(p, TextPart)
            )
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
                            inline_data=types.Blob(
                                mime_type=part.media_type, data=image_bytes
                            )
                        )
                    )
                elif isinstance(part, FilePart):
                    # AI SDK v6 file format: extract base64 from data URL
                    # Format: "data:image/png;base64,iVBORw0..."
                    if part.url.startswith("data:"):
                        # Extract base64 content after "base64,"
                        data_url_parts = part.url.split(",", 1)
                        if len(data_url_parts) == 2:
                            base64_data = data_url_parts[1]
                            file_bytes = base64.b64decode(base64_data)

                            # Get image dimensions if it's an image
                            if part.mediaType.startswith("image/"):
                                from io import BytesIO
                                from PIL import Image

                                with Image.open(BytesIO(file_bytes)) as img:
                                    width, height = img.size
                                    image_format = img.format

                                logger.info(
                                    f"[FILE INPUT] filename={part.filename}, "
                                    f"mediaType={part.mediaType}, "
                                    f"size={len(file_bytes)} bytes, "
                                    f"dimensions={width}x{height}, "
                                    f"format={image_format}"
                                )
                            else:
                                logger.info(
                                    f"[FILE INPUT] filename={part.filename}, "
                                    f"mediaType={part.mediaType}, "
                                    f"size={len(file_bytes)} bytes"
                                )

                            adk_parts.append(
                                types.Part(
                                    inline_data=types.Blob(
                                        mime_type=part.mediaType, data=file_bytes
                                    )
                                )
                            )

        return types.Content(role=self.role, parts=adk_parts)
