# Codebase Structure

## Root-Level Organization

### Configuration Files
- `justfile` - Task runner (replaces Makefile)
- `pyproject.toml` - Python project config with ruff/mypy settings
- `package.json` - Node.js project config (pnpm)
- `uv.lock` - Python dependency lock file
- `pnpm-lock.yaml` - Node.js dependency lock file
- `.semgrep/python-rules.yaml` - Semgrep security rules

### Backend Core (Python)
- `server.py` - FastAPI server with SSE/WebSocket endpoints
- `adk_stream_protocol/` - Main package directory
  - `bidi_event_sender.py` - BIDI mode WebSocket event streaming
  - `sse_event_streamer.py` - SSE mode HTTP streaming  
  - `stream_protocol.py` - ADK to AI SDK v6 protocol converter
  - `adk_compat.py` - ADK compatibility utilities
  - `frontend_tool_service.py` - Frontend tool delegation (browser APIs)
  - `confirmation_interceptor.py` - Tool approval interceptor
  - `chunk_logger.py` - E2E test fixture recording
  - `chunk_player.py` - E2E test fixture playback
  - `result.py` - Rust-style Result[T, E] error handling

### Frontend Structure (TypeScript/React)

#### Next.js App Router
- `app/` - Next.js 15 app directory
  - `page.tsx` - Main chat interface with mode switcher
  - `layout.tsx` - Root layout with metadata
  - `api/chat/route.ts` - Gemini Direct mode API endpoint

#### React Components
- `components/` - UI components
  - `chat.tsx` - Main chat component using useChat hook
  - `message.tsx` - Message display with multimodal support
  - `tool-invocation.tsx` - Tool execution UI with approval flow
  - `audio-player.tsx` - PCM audio playback
  - `image-display.tsx` - Image rendering
  - `image-upload.tsx` - Image upload UI

#### Library Code
- `lib/` - Reusable utilities
  - `bidi/` - BIDI mode implementation
    - `transport.ts` - WebSocket transport for BIDI
    - `build-use-chat-options.ts` - useChat configuration builder
  - `sse/` - SSE mode implementation
    - `build-use-chat-options.ts` - SSE-specific configuration
  - `tests/` - Frontend test infrastructure
    - `e2e/` - End-to-end tests (12 files, 458 tests)
    - `integration/` - Integration tests
    - `unit/` - Unit tests
    - `helpers/` - Test utilities
      - `msw-setup.ts` - MSW server helper
      - `bidi-ws-handlers.ts` - WebSocket mock handlers
      - `sse-response-builders.ts` - SSE response builders
    - `mocks/` - MSW server configuration

### Test Organization

#### Root-Level Fixtures
- `fixtures/` - Centralized test fixtures
  - `backend/` - JSONL chunk recordings (8 files)
  - `frontend/` - JSON baseline fixtures (15 files)
  - `public/` - Symlinks to backend fixtures for web access
  - `README.md` - Fixture documentation with recording procedures

#### Backend Tests
- `tests/` - Python test suite (390 tests)
  - `unit/` - Unit tests (isolated component testing)
  - `integration/` - Integration tests (component interaction)
  - `e2e/` - End-to-end tests (full system with real dependencies)
  - `conftest.py` - Pytest fixtures and configuration
  - `utils/` - Shared test utilities (only importable location)

### Documentation

#### Main Documentation
- `docs/` - Current implementation documentation (NO TODOs, NO future plans)
  - `ARCHITECTURE.md` - System architecture
  - `IMPLEMENTATION.md` - Implementation status
  - `E2E_GUIDE.md` - E2E testing guide
  - `adr/` - Architecture Decision Records (immutable)

#### Agent Documentation
- `agents/` - Agent session tracking
  - `tasks.md` - Current active tasks (fixture recording pending)

### Utility Directories
- `scripts/` - Development and utility scripts
- `public/` - Next.js static assets
  - `fixtures/` - Symlink to `fixtures/public/` for E2E tests
- `.serena/` - Serena MCP configuration and memories

### Generated/Ignored Directories
- `logs/` - Application logs (gitignored)
- `.cache/` - Weather API cache (gitignored)
- `.next/` - Next.js build output (gitignored)
- `chunk_logs/` - Chunk logger output (gitignored)
- `test_chunks/` - Test chunk recordings (gitignored)
- `.mypy_cache/`, `.pytest_cache/`, `.ruff_cache/` - Tool caches
