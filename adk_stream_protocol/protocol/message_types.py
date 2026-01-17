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
from pydantic import BaseModel, Field, field_validator, model_validator


# ============================================================
# Image Processing Helpers
# ============================================================


def _extract_image_metadata(image_bytes: bytes) -> tuple[int, int, str | None]:
    """Extract image dimensions and format from raw bytes.

    Args:
        image_bytes: Raw image data

    Returns:
        (width, height, format) tuple where format may be None
    """
    with Image.open(BytesIO(image_bytes)) as img:
        return img.size[0], img.size[1], img.format


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
            msg = f"Invalid base64 encoding: {e!s}"
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


class ToolResultPart(BaseModel):
    """
    Tool result part in message (AI SDK v6 format).

    This represents tool execution results sent from frontend to backend.
    Used in Pattern B where tool result is sent separately from approval.

    Frontend sends this when:
    - Using addToolOutput() in AI SDK v6
    - Tool execution completes on browser (e.g., Geolocation API)

    Converts to: ADK FunctionResponse with tool execution result

    Reference:
    - Frontend test: lib/tests/e2e/frontend-execute-sse.e2e.test.tsx (addToolOutput)
    """

    model_config = {"populate_by_name": True}

    type: Literal["tool-result"] = "tool-result"
    tool_call_id: str = Field(alias="toolCallId")
    result: dict[str, Any]


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
MessagePart = (
    TextPart | ImagePart | FilePart | ToolUsePart | ToolResultPart | StepPart | GenericPart
)
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

    id: str | None = None  # Message ID from AI SDK v6 (optional)
    role: Literal["user", "assistant", "system", "tool"]  # Strict role validation
    content: str | list[MessagePart] | None = (
        None  # Simple format or Parts array (function_response)
    )
    parts: list[MessagePart] | None = None  # AI SDK v6 format with discriminated union

    @model_validator(mode="after")
    def validate_content_or_parts(self) -> ChatMessage:
        """Ensure at least one of content or parts is provided."""
        if self.content is None and self.parts is None:
            msg = "Message must have either 'content' or 'parts'"
            raise ValueError(msg)
        return self

    def _get_text_content(self) -> str:
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
        width, height, image_format = _extract_image_metadata(image_bytes)

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
            width, height, image_format = _extract_image_metadata(file_bytes)
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
        # IMPORTANT: Do NOT convert assistant's tool calls (CALL/APPROVAL_REQUESTED) to FunctionCalls
        # ADK automatically records tool calls from LLM responses in the session.
        # Re-injecting them during history sync corrupts ADK's internal context (ctx.agent becomes None).
        # Only process user's approval/denial responses (APPROVAL_RESPONDED state).

        if part.state in {ToolCallState.CALL, ToolCallState.APPROVAL_REQUESTED}:
            # Skip assistant's tool calls - ADK already has them from the original run
            logger.debug(
                f"[AI SDK v6] Skipping assistant tool call during history sync "
                f"(id={part.tool_call_id}, name={part.tool_name}, state={part.state})"
            )
            return

        # Handle APPROVAL_RESPONDED state (user's approval/denial response)
        # ADR 0002: Any tool can be in approval-responded state (not just adk_request_confirmation)
        # The approval.id is used as the confirmation_id to map back to the original tool
        if part.state == ToolCallState.APPROVAL_RESPONDED:
            # Extract approval decision and approval ID
            if part.approval is None:
                logger.warning("[AI SDK v6] Missing approval metadata in approval-responded state")
                return

            approval_id = part.approval.id
            confirmed = part.approval.approved

            logger.info(
                f"[ADK Confirmation] Converting approval response to ADK FunctionResponse "
                f"(approval_id={approval_id}, original_tool={part.tool_name}, "
                f"original_call_id={part.tool_call_id}, approved={confirmed})"
            )

            # Create ADK FunctionResponse for adk_request_confirmation with approval decision
            # ADR 0002: Use approval.id as the function response ID (this is the confirmation_id)
            # The backend's confirmation_id_mapping will resolve this to the original tool_call_id
            function_response = types.FunctionResponse(
                id=approval_id,
                name="adk_request_confirmation",
                response={"confirmed": confirmed},
            )
            adk_parts.append(types.Part(function_response=function_response))
            return

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

    def _process_tool_result_part(self, part: ToolResultPart, adk_parts: list[types.Part]) -> None:
        """
        Process a ToolResultPart and convert to ADK FunctionResponse.

        This handles tool execution results sent from frontend (Pattern B):
        - Frontend executes tool (e.g., browser Geolocation API)
        - Frontend sends tool result via addToolOutput()
        - Backend converts to ADK FunctionResponse

        The tool_call_id maps to the original tool call ID from ADK.
        We use the ID mapper to retrieve the tool name.
        """
        # Validate result
        if not isinstance(part.result, dict):
            logger.warning(f"[tool-result] Invalid result format: {part.result}")
            return

        # Resolve tool name from ID using ID mapper
        # The ID mapper tracks tool_name → function_call.id mappings
        tool_name = None
        if hasattr(self, "_id_mapper") and self._id_mapper:
            tool_name = self._id_mapper.resolve_tool_result(part.tool_call_id)

        if not tool_name:
            logger.error(
                f"[tool-result] Cannot resolve tool name for ID: {part.tool_call_id}. "
                f"This may indicate the tool was never registered in ID mapper."
            )
            return

        logger.info(
            f"[tool-result] Converting to ADK FunctionResponse "
            f"(id={part.tool_call_id}, name={tool_name})"
        )

        # SSE Mode: Resolve pending Future before ADK processes the message
        # In SSE mode, tool execution from Turn 1 may still be awaiting this result
        # By resolving the Future now, the await will complete when ADK processes the FunctionResponse
        if hasattr(self, "_delegate") and self._delegate:
            logger.info(
                f"[tool-result] Resolving pending Future for SSE mode "
                f"(id={part.tool_call_id}, tool={tool_name})"
            )
            self._delegate.resolve_tool_result(part.tool_call_id, part.result)

        # Create ADK FunctionResponse
        function_response = types.FunctionResponse(
            id=part.tool_call_id,
            name=tool_name,
            response=part.result,
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
        elif isinstance(part, ToolResultPart):
            self._process_tool_result_part(part, adk_parts)

    def to_adk_content(self, id_mapper: Any = None, delegate: Any = None) -> types.Content:
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

        Args:
            id_mapper: Optional IDMapper for resolving tool_call_id → tool_name
                      Required for processing tool-result parts in Pattern B.
            delegate: Optional FrontendToolDelegate for resolving Futures in SSE mode
                     Required for resolving pending tool results across turns.
        """
        # Store ID mapper and delegate temporarily for use in _process_tool_result_part
        self._id_mapper = id_mapper
        self._delegate = delegate

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

        # Clean up temporary reference
        self._id_mapper = None

        return types.Content(role=self.role, parts=adk_parts)


# ============================================================
# WebSocket Message Processing for BIDI Mode
# ============================================================


def _fix_tool_output_role(msg: ChatMessage) -> None:
    """Fix message role for tool outputs.

    AI SDK may send tool outputs as role="assistant", but ADK requires
    role="user" for FunctionResponse. This function checks and fixes the role.
    """
    if not msg.parts:
        return

    has_tool_output = any(
        isinstance(part, ToolUsePart) and part.state == "output-available"
        for part in msg.parts
    )

    if has_tool_output and msg.role != "user":
        logger.info(
            f"[BIDI] Overriding message role from '{msg.role}' to 'user' for tool output"
        )
        msg.role = "user"


def _extract_image_blobs_from_parts(parts: list[Any]) -> list[types.Blob]:
    """Extract image/video blobs from message parts.

    Decodes data URL format files and creates ADK Blob objects.
    Used for Live API which requires images to be sent via send_realtime().
    """
    image_blobs: list[types.Blob] = []

    logger.info(f"[STEP 2] Processing {len(parts)} parts from last_msg")
    for part in parts:
        logger.info(f"[STEP 2] Part type: {type(part).__name__}")
        if isinstance(part, FilePart) and part.url.startswith("data:"):
            # Decode data URL format: "data:image/png;base64,..."
            data_url_parts = part.url.split(",", 1)
            if len(data_url_parts) == 2:  # noqa: PLR2004 - data URL format: "data:type;base64,content"
                file_data_base64 = data_url_parts[1]
                file_bytes = base64.b64decode(file_data_base64)
                blob = types.Blob(mime_type=part.media_type, data=file_bytes)
                image_blobs.append(blob)

    return image_blobs


def _build_text_content(
    adk_content: types.Content,
) -> types.Content | None:
    """Build text content from ADK content, separating non-image parts.

    Handles the separation logic for FunctionResponse parts which must be
    sent alone with role="user" per ADK requirements.
    """
    if not adk_content.parts:
        return None

    # Extract non-image parts (skip inline_data parts)
    non_image_parts: list[types.Part] = []
    logger.info(f"[STEP 2] ADK content has {len(adk_content.parts)} parts")

    for adk_part in adk_content.parts:
        if not hasattr(adk_part, "inline_data") or adk_part.inline_data is None:
            non_image_parts.append(adk_part)
            if hasattr(adk_part, "function_response") and adk_part.function_response:
                logger.info(
                    f"[STEP 2] Including FunctionResponse: {adk_part.function_response.name}"
                )

    if not non_image_parts:
        return None

    # Check for FunctionResponse parts
    function_response_parts = [
        part
        for part in non_image_parts
        if hasattr(part, "function_response") and part.function_response
    ]

    if function_response_parts:
        # ADK requires FunctionResponse to be sent ALONE with role="user"
        return types.Content(role="user", parts=function_response_parts)

    # No FunctionResponse - send all parts with original role
    return types.Content(role=adk_content.role, parts=non_image_parts)


def process_chat_message_for_bidi(
    message_data: dict[str, Any],
    id_mapper: Any = None,
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
        id_mapper: Optional ID mapper for resolving tool_call_id → tool_name

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

    # STEP 1: Log and parse incoming message
    logger.info(f"[STEP 1] Received {len(messages)} messages from frontend")
    logger.info(f"[STEP 1] Last message role: {messages[-1].get('role')}")
    logger.info(f"[STEP 1] Last message parts: {messages[-1].get('parts', [])}")

    last_msg = ChatMessage(**messages[-1])

    # Fix role for tool outputs (ADK requires role="user" for FunctionResponse)
    _fix_tool_output_role(last_msg)

    # Convert to ADK Content (handles all part types including confirmation responses)
    adk_content = last_msg.to_adk_content(id_mapper=id_mapper)

    # STEP 2: Separate image blobs and text content
    image_blobs = (
        _extract_image_blobs_from_parts(last_msg.parts)
        if last_msg.parts
        else []
    )
    text_content = _build_text_content(adk_content)

    # STEP 3: Log final ADK format
    logger.info(
        f"[STEP 3] ADK format: image_blobs={len(image_blobs)}, "
        f"text_content={'present' if text_content else 'None'}"
    )
    if text_content:
        logger.info(f"[STEP 3] Text content role: {text_content.role}, parts: {text_content.parts}")

    return (image_blobs, text_content)
