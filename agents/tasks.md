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
