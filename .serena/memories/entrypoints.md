# Project Entrypoints

## Backend Server (FastAPI)

### Main Entry Point
- **File**: `server.py`
- **Command**: `uv run uvicorn server:app --reload --port 8000`
- **URL**: http://localhost:8000
- **Description**: FastAPI server providing ADK SSE and BIDI endpoints

### Key Endpoints
```
# SSE Mode (Server-Sent Events)
POST /api/chat/adk-sse
- Content-Type: application/json
- Returns: text/event-stream

# BIDI Mode (WebSocket)
WebSocket /live
- Bidirectional real-time communication
- Supports audio, text, images, tool execution

# Health Check
GET /health
- Returns: {"status": "ok"}

# API Documentation
GET /docs
- FastAPI auto-generated Swagger UI
```

### Environment Variables
```bash
# Required
GOOGLE_API_KEY=<your-gemini-api-key>

# Optional (for debugging)
CHUNK_LOGGER_ENABLED=true
CHUNK_LOGGER_OUTPUT_DIR=./chunk_logs
CHUNK_LOGGER_SESSION_ID=session-name
```

## Frontend Application (Next.js)

### Main Entry Point
- **File**: `app/page.tsx`
- **Command**: `pnpm dev`
- **URL**: http://localhost:3000
- **Description**: Next.js chat interface with mode switching

### Mode Selector
Users can switch between three modes:
1. **Gemini Direct**: Direct Gemini API via Next.js API route
2. **ADK SSE**: Server-Sent Events via FastAPI backend
3. **ADK BIDI**: WebSocket bidirectional via FastAPI backend

### Key Components
```typescript
// Main chat component
app/page.tsx
  └─ components/chat.tsx
       └─ useChat() hook from @ai-sdk/react
            └─ Mode-specific configuration
                 ├─ lib/bidi/build-use-chat-options.ts (WebSocket)
                 ├─ lib/sse/build-use-chat-options.ts (SSE)
                 └─ Default (Gemini Direct via API route)
```

## Test Entrypoints

### Backend Tests
```bash
# All tests
uv run pytest tests/

# Specific test types
uv run pytest tests/unit/                 # Unit tests
uv run pytest tests/integration/          # Integration tests
uv run pytest tests/e2e/                  # E2E tests

# Specific test file
uv run pytest tests/unit/test_stream_protocol.py -v
```

### Frontend Tests
```bash
# All library tests
pnpm test:lib

# With single concurrency (recommended for E2E)
pnpm exec vitest run lib/tests/ --max-concurrency=1

# Specific test types
pnpm test:components                      # Component tests
pnpm test:app                             # App tests

# Specific test file
pnpm exec vitest run lib/tests/e2e/bidi-use-chat.e2e.test.tsx
```

## Development Workflow

### Full Stack Development
```bash
# Terminal 1: Backend
uv run uvicorn server:app --reload --port 8000

# Terminal 2: Frontend
pnpm dev

# Access application at http://localhost:3000
```

### Testing Workflow
```bash
# 1. Clean environment
just delete-all

# 2. Run all quality checks
just format && just lint && just check && just semgrep

# 3. Run all tests
just test

# 4. If all pass, commit
git add .
git commit -m "type(scope): description"
```

## Debugging Entrypoints

### Chunk Logger (E2E Testing)
```bash
# Enable chunk logging
export CHUNK_LOGGER_ENABLED=true
export CHUNK_LOGGER_OUTPUT_DIR=./chunk_logs
export CHUNK_LOGGER_SESSION_ID=debug-session

# Run application (generates chunk logs)
uv run uvicorn server:app --reload --port 8000

# View recorded chunks
cat chunk_logs/debug-session/backend/*.jsonl
cat chunk_logs/debug-session/frontend/*.jsonl
```

### Application Logs
```bash
# View backend logs
tail -f logs/app.log

# View frontend dev server logs
# (printed to terminal where pnpm dev is running)
```
