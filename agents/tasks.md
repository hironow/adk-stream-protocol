# ADK-AI Data Protocol - Implementation Tasks

**Project Goal:** Demonstrate integration between AI SDK v6 (frontend) and Google ADK (backend) with SSE streaming.

**Last Updated:** 2025-12-11 (Final architecture - simplified to 2 phases)

---

## Phase 1: Gemini Direct ✅ COMPLETED

**Objective:** Verify frontend can work with AI SDK v6 natively.

### Tasks
- [x] Setup Next.js 15 + React 19 environment with pnpm
- [x] Install AI SDK v6 dependencies
- [x] Implement frontend with Next.js App Router
  - [x] Chat UI with `useChat` hook
  - [x] API route connecting to Gemini directly
  - [x] Streaming support
- [x] Verify Gemini Direct mode works

### Files Created
- `app/layout.tsx` - Next.js layout
- `app/page.tsx` - Chat UI with AI SDK v6
- `app/api/chat/route.ts` - API route handler
- `app/api/config/route.ts` - Backend configuration API
- `app/globals.css` - Global styles
- `next.config.ts` - Next.js config
- `tsconfig.json` - TypeScript config

### Testing
- ✅ Frontend UI functional with Gemini streaming
- ✅ AI SDK v6 Data Stream Protocol working (SSE format)
- ✅ Message display with `message.parts` structure
- ✅ `useChat` with `sendMessage({ text })` API

### Key Learnings
- AI SDK v6 breaking changes documented in README.md
- `convertToModelMessages()` required for message conversion
- `toUIMessageStreamResponse()` for proper SSE streaming
- Message structure changed from `content` to `parts`

---

## Phase 2: ADK SSE Streaming ✅ COMPLETED (FINAL VERSION)

**Objective:** Implement ADK backend with SSE streaming compatible with AI SDK v6.

### Tasks
- [x] Setup Python 3.13 environment with uv
- [x] Setup FastAPI backend with ADK integration
- [x] Implement `/stream` SSE endpoint
  - [x] AI SDK compatible event format
  - [x] Token-by-token streaming
  - [x] Proper SSE headers
- [x] Integrate ADK LLM with `run_async()`
  - [x] Agent with InMemoryRunner
  - [x] Session management
  - [x] Real LLM responses
- [x] Add `adk-sse` mode to frontend API route
- [x] Test end-to-end SSE streaming
- [x] Add missing AI SDK v6 header (`x-vercel-ai-ui-message-stream: v1`)

### Files Created/Modified
- `server.py` - FastAPI backend with ADK integration
- `app/page.tsx` - Frontend with direct ADK backend connection in Phase 2
- `app/api/chat/route.ts` - Phase 1 (Gemini Direct) API route
- `app/api/config/route.ts` - Backend configuration API
- `.env.example` - Configuration template
- `.env.local` - Local environment variables
- `justfile` - Task automation

### Implementation Details

**Backend SSE Streaming:**
```python
async def stream_agent_chat(user_message: str):
    """Stream ADK agent responses as SSE events in AI SDK v6 format."""
    session = await get_or_create_session(user_id)

    async for event in agent_runner.run_async(
        user_id=user_id,
        session_id=session.id,
        new_message=message_content,
    ):
        if event.content and event.content.parts:
            for part in event.content.parts:
                if hasattr(part, 'text') and part.text:
                    yield f'data: {json.dumps({"type": "text-delta", ...})}\n\n'
```

**Frontend Integration:**
```typescript
// Phase 2: ADK Backend via SSE Streaming (FINAL VERSION)
// Frontend connects DIRECTLY to ADK backend (no Next.js proxy)
const backendMode = process.env.NEXT_PUBLIC_BACKEND_MODE || "gemini";
const adkBackendUrl = process.env.NEXT_PUBLIC_ADK_BACKEND_URL || "http://localhost:8000";

const apiEndpoint = backendMode === "adk-sse"
  ? `${adkBackendUrl}/stream`  // Direct connection to ADK backend
  : "/api/chat";                 // Phase 1: Next.js API route

const { messages, sendMessage, status } = useChat({
  api: apiEndpoint,
});
```

### Testing
- ✅ Backend `/stream` endpoint tested with curl
- ✅ Frontend-to-backend SSE streaming working
- ✅ AI SDK v6 Data Stream Protocol format verified
- ✅ Real-time token display in UI
- ✅ Test: "What is 2+2?" → Response: "2 + 2 = 4"

### Key Learnings
- ADK `run_async()` method for SSE streaming
- FastAPI `StreamingResponse` for SSE
- AI SDK v6 event format: `text-start`, `text-delta`, `text-end`, `finish`, `[DONE]`
- Required header: `x-vercel-ai-ui-message-stream: v1` for full compatibility
- API Key environment variables:
  - ADK uses `GOOGLE_API_KEY`
  - AI SDK uses `GOOGLE_GENERATIVE_AI_API_KEY`

---

## Experimental Code (Archived)

### experiments/phase2-jsonrpc/ - JSONRPC Integration

**Status:** Archived - Not adopted for production

**Why Not Adopted:**
- No streaming support (returns complete responses)
- Not compatible with AI SDK v6 streaming expectations
- Poor user experience for long responses
- No real benefit over direct API calls

**Key Files:**
- `experiments/phase2-jsonrpc/README.md` - Full documentation with code examples
- Code snippets preserved for reference

### experiments/phase4-websocket/ - WebSocket Bidirectional

**Status:** Archived - Not adopted for production

**Why Not Adopted:**
- AI SDK v6 has NO WebSocket support
- Requires custom client implementation
- Adds significant complexity without benefit for text chat
- SSE provides equivalent functionality with simpler architecture
- WebSocket valuable for audio/video in future, but not needed now

**Key Files:**
- `experiments/phase4-websocket/README.md` - Full documentation with code examples
- `experiments/phase4-websocket/test_websocket_client.py` - Python test client
- `experiments/phase4-websocket/TEST_RESULTS_PHASE4.md` - Test results before archival

**When to Reconsider:**
- Multimodal requirements (audio/video streaming)
- True bidirectional communication with interruptions
- Low-latency requirements beyond SSE capabilities

---

## Current Architecture Summary

| Phase | Transport | Protocol | ADK Method | Status |
|-------|-----------|----------|------------|--------|
| Phase 1 | SSE | AI SDK v6 Official | - | ✅ Production |
| Phase 2 | SSE | AI SDK v6 Compatible | run_async() | ✅ Production (Final) |

**Archived Experiments:**
- ~~JSONRPC~~ - Non-streaming, archived to `experiments/phase2-jsonrpc/`
- ~~WebSocket~~ - Complex, AI SDK v6 incompatible, archived to `experiments/phase4-websocket/`

---

## Development Guidelines

- Follow TDD approach where applicable
- Keep commits small and focused
- Update this file as tasks progress
- Document any blockers or decisions in this file
- Run `just check` before committing

## Testing Commands

```bash
# Phase 1: Gemini Direct (✅ Production)
echo 'BACKEND_MODE=gemini' > .env.local
pnpm dev

# Phase 2: ADK SSE Streaming (✅ Production - FINAL)
echo 'BACKEND_MODE=adk-sse' > .env.local
just dev

# Test backend directly
curl http://localhost:8000/
curl http://localhost:8000/health

# Test SSE streaming endpoint
curl -N http://localhost:8000/stream \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"What is 2+2?"}]}'

# Expected output:
# data: {"type": "text-start", "id": "0"}
# data: {"type": "text-delta", "id": "0", "delta": "2 + 2 = 4"}
# data: {"type": "text-end", "id": "0"}
# data: {"type": "finish", "finishReason": "stop"}
# data: [DONE]

# Test frontend API
curl -N http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","parts":[{"type":"text","text":"Hello"}]}]}'
```

---

## Notes

- All backend code uses Python 3.13+ with type hints
- All frontend code uses TypeScript with strict mode
- Pydantic for backend data validation
- AI SDK v6 types for frontend
- Simple, maintainable architecture with two clear phases

### Final Architecture Decision

After implementing and testing multiple approaches:

1. **Gemini Direct (Phase 1)** - Simple, fast, AI SDK v6 native
2. **ADK SSE (Phase 2)** - Production-ready, full ADK integration, streaming

**Removed complexity:**
- JSONRPC endpoint (no streaming benefit)
- WebSocket transport (AI SDK v6 incompatible, added complexity)

**Result:** Clean, simple architecture that's easy to understand and maintain.

### AI SDK v6 Key Requirements

1. **Message Conversion:**
   ```typescript
   import { convertToModelMessages } from "ai";
   messages: convertToModelMessages(messages)
   ```

2. **Response Format:**
   ```typescript
   return result.toUIMessageStreamResponse();
   ```

3. **Required Header:**
   ```typescript
   "x-vercel-ai-ui-message-stream": "v1"
   ```

4. **Message Display:**
   ```typescript
   {message.parts.map(part => part.type === "text" ? part.text : null)}
   ```

See README.md "AI SDK v6 Migration Notes" section for complete details.
