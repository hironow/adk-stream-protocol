# Getting Started Guide

This guide provides detailed instructions for setting up, running, and developing with the ADK Stream Protocol project.

## Table of Contents

- [Core Concepts](#core-concepts)
- [Installation](#installation)
- [Configuration](#configuration)
- [Running the Project](#running-the-project)
- [Usage Examples](#usage-examples)
- [AI SDK v6 Migration Notes](#ai-sdk-v6-migration-notes)
- [Development](#development)
- [Troubleshooting](#troubleshooting)

## Core Concepts

### Architecture Overview

**Key Insight:** All three modes use the same **AI SDK v6 Data Stream Protocol** format for communication, ensuring consistent frontend behavior regardless of backend implementation.

#### Protocol Flow

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

Legend:

- Gemini Direct: Gemini APIへの直接接続モード
- ADK SSE: ADKバックエンドを使用したSSE（Server-Sent Events）ストリーミングモード
- ADK BIDI: ADKバックエンドを使用した双方向WebSocketストリーミングモード
- AI SDK v6: Vercel AI SDK バージョン6
- Data Stream Protocol: AI SDK v6のデータストリーミングプロトコル
- StreamProtocolConverter: ADKイベントをAI SDK v6形式に変換するコンバーター
- HTTP SSE: HTTPサーバー送信イベント（一方向ストリーミング）
- WebSocket: 双方向通信プロトコル

### StreamProtocolConverter: The Heart of Integration

**Location:** `stream_protocol.py`

**Purpose:** Convert ADK-specific event formats to AI SDK v6 Data Stream Protocol

**Usage:** Both ADK SSE and ADK BIDI modes use the **same converter**

**Key Events:**

- Text streaming: `text-start`, `text-delta`, `text-end`
- Reasoning/Thinking: `reasoning-start`, `reasoning-delta`, `reasoning-end` (Gemini 2.0)
- Tool calls: `tool-input-start`, `tool-input-available`
- Tool results: `tool-output-available`
- Audio (BIDI): `data-pcm` (PCM audio streaming)
- Images: `data-image` (base64-encoded images)
- Audio transcription: `text-*` events for input/output transcription (native-audio models)

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

## Installation

### Prerequisites

Make sure you have the following installed:

- **Python 3.14+** - Required for ADK backend
- **Node.js 18+** - Required for Next.js frontend
- **bun** - Node.js package manager and runtime (install via `curl -fsSL https://bun.sh/install | bash`)
- **uv** - Python package manager (install via `curl -LsSf https://astral.sh/uv/install.sh | sh`)
- **just** - Task runner (install via `cargo install just` or `brew install just`)

### Quick Install

Clone the repository and install all dependencies:

```bash
# Clone repository
git clone <repository-url>
cd adk-stream-protocol

# Install all dependencies (Python + Node.js)
just install
```

### Manual Installation

If you prefer to install dependencies separately:

```bash
# Install Python dependencies
uv sync

# Install Node.js dependencies
bun install
```

## Configuration

### Environment Variables

Copy the example environment file:

```bash
cp .env.example .env.local
```

### Mode 1: Gemini Direct Configuration

For running with AI SDK v6 direct Gemini API connection (no backend needed):

```bash
# .env.local
GOOGLE_GENERATIVE_AI_API_KEY=your_api_key_here
BACKEND_MODE=gemini
NEXT_PUBLIC_BACKEND_MODE=gemini
```

**Get your API key:**

1. Visit [Google AI Studio](https://aistudio.google.com/apikey)
2. Create a new API key
3. Copy and paste into `GOOGLE_GENERATIVE_AI_API_KEY`

### Mode 2 & 3: ADK SSE/BIDI Configuration

For running with ADK backend (SSE or BIDI modes):

```bash
# .env.local
GOOGLE_API_KEY=your_api_key_here
BACKEND_MODE=adk-sse
NEXT_PUBLIC_BACKEND_MODE=adk-sse
ADK_BACKEND_URL=http://localhost:8000
NEXT_PUBLIC_ADK_BACKEND_URL=http://localhost:8000
```

**Important Notes:**

- ADK modes use `GOOGLE_API_KEY` (NOT `GOOGLE_GENERATIVE_AI_API_KEY`)
- Backend runs on port 8000 by default
- Frontend runs on port 3000 by default

## Running the Project

### Mode 1: Gemini Direct (Frontend Only)

This mode requires no backend server - AI SDK v6 connects directly to Gemini API.

```bash
# Start frontend development server
bun dev
```

Visit: <http://localhost:3000>

**What happens:**

- Next.js API route (`/app/api/chat/route.ts`) handles requests
- AI SDK v6 `streamText()` calls Gemini API directly
- Tools execute on Next.js server

### Mode 2 & 3: ADK SSE/BIDI (Backend + Frontend)

These modes require both backend and frontend servers running.

**Option A: Run both concurrently (recommended):**

```bash
just dev
```

This starts:

- Backend on <http://localhost:8000>
- Frontend on <http://localhost:3000>

**Option B: Run separately:**

```bash
# Terminal 1: Backend server
just server
# or: uv run uvicorn server:app --reload --host 0.0.0.0 --port 8000

# Terminal 2: Frontend server
bun dev
```

### Verify Backend is Running

```bash
# Check health endpoint
curl http://localhost:8000/health

# Check root endpoint
curl http://localhost:8000/

# Test SSE streaming
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

### Available Commands

Run `just --list` to see all available commands:

```bash
just install              # Install all dependencies
just dev                  # Run frontend and backend concurrently
just server               # Run backend server only
just test-fast            # Run fast tests (no external dependencies)
just test-unified-e2e     # Run E2E tests (pytest + Playwright)
just test-unified-all     # Run all tests
just lint                 # Run linting (Python + TypeScript)
just format               # Format code
```

## Usage Examples

### Example 1: Simple Text Chat

1. Open <http://localhost:3000>
2. Type: "Hello, tell me about AI SDK v6"
3. Press Enter or click Send
4. Watch the response stream token-by-token

### Example 2: Tool Calling (Weather)

1. Type: "What's the weather in Tokyo?"
2. AI will call the `get_weather` tool
3. Tool result is displayed in the chat
4. AI uses the result to formulate response

### Example 3: Tool Approval (BGM Change)

**Prerequisites:** ADK SSE or BIDI mode

1. Type: "Change the background music to jazz"
2. AI requests the `change_bgm` tool
3. **Approval dialog appears** in the UI
4. Click **Approve** or **Deny**
5. If approved:
   - Browser AudioContext switches track
   - AI receives confirmation
   - AI responds with success message

### Example 4: Location-Based Query

**Prerequisites:** ADK BIDI mode (requires browser permissions)

1. Type: "What's the weather at my current location?"
2. AI requests the `get_location` tool
3. **Approval dialog appears** in the UI
4. Click **Approve**
5. Browser prompts for location permission
6. If granted:
   - Geolocation API provides coordinates
   - AI receives location data
   - AI calls `get_weather` with coordinates
   - AI responds with location-specific weather

### Example 5: Voice Interaction (BIDI Mode)

**Prerequisites:** ADK BIDI mode

1. Switch to BIDI mode in the UI
2. **Hold CMD key** (Mac) or **Ctrl key** (Windows/Linux)
3. Speak into microphone
4. Release key when done
5. Watch the transcription appear in real-time
6. AI responds with audio output
7. Audio transcription shows AI's spoken response

### Example 6: Image Upload

**Prerequisites:** Any mode with image support

1. Click the image upload button
2. Select an image (PNG, JPEG, WebP)
3. Image preview appears
4. Type: "What do you see in this image?"
5. AI analyzes the image and responds

## AI SDK v6 Migration Notes

This project uses AI SDK v6 beta. The official documentation states v6 has minimal breaking changes, but we encountered several issues during implementation. These notes document the actual changes required.

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
  model: google("gemini-2.5-flash"),
  messages, // UIMessage[] - wrong format!
});

// ✅ Convert UIMessage[] to ModelMessage[]
import { convertToModelMessages } from "ai";

const result = streamText({
  model: google("gemini-2.5-flash"),
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

## Development

### Backend Development

The backend server (`server.py`) uses:

- **FastAPI** for async HTTP handling
- **Pydantic** for data validation
- **Loguru** for logging
- **Google ADK** for AI capabilities

**Key Files:**

- `server.py` - Main FastAPI application
- `adk_stream_protocol/stream_protocol.py` - StreamProtocolConverter (ADK → AI SDK v6)
- `adk_stream_protocol/adk_ag_tools.py` - Tool implementations (change_bgm, get_location, etc.)

**Development Tips:**

- Use `just server` for auto-reload during development
- Check logs for debugging (Loguru provides colored output)
- Test endpoints with curl before frontend integration

### Frontend Development

The frontend uses:

- **Next.js App Router** for routing
- **AI SDK v6's `useChat` hook** for chat UI
- **Server-side Route Handlers** for API endpoints
- **TypeScript** for type safety

**Key Files:**

- `app/page.tsx` - Main chat UI
- `app/api/chat/route.ts` - Gemini Direct API route
- `lib/bidi/transport.ts` - Custom WebSocket transport (BIDI mode)
- `lib/sse/transport.ts` - SSE transport (ADK SSE / Gemini modes)
- `components/chat.tsx` - Chat component

**Development Tips:**

- Use `bun dev` for hot reload (or `just dev` for full stack)
- Check browser console for client-side errors
- Check Next.js terminal for server-side errors
- Clear `.next` cache if changes don't apply

## Troubleshooting

### Common Issues

#### 1. Backend not starting

**Error:** `ModuleNotFoundError: No module named 'google.adk'`

**Solution:**

```bash
uv sync  # Reinstall Python dependencies
```

#### 2. Frontend build errors

**Error:** `Module not found: Can't resolve 'ai'`

**Solution:**

```bash
bun install  # Reinstall Node.js dependencies
rm -rf .next && bun dev  # Clear cache and restart
```

#### 3. API Key errors

**Error:** `401 Unauthorized` or `Invalid API key`

**Solution:**

- Check `.env.local` file exists
- Verify API key is correct
- Use correct variable name:
    - Gemini Direct: `GOOGLE_GENERATIVE_AI_API_KEY`
    - ADK modes: `GOOGLE_API_KEY`
- Restart development server after changing `.env.local`

#### 4. WebSocket connection fails

**Error:** `WebSocket connection to 'ws://localhost:8000/live' failed`

**Solution:**

- Verify backend is running (`curl http://localhost:8000/health`)
- Check `ADK_BACKEND_URL` in `.env.local`
- Check browser console for CORS errors
- Try restarting both backend and frontend

#### 5. Tool approval not working

**Error:** Approval dialog doesn't appear

**Solution:**

- Verify you're using ADK SSE or BIDI mode (not Gemini Direct)
- Check that tool is in `TOOLS_REQUIRING_APPROVAL` list (server.py)
- Check browser console for errors
- Verify `FrontendToolDelegate` is initialized correctly

### Debug Tips

1. **Clear Next.js cache** if changes don't apply:

   ```bash
   rm -rf .next && bun dev
   ```

2. **Check server logs** for actual errors (not just browser console)

3. **Test API directly** with curl to isolate frontend/backend issues

4. **Verify environment variables** are loaded (especially after changes)

5. **Check Python version:**

   ```bash
   python --version  # Should be 3.14+
   uv run python --version
   ```

6. **Check Node.js version:**

   ```bash
   node --version  # Should be 18+
   ```

### Getting Help

If you encounter issues not covered here:

1. Check `docs/spec_ARCHITECTURE.md` for detailed technical documentation
2. Check `experiments/README.md` for known issues and workarounds
3. Check the project's issue tracker
4. Review logs carefully - most errors have helpful messages

## Next Steps

- **Learn the architecture:** Read `docs/spec_ARCHITECTURE.md` for complete technical details
- **Explore test coverage:** See `docs/testing_COVERAGE_AUDIT.md`
- **Review experiments:** Check `experiments/README.md` for research notes
- **Run E2E tests:** Follow `docs/testing_E2E.md` for comprehensive testing
