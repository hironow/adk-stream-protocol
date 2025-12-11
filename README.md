# ADK-AI Data Protocol

AI SDK v6 and Google ADK integration example demonstrating SSE streaming implementation.

## Project Overview

This project demonstrates the integration between:
- **Frontend**: Next.js 15 with AI SDK v6 beta
- **Backend**: Google ADK with FastAPI

The project provides **three streaming modes** with real-time mode switching:

1. **Gemini Direct** - Direct Gemini API via AI SDK
2. **ADK SSE** - ADK backend with Server-Sent Events
3. **ADK BIDI** ⚡ - ADK backend with WebSocket bidirectional streaming

## Core Architecture

**Key Insight:** All three modes use the same **AI SDK v6 Data Stream Protocol** format for communication, ensuring consistent frontend behavior regardless of backend implementation.

### Protocol Flow

```
┌─────────────────┐
│  Gemini Direct  │  AI SDK v6 → Gemini API → AI SDK v6 Data Stream Protocol → HTTP SSE
└─────────────────┘

┌─────────────────┐
│    ADK SSE      │  ADK Events → StreamProtocolConverter → AI SDK v6 Data Stream Protocol → HTTP SSE
└─────────────────┘

┌─────────────────┐
│   ADK BIDI      │  ADK Events → StreamProtocolConverter → AI SDK v6 Data Stream Protocol → WebSocket
└─────────────────┘                                         (SSE format over WebSocket)
```

### StreamProtocolConverter: The Heart of Integration

**Location:** `stream_protocol.py`

**Purpose:** Convert ADK-specific event formats to AI SDK v6 Data Stream Protocol

**Usage:** Both ADK SSE and ADK BIDI modes use the **same converter**

**Key Events:**
- Text streaming: `text-start`, `text-delta`, `text-end`
- Reasoning/Thinking: `reasoning-start`, `reasoning-delta`, `reasoning-end` (Gemini 2.0)
- Tool calls: `tool-call-start`, `tool-call-delta`, `tool-call-available`
- Tool results: `tool-result-start`, `tool-result-delta`, `tool-result-available`
- Audio (BIDI): `data-pcm` (PCM audio streaming)
- Images: `data` events with base64-encoded images

### Transport Layer Differences

**HTTP SSE (Gemini Direct / ADK SSE):**
- Standard Server-Sent Events over HTTP
- Browser `EventSource` API automatically parses SSE format
- AI SDK v6 built-in support via `streamText()`

**WebSocket (ADK BIDI):**
- Real-time bidirectional communication
- Backend sends **SSE format over WebSocket** (not raw JSON)
  - Format: `data: {"type":"text-delta","text":"..."}\n\n`
  - Same format as HTTP SSE, just delivered via WebSocket
- Custom `WebSocketChatTransport` (frontend):
  - Parses SSE format from WebSocket messages
  - Converts to `ReadableStream<UIMessageChunk>`
  - Makes WebSocket transparent to `useChat` hook

**Why SSE format over WebSocket?**
- **Protocol reuse:** Same `StreamProtocolConverter` works for both modes
- **Compatibility:** AI SDK v6 expects Data Stream Protocol format
- **Simplicity:** No need to maintain two different protocol implementations

### Frontend Transparency

```typescript
// Frontend code is identical for all modes:
const { messages, input, handleSubmit } = useChat({
  api: selectedMode === 'bidi' ? undefined : '/api/chat',
  experimental_transform: selectedMode === 'bidi'
    ? webSocketTransportRef.current
    : undefined,
});
```

The `useChat` hook receives the same `UIMessageChunk` stream regardless of:
- Backend implementation (Gemini Direct vs ADK)
- Streaming mode (SSE vs BIDI)
- Transport layer (HTTP SSE vs WebSocket)

## Current Status

**Phase 1: Gemini Direct** ✅ Production Ready
- Frontend: Next.js app with AI SDK v6 using `useChat` hook
- Direct connection to Gemini API (no backend needed)
- Built-in AI SDK v6 streaming support
- Tool calling: `get_weather`, `calculate`, `get_current_time`

**Phase 2: ADK SSE Streaming** ✅ Production Ready
- Backend: FastAPI server with Google ADK integration
- SSE streaming endpoint (`/stream`) using ADK's `run_async()`
- Full AI SDK v6 Data Stream Protocol compatibility
- Real-time token-by-token streaming
- Tool calling via ADK agent

**Phase 3: ADK BIDI Streaming** ✅ **NEW** - Experimental
- Backend: WebSocket endpoint (`/live`) using ADK's `run_live()`
- Bidirectional streaming via WebSocket
- Custom `WebSocketChatTransport` for AI SDK v6 `useChat`
- Enables real-time voice agent capabilities
- Same tool calling support as SSE mode
- **Architecture:** "SSE format over WebSocket" (100% protocol reuse)

## Experimental Code

Experimental implementations are archived in `experiments/`:
- `experiments/phase2-jsonrpc/` - JSONRPC integration (non-streaming)
- `experiments/phase4-websocket/` - WebSocket bidirectional communication

See README files in each directory for details and why they weren't adopted.

## Tech Stack

### Frontend
- Next.js 15 (App Router)
- React 19
- AI SDK v6 beta (`ai`, `@ai-sdk/react`, `@ai-sdk/google`)
- TypeScript 5.7

### Backend
- Python 3.13
- Google ADK >=1.20.0
- FastAPI >=0.115.0
- Pydantic v2
- Uvicorn (ASGI server)

## Setup

### Prerequisites
- Python 3.13+
- Node.js 18+
- pnpm (for Node.js packages)
- uv (for Python packages)
- just (for task automation)

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   just install
   ```
   Or manually:
   ```bash
   uv sync
   pnpm install
   ```

3. Set up environment variables:
   ```bash
   cp .env.example .env.local
   ```
   Then edit `.env.local`:

   **For Phase 1 (Gemini Direct):**
   ```
   GOOGLE_GENERATIVE_AI_API_KEY=your_api_key_here
   BACKEND_MODE=gemini
   NEXT_PUBLIC_BACKEND_MODE=gemini
   ```

   **For Phase 2 (ADK SSE - FINAL):**
   ```
   GOOGLE_API_KEY=your_api_key_here
   BACKEND_MODE=adk-sse
   NEXT_PUBLIC_BACKEND_MODE=adk-sse
   ADK_BACKEND_URL=http://localhost:8000
   NEXT_PUBLIC_ADK_BACKEND_URL=http://localhost:8000
   ```

   Note: Phase 2 does NOT require `GOOGLE_GENERATIVE_AI_API_KEY` (ADK uses `GOOGLE_API_KEY`).

## Running the Project

### Phase 1: Gemini Direct

**Run frontend only:**
```bash
pnpm dev
```

Frontend will be available at: http://localhost:3000

### Phase 2: ADK SSE Streaming

**Run backend server:**
```bash
just server
# or
uv run uvicorn server:app --reload --host 0.0.0.0 --port 8000
```

Backend will be available at: http://localhost:8000

**Test backend:**
```bash
curl http://localhost:8000/
curl http://localhost:8000/health
```

**Run frontend:**
```bash
pnpm dev
```

**Run both concurrently:**
```bash
just dev
```

## Project Structure

```
adk-ai-data-protocol/
├── app/                    # Next.js App Router
│   ├── api/
│   │   ├── chat/
│   │   │   └── route.ts   # AI SDK v6 Route Handler
│   │   └── config/
│   │       └── route.ts   # Backend configuration API
│   ├── layout.tsx         # Root layout
│   ├── page.tsx           # Main chat UI
│   └── globals.css        # Global styles
├── experiments/           # Archived experimental code
│   ├── phase2-jsonrpc/    # JSONRPC integration
│   └── phase4-websocket/  # WebSocket bidirectional
├── server.py              # ADK FastAPI server
├── package.json           # Node.js dependencies
├── pyproject.toml         # Python dependencies
├── justfile               # Task runner
├── next.config.ts         # Next.js config
├── tsconfig.json          # TypeScript config
└── README.md              # This file
```

## Available Commands (just)

```bash
just install           # Install all dependencies
just server            # Run backend server
just frontend          # Run frontend dev server
just dev               # Run both servers concurrently
just lint-python       # Lint Python code
just fmt-python        # Format Python code
just check-python      # Run all Python checks
just lint-frontend     # Lint Next.js code
just check             # Run all checks
just clean             # Clean generated files
just info              # Show project info
```

## Architecture Overview

This project supports **three streaming modes**, all using the same frontend (`useChat` hook) with different backends and transports.

### Quick Comparison

```
+------------------+------------------+------------------+------------------+
| Mode             | Backend          | Transport        | Use Case         |
+------------------+------------------+------------------+------------------+
| Gemini Direct    | None (AI SDK)    | HTTP SSE         | Simple apps      |
| ADK SSE          | ADK + FastAPI    | HTTP SSE         | Production apps  |
| ADK BIDI         | ADK + FastAPI    | WebSocket        | Voice agents     |
+------------------+------------------+------------------+------------------+
```

Legend / 凡例:
- Backend: バックエンド（処理を行うサーバー）
- Transport: トランスポート層（通信方式）
- Use Case: 利用ケース

### Architecture Diagrams

#### Overview: All Three Modes

```
Mode 1: Gemini Direct (SSE)      Mode 2: ADK SSE              Mode 3: ADK BIDI (WebSocket)
================================  ===========================  ================================

┌─────────────────────┐          ┌─────────────────────┐      ┌─────────────────────┐
│   Frontend (Next)   │          │   Frontend (Next)   │      │   Frontend (Next)   │
│  ┌──────────────┐   │          │  ┌──────────────┐   │      │  ┌──────────────┐   │
│  │   useChat    │   │          │  │   useChat    │   │      │  │   useChat    │   │
│  │    Hook      │   │          │  │    Hook      │   │      │  │    Hook      │   │
│  └──────┬───────┘   │          │  └──────┬───────┘   │      │  └──────┬───────┘   │
│         │           │          │         │           │      │         │           │
│         │ HTTP      │          │         │ HTTP      │      │         │ WS        │
└─────────┼───────────┘          └─────────┼───────────┘      └─────────┼───────────┘
          │                                │                            │
          │ SSE                            │ SSE                        │ SSE format
          ▼                                ▼                            │ over WS
  ┌───────────────┐              ┌─────────────────┐           ┌────────▼──────────┐
  │ /api/chat     │              │ /stream         │           │ /live (WebSocket) │
  │ (Next.js API) │              │ (FastAPI)       │           │ (FastAPI)         │
  │               │              │                 │           │                   │
  │ ┌───────────┐ │              │ ┌─────────────┐ │           │ ┌───────────────┐ │
  │ │  Gemini   │ │              │ │ ADK Agent   │ │           │ │ ADK Agent     │ │
  │ │    API    │ │              │ │ run_async() │ │           │ │ run_live()    │ │
  │ └───────────┘ │              │ └─────────────┘ │           │ │ LiveQueue     │ │
  └───────────────┘              └─────────────────┘           │ └───────────────┘ │
                                                                └───────────────────┘
```

Legend / 凡例:
- useChat Hook: AI SDKのReactフック（チャット状態管理）
- HTTP/WS: 通信プロトコル（HTTP または WebSocket）
- SSE: Server-Sent Events（サーバーからクライアントへの一方向ストリーミング）
- run_async(): ADKの通常ストリーミングメソッド
- run_live(): ADKの双方向ストリーミングメソッド
- LiveQueue: LiveRequestQueue（クライアント→エージェントのメッセージキュー）

---

#### Mode 1: Gemini Direct (SSE) - Simple Architecture

```
┌─────────────────────────────────────────────────────────┐
│                Frontend (Next.js + AI SDK v6)           │
│                                                         │
│  User Input → useChat.sendMessage({ text: "..." })     │
│                           ↓                             │
│                    POST /api/chat                       │
└───────────────────────────┬─────────────────────────────┘
                            │
                            │ HTTP Request
                            │ { messages: [...] }
                            ▼
┌─────────────────────────────────────────────────────────┐
│         Next.js API Route (/app/api/chat/route.ts)      │
│                                                         │
│  1. Receive messages (UIMessage[])                      │
│  2. convertToModelMessages(messages)                    │
│  3. streamText({                                        │
│       model: google("gemini-3-pro-preview"),            │
│       messages,                                         │
│       tools: { get_weather, calculate, ... }            │
│     })                                                  │
│  4. return result.toUIMessageStreamResponse()          │
└───────────────────────────┬─────────────────────────────┘
                            │
                            │ SSE Stream
                            │ data: {"type":"text-delta",...}
                            ▼
┌─────────────────────────────────────────────────────────┐
│                  Gemini API (Google Cloud)              │
│                                                         │
│  - Model: gemini-3-pro-preview                          │
│  - Tool execution: Server-side                          │
│  - Streaming: Native SSE support                        │
└─────────────────────────────────────────────────────────┘
```

**Key Points:**
- No separate backend server required
- AI SDK handles Gemini API directly
- Tools executed on Next.js server
- Simple setup, best for prototypes

---

#### Mode 2: ADK SSE - Production Architecture

```
┌─────────────────────────────────────────────────────────┐
│                Frontend (Next.js + AI SDK v6)           │
│                                                         │
│  User Input → useChat.sendMessage({ text: "..." })     │
│                           ↓                             │
│                  POST http://localhost:8000/stream      │
└───────────────────────────┬─────────────────────────────┘
                            │
                            │ HTTP Request
                            │ { messages: [...] }
                            ▼
┌─────────────────────────────────────────────────────────┐
│            ADK Backend (FastAPI server.py)              │
│                                                         │
│  1. Receive ChatRequest (messages)                      │
│  2. Extract last user message                           │
│  3. Create ADK Content:                                 │
│     types.Content(role="user", parts=[...])             │
│  4. Run agent:                                          │
│     agent_runner.run_async(                             │
│       session_id=session.id,                            │
│       new_message=message_content                       │
│     )                                                   │
│  5. Convert ADK events → SSE format:                    │
│     stream_adk_to_ai_sdk(event_stream)                  │
│  6. Return StreamingResponse                            │
└───────────────────────────┬─────────────────────────────┘
                            │
                            │ Protocol Conversion
                            │ (stream_protocol.py)
                            ▼
┌─────────────────────────────────────────────────────────┐
│            AI SDK v6 Data Stream Protocol               │
│                                                         │
│  SSE Format:                                            │
│  data: {"type":"text-start","id":"0"}                   │
│  data: {"type":"text-delta","id":"0","delta":"..."}     │
│  data: {"type":"tool-call-available","toolName":"..."}  │
│  data: {"type":"tool-result-available","result":{...}}  │
│  data: {"type":"finish","finishReason":"stop"}          │
│  data: [DONE]                                           │
└───────────────────────────┬─────────────────────────────┘
                            │
                            │ HTTP SSE
                            ▼
┌─────────────────────────────────────────────────────────┐
│            Frontend useChat Hook (React State)          │
│                                                         │
│  - Parses SSE events                                    │
│  - Updates messages array                               │
│  - Renders UI components                                │
└─────────────────────────────────────────────────────────┘
```

**Key Points:**
- ADK backend provides full agent capabilities
- Session management and state preservation
- Tool execution via ADK agent
- Protocol conversion to AI SDK v6 format
- Production-ready with FastAPI

---

#### Mode 3: ADK BIDI (WebSocket) - Bidirectional Architecture

```
┌─────────────────────────────────────────────────────────┐
│                Frontend (Next.js + AI SDK v6)           │
│                                                         │
│  User Input → useChat.sendMessage({ text: "..." })     │
│                           ↓                             │
│             WebSocketChatTransport.sendMessages()       │
│                           ↓                             │
│                WebSocket Connection                     │
│                ws://localhost:8000/live                 │
└─────────────────┬───────────────────────┬───────────────┘
                  │                       │
                  │ ↓ JSON Message        │ ↑ SSE format
                  │   (Upstream)          │   over WebSocket
                  │                       │   (Downstream)
┌─────────────────▼───────────────────────▼───────────────┐
│        ADK Backend WebSocket Handler (server.py)        │
│                                                         │
│  Concurrent Tasks (asyncio.gather):                     │
│                                                         │
│  Task 1: Receive from Client                            │
│  ┌────────────────────────────────────────────┐         │
│  │ 1. websocket.receive_text()                │         │
│  │ 2. Parse JSON → ChatMessage                │         │
│  │ 3. Convert: ChatMessage.to_adk_content()   │         │
│  │ 4. Enqueue: live_request_queue.send_content() │      │
│  └────────────────────────────────────────────┘         │
│                       ↓                                 │
│                 LiveRequestQueue                        │
│                       ↓                                 │
│  Task 2: Send to Client                                 │
│  ┌────────────────────────────────────────────┐         │
│  │ 1. agent_runner.run_live(                  │         │
│  │      live_request_queue=...,               │         │
│  │      run_config=RunConfig(...)             │         │
│  │    )                                       │         │
│  │ 2. stream_adk_to_ai_sdk(live_events)       │         │
│  │    ★ SAME converter as SSE mode!           │         │
│  │ 3. websocket.send_text(sse_event)          │         │
│  └────────────────────────────────────────────┘         │
└─────────────────┬───────────────────────┬───────────────┘
                  │                       │
                  │ WebSocket             │ WebSocket
                  ▼                       ▼
┌─────────────────────────────────────────────────────────┐
│         WebSocketChatTransport (Frontend)               │
│                                                         │
│  handleWebSocketMessage():                              │
│  1. Receive: data.startsWith("data: ")                  │
│  2. Parse: JSON.parse(data.substring(6))                │
│  3. Convert: chunk as UIMessageChunk                    │
│  4. Enqueue: controller.enqueue(chunk)                  │
│  5. useChat consumes → UI updates                       │
└─────────────────────────────────────────────────────────┘
```

**Key Points:**
- **Architecture: "SSE format over WebSocket"**
- Protocol conversion: 100% reuses `stream_adk_to_ai_sdk()`
- Bidirectional: Concurrent upstream/downstream message flow
- Real-time: Low latency, suitable for voice agents
- Tools: Same tool calling support as SSE mode
- Future: Can add audio/video streaming

**Why This Design:**
- **Code reuse:** Same protocol converter for SSE and BIDI modes
- **Simplicity:** Only transport layer changes (HTTP → WebSocket)
- **Compatibility:** AI SDK v6 Data Stream Protocol maintained
- **Flexibility:** Easy to extend with audio/video

---

### Mode Comparison Table

| Feature | Gemini Direct | ADK SSE | ADK BIDI |
|---------|--------------|---------|----------|
| **Backend** | None | FastAPI + ADK | FastAPI + ADK |
| **Transport** | HTTP SSE | HTTP SSE | WebSocket |
| **Latency** | Low | Low | Very Low |
| **Bidirectional** | No | No | Yes |
| **Tool Calling** | Next.js server | ADK agent | ADK agent |
| **Session Management** | No | Yes | Yes |
| **Audio/Video** | No | No | Yes (future) |
| **Complexity** | Simple | Medium | Advanced |
| **Use Case** | Prototypes | Production | Voice agents |

Legend / 凡例:
- Transport: トランスポート（通信方式）
- Latency: レイテンシ（応答速度）
- Bidirectional: 双方向通信の可否
- Session Management: セッション管理機能
- Complexity: 実装の複雑さ

## Testing

### Test Phase 2 SSE Streaming

```bash
# Direct backend test
curl -N http://localhost:8000/stream \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"What is 2+2?"}]}'

# Expected output:
# data: {"type": "text-start", "id": "0"}
# data: {"type": "text-delta", "id": "0", "delta": "2 + 2 = 4"}
# data: {"type": "text-end", "id": "0"}
# data: {"type": "finish", "finishReason": "stop"}
# data: [DONE]
```

### Test Frontend Integration

```bash
# Test configuration
curl http://localhost:3000/api/config

# Test chat endpoint
curl -N http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","parts":[{"type":"text","text":"Hello"}]}]}'
```

## AI SDK v6 Migration Notes

This project uses AI SDK v6 beta. While the official documentation states v6 has minimal breaking changes, we encountered several issues during implementation. These notes document the actual changes required.

### Breaking Changes Encountered

#### 1. useChat Hook API Changes

**Message sending:**
```typescript
// ❌ v3/v4 style (doesn't work in v6)
const { input, handleInputChange, handleSubmit } = useChat();

// ✅ v6 style (correct)
const { messages, sendMessage, status } = useChat();
const [input, setInput] = useState("");

const handleSubmit = (e) => {
  e.preventDefault();
  sendMessage({ text: input }); // Must pass object with 'text' property
  setInput("");
};
```

**Loading state:**
```typescript
// ❌ v3/v4: isLoading
const isLoading = useChat().isLoading;

// ✅ v6: status
const status = useChat().status;
const isLoading = status === "submitted" || status === "streaming";
```

#### 2. Message Structure Changes

**Displaying messages:**
```typescript
// ❌ v3/v4: message.content
{messages.map(message => (
  <div>{message.content}</div>
))}

// ✅ v6: message.parts
{messages.map(message => (
  <div>
    {message.parts.map((part, index) =>
      part.type === "text" ? (
        <span key={index}>{part.text}</span>
      ) : null
    )}
  </div>
))}
```

**Why:** AI SDK v6 introduced a new `parts` structure to support multiple content types (text, files, tool calls, etc.)

#### 3. Route Handler Changes

**Message conversion required:**
```typescript
// ❌ Passing messages directly causes validation errors
const result = streamText({
  model: google("gemini-2.0-flash-exp"),
  messages, // UIMessage[] - wrong format!
});

// ✅ Convert UIMessage[] to ModelMessage[]
import { convertToModelMessages } from "ai";

const result = streamText({
  model: google("gemini-2.0-flash-exp"),
  messages: convertToModelMessages(messages), // Correct!
});
```

**Type safety:**
```typescript
import type { UIMessage } from "ai";

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();
  // ...
}
```

#### 4. Stream Response Methods

**Correct method for useChat:**
```typescript
// ❌ Wrong methods
return result.toTextStreamResponse();    // Plain text only
return result.toDataStreamResponse();    // Deprecated/not recommended

// ✅ Correct for useChat with Data Stream Protocol
return result.toUIMessageStreamResponse();
```

**Why:** `useChat` expects UI Message Stream format by default, which uses Server-Sent Events (SSE) with structured data.

### Data Stream Protocol Details

AI SDK v6 uses two streaming protocols:

#### Text Stream Protocol
- Simple text chunks concatenated together
- Use `streamProtocol: 'text'` option in `useChat`
- Response method: `toTextStreamResponse()`

#### Data Stream Protocol (Default)
- Server-Sent Events (SSE) format
- Supports text, tool calls, reasoning blocks, files
- Structured JSON messages with type fields
- Terminates with `data: [DONE]` marker
- Response method: `toUIMessageStreamResponse()`

**SSE Format Example:**
```
data: {"type":"text-start","id":"0"}
data: {"type":"text-delta","id":"0","delta":"Hello"}
data: {"type":"text-delta","id":"0","delta":" world"}
data: {"type":"text-end","id":"0"}
data: {"type":"finish","finishReason":"stop"}
data: [DONE]
```

### Common Errors and Solutions

**Error: "Invalid prompt: The messages do not match the ModelMessage[] schema"**
- **Cause:** Not using `convertToModelMessages()`
- **Solution:** Import and use `convertToModelMessages()` in route handler

**Error: Messages not displaying in UI**
- **Cause:** Using `message.content` instead of `message.parts`
- **Solution:** Map over `message.parts` and render `part.text`

### Debug Tips

1. **Clear Next.js cache** if changes don't apply:
   ```bash
   rm -rf .next && pnpm dev
   ```

2. **Check server logs** for actual errors (not just browser console)

3. **Test API directly** with curl to isolate frontend/backend issues

4. **Verify environment variables** are loaded (especially after changes)

## Development

### Backend Development

The backend server (`server.py`) uses:
- FastAPI for async HTTP handling
- Pydantic for data validation
- Loguru for logging
- Google ADK for AI capabilities

### Frontend Development

The frontend uses:
- Next.js App Router for routing
- AI SDK v6's `useChat` hook for chat UI
- Server-side Route Handlers for API endpoints
- TypeScript for type safety

## License

ISC
