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

import base64
from enum import Enum
from io import BytesIO
from typing import Any, Literal

from google.genai import types
from loguru import logger
from PIL import Image
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


class StepPart(BaseModel):
    """
    Step part in message (AI SDK v6 format).

    These are internal chunks that AI SDK v6 adds during step processing:
    - 'start': Beginning of a new message
    - 'step-start': Beginning of a processing step (observed in logs)
    - 'start-step': Beginning of a processing step (documented in AI SDK)
    - 'finish-step': End of a processing step
    """

    type: Literal["start", "step-start", "start-step", "finish-step"]


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
        if not v or len(v.strip()) == 0:
            msg = "Image data cannot be empty"
            raise ValueError(msg)

        # Validate base64 encoding
        # Reason: Standard library exception translation - converting base64 decode errors to ValueError
        try:  # nosemgrep: forbid-try-except
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
    tool_name: str | None = Field(default=None, alias="toolName")
    args: dict[str, Any] | None = None  # AI SDK v6: "input"
    state: ToolCallState
    approval: ToolApproval | None = (
        None  # Present when state="approval-requested" or "approval-responded"
    )
    output: dict[str, Any] | None = None  # Present when state="output-available"

    def model_post_init(self, __context: Any) -> None:
        """Derive tool_name from type if not provided."""
        if self.tool_name is None and self.type.startswith("tool-"):
            # Extract tool name from type (e.g., "tool-change_bgm" -> "change_bgm")
            self.tool_name = self.type[5:]  # Remove "tool-" prefix


# ============================================================
# Generic Part for AI SDK v6 Internal Chunks
# ============================================================


class GenericPart(BaseModel):
    """
    Generic part for AI SDK v6 internal chunks.

    This handles internal chunk types that AI SDK v6 adds during processing:
    - 'step-start' / 'start-step': Beginning of a processing step
    - 'finish-step' / 'step-end': End of a processing step
    - 'start' / 'finish': Stream lifecycle markers

    These chunks are internal to AI SDK v6's useChat hook and appear when:
    - Mode switching between Gemini Direct, ADK SSE, and ADK BIDI
    - Tool calling sequences in Gemini Direct mode
    - Stream processing state changes

    Without this handler, these chunks would cause 422 validation errors
    when sent through our Pydantic models (e.g., during mode switching
    with preserved message history).
    """

    type: str
    # Allow any additional fields without validation
    model_config = {"extra": "allow"}


# ============================================================
# Message Part Union
# ============================================================


# Use Union type with GenericPart as fallback for unknown types
# IMPORTANT: GenericPart must be last in the union to act as a catch-all.
# Pydantic tries each type in order, so specific types must come before generic ones.
# StepPart handles known internal chunks (start, step-start, start-step, finish-step).
# Only truly unknown types fall through to GenericPart, preventing 422 validation errors.
MessagePart = TextPart | ImagePart | FilePart | ToolUsePart | StepPart | GenericPart
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

    Supports three formats:
    - Simple: { role: "user", content: "text" }
    - Parts array: { role: "user", content: [{type: "tool-result", ...}] }
    - Parts field: { role: "user", parts: [...] } (AI SDK v6 format)

    This class combines AI SDK v6 type definition with ADK conversion logic
    (to_adk_content method) to keep type and transformation together.

    Edge case fix (POC Phase 5): content can be list[MessagePart] for function_response.
    Previously typed as str | None, causing Pydantic validation error in BIDI mode.
    """

    role: str
    content: str | list[MessagePart] | None = (
        None  # Simple format or Parts array (function_response)
    )
    parts: list[MessagePart] | None = None  # AI SDK v6 format with discriminated union

    def get_text_content(self) -> str:
        """Extract text content from either format (str, list[Part], or parts field)"""
        if self.content:
            if isinstance(self.content, str):
                return self.content
            # content is list[MessagePart] (function_response format)
            return "".join(p.text or "" for p in self.content if isinstance(p, TextPart))
        if self.parts is not None:
            return "".join(p.text or "" for p in self.parts if isinstance(p, TextPart))
        return ""

    def _process_image_part(self, part: ImagePart) -> types.Part | None:
        """Process ImagePart and return ADK Part."""
        image_bytes = base64.b64decode(part.data)

        # Get image dimensions using PIL
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
        return types.Part(inline_data=types.Blob(mime_type=part.media_type, data=image_bytes))

    def _process_file_part(self, part: FilePart) -> types.Part | None:
        """Process FilePart and return ADK Part."""
        if not part.url.startswith("data:"):
            return None

        # Extract base64 content after "base64,"
        data_url_parts = part.url.split(",", 1)
        if len(data_url_parts) != 2:  # noqa: PLR2004
            return None

        base64_data = data_url_parts[1]
        file_bytes = base64.b64decode(base64_data)

        # Get image dimensions if it's an image
        if part.media_type.startswith("image/"):
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

        return types.Part(inline_data=types.Blob(mime_type=part.media_type, data=file_bytes))

    def _process_tool_use_part(self, part: ToolUsePart, adk_parts: list[types.Part]) -> None:
        """Process a ToolUsePart and add to adk_parts if applicable."""
        # Only process OUTPUT_AVAILABLE state (tool results from frontend)
        if part.state != ToolCallState.OUTPUT_AVAILABLE:
            logger.debug(
                f"[AI SDK v6] Skipping tool-use part: {part.tool_name} (state={part.state})"
            )
            return

        # Validate output
        if part.output is None or not isinstance(part.output, dict):
            logger.warning(f"[AI SDK v6] Invalid output format for {part.tool_name}: {part.output}")
            return

        # Handle adk_request_confirmation tool outputs (special case for confirmation data)
        if part.tool_name == "adk_request_confirmation":
            # Extract confirmed directly from output (no toolConfirmation wrapper)
            confirmed = part.output.get("confirmed", False)

            logger.info(
                f"[ADK Confirmation] Converting AI SDK tool output to ADK FunctionResponse "
                f"(id={part.tool_call_id}, confirmed={confirmed})"
            )

            # Create ADK FunctionResponse for adk_request_confirmation
            function_response = types.FunctionResponse(
                id=part.tool_call_id,
                name="adk_request_confirmation",
                response={"confirmed": confirmed},
            )
            adk_parts.append(types.Part(function_response=function_response))
        else:
            # Handle ALL other tool outputs (get_location, process_payment, etc.)
            logger.info(
                f"[AI SDK v6] Converting tool output to ADK FunctionResponse "
                f"(id={part.tool_call_id}, name={part.tool_name})"
            )

            # Create ADK FunctionResponse for any tool
            function_response = types.FunctionResponse(
                id=part.tool_call_id,
                name=part.tool_name,
                response=part.output,
            )
            adk_parts.append(types.Part(function_response=function_response))

    def _process_part(self, part: object, adk_parts: list[types.Part]) -> None:
        """Process a single part and add to adk_parts if applicable."""
        if isinstance(part, StepPart):
            logger.debug(f"[AI SDK v6] Skipping known internal step chunk: '{part.type}'")
        elif isinstance(part, GenericPart):
            logger.warning(
                f"[AI SDK v6] Ignoring internal chunk type: '{part.type}'. "
                f"This is expected for step-start, start-step, finish-step, etc. "
                f"Full part data: {part.model_dump()}"
            )
        elif isinstance(part, TextPart):
            adk_parts.append(types.Part(text=part.text))
        elif isinstance(part, ImagePart):
            adk_part = self._process_image_part(part)
            if adk_part:
                adk_parts.append(adk_part)
        elif isinstance(part, FilePart):
            adk_part = self._process_file_part(part)
            if adk_part:
                adk_parts.append(adk_part)
        elif isinstance(part, ToolUsePart):
            self._process_tool_use_part(part, adk_parts)

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
        adk_parts = []

        if self.content:
            if isinstance(self.content, str):
                adk_parts.append(types.Part(text=self.content))
            else:
                # content is list[MessagePart] (function_response format)
                for part in self.content:
                    self._process_part(part, adk_parts)

        if self.parts:
            for part in self.parts:
                self._process_part(part, adk_parts)

        return types.Content(role=self.role, parts=adk_parts)


# ============================================================
# WebSocket Message Processing for BIDI Mode
# ============================================================


def process_chat_message_for_bidi(  # noqa: C901, PLR0912 - Complexity needed for AI SDK v6 message processing
    message_data: dict,
) -> tuple[list[types.Blob], types.Content | None]:
    """
    Process AI SDK v6 message data for BIDI streaming.

    This function handles AI SDK v6 message format conversion for WebSocket BIDI mode:
    1. Parse ChatMessage from message data
    2. Separate image/video blobs from text parts
    3. Return separated data ready for ADK LiveRequestQueue

    Tool confirmation responses are handled in ChatMessage.to_adk_content()
    via _process_tool_use_part, which converts adk_request_confirmation outputs
    to ADK FunctionResponse format.

    Responsibility Separation:
    - This function: AI SDK v6 message processing (protocol layer)
    - Caller (server.py): ADK LiveRequestQueue operations (transport layer)

    Args:
        message_data: Message data from WebSocket event (AI SDK v6 format)
                     Example: {"messages": [{"role": "user", "parts": [...]}]}

    Returns:
        (image_blobs, text_content): Tuple of:
            - image_blobs: List of Blob objects to send via send_realtime()
            - text_content: Content object to send via send_content(), or None if no text

    Reference:
    - ADK Live API requirements: https://google.github.io/adk-docs/streaming/dev-guide/part2/
    - AI SDK v6 message format: https://ai-sdk.dev/docs/ai-sdk-ui/overview
    """
    messages = message_data.get("messages", [])
    if not messages:
        return ([], None)

    # STEP 1: Log incoming message data (verify frontend is sending correct data)
    logger.info(f"[STEP 1] Received {len(messages)} messages from frontend")
    logger.info(f"[STEP 1] Last message role: {messages[-1].get('role')}")
    logger.info(f"[STEP 1] Last message parts: {messages[-1].get('parts', [])}")

    # Parse last message from AI SDK v6 format
    last_msg = ChatMessage(**messages[-1])

    # IMPORTANT: Tool outputs (including adk_request_confirmation) must have role="user"
    # AI SDK may send them as role="assistant", but ADK requires role="user" for FunctionResponse
    # Check if message contains tool outputs and override role if needed
    has_tool_output = False
    if last_msg.parts:
        for part in last_msg.parts:
            if isinstance(part, ToolUsePart) and part.state == "output-available":
                has_tool_output = True
                break

    if has_tool_output and last_msg.role != "user":
        logger.info(
            f"[BIDI] Overriding message role from '{last_msg.role}' to 'user' for tool output"
        )
        last_msg.role = "user"

    # Convert message to ADK Content using ChatMessage.to_adk_content()
    # This handles all part types including ToolUsePart (confirmation responses)
    adk_content = last_msg.to_adk_content()

    # Separate image/video blobs from other parts
    # IMPORTANT: Live API requires separation
    # - Images/videos: Send via send_realtime(blob)
    # - Text/tool responses: Send via send_content(content)
    image_blobs: list[types.Blob] = []
    non_image_parts: list[types.Part] = []

    # Extract image blobs from original parts (before ADK conversion)
    if last_msg.parts:
        logger.info(f"[STEP 2] Processing {len(last_msg.parts)} parts from last_msg")
        for part in last_msg.parts:
            logger.info(f"[STEP 2] Part type: {type(part).__name__}")
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

    # Extract non-image parts from ADK content (includes text, tool responses, etc.)
    if adk_content.parts:
        logger.info(f"[STEP 2] ADK content has {len(adk_content.parts)} parts")
        for adk_part in adk_content.parts:
            # Skip inline_data parts (images) - they're already in image_blobs
            if not hasattr(adk_part, "inline_data") or adk_part.inline_data is None:
                non_image_parts.append(adk_part)
                # Log what we're including
                if hasattr(adk_part, "function_response") and adk_part.function_response:
                    logger.info(
                        f"[STEP 2] Including FunctionResponse: {adk_part.function_response.name}"
                    )

    # Create text content if any non-image parts exist
    text_content = None
    if non_image_parts:
        # Check if FunctionResponse is included (tool confirmation response)
        function_response_parts = [
            part
            for part in non_image_parts
            if hasattr(part, "function_response") and part.function_response
        ]

        if function_response_parts:
            # ADK requires FunctionResponse to be sent ALONE with role="user"
            # Do not mix FunctionResponse with other text parts
            text_content = types.Content(role="user", parts=function_response_parts)
        else:
            # No FunctionResponse - send all parts with original role
            text_content = types.Content(role=adk_content.role, parts=non_image_parts)

    # STEP 3: Log ADK format before sending (verify correct structure for ADK)
    logger.info(
        f"[STEP 3] ADK format: image_blobs={len(image_blobs)}, non_image_parts={len(non_image_parts)}"
    )
    if text_content:
        logger.info(f"[STEP 3] Text content role: {text_content.role}, parts: {text_content.parts}")

    return (image_blobs, text_content)
