# Agent Tasks

This file tracks implementation tasks for AI agents working on the ADK AI Data Protocol project.

## Current Sprint: ADK BIDI + AI SDK v6 Integration

**Experiment Reference:** `experiments/2025-12-11_adk_bidi_ai_sdk_v6_integration.md`

**Objective:** Implement bidirectional streaming between AI SDK v6 useChat and ADK BIDI mode using WebSocket transport.

### Phase 1: Backend WebSocket Infrastructure

#### Task 1.1: Create WebSocket endpoint in FastAPI

**File:** `server.py`

**Implementation:**

```python
@app.websocket("/live")
async def live_chat(websocket: WebSocket):
    """
    WebSocket endpoint for bidirectional streaming with ADK BIDI mode.
    Bridges AI SDK v6 useChat with ADK LiveRequestQueue.
    """
    await websocket.accept()
    logger.info("WebSocket connection established")
    # TODO: Implement bridge logic
```

**Acceptance Criteria:**

- WebSocket endpoint accepts connections at `ws://localhost:8000/live`
- Connection lifecycle managed properly (accept, close, error handling)
- Logging for connection events

#### Task 1.2: Implement message format conversion (useChat → ADK)

**File:** `server.py` or new `live_bridge.py`

**Implementation:**

Convert AI SDK v6 `SendMessagesParams` to ADK `Content` format:

```python
def convert_useChat_to_adk_content(message: dict) -> types.Content:
    """
    Convert AI SDK v6 message format to ADK Content.

    Input: { role: "user", content: "..." } or { role: "user", parts: [...] }
    Output: types.Content(role="user", parts=[types.Part(text="...")])
    """
    pass
```

**Acceptance Criteria:**

- Handles both simple content and parts-based messages
- Extracts text from message parts
- Creates proper ADK Content objects
- Unit tests for conversion logic

#### Task 1.3: Implement ADK event → UIMessageChunk conversion

**File:** `stream_protocol.py` or new `live_stream_protocol.py`

**Implementation:**

Convert ADK live events to AI SDK v6 `UIMessageChunk` format:

```python
async def stream_adk_live_to_ui_chunks(
    adk_event_stream: AsyncIterator[Any],
) -> AsyncIterator[str]:
    """
    Convert ADK live events to AI SDK v6 UIMessageChunk SSE format.
    Yields SSE-formatted events for WebSocket transmission.
    """
    pass
```

**Acceptance Criteria:**

- Converts ADK text events to text-delta chunks
- Converts tool calls to tool-call-start/available
- Converts tool results to tool-result-available
- Handles finish events with proper reasons
- Maintains streaming state

#### Task 1.4: Integrate ADK BIDI run_live()

**File:** `server.py`

**Implementation:**

Replace `run_async()` with `run_live()` for BIDI mode:

```python
@app.websocket("/live")
async def live_chat(websocket: WebSocket):
    await websocket.accept()

    session = await get_or_create_session("live_user")

    # Use run_live instead of run_async
    live_stream = agent_runner.run_live(
        user_id="live_user",
        session_id=session.id,
    )

    # Handle bidirectional message flow
    # - Receive from websocket → LiveRequestQueue
    # - Receive from live_stream → websocket
```

**Acceptance Criteria:**

- Uses ADK's `run_live()` method
- Manages LiveRequestQueue for incoming messages
- Streams events back through WebSocket
- Handles concurrent read/write on WebSocket

#### Task 1.5: WebSocket message routing and session management

**File:** `server.py`

**Implementation:**

- Receive messages from WebSocket (frontend → backend)
- Send to LiveRequestQueue
- Stream ADK events to WebSocket (backend → frontend)
- Manage session lifecycle

**Acceptance Criteria:**

- Concurrent message handling (asyncio.gather or create_task)
- Proper error handling and connection cleanup
- Session persistence across messages
- Graceful shutdown on disconnect

### Phase 2: Frontend WebSocket Transport

#### Task 2.1: Implement WebSocketChatTransport class

**File:** `lib/websocket-chat-transport.ts` (new file)

**Implementation:**

Based on community example, implement custom ChatTransport:

```typescript
export class WebSocketChatTransport implements ChatTransport {
  private ws: WebSocket | null = null;
  private url: string;

  constructor(config: { url: string }) {
    this.url = config.url;
  }

  async sendMessages(params: SendMessagesParams): Promise<ReadableStream<UIMessageChunk>> {
    // Establish WebSocket connection
    // Send messages
    // Return stream of UIMessageChunk
  }
}
```

**Acceptance Criteria:**

- Implements ChatTransport interface
- Establishes WebSocket connection
- Sends messages in correct format
- Returns ReadableStream of UIMessageChunk
- Handles connection errors

#### Task 2.2: Message streaming and state management

**File:** `lib/websocket-chat-transport.ts`

**Implementation:**

```typescript
private handleWebSocketMessage(data: any): void {
  // Parse SSE-style messages from WebSocket
  // Enqueue UIMessageChunk to stream controller
  // Handle tool calls
  // Handle finish events
}
```

**Acceptance Criteria:**

- Parses incoming WebSocket messages
- Converts to UIMessageChunk format
- Streams to ReadableStream controller
- Maintains message order
- Handles stream completion

#### Task 2.3: Tool call callback integration

**File:** `lib/websocket-chat-transport.ts`

**Implementation:**

```typescript
export class WebSocketChatTransport implements ChatTransport {
  private toolCallCallback?: (toolCall: ToolCall) => Promise<any>;

  constructor(config: {
    url: string;
    toolCallCallback?: (toolCall: ToolCall) => Promise<any>;
  }) {
    this.url = config.url;
    this.toolCallCallback = config.toolCallCallback;
  }

  private async handleToolCall(toolCall: ToolCall): Promise<void> {
    if (this.toolCallCallback) {
      const result = await this.toolCallCallback(toolCall);
      // Send tool result back via WebSocket
    }
  }
}
```

**Acceptance Criteria:**

- Supports tool call callback function
- Detects tool-call events from stream
- Executes callback and gets result
- Sends tool result back to backend
- Updates UI with tool execution state

#### Task 2.4: Update useChat to use WebSocketChatTransport

**File:** `app/page.tsx` or new mode switcher

**Implementation:**

```typescript
import { WebSocketChatTransport } from "@/lib/websocket-chat-transport";

// Create transport instance
const transport = new WebSocketChatTransport({
  url: process.env.NEXT_PUBLIC_ADK_BACKEND_URL + "/live",
  toolCallCallback: async (toolCall) => {
    // Handle tools on frontend if needed
  },
});

// Use with useChat
const { messages, sendMessage, isLoading } = useChat({
  transport,
});
```

**Acceptance Criteria:**

- WebSocketChatTransport imported and instantiated
- useChat configured with custom transport
- Messages display correctly in UI
- Streaming works smoothly
- Tool invocations render properly

### Phase 3: Testing and Validation

#### Task 3.1: Backend unit tests

**File:** `tests/unit/test_live_bridge.py`

**Tests:**

- Message format conversion (useChat → ADK)
- Event conversion (ADK → UIMessageChunk)
- WebSocket message handling
- Session management

#### Task 3.2: Integration tests

**File:** `tests/integration/test_websocket_live.py`

**Tests:**

- End-to-end message flow through WebSocket
- Tool calling in BIDI context
- Connection stability and reconnection
- Concurrent message handling

#### Task 3.3: Manual testing checklist

- [ ] WebSocket connection establishes successfully
- [ ] Send message from UI → appears in backend logs
- [ ] Agent response streams back to UI in real-time
- [ ] Tool calls work during conversation
- [ ] Tool results display correctly
- [ ] Multiple messages in sequence work
- [ ] Connection survives errors gracefully
- [ ] Reconnection works after disconnect
- [ ] Performance is acceptable (< 500ms latency)

### Phase 4: Environment and Configuration

#### Task 4.1: Update .env.example

**File:** `.env.example`

**Addition:**

```bash
# BIDI Mode Configuration (Phase 3 - WebSocket bidirectional streaming)
NEXT_PUBLIC_WEBSOCKET_ENABLED=false
WEBSOCKET_LIVE_URL=ws://localhost:8000/live
```

#### Task 4.2: Add backend mode switcher

**File:** `app/page.tsx` or new component

**Implementation:**

UI toggle to switch between:

- "gemini" - Direct Gemini API (SSE)
- "adk-sse" - ADK backend via SSE (current)
- "adk-bidi" - ADK BIDI via WebSocket (new)

#### Task 4.3: Update documentation

**Files:**

- `README.md` - Add BIDI mode instructions
- `docs/architecture.md` - Document WebSocket architecture (if exists)
- `experiments/2025-12-11_adk_bidi_ai_sdk_v6_integration.md` - Update results section

## Implementation Order

**Day 1: Backend Foundation**

1. Task 1.1: WebSocket endpoint
2. Task 1.2: Message format conversion (useChat → ADK)
3. Task 1.3: ADK event → UIMessageChunk conversion

**Day 2: Backend Integration**

4. Task 1.4: Integrate run_live()
5. Task 1.5: Message routing and session management
6. Task 3.1: Backend unit tests

**Day 3: Frontend Implementation**

7. Task 2.1: WebSocketChatTransport class
8. Task 2.2: Message streaming
9. Task 2.3: Tool call callbacks

**Day 4: Frontend Integration & Testing**

10. Task 2.4: Update useChat
11. Task 3.2: Integration tests
12. Task 3.3: Manual testing

**Day 5: Polish & Documentation**

13. Task 4.1: Environment configuration
14. Task 4.2: Backend mode switcher
15. Task 4.3: Update documentation

## Notes

- Keep SSE mode (`adk-sse`) functional - don't break existing implementation
- WebSocket mode should be opt-in via environment variable
- Follow TDD where possible (write tests first)
- Commit frequently with clear messages
- Update experiment document with findings

---

## Current Sprint: ADK BIDI Multimodal Support - Phase 1 (Image Support)

**Experiment Reference:** `experiments/2025-12-11_adk_bidi_multimodal_support.md`

**Objective:** Implement image input/output support in ADK BIDI mode using AI SDK v6 Data Stream Protocol custom events.

**Decision:** Focus on Phase 1 (Image Support) - highest value-to-complexity ratio.

### Phase 1A: Backend Image Input Support

#### Task 1A.1: Extend ChatMessage model for multimodal parts

**File:** `server.py`

**Current Implementation:**
```python
class ChatMessage(BaseModel):
    role: str
    content: str | None = None
    parts: list[dict] | None = None
```

**New Implementation:**
```python
from pydantic import BaseModel, Field

class ImagePart(BaseModel):
    """Image part in message"""
    type: Literal["image"] = "image"
    data: str  # base64 encoded image
    media_type: str = "image/png"  # image/png, image/jpeg, image/webp

class TextPart(BaseModel):
    """Text part in message"""
    type: Literal["text"] = "text"
    text: str

MessagePart = ImagePart | TextPart

class ChatMessage(BaseModel):
    role: str
    content: str | None = None
    parts: list[MessagePart] | None = None  # ← Updated to use union type
```

**Acceptance Criteria:**
- ChatMessage supports both text and image parts
- Pydantic validates part types correctly
- Base64 image data accepted
- Media type validation (png, jpeg, webp)
- Backward compatibility with existing text-only messages

#### Task 1A.2: Extend to_adk_content() for image conversion

**File:** `server.py` (ChatMessage class)

**Implementation:**
```python
def to_adk_content(self) -> types.Content:
    """
    Convert AI SDK v6 message to ADK Content format.

    Supports:
    - Text only: { role: "user", content: "text" }
    - Parts (text + images): { role: "user", parts: [
        { type: "text", text: "..." },
        { type: "image", data: "base64...", media_type: "image/png" }
      ]}
    """
    adk_parts = []

    # Handle simple text content
    if self.content:
        adk_parts.append(types.Part(text=self.content))

    # Handle parts array (multimodal)
    if self.parts:
        for part in self.parts:
            if part.type == "text":
                adk_parts.append(types.Part(text=part.text))
            elif part.type == "image":
                # Decode base64 and create inline_data
                import base64
                image_bytes = base64.b64decode(part.data)
                adk_parts.append(
                    types.Part(
                        inline_data=types.InlineData(
                            mime_type=part.media_type,
                            data=image_bytes
                        )
                    )
                )

    return types.Content(role=self.role, parts=adk_parts)
```

**Acceptance Criteria:**
- Converts text parts to ADK Part(text=...)
- Converts image parts to ADK Part(inline_data=...)
- Base64 decoding works correctly
- MIME types mapped correctly
- Handles mixed text+image messages
- Unit tests for all conversion paths

#### Task 1A.3: Add image input validation

**File:** `server.py` (new helper functions)

**Implementation:**
```python
import imghdr
from io import BytesIO

MAX_IMAGE_SIZE = 10 * 1024 * 1024  # 10MB
ALLOWED_IMAGE_TYPES = {"png", "jpeg", "webp"}

def validate_image(data: str, media_type: str) -> bool:
    """
    Validate image data and media type.

    Args:
        data: base64 encoded image
        media_type: MIME type (image/png, etc.)

    Returns:
        True if valid

    Raises:
        ValueError: If validation fails
    """
    import base64

    # Decode base64
    try:
        image_bytes = base64.b64decode(data)
    except Exception as e:
        raise ValueError(f"Invalid base64 encoding: {e}")

    # Check size
    if len(image_bytes) > MAX_IMAGE_SIZE:
        raise ValueError(f"Image too large: {len(image_bytes)} bytes (max {MAX_IMAGE_SIZE})")

    # Verify image type
    image_type = imghdr.what(BytesIO(image_bytes))
    if image_type not in ALLOWED_IMAGE_TYPES:
        raise ValueError(f"Unsupported image type: {image_type}")

    # Verify MIME type matches
    expected_mime = f"image/{image_type}"
    if media_type != expected_mime:
        raise ValueError(f"MIME type mismatch: expected {expected_mime}, got {media_type}")

    return True
```

**Acceptance Criteria:**
- Validates base64 encoding
- Enforces size limits (10MB max)
- Checks image format (PNG, JPEG, WebP only)
- Verifies MIME type consistency
- Provides clear error messages
- Unit tests for validation logic

### Phase 1B: Backend Image Output Support

#### Task 1B.1: Add image output handling in StreamProtocolConverter

**File:** `stream_protocol.py`

**Implementation:**
```python
class StreamProtocolConverter:
    # ... existing code ...

    def _process_inline_data_part(self, inline_data: types.InlineData) -> list[str]:
        """
        Process inline data (image) part into data-image event.

        ADK format: types.Part(inline_data=InlineData(mime_type="image/png", data=bytes))
        AI SDK v6 format: data: {"type":"data-image","data":"base64...","mediaType":"image/png"}
        """
        import base64

        # Encode image bytes to base64
        image_base64 = base64.b64encode(inline_data.data).decode('utf-8')

        # Create data-image custom event
        event = self._format_sse_event({
            "type": "data-image",
            "data": image_base64,
            "mediaType": inline_data.mime_type,
        })

        return [event]

    async def convert_event(self, event: Event) -> AsyncGenerator[str, None]:
        """Convert a single ADK event to AI SDK v6 SSE events."""
        # ... existing start event code ...

        # Process event content parts
        if event.content and event.content.parts:
            for part in event.content.parts:
                # Text content
                if hasattr(part, "text") and part.text:
                    for sse_event in self._process_text_part(part.text):
                        yield sse_event

                # Image content (NEW)
                if hasattr(part, "inline_data") and part.inline_data:
                    for sse_event in self._process_inline_data_part(part.inline_data):
                        yield sse_event

                # ... existing thought, function_call, etc. ...
```

**Acceptance Criteria:**
- Detects ADK inline_data parts
- Encodes image bytes to base64
- Creates data-image SSE events
- Preserves MIME type information
- Works with existing text/tool events
- Unit tests for image event conversion

#### Task 1B.2: Add logging and monitoring for image events

**File:** `stream_protocol.py`

**Implementation:**
```python
def _process_inline_data_part(self, inline_data: types.InlineData) -> list[str]:
    """Process inline data (image) part into data-image event."""
    import base64

    # Log image processing
    image_size = len(inline_data.data)
    logger.info(
        f"Processing image: {inline_data.mime_type}, "
        f"size={image_size} bytes ({image_size / 1024:.1f} KB)"
    )

    # Encode to base64
    image_base64 = base64.b64encode(inline_data.data).decode('utf-8')

    # Log base64 size (larger than original due to encoding)
    base64_size = len(image_base64)
    logger.debug(f"Base64 encoded size: {base64_size} bytes")

    # Create event
    event = self._format_sse_event({
        "type": "data-image",
        "data": image_base64,
        "mediaType": inline_data.mime_type,
    })

    return [event]
```

**Acceptance Criteria:**
- Logs image size and type
- Tracks base64 encoding overhead
- Debug logs for troubleshooting
- Performance metrics collected

### Phase 1C: Frontend Image Upload Component

#### Task 1C.1: Create ImageUpload component

**File:** `components/image-upload.tsx` (new file)

**Implementation:**
```typescript
"use client";

import { useState } from "react";

interface ImageUploadProps {
  onImageSelect: (image: { data: string; mediaType: string }) => void;
  maxSizeMB?: number;
}

export function ImageUpload({ onImageSelect, maxSizeMB = 10 }: ImageUploadProps) {
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    const allowedTypes = ["image/png", "image/jpeg", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      setError("Only PNG, JPEG, and WebP images are supported");
      return;
    }

    // Validate file size
    const maxSize = maxSizeMB * 1024 * 1024;
    if (file.size > maxSize) {
      setError(`Image must be smaller than ${maxSizeMB}MB`);
      return;
    }

    // Read file as base64
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result as string;
      const data = base64.split(",")[1]; // Remove data:image/png;base64, prefix

      setPreview(base64);
      setError(null);
      onImageSelect({ data, mediaType: file.type });
    };
    reader.onerror = () => {
      setError("Failed to read image file");
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="image-upload">
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={handleFileSelect}
        className="file-input"
      />

      {preview && (
        <div className="preview">
          <img src={preview} alt="Preview" style={{ maxWidth: "200px" }} />
        </div>
      )}

      {error && <div className="error">{error}</div>}
    </div>
  );
}
```

**Acceptance Criteria:**
- File input accepts PNG, JPEG, WebP
- File size validation (10MB limit)
- File type validation
- Base64 encoding of image
- Image preview after selection
- Error messages for invalid inputs
- Clean, accessible UI

#### Task 1C.2: Integrate ImageUpload with chat interface

**File:** `app/page.tsx`

**Implementation:**
```typescript
import { ImageUpload } from "@/components/image-upload";

export default function Home() {
  const [pendingImages, setPendingImages] = useState<Array<{data: string, mediaType: string}>>([]);

  const { messages, sendMessage } = useChat({
    // ... existing config ...
  });

  const handleImageSelect = (image: { data: string; mediaType: string }) => {
    setPendingImages([...pendingImages, image]);
  };

  const handleSendMessage = (text: string) => {
    const parts = [];

    // Add text part
    if (text) {
      parts.push({ type: "text", text });
    }

    // Add image parts
    for (const image of pendingImages) {
      parts.push({
        type: "image",
        data: image.data,
        media_type: image.mediaType,
      });
    }

    // Send message with parts
    sendMessage({ parts });

    // Clear pending images
    setPendingImages([]);
  };

  return (
    <div>
      {/* ... existing chat UI ... */}

      <div className="input-area">
        <ImageUpload onImageSelect={handleImageSelect} />

        {/* Show pending images */}
        {pendingImages.length > 0 && (
          <div className="pending-images">
            {pendingImages.length} image(s) ready to send
          </div>
        )}

        {/* ... existing text input ... */}
      </div>
    </div>
  );
}
```

**Acceptance Criteria:**
- ImageUpload component integrated in chat UI
- Multiple images can be attached to one message
- Pending images shown before sending
- Images cleared after message sent
- Works with both text-only and text+image messages

### Phase 1D: Frontend Image Display Component

#### Task 1D.1: Create ImageDisplay component

**File:** `components/image-display.tsx` (new file)

**Implementation:**
```typescript
"use client";

interface ImageDisplayProps {
  data: string; // base64 encoded
  mediaType: string;
  alt?: string;
}

export function ImageDisplay({ data, mediaType, alt = "Image" }: ImageDisplayProps) {
  const dataUrl = `data:${mediaType};base64,${data}`;

  return (
    <div className="image-display">
      <img
        src={dataUrl}
        alt={alt}
        style={{
          maxWidth: "100%",
          maxHeight: "400px",
          borderRadius: "8px",
          objectFit: "contain",
        }}
        loading="lazy"
      />
    </div>
  );
}
```

**Acceptance Criteria:**
- Renders base64 encoded images
- Supports PNG, JPEG, WebP
- Responsive sizing (max 400px height)
- Lazy loading for performance
- Accessible alt text
- Clean styling

#### Task 1D.2: Extend WebSocketChatTransport to handle data-image events

**File:** `lib/websocket-chat-transport.ts`

**Implementation:**
```typescript
private handleWebSocketMessage(
  data: string,
  controller: ReadableStreamDefaultController<UIMessageChunk>
): void {
  try {
    if (data.startsWith("data: ")) {
      const jsonStr = data.substring(6);

      if (jsonStr === "[DONE]") {
        controller.close();
        this.ws?.close();
        return;
      }

      const chunk = JSON.parse(jsonStr);
      console.log("[WS Transport] Received chunk:", chunk.type);

      // Enqueue UIMessageChunk to stream
      controller.enqueue(chunk as UIMessageChunk);

      // Handle tool calls
      if (chunk.type === "tool-call-available" && this.config.toolCallCallback) {
        this.handleToolCall(chunk);
      }

      // Handle images (NEW)
      if (chunk.type === "data-image") {
        console.log(`[WS Transport] Received image: ${chunk.mediaType}`);
        // Image chunk will be consumed by MessageComponent
      }
    }
  } catch (error) {
    console.error("[WS Transport] Error handling message:", error);
    controller.error(error);
  }
}
```

**Acceptance Criteria:**
- Detects data-image events
- Logs image reception
- Passes image chunks to stream
- No special handling needed (MessageComponent handles rendering)

#### Task 1D.3: Update MessageComponent to render images

**File:** `components/message.tsx`

**Implementation:**
```typescript
import { ImageDisplay } from "./image-display";

export function MessageComponent({ message }: { message: UIMessage }) {
  return (
    <div className={`message message-${message.role}`}>
      {/* Render text content */}
      {message.content && <div className="message-text">{message.content}</div>}

      {/* Render data parts (NEW) */}
      {message.data && message.data.length > 0 && (
        <div className="message-data">
          {message.data.map((dataPart, index) => {
            // Render images
            if (dataPart.type === "data-image") {
              return (
                <ImageDisplay
                  key={index}
                  data={dataPart.data}
                  mediaType={dataPart.mediaType}
                  alt={`Image ${index + 1}`}
                />
              );
            }
            return null;
          })}
        </div>
      )}

      {/* ... existing tool call rendering ... */}
    </div>
  );
}
```

**Acceptance Criteria:**
- MessageComponent renders data-image parts
- Images display inline with text
- Multiple images in one message supported
- Existing text/tool rendering unaffected

### Phase 1E: Testing and Validation

#### Task 1E.1: Backend unit tests

**File:** `tests/unit/test_image_support.py` (new file)

**Tests:**
```python
import pytest
import base64
from server import ChatMessage, ImagePart, TextPart, validate_image

def test_chat_message_with_image():
    """Test ChatMessage with image part"""
    # Create message with text and image
    message = ChatMessage(
        role="user",
        parts=[
            TextPart(type="text", text="What's in this image?"),
            ImagePart(
                type="image",
                data=base64.b64encode(b"fake_image_data").decode(),
                media_type="image/png"
            )
        ]
    )

    # Convert to ADK content
    content = message.to_adk_content()

    # Assertions
    assert len(content.parts) == 2
    assert content.parts[0].text == "What's in this image?"
    assert content.parts[1].inline_data is not None
    assert content.parts[1].inline_data.mime_type == "image/png"

def test_image_validation_size_limit():
    """Test image size validation"""
    large_image = "a" * (11 * 1024 * 1024)  # 11MB > 10MB limit

    with pytest.raises(ValueError, match="Image too large"):
        validate_image(large_image, "image/png")

def test_stream_protocol_image_output():
    """Test StreamProtocolConverter handles images"""
    # TODO: Test image event generation
    pass
```

**Acceptance Criteria:**
- Tests for ChatMessage with images
- Tests for to_adk_content() conversion
- Tests for image validation
- Tests for StreamProtocolConverter image events
- All tests pass

#### Task 1E.2: End-to-end testing with real images

**Manual Test Checklist:**

**Test 1: Upload single image**
- [ ] Click file input, select PNG image
- [ ] Image preview displays
- [ ] Type text message "What's in this image?"
- [ ] Send message
- [ ] Backend receives image part
- [ ] Agent analyzes image (Gemini vision)
- [ ] Agent response describes image content
- [ ] Response displays in UI

**Test 2: Upload multiple images**
- [ ] Select 2 images
- [ ] Both previews display
- [ ] Send message with both images
- [ ] Agent response references both images
- [ ] Images display in chat history

**Test 3: Image-only message (no text)**
- [ ] Select image without typing text
- [ ] Send image-only message
- [ ] Agent responds appropriately

**Test 4: Error handling**
- [ ] Try uploading file > 10MB → error message
- [ ] Try uploading non-image file → error message
- [ ] Try uploading unsupported format (GIF) → error message

**Test 5: Performance**
- [ ] Upload 5MB image → reasonable upload time
- [ ] Image displays without lag
- [ ] Chat remains responsive

**Test 6: Backward compatibility**
- [ ] Send text-only message → works as before
- [ ] Use tool calling → works as before
- [ ] Switch between ADK SSE and BIDI modes → both work

#### Task 1E.3: Update experiment document with results

**File:** `experiments/2025-12-11_adk_bidi_multimodal_support.md`

**Add Results Section:**
```markdown
## Results (Phase 1: Image Support)

**Implementation Date:** 2025-12-11

### What Works ✅

- Image upload via file input (PNG, JPEG, WebP)
- Image size validation (10MB limit)
- Base64 encoding/decoding
- WebSocket transmission of images
- ADK vision model processing
- Image display in chat messages
- Multiple images per message
- Backward compatibility with text-only mode

### Performance Metrics

- Image upload: ~XXXms for 5MB image
- Base64 encoding overhead: ~33% size increase
- WebSocket transmission: ~XXXms for encoded image
- Agent response time: ~XXXs for image analysis

### Limitations Discovered

- [Document any limitations found during testing]

### Future Improvements

- [ ] Image compression before upload
- [ ] Binary WebSocket frames (reduce overhead)
- [ ] Progressive image loading
- [ ] Image thumbnail generation
```

### Phase 1F: Documentation

#### Task 1F.1: Update README.md

**File:** `README.md`

**Add to "Current Status" section:**
```markdown
**Phase 3.1: Image Support** ✅ Complete
- Image upload in chat interface (PNG, JPEG, WebP)
- Image transmission via WebSocket (base64 encoded)
- ADK vision model processing (Gemini multimodal)
- Image display in chat messages
- Custom `data-image` events in AI SDK v6 protocol
- Backward compatible with text-only mode
```

#### Task 1F.2: Create architecture diagram for image flow

**File:** `README.md` or `docs/multimodal-architecture.md`

**Add diagram:**
```
Image Upload Flow (BIDI Mode with Multimodal)
==============================================

┌─────────────────────────────────────────────┐
│  Frontend (Next.js + AI SDK v6)             │
│                                             │
│  1. User selects image file                 │
│  2. ImageUpload reads as base64             │
│  3. Add to message parts:                   │
│     parts: [                                │
│       { type: "text", text: "..." },        │
│       { type: "image", data: "base64...",   │
│         media_type: "image/png" }           │
│     ]                                       │
│  4. Send via WebSocket                      │
└──────────────┬──────────────────────────────┘
               │ WebSocket
               │ JSON: { messages: [...] }
               ▼
┌─────────────────────────────────────────────┐
│  Backend (server.py)                        │
│                                             │
│  1. ChatMessage.to_adk_content():           │
│     - Decode base64 → bytes                 │
│     - Create types.Part(inline_data=        │
│         InlineData(mime_type, data))        │
│  2. live_request_queue.send_content()       │
└──────────────┬──────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────┐
│  ADK Agent (Gemini Vision)                  │
│                                             │
│  - Processes multimodal content             │
│  - Analyzes image + text                    │
│  - Generates response                       │
└──────────────┬──────────────────────────────┘
               │ ADK Events
               ▼
┌─────────────────────────────────────────────┐
│  stream_protocol.py                         │
│                                             │
│  - Detects inline_data parts                │
│  - Encodes to base64                        │
│  - Creates SSE event:                       │
│    data: {"type":"data-image",              │
│           "data":"base64...",               │
│           "mediaType":"image/png"}          │
└──────────────┬──────────────────────────────┘
               │ WebSocket
               │ SSE format
               ▼
┌─────────────────────────────────────────────┐
│  WebSocketChatTransport                     │
│                                             │
│  - Parses data-image events                 │
│  - Enqueues to stream                       │
└──────────────┬──────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────┐
│  MessageComponent + ImageDisplay            │
│                                             │
│  - Renders base64 as <img>                  │
│  - Displays inline with text                │
└─────────────────────────────────────────────┘
```

## Implementation Order (Phase 1: Image Support)

**Day 1: Backend Foundation**
1. Task 1A.1: Extend ChatMessage model
2. Task 1A.2: Extend to_adk_content()
3. Task 1A.3: Add image validation
4. Task 1B.1: Add image output handling
5. Task 1E.1: Backend unit tests

**Day 2: Frontend Components**
6. Task 1C.1: Create ImageUpload component
7. Task 1D.1: Create ImageDisplay component
8. Task 1D.2: Extend WebSocketChatTransport
9. Task 1D.3: Update MessageComponent

**Day 3: Integration & Testing**
10. Task 1C.2: Integrate ImageUpload with chat
11. Task 1E.2: End-to-end testing
12. Task 1B.2: Add logging/monitoring
13. Bug fixes from testing

**Day 4: Documentation & Polish**
14. Task 1E.3: Update experiment document
15. Task 1F.1: Update README
16. Task 1F.2: Create architecture diagram
17. Final testing and commit

## Success Criteria (Phase 1)

- [ ] User can upload images in chat UI (PNG, JPEG, WebP)
- [ ] Images validate correctly (size, type)
- [ ] Images transmit via WebSocket
- [ ] ADK agent receives and processes images
- [ ] Agent can describe image contents using Gemini vision
- [ ] Images display in chat messages
- [ ] Multiple images per message work
- [ ] No regression in text/tool functionality
- [ ] Protocol compatible with AI SDK v6 Data Stream Protocol
- [ ] All tests pass
- [ ] Documentation complete

## Notes (Phase 1)

- Use `data-image` custom events (not `file` events)
- Base64 encoding in JSON (binary frames in future phase)
- Gemini vision model automatically used when images present
- Keep existing SSE/BIDI text mode functional
- Follow TDD where possible
- Commit frequently with clear messages
- Update experiment document with findings

---

## 📊 Implementation Progress (2025-12-11)

### ✅ Day 1: Backend Foundation - COMPLETED

**Tasks Completed:**

1. ✅ **Task 1A.1**: Extended ChatMessage model (server.py:332-373)
   - Created TextPart and ImagePart Pydantic models with discriminated unions
   - Used Literal["text"] and Literal["image"] for type discrimination
   - Added MessagePart = Union[TextPart, ImagePart]

2. ✅ **Task 1A.2**: Extended to_adk_content() (server.py:395-441)
   - Modified to handle multimodal parts (text + images)
   - Converts base64-encoded images to ADK types.Blob format
   - Maintains backward compatibility with simple text messages

3. ✅ **Task 1A.3**: Added image validation (server.py:346-373)
   - Media type validation (image/png, image/jpeg, image/webp)
   - Base64 encoding validation
   - Empty data validation
   - All validation uses Pydantic field_validator decorators

4. ✅ **Task 1B.1**: Image output handling (stream_protocol.py:132-139, 226-248)
   - Added _process_inline_data_part() to StreamProtocolConverter
   - Converts ADK types.Blob to AI SDK v6 data-image custom event
   - Encodes image bytes to base64 for JSON transport
   - Added isinstance(types.Blob) check for type safety

5. ✅ **Task 1B.2**: Logging and monitoring (server.py:429-432, stream_protocol.py:233-237)
   - Added logger.info for image input processing (media_type, size)
   - Added logger.info for image output sending (media_type, size, base64 size)

6. ✅ **Task 1E.1**: Backend unit tests
   - Created tests/unit/test_image_support.py with 10 tests
   - Created 2 image output tests in tests/unit/test_stream_protocol.py
   - All 26 tests passing

**Test Results:**
```
tests/unit/test_image_support.py: 10 passed
tests/unit/test_stream_protocol.py: 16 passed (including 2 new image tests)
Total: 26 passed
```

### ✅ Day 2: Frontend Components - COMPLETED

**Tasks Completed:**

1. ✅ **Task 2.1**: WebSocketChatTransport extension (lib/websocket-chat-transport.ts:30-55)
   - Added TextPart and ImagePart interfaces
   - Defined MessagePart union type
   - Extended SendMessagesParams for image parts

2. ✅ **Task 2.2**: ImageDisplay component (components/image-display.tsx)
   - Base64 image data display
   - Data URL image rendering
   - Error handling
   - Dark theme styling

3. ✅ **Task 2.3**: MessageComponent update (components/message.tsx:117-127)
   - Added data-image part handling
   - Integrated ImageDisplay component
   - Maintains existing functionality compatibility

4. ✅ **Task 2.4**: ImageUpload component (components/image-upload.tsx)
   - File selection UI
   - Image validation (format, size)
   - Base64 encoding
   - Preview display
   - Remove functionality

5. ✅ **Task 2.5**: Chat interface integration (app/page.tsx)
   - Added ImageUpload component
   - Image state management
   - Multimodal message sending logic
   - Post-send cleanup

**Implementation Features:**
- Type safety: Complete TypeScript type definitions
- Validation: PNG, JPEG, WebP support; 5MB max file size; Base64 validation
- UX: Real-time preview, loading states, error messages
- Backward compatibility: Text-only messages still work

### 🔄 Day 3: Integration & Testing - IN PROGRESS

**Next Steps:**
- [ ] Start backend and frontend servers
- [ ] Manual integration testing with real images
- [ ] Verify end-to-end image upload and display
- [ ] Test with ADK BIDI mode (WebSocket)
- [ ] Bug fixes if needed

**Testing Plan:**
1. Upload PNG/JPEG/WebP images
2. Send text + image multimodal messages
3. Verify image display in chat
4. Test error cases (invalid format, too large)
5. Verify backend logging shows image processing

### 📋 Remaining Tasks

**Day 3:**
- Task 1E.2: End-to-end testing
- Bug fixes from testing

**Day 4:**
- Task 1E.3: Update experiment document
- Task 1F.1: Update README
- Task 1F.2: Create architecture diagram
- Final testing and commit

---

## 🚨 Current Issues and Remaining Tasks (2025-12-11 Updated)

### ✅ RESOLVED: AI SDK v6 Endpoint Switching Bug

**Problem:** AI SDK v6 `useChat` hook's `api` option completely non-functional - all requests went to first endpoint

**Solution Implemented:** Manual `DefaultChatTransport` creation with `prepareSendMessagesRequest` callback
- File: `lib/build-use-chat-options.ts`
- Commits: `ee4784a`, `8bea94e`, `15044d7`
- Documentation: `experiments/2025-12-11_e2e_test_timeout_investigation.md` (lines 515-690)

**Verification:**
- ✅ Gemini Direct → `POST /api/chat` (200 OK)
- ✅ ADK SSE → `POST http://localhost:8000/stream` (200 OK)
- ✅ Component consolidation (3 separate → 1 unified)

**Status:** 🟢 COMPLETE - No further action needed

---

### 🔧 PRIORITY 1: Gemini Model Name Configuration

**Issue:** Model `gemini-2.5-flash-native-audio-preview-09-2025` not found (404 NOT_FOUND)

**Impact:**
- ❌ Gemini Direct mode fails
- ❌ ADK SSE/BIDI modes fail (backend uses same model)

**Root Cause:** Model name no longer valid or requires different API version

**Required Actions:**

1. **Research correct model name:**
   - Reference: https://google.github.io/adk-docs/streaming/dev-guide/part4/#streamingmode-bidi-or-sse
   - Check ADK documentation for SSE/BIDI recommended models
   - Verify model availability in API version v1beta

2. **Update model names in:**
   - `server.py` - ADK backend agent configuration
   - `app/api/chat/route.ts` - Gemini Direct mode

3. **Recommended models to try:**
   - For SSE: `gemini-2.0-flash-exp` (text + vision)
   - For BIDI audio: `gemini-2.0-flash-exp` with AUDIO response modality
   - Fallback: `gemini-1.5-flash` (stable)

**Files to Update:**
```
server.py:272-278          # Agent model configuration
app/api/chat/route.ts:X    # Gemini Direct model (need to locate)
```

**Testing Requirements:**
- [ ] Gemini Direct mode works with new model
- [ ] ADK SSE mode works with new model
- [ ] ADK BIDI mode works with new model
- [ ] Image upload still works (vision capability)
- [ ] Tool calling still works

**Priority:** 🔴 HIGH - Blocks all functionality

---

### ⏱️ PRIORITY 2: WebSocket Timeout Investigation

**Issue:** WebSocket connection closes with "Deadline expired" error after successful PCM streaming

**Context:**
- 35 PCM audio chunks (111,360 bytes) sent successfully
- Connection closes before completion
- Error: `received 1011 (internal error) Deadline expired before operation could complete`

**Evidence:**
```
Connection closed: received 1011 (internal error) Deadline expired before operation could complete.
```

**Hypothesis:** ADK Live API deadline setting too short for audio streaming

**Required Investigation:**

1. **Check ADK deadline configuration:**
   - File: `server.py`
   - Look for timeout/deadline parameters in:
     - `run_live()` configuration
     - `RunConfig` parameters
     - WebSocket connection settings
     - ADK session configuration

2. **Review ADK documentation:**
   - ADK Live API timeout/deadline docs
   - Default timeout values
   - Recommended settings for audio streaming
   - Session keep-alive mechanisms

3. **Identify timeout location:**
   ```python
   # Potential locations in server.py
   run_config = RunConfig(...)  # Check for deadline parameter
   live_events = agent_runner.run_live(...)  # Check for timeout
   await websocket.accept()  # WebSocket settings
   ```

4. **Test fixes:**
   - Increase deadline/timeout value
   - Add keep-alive mechanism
   - Verify connection stability with longer sessions

**Files to Investigate:**
```
server.py:469-578          # WebSocket /live endpoint
server.py:220-289          # Agent configuration
```

**Testing Requirements:**
- [ ] WebSocket connection stays open during full audio stream
- [ ] No deadline expiry errors
- [ ] Graceful connection close after completion
- [ ] Works with both short and long audio streams

**Priority:** 🟡 MEDIUM - Affects ADK BIDI mode audio streaming

---

### 📋 PRIORITY 3: Multimodal Support - Complete Integration Testing

**Status:** Day 2 frontend implementation complete, Day 3 integration testing pending

**Completed:**
- ✅ Backend image input/output support
- ✅ Frontend ImageUpload component
- ✅ Frontend ImageDisplay component
- ✅ MessageComponent integration
- ✅ WebSocketChatTransport image event handling
- ✅ Backend unit tests (26 passed)

**Remaining Tasks:**

**Task 1E.2: End-to-end testing with real images**

Manual Test Checklist:

**Test 1: Upload single image**
- [ ] Click file input, select PNG image
- [ ] Image preview displays
- [ ] Type text message "What's in this image?"
- [ ] Send message
- [ ] Backend receives image part (check logs)
- [ ] Agent analyzes image (Gemini vision)
- [ ] Agent response describes image content
- [ ] Response displays in UI

**Test 2: Upload multiple images**
- [ ] Select 2 images
- [ ] Both previews display
- [ ] Send message with both images
- [ ] Agent response references both images
- [ ] Images display in chat history

**Test 3: Image-only message (no text)**
- [ ] Select image without typing text
- [ ] Send image-only message
- [ ] Agent responds appropriately

**Test 4: Error handling**
- [ ] Try uploading file > 5MB → error message
- [ ] Try uploading non-image file → error message
- [ ] Try uploading unsupported format → error message

**Test 5: Backend mode switching**
- [ ] Test in Gemini Direct mode
- [ ] Test in ADK SSE mode
- [ ] Test in ADK BIDI mode
- [ ] All modes handle images correctly

**Test 6: Backward compatibility**
- [ ] Send text-only message → works as before
- [ ] Use tool calling → works as before

**Prerequisites:**
- ⚠️ BLOCKED by Gemini model name fix (need vision-capable model)
- Server and frontend must be running
- Valid Gemini API key required

**Priority:** 🟢 LOW - Feature addition (not blocking existing functionality)

---

### 📝 PRIORITY 4: Documentation Updates

**Task 1E.3: Update experiment document**
- File: `experiments/2025-12-11_adk_bidi_multimodal_support.md`
- Add: Results section with test outcomes
- Add: Performance metrics
- Add: Limitations discovered
- Status: Pending integration testing

**Task 1F.1: Update README.md**
- Add: Image support to Current Status section
- Add: Usage instructions for image upload
- Add: Troubleshooting section
- Status: Pending integration testing

**Task 1F.2: Create architecture diagram**
- Add: Image upload flow diagram
- Add: Data format transformations
- Location: README.md or docs/multimodal-architecture.md
- Status: Pending integration testing

**Priority:** 🟢 LOW - Documentation (defer until features working)

---

## Recommended Implementation Order

**Phase 1: Unblock Current Functionality** 🔴
1. Fix Gemini model name (PRIORITY 1)
   - Research correct model name from ADK docs
   - Update server.py and app/api/chat/route.ts
   - Test all 3 backend modes

**Phase 2: Stability Improvements** 🟡
2. Investigate WebSocket timeout (PRIORITY 2)
   - Find ADK deadline configuration
   - Increase timeout for audio streaming
   - Test with long sessions

**Phase 3: Feature Completion** 🟢
3. Complete multimodal integration testing (PRIORITY 3)
   - Run manual test checklist
   - Fix bugs discovered during testing
   - Update experiment document

4. Update documentation (PRIORITY 4)
   - Add results to experiment notes
   - Update README with new features
   - Create architecture diagrams

---

## Quick Reference: Current System State

**Working:**
- ✅ AI SDK v6 endpoint switching (fixed with manual transport)
- ✅ Backend WebSocket infrastructure (/live endpoint)
- ✅ Frontend WebSocketChatTransport
- ✅ Backend image input/output support (code complete)
- ✅ Frontend image upload/display (code complete)
- ✅ Tool calling in all modes
- ✅ Text streaming in all modes

**Broken:**
- ❌ All modes (model name error blocks everything)
- ❌ ADK BIDI audio streaming (WebSocket timeout)

**Untested:**
- ⚠️ End-to-end image upload (blocked by model name)
- ⚠️ Image display in chat messages (blocked by model name)
- ⚠️ Multi-image messages (blocked by model name)

**Next Immediate Action:** Fix Gemini model name to unblock all functionality
