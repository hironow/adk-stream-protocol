# ADK-AI Data Protocol - Implementation Tasks

**Project Goal:** Demonstrate integration between AI SDK v6 (frontend) and Google ADK (backend) with progressive implementation of data stream protocols.

**Last Updated:** 2025-12-10 (after Phase 4 WebSocket integration completion)

---

## Phase 1: Independent Operation ✅ COMPLETED

**Objective:** Verify both frontend and backend can operate independently.

### Tasks
- [x] Setup Python 3.13 environment with uv
- [x] Setup Next.js 15 + React 19 environment with pnpm
- [x] Install dependencies (FastAPI, Pydantic, AI SDK v6)
- [x] Create justfile for task automation
- [x] Implement backend server with FastAPI
  - [x] Root endpoint (`/`)
  - [x] Health check endpoint (`/health`)
  - [x] Simple echo chat endpoint (`/chat`)
- [x] Implement frontend with Next.js App Router
  - [x] Chat UI with `useChat` hook
  - [x] API route connecting to Gemini directly
  - [x] Streaming support
- [x] Verify both work independently

### Files Created
- `server.py` - FastAPI backend
- `app/layout.tsx` - Next.js layout
- `app/page.tsx` - Chat UI with AI SDK v6 (fixed for v6 compatibility)
- `app/api/chat/route.ts` - API route handler with convertToModelMessages
- `app/api/config/route.ts` - Backend configuration API
- `app/globals.css` - Global styles
- `justfile` - Task automation
- `next.config.ts` - Next.js config
- `tsconfig.json` - TypeScript config
- `.gitignore` - Git ignore patterns
- `.env.example` - Environment variable template
- `.env.local` - Local environment configuration

### Testing
- ✅ Backend endpoints tested with curl
- ✅ Frontend UI functional with Gemini streaming
- ✅ AI SDK v6 Data Stream Protocol working (SSE format)
- ✅ Message display with `message.parts` structure
- ✅ `useChat` with `sendMessage({ text })` API

### Additional Achievements
- ✅ Debugged and fixed all AI SDK v6 breaking changes
- ✅ Documented migration issues in README.md
- ✅ Verified SSE streaming works end-to-end with Gemini

---

## Phase 2: JSONRPC Integration with ADK LLM ✅ COMPLETED

**Objective:** Implement JSONRPC 2.0 protocol for non-streaming communication between frontend and ADK backend with actual LLM integration.

### Tasks
- [x] Design JSONRPC 2.0 protocol with Pydantic models
  - [x] `JSONRPCRequest`
  - [x] `JSONRPCResponse`
  - [x] `JSONRPCError`
- [x] Implement `/jsonrpc` endpoint in backend
  - [x] Handle `chat` method
  - [x] Error handling (Method not found, Invalid params, Internal error)
- [x] Update frontend API route for multi-backend support
  - [x] `gemini` mode (Phase 1)
  - [x] `adk-jsonrpc` mode (Phase 2)
  - [x] Environment variable configuration
- [x] Add backend configuration API (`/api/config`)
- [x] Update UI to display current backend mode
- [x] Test JSONRPC integration end-to-end
- [x] **Integrate actual ADK LLM into backend**
  - [x] Research ADK official examples and documentation
  - [x] Implement ADK Agent with InMemoryRunner
  - [x] Configure API keys correctly (GOOGLE_API_KEY for ADK)
  - [x] Test standalone ADK backend with real LLM responses

### Files Modified/Created
- `server.py` - Added JSONRPC models, endpoint, **and ADK LLM integration**
  - Added ADK Agent with InMemoryRunner
  - Implemented session management
  - Replaced echo responses with actual LLM calls
- `app/api/chat/route.ts` - Multi-backend mode support
- `app/api/config/route.ts` - Configuration API (new)
- `app/page.tsx` - Backend mode display
- `.env.example` - Added backend mode configuration **and ADK API keys**
  - `GOOGLE_API_KEY` for ADK
  - `GOOGLE_GENERATIVE_AI_API_KEY` for AI SDK
  - `GOOGLE_GENAI_USE_VERTEXAI=0` for Google AI Studio
- `.env.local` - Local environment variables (new)

### Testing
- ✅ JSONRPC endpoint tested with curl **with actual LLM responses**
- ✅ `/chat` endpoint tested with actual LLM responses
- ✅ Error cases validated (unknown method, missing params)
- ✅ Frontend-backend integration working
- ✅ **ADK backend standalone functionality verified**
  - Test: "What is 2 plus 2" → Response: "2 + 2 = 4"
  - Test: "Tell me a very short joke" → Response: Actual joke from Gemini

### Key Learnings
- **API Key Environment Variables**: ADK uses `GOOGLE_API_KEY`, while AI SDK v6 uses `GOOGLE_GENERATIVE_AI_API_KEY`
- **ADK Configuration**: Set `GOOGLE_GENAI_USE_VERTEXAI=0` to use Google AI Studio instead of Vertex AI
- **InMemoryRunner**: Simplest way to programmatically invoke ADK agents
- **Session Management**: ADK requires session creation before running agents
- **Official Examples**: ADK quickstart guide provides reliable integration patterns

---

## Phase 3: SSE Streaming ✅ COMPLETED

**Objective:** Implement Server-Sent Events (SSE) streaming with AI SDK data stream protocol.

### Tasks

**Frontend (✅ Already completed in Phase 1):**
- [x] Research AI SDK v6 data stream protocol format
  - [x] Message types and structure (documented in README.md)
  - [x] Token streaming format (SSE with text-delta events)
  - [x] Error handling in streams
- [x] Update frontend API route for SSE mode
  - [x] Using `toUIMessageStreamResponse()` for Data Stream Protocol
  - [x] Handle SSE connection and parsing (handled by AI SDK v6)
  - [x] Convert messages with `convertToModelMessages()`
- [x] Update UI for streaming visualization
  - [x] Real-time token display with `message.parts`
  - [x] Loading states with `status` enum
- [x] Test SSE streaming end-to-end (working with Gemini)

**Backend (✅ Completed):**
- [x] Implement SSE endpoint in backend (`/stream`)
  - [x] AI SDK compatible event format
  - [x] Token-by-token streaming
  - [x] Proper SSE headers and connection handling
- [x] Integrate with ADK LLM capabilities
  - [x] Connect to actual LLM (Gemini via ADK)
  - [x] Stream tokens as they're generated using `run_async()`
- [x] Add `adk-sse` backend mode to API route
- [x] Test ADK backend SSE streaming end-to-end

### Files Modified
- `server.py` - Added `/stream` endpoint with `stream_agent_chat()` function
- `app/api/chat/route.ts` - Added `adk-sse` mode support
- `.env.example` - Documented SSE mode

### Implementation Details

**Backend SSE Implementation:**
```python
async def stream_agent_chat(user_message: str, user_id: str = "default_user"):
    """Stream ADK agent responses as SSE events in AI SDK v6 format."""
    session = await get_or_create_session(user_id)
    message_content = types.Content(role="user", parts=[types.Part(text=user_message)])

    text_id = "0"
    has_started = False

    async for event in agent_runner.run_async(
        user_id=user_id,
        session_id=session.id,
        new_message=message_content,
    ):
        if event.content and event.content.parts:
            for part in event.content.parts:
                if hasattr(part, 'text') and part.text:
                    if not has_started:
                        yield f'data: {json.dumps({"type": "text-start", "id": text_id})}\n\n'
                        has_started = True
                    yield f'data: {json.dumps({"type": "text-delta", "id": text_id, "delta": part.text})}\n\n'

    if has_started:
        yield f'data: {json.dumps({"type": "text-end", "id": text_id})}\n\n'
    yield f'data: {json.dumps({"type": "finish", "finishReason": "stop"})}\n\n'
    yield 'data: [DONE]\n\n'
```

**Testing Results:**
- ✅ Backend `/stream` endpoint tested with curl
- ✅ Frontend-to-backend SSE streaming working
- ✅ AI SDK v6 Data Stream Protocol format verified
- ✅ Real-time token display in UI

### Key Learnings
- **ADK `run_async()` method**: Used for unidirectional streaming (SSE)
- **SSE Event Format**: Matches AI SDK v6 protocol (`text-start`, `text-delta`, `text-end`, `finish`)
- **FastAPI StreamingResponse**: Proper headers required (`Cache-Control: no-cache`, `Connection: keep-alive`)
- **Event Streaming Pattern**: ADK events converted to AI SDK SSE format on-the-fly

---

## ADK Real-time Capabilities Research 📚

**Research Date:** 2025-12-10
**Objective:** Investigate ADK Python SDK's latest real-time communication capabilities for WebSocket and bidirectional streaming implementation.

### ADK Streaming Methods Comparison

| Method | Protocol | Direction | Use Case | Phase |
|--------|----------|-----------|----------|-------|
| `run_async()` | SSE | Unidirectional (server→client) | Token streaming, real-time responses | ✅ Phase 3 |
| `run_live()` | WebSocket | Bidirectional (server↔client) | Interactive conversations, interruptions | 📋 Phase 4/5 |

### Key Technical Findings

**1. `run_live()` Method - Bidirectional WebSocket Streaming**

```python
async def run_live(
    self,
    user_id: str,
    session_id: str,
    request_queue: LiveRequestQueue,
) -> AsyncIterator[LiveEvent]:
    """
    Run agent with bidirectional streaming over WebSocket.

    Args:
        user_id: User identifier
        session_id: Session identifier
        request_queue: Queue for incoming messages from client

    Yields:
        LiveEvent: Streaming events from agent
    """
```

**2. LiveRequestQueue - Message Buffering**

- Manages incoming messages from client during streaming
- Supports user interruptions of agent responses
- Thread-safe message queuing
- Required for bidirectional communication

**3. Dual-Task Concurrent Pattern**

```python
async def websocket_handler(websocket: WebSocket):
    request_queue = LiveRequestQueue()

    # Task 1: Upstream - Receive messages from client
    async def upstream():
        async for message in websocket.receive_text():
            await request_queue.put(message)

    # Task 2: Downstream - Send agent responses to client
    async def downstream():
        async for event in agent_runner.run_live(
            user_id=user_id,
            session_id=session_id,
            request_queue=request_queue,
        ):
            await websocket.send_text(event.to_json())

    # Run both tasks concurrently
    await asyncio.gather(upstream(), downstream())
```

**4. Streaming Session Lifecycle**

1. **Connection**: WebSocket connection established
2. **Session Creation**: Get or create ADK session
3. **Concurrent Tasks**: Launch upstream (receive) and downstream (send) tasks
4. **Message Flow**: Bidirectional message exchange
5. **Interruption Support**: Client can interrupt agent mid-response
6. **Termination**: Clean session closure

**5. Multimodal Support**

- Text streaming (implemented in Phase 3)
- Audio streaming (future capability)
- Video streaming (future capability)
- Combined multimodal streams

### Implementation Architecture for Phase 4/5

**Backend WebSocket Endpoint:**
```python
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()

    user_id = "default_user"  # From auth in production
    session = await get_or_create_session(user_id)
    request_queue = LiveRequestQueue()

    async def upstream():
        """Receive messages from client"""
        try:
            while True:
                data = await websocket.receive_text()
                await request_queue.put(data)
        except WebSocketDisconnect:
            await request_queue.close()

    async def downstream():
        """Send agent responses to client"""
        try:
            async for event in agent_runner.run_live(
                user_id=user_id,
                session_id=session.id,
                request_queue=request_queue,
            ):
                # Convert ADK LiveEvent to AI SDK format
                formatted_event = format_live_event(event)
                await websocket.send_json(formatted_event)
        except Exception as e:
            logger.error(f"Downstream error: {e}")

    await asyncio.gather(upstream(), downstream())
```

**Frontend WebSocket Client:**
```typescript
const ws = new WebSocket('ws://localhost:8000/ws');

ws.onopen = () => {
  ws.send(JSON.stringify({ text: "Hello" }));
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  // Handle streaming event
};

// Support interruption
function interruptAgent() {
  ws.send(JSON.stringify({ type: "interrupt" }));
}
```

### Resources
- **ADK Official Docs**: https://google.github.io/adk-docs/
- **Gemini Live API**: WebSocket-based real-time API
- **FastAPI WebSocket**: https://fastapi.tiangolo.com/advanced/websockets/
- **AI SDK v6**: WebSocket support investigation needed

### Next Steps for Implementation
1. Research AI SDK v6 WebSocket/bidirectional streaming support
2. Implement `/ws` WebSocket endpoint in FastAPI with `run_live()`
3. Create LiveRequestQueue integration
4. Implement dual-task pattern (upstream/downstream)
5. Build frontend WebSocket client
6. Add interruption support
7. Test bidirectional streaming end-to-end

---

## Phase 4: WebSocket Integration ✅ COMPLETED

**Objective:** Implement bidirectional communication via WebSocket using ADK's `run_async()` method.

### Tasks
- [x] Research AI SDK v6 WebSocket/bidirectional streaming support
  - **Finding**: AI SDK v6 has no built-in WebSocket support
  - **Solution**: Implemented custom WebSocket client
- [x] Implement WebSocket endpoint in backend (`/ws`)
  - [x] WebSocket connection handling with FastAPI
  - [x] Integrated ADK `run_async()` method (run_live() for future Phase 5)
  - [x] Session management for WebSocket connections
  - [x] Event format compatible with AI SDK patterns
- [x] Update frontend for WebSocket mode
  - [x] Custom WebSocket client implementation
  - [x] Bidirectional message handling
  - [x] Connection state management (connected/disconnected indicator)
  - [x] Real-time message streaming
- [x] Test WebSocket integration end-to-end
  - [x] WebSocket endpoint responds correctly
  - [x] Frontend connects and displays WebSocket status
  - [x] Message format compatible with streaming protocol

### Implementation Details

**Backend WebSocket Endpoint (`server.py`):**
```python
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for bidirectional streaming (Phase 4)"""
    await websocket.accept()
    user_id = "default_user"
    session = await get_or_create_session(user_id)

    # Process messages using ADK run_async
    # Stream response back to client via WebSocket
    # Event format: message-start, text-start, text-delta, text-end, finish
```

**Frontend WebSocket Client (`app/page.tsx`):**
- Conditional rendering based on `BACKEND_MODE=adk-websocket`
- Custom WebSocket connection management
- Real-time streaming message display
- Connection status indicator
- Compatible with existing UI (shares same message display logic)

**Key Learnings:**
- **AI SDK v6 Limitation**: No built-in WebSocket/bidirectional streaming support
- **Custom Implementation**: Successfully implemented custom WebSocket layer
- **Event Format**: Uses same event structure as SSE (`text-start`, `text-delta`, etc.)
- **State Management**: Manual WebSocket state management required (vs useChat hook)
- **Run Method**: Currently uses `run_async()` - can upgrade to `run_live()` for true bidirectional in Phase 5

### Files Modified
- `server.py` - Added WebSocket endpoint `/ws`
- `app/page.tsx` - Added custom WebSocket client with conditional rendering
- `.env.example` - Added `adk-websocket` mode documentation

---

## Phase 5: Full Bidirectional Streaming with Interruption 📋 PLANNED

**Objective:** Advanced streaming scenarios with interruption support and multimodal capabilities.

### Tasks
- [ ] Implement user interruption of agent responses
  - [ ] Send interrupt signal via WebSocket
  - [ ] Handle interruption in ADK agent
  - [ ] Clean state management after interruption
- [ ] Add frontend controls for interruption
  - [ ] "Stop" button during agent response
  - [ ] Visual feedback for interruption state
- [ ] Implement advanced streaming patterns
  - [ ] Message queuing and prioritization
  - [ ] Retry logic for connection failures
  - [ ] Graceful degradation (WebSocket → SSE → JSONRPC)
- [ ] Performance optimization
  - [ ] Connection pooling
  - [ ] Message batching where appropriate
  - [ ] Memory management for long sessions
- [ ] Load testing
  - [ ] Concurrent WebSocket connections
  - [ ] Message throughput testing
  - [ ] Latency measurements

### Future Capabilities (Multimodal)
- [ ] Audio streaming integration
- [ ] Video streaming integration
- [ ] Combined text + audio + video streams

---

## Current Status Summary

| Phase | Status | Completion Date |
|-------|--------|-----------------|
| Phase 1: Independent Operation | ✅ Completed | 2025-12-10 |
| Phase 2: JSONRPC + ADK LLM | ✅ Completed | 2025-12-10 |
| Phase 3: SSE Streaming | ✅ Completed | 2025-12-10 |
| ADK Research: Real-time Capabilities | ✅ Completed | 2025-12-10 |
| Phase 4: WebSocket Integration | ✅ Completed | 2025-12-10 |
| Phase 5: Bidirectional Streaming + Interruption | 📋 Planned | - |

---

## Next Immediate Steps

### Current State
- ✅ Frontend is fully functional with AI SDK v6 Data Stream Protocol
- ✅ Gemini Direct mode working with SSE streaming
- ✅ All AI SDK v6 migration issues resolved and documented
- ✅ **ADK backend integrated with actual LLM (InMemoryRunner + Agent)**
- ✅ **All endpoints working: `/chat`, `/jsonrpc`, `/stream`**
- ✅ **Phase 3 SSE streaming completed and tested**
- ✅ **ADK real-time capabilities researched (`run_async()` vs `run_live()`)**
- ⏳ Next: Implement Phase 4 WebSocket bidirectional streaming

### Phase 4: WebSocket Bidirectional Streaming with ADK

1. **Research AI SDK v6 WebSocket Support**
   - Investigate if AI SDK v6 has built-in WebSocket/bidirectional streaming
   - Check for existing examples or patterns
   - Determine if custom implementation needed

2. **Implement WebSocket Endpoint in FastAPI** (`/ws`)
   - Use FastAPI WebSocket support
   - Integrate ADK's `run_live()` method (not `run_async()`)
   - Implement LiveRequestQueue for message buffering
   - Dual-task concurrent pattern (upstream + downstream)
   - Proper connection lifecycle management

3. **Build Frontend WebSocket Client**
   - Create WebSocket connection to `/ws` endpoint
   - Handle bidirectional message flow
   - Connection state management (connecting, open, closed)
   - Error handling and reconnection logic

4. **Event Format Conversion**
   - Convert ADK `LiveEvent` to AI SDK compatible format
   - Support text streaming (audio/video for future phases)
   - Handle special events (interruption, errors, completion)

5. **End-to-End Testing**
   - Test WebSocket connection establishment
   - Test bidirectional message exchange
   - Test connection error handling
   - Compare with SSE streaming behavior

---

## Development Guidelines

- Follow TDD approach where applicable
- Keep commits small and focused
- Update this file as tasks progress
- Document any blockers or decisions in this file
- Run `just check` before committing

## Testing Commands

```bash
# Phase 1: Gemini Direct (✅ Working)
echo 'BACKEND_MODE=gemini' > .env.local
pnpm dev

# Phase 2: JSONRPC (✅ Working)
echo 'BACKEND_MODE=adk-jsonrpc' > .env.local
just dev

# Phase 3: SSE Streaming (✅ Working)
echo 'BACKEND_MODE=adk-sse' > .env.local
just dev

# Phase 4: WebSocket (📋 Planned)
echo 'BACKEND_MODE=adk-websocket' > .env.local
just dev

# Test backend directly
curl http://localhost:8000/
curl http://localhost:8000/health

# Test JSONRPC endpoint
curl -X POST http://localhost:8000/jsonrpc \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"chat","params":{"messages":[{"role":"user","content":"Hello"}]},"id":1}'

# Test SSE streaming endpoint
curl -N -X POST http://localhost:8000/stream \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Tell me a joke"}]}'

# Test WebSocket endpoint (when implemented)
# wscat -c ws://localhost:8000/ws
```

---

## Notes

- All backend code should use Python 3.13+ with type hints
- All frontend code should use TypeScript with strict mode
- Use Pydantic for data validation on backend
- Use AI SDK v6 types on frontend
- Keep streaming protocols separate and configurable

### AI SDK v6 Lessons Learned

During Phase 1 implementation, we encountered several AI SDK v6 breaking changes not clearly documented:

1. **useChat Hook Changes**:
   - No longer provides `input`, `handleInputChange`, `handleSubmit`
   - Must manage input state manually with `useState`
   - `sendMessage({ text: input })` requires object parameter, not string
   - `isLoading` replaced with `status` enum

2. **Message Display**:
   - `message.content` doesn't exist in v6
   - Must use `message.parts` array instead
   - Each part has `type` and content (e.g., `part.text` for text parts)

3. **Route Handler Requirements**:
   - Must import `convertToModelMessages` from "ai"
   - UIMessage[] must be converted before passing to `streamText`
   - Type annotations important: `{ messages }: { messages: UIMessage[] }`

4. **Streaming Response**:
   - `toDataStreamResponse()` doesn't work as expected
   - Use `toUIMessageStreamResponse()` for Data Stream Protocol
   - This enables SSE format with structured message parts

5. **Debugging**:
   - Next.js caching can hide changes - use `rm -rf .next` when needed
   - Test API with curl to isolate frontend/backend issues
   - Check server logs, not just browser console

See README.md "AI SDK v6 Migration Notes" section for complete details.
