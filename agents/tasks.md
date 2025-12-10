# ADK-AI Data Protocol - Implementation Tasks

**Project Goal:** Demonstrate integration between AI SDK v6 (frontend) and Google ADK (backend) with progressive implementation of data stream protocols.

**Last Updated:** 2025-12-10 (after Phase 1 completion and AI SDK v6 migration debugging)

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

## Phase 3: SSE Streaming 🚧 IN PROGRESS

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

**Backend (⏳ Next steps):**
- [ ] Implement SSE endpoint in backend (`/stream`)
  - [ ] AI SDK compatible event format
  - [ ] Token-by-token streaming
  - [ ] Proper SSE headers and connection handling
- [ ] Integrate with ADK LLM capabilities
  - [ ] Connect to actual LLM (Gemini via ADK)
  - [ ] Stream tokens as they're generated
- [ ] Add `adk-sse` backend mode to API route
- [ ] Test ADK backend SSE streaming end-to-end

### Files to Modify/Create
- `server.py` - Add SSE streaming endpoint
- `app/api/chat/route.ts` - Add SSE mode support
- `.env.example` - Document SSE mode

### Resources
- AI SDK v6 documentation: https://ai-sdk.dev/docs
- AI SDK v6 data stream protocol spec
- FastAPI SSE examples: https://fastapi.tiangolo.com/advanced/custom-response/#using-streamingresponse-with-file-like-objects

### Answered Questions
- ✅ **AI SDK v6 data stream protocol format**: SSE with structured JSON events
  - Format: `data: {"type":"text-delta","id":"0","delta":"text"}`
  - Terminates with `data: [DONE]`
  - Uses `toUIMessageStreamResponse()` on backend
  - Frontend automatically handles with `useChat` hook

### Open Questions
- How to properly integrate ADK's LLM streaming with FastAPI SSE?
- Should we use sse-starlette library or implement manually?
- How to format ADK streaming output to match AI SDK protocol?

---

## Phase 4: WebSocket Integration 📋 PLANNED

**Objective:** Implement bidirectional communication via WebSocket.

### Tasks
- [ ] Research WebSocket support in AI SDK v6
- [ ] Implement WebSocket endpoint in backend
  - [ ] Connection handling
  - [ ] Message protocol design
  - [ ] Bidirectional streaming
- [ ] Update frontend for WebSocket mode
  - [ ] WebSocket connection management
  - [ ] Handle bidirectional communication
- [ ] Test WebSocket integration

### Files to Modify/Create
- `server.py` - Add WebSocket endpoint
- `app/api/chat/route.ts` or separate WebSocket client
- Frontend WebSocket client component

---

## Phase 5: Full Bidirectional Streaming 📋 PLANNED

**Objective:** Advanced streaming scenarios with full bidirectional capabilities.

### Tasks
- [ ] Define advanced streaming use cases
- [ ] Implement complex streaming patterns
- [ ] Performance optimization
- [ ] Load testing

---

## Current Status Summary

| Phase | Status | Completion Date |
|-------|--------|-----------------|
| Phase 1: Independent Operation | ✅ Completed | 2025-12-10 |
| Phase 2: JSONRPC + ADK LLM | ✅ Completed | 2025-12-10 |
| Phase 3: SSE Streaming | 🚧 In Progress | - |
| Phase 4: WebSocket Integration | 📋 Planned | - |
| Phase 5: Bidirectional Streaming | 📋 Planned | - |

---

## Next Immediate Steps

### Current State
- ✅ Frontend is fully functional with AI SDK v6 Data Stream Protocol
- ✅ Gemini Direct mode working with SSE streaming
- ✅ All AI SDK v6 migration issues resolved and documented
- ✅ **ADK backend integrated with actual LLM (InMemoryRunner + Agent)**
- ✅ **Both `/chat` and `/jsonrpc` endpoints working with ADK**
- ⏳ Next: Implement ADK backend SSE streaming endpoint

### Phase 3: ADK Backend SSE Implementation

1. **Implement SSE Endpoint in FastAPI** (`/stream`)
   - Generate SSE events matching AI SDK v6 format
   - Support `text-start`, `text-delta`, `text-end` event types
   - Add `data: [DONE]` terminator
   - Proper SSE headers (`Content-Type: text/event-stream`)

2. **Integrate ADK LLM Streaming**
   - Use Google ADK to generate streaming responses
   - Convert ADK token stream to AI SDK SSE format
   - Handle errors and edge cases

3. **Add `adk-sse` Mode to Frontend**
   - Update `app/api/chat/route.ts` to support `adk-sse` mode
   - Proxy SSE stream from ADK backend to frontend
   - Maintain same AI SDK protocol format

4. **End-to-End Testing**
   - Test with curl to verify SSE format
   - Test in browser with UI
   - Compare behavior with Gemini Direct mode

---

## Development Guidelines

- Follow TDD approach where applicable
- Keep commits small and focused
- Update this file as tasks progress
- Document any blockers or decisions in this file
- Run `just check` before committing

## Testing Commands

```bash
# Phase 1: Gemini Direct
echo 'BACKEND_MODE=gemini' > .env.local
pnpm dev

# Phase 2: JSONRPC
echo 'BACKEND_MODE=adk-jsonrpc' > .env.local
just dev

# Phase 3: SSE (when ready)
echo 'BACKEND_MODE=adk-sse' > .env.local
just dev

# Test backend directly
curl http://localhost:8000/
curl http://localhost:8000/health
curl -X POST http://localhost:8000/jsonrpc -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"chat","params":{"messages":[{"role":"user","content":"Hello"}]},"id":1}'
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
