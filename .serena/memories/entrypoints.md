# Project Entrypoints

## Backend Entrypoints

### Main Server
- **File**: `server.py`
- **FastAPI app**: Variable `app` at line 61
- **Start Command**: `uv run uvicorn server:app --reload --host 0.0.0.0 --port 8000`
- **Endpoints**:
  - POST `/stream` - SSE streaming endpoint
  - WS `/live` - WebSocket BIDI endpoint

### Key Backend Modules
- `stream_protocol.py` - Protocol conversion (ADK → AI SDK v6)
- `ai_sdk_v6_compat.py` - Message compatibility layer
- `tool_delegate.py` - Tool execution delegation

## Frontend Entrypoints

### Main App
- **File**: `app/page.tsx`
- **Start Command**: `pnpm dev` (runs next dev -p 3000)
- **Main Component**: Chat interface with mode switching

### API Routes (Gemini Direct)
- `app/api/chat/route.ts` - Gemini Direct mode API

### Key Frontend Modules
- `components/chat.tsx` - Main chat component
- `lib/build-use-chat-options.ts` - Mode configuration
- `lib/websocket-chat-transport.ts` - WebSocket transport

## Development Commands

### Start Everything
```bash
just dev  # Starts both backend (8000) and frontend (3000)
```

### Individual Services
```bash
just server  # Backend only
pnpm dev    # Frontend only
```

## Environment Modes
Set in `.env.local`:
1. `BACKEND_MODE=gemini` - Direct Gemini API (no backend needed)
2. `BACKEND_MODE=adk-sse` - ADK with SSE streaming
3. `BACKEND_MODE=adk-bidi` - ADK with WebSocket BIDI

## Testing Entrypoints
- Python: `pytest tests/unit/` via `just test-python`
- TypeScript: `vitest` via `pnpm exec vitest`
- E2E: Playwright via `just test-e2e-clean`