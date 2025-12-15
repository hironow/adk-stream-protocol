"""
Unit tests for image support in ADK BIDI mode.

Tests cover:
- ChatMessage model with image parts
- Image conversion to ADK format
- Image validation
- StreamProtocolConverter image handling
"""

from __future__ import annotations

import base64

import pytest

from server import ChatMessage


def test_chat_message_with_text_and_image():
    """
    Test ChatMessage with both text and image parts.

    RED phase: This test will fail because ImagePart doesn't exist yet.
    """

    # given: A message with text and image parts
    # Create a small 1x1 PNG image (base64 encoded)
    # PNG header + minimal PNG data
    png_data = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
    )
    png_base64 = base64.b64encode(png_data).decode("utf-8")

    message_data = {
        "role": "user",
        "parts": [
            {"type": "text", "text": "What's in this image?"},
            {"type": "image", "data": png_base64, "media_type": "image/png"},
        ],
    }

    # when: Create ChatMessage from data
    message = ChatMessage(**message_data)

    # then: Message should have correct structure
    assert message.role == "user"
    assert message.parts is not None
    assert len(message.parts) == 2

    # First part is text
    assert message.parts[0].type == "text"
    assert message.parts[0].text == "What's in this image?"

    # Second part is image
    assert message.parts[1].type == "image"
    assert message.parts[1].data == png_base64
    assert message.parts[1].media_type == "image/png"


def test_chat_message_to_adk_content_with_image():
    """
    Test ChatMessage.to_adk_content() converts image to ADK format.

    RED phase: This test will fail because to_adk_content() doesn't handle images yet.
    """

    # given: A message with text and image
    png_data = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
    )
    png_base64 = base64.b64encode(png_data).decode("utf-8")

    message = ChatMessage(
        role="user",
        parts=[
            {"type": "text", "text": "Analyze this"},
            {"type": "image", "data": png_base64, "media_type": "image/png"},
        ],
    )

    # when: Convert to ADK Content
    content = message.to_adk_content()

    # then: Content should have both text and image parts
    assert content.role == "user"
    assert len(content.parts) == 2

    # First part: text
    assert content.parts[0].text == "Analyze this"
    # ADK Part always has inline_data attribute, but it's None for text
    assert content.parts[0].inline_data is None

    # Second part: inline_data (image)
    assert content.parts[1].inline_data is not None
    assert content.parts[1].inline_data.mime_type == "image/png"
    assert content.parts[1].inline_data.data == png_data  # Should be bytes


def test_chat_message_image_only():
    """
    Test ChatMessage with only an image (no text).

    RED phase: Will fail until image support is implemented.
    """

    # given: An image-only message
    png_data = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
    )
    png_base64 = base64.b64encode(png_data).decode("utf-8")

    message = ChatMessage(
        role="user",
        parts=[
            {"type": "image", "data": png_base64, "media_type": "image/png"},
        ],
    )

    # when: Convert to ADK Content
    content = message.to_adk_content()

    # then: Content should have one image part
    assert content.role == "user"
    assert len(content.parts) == 1
    assert content.parts[0].inline_data is not None
    assert content.parts[0].inline_data.mime_type == "image/png"


def test_chat_message_multiple_images():
    """
    Test ChatMessage with multiple images.

    RED phase: Will fail until multi-image support works.
    """

    # given: A message with text and two images
    png_data = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
    )
    png_base64 = base64.b64encode(png_data).decode("utf-8")

    message = ChatMessage(
        role="user",
        parts=[
            {"type": "text", "text": "Compare these images"},
            {"type": "image", "data": png_base64, "media_type": "image/png"},
            {"type": "image", "data": png_base64, "media_type": "image/png"},
        ],
    )

    # when: Convert to ADK Content
    content = message.to_adk_content()

    # then: Should have 3 parts (1 text + 2 images)
    assert len(content.parts) == 3
    assert content.parts[0].text == "Compare these images"
    assert content.parts[0].inline_data is None
    assert content.parts[1].inline_data is not None
    assert content.parts[1].inline_data.mime_type == "image/png"
    assert content.parts[2].inline_data is not None
    assert content.parts[2].inline_data.mime_type == "image/png"


def test_chat_message_backward_compatibility_text_only():
    """
    Test that existing text-only messages still work.

    This should PASS even before implementing image support.
    Ensures we don't break existing functionality.
    """

    # given: Simple text message (existing format)
    message = ChatMessage(role="user", content="Hello")

    # when: Convert to ADK Content
    content = message.to_adk_content()

    # then: Should work as before
    assert content.role == "user"
    assert len(content.parts) == 1
    assert content.parts[0].text == "Hello"


def test_chat_message_backward_compatibility_parts_text():
    """
    Test that existing parts-based text messages still work.

    This should PASS even before implementing image support.
    """

    # given: Parts-based text message (existing format)
    message = ChatMessage(
        role="user",
        parts=[{"type": "text", "text": "Hello"}],
    )

    # when: Convert to ADK Content
    content = message.to_adk_content()

    # then: Should work as before
    assert content.role == "user"
    assert len(content.parts) == 1
    assert content.parts[0].text == "Hello"


def test_image_part_rejects_invalid_media_type():
    """
    Test that invalid ImagePart becomes GenericPart (fallback behavior).

    When ImagePart validation fails, Pydantic Union falls back to GenericPart.
    This is the current implementation behavior to avoid 422 errors.
    """
    from ai_sdk_v6_compat import GenericPart

    # given: Invalid media type (GIF not supported by ImagePart)
    png_data = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
    )
    png_base64 = base64.b64encode(png_data).decode("utf-8")

    # when: Create message with invalid media_type
    message = ChatMessage(
        role="user",
        parts=[
            {"type": "image", "data": png_base64, "media_type": "image/gif"},
        ],
    )

    # then: Falls back to GenericPart due to validation failure
    assert len(message.parts) == 1
    assert isinstance(message.parts[0], GenericPart)
    assert message.parts[0].type == "image"


def test_image_part_rejects_invalid_base64():
    """
    Test that invalid base64 in ImagePart becomes GenericPart (fallback behavior).

    When ImagePart validation fails on base64 decoding,
    Pydantic Union falls back to GenericPart.
    """
    from ai_sdk_v6_compat import GenericPart

    # given: Invalid base64 string
    invalid_base64 = "This is not base64!@#$"

    # when: Create message with invalid base64
    message = ChatMessage(
        role="user",
        parts=[
            {"type": "image", "data": invalid_base64, "media_type": "image/png"},
        ],
    )

    # then: Falls back to GenericPart due to validation failure
    assert len(message.parts) == 1
    assert isinstance(message.parts[0], GenericPart)
    assert message.parts[0].type == "image"


def test_image_part_rejects_empty_data():
    """
    Test that empty data in ImagePart becomes GenericPart (fallback behavior).

    When ImagePart validation fails on empty data,
    Pydantic Union falls back to GenericPart.
    """
    from ai_sdk_v6_compat import GenericPart

    # when: Create message with empty data
    message = ChatMessage(
        role="user",
        parts=[
            {"type": "image", "data": "", "media_type": "image/png"},
        ],
    )

    # then: Falls back to GenericPart due to validation failure
    assert len(message.parts) == 1
    assert isinstance(message.parts[0], GenericPart)
    assert message.parts[0].type == "image"


def test_image_part_accepts_all_supported_formats():
    """
    Test that ImagePart accepts all supported image formats.

    This should PASS once validation is implemented.
    """

    # given: Valid base64 image
    png_data = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
    )
    png_base64 = base64.b64encode(png_data).decode("utf-8")

    # when: Create messages with all supported formats
    for media_type in ["image/png", "image/jpeg", "image/webp"]:
        message = ChatMessage(
            role="user",
            parts=[
                {"type": "image", "data": png_base64, "media_type": media_type},
            ],
        )

        # then: Should succeed
        assert message.parts is not None
        assert len(message.parts) == 1
        assert message.parts[0].media_type == media_type
