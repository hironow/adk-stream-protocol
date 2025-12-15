# Codebase Structure

## Root Files
- `server.py` - FastAPI backend server (ADK integration)
- `stream_protocol.py` - ADK to AI SDK v6 protocol converter
- `ai_sdk_v6_compat.py` - AI SDK v6 compatibility layer
- `tool_delegate.py` - Tool delegation implementation
- `chunk_logger.py` - Chunk logging for E2E testing
- `chunk_player.py` - Chunk replay for E2E testing
- `justfile` - Task runner configuration
- `pyproject.toml` - Python project config
- `package.json` - Node.js project config

## Frontend Directories
- `app/` - Next.js app router pages
  - `page.tsx` - Main chat interface
  - `layout.tsx` - Root layout
  - `api/` - API routes (Gemini Direct mode)
- `components/` - React components
  - `chat.tsx` - Main chat component
  - `message.tsx` - Message display
  - `audio-player.tsx` - PCM audio playback
- `lib/` - Frontend utilities
  - `websocket-chat-transport.ts` - WebSocket transport for BIDI
  - `build-use-chat-options.ts` - Mode-specific configuration
  - `audio-recorder.ts` - Audio recording utilities
  - `chunk-*.ts` - E2E testing utilities
- `public/` - Static assets

## Backend Directories
- `tests/` - All test files
  - `unit/` - Python unit tests
  - `integration/` - Integration tests
  - `e2e/` - End-to-end tests
  - `fixtures/` - Test fixtures and recordings
- `scripts/` - Utility scripts
  - `check-coverage.py` - Field coverage validation
  - `field_coverage_config.yaml` - Coverage configuration
- `logs/` - Application logs (gitignored)
- `.cache/` - Weather API cache (gitignored)

## Documentation
- `docs/` - Main documentation
  - `GETTING_STARTED.md` - Setup guide
  - `ARCHITECTURE.md` - System architecture
  - `IMPLEMENTATION.md` - Implementation status
  - `adr/` - Architecture Decision Records
- `agents/` - Agent documentation
  - `tasks.md` - Task tracking
  - `reviews.md` - Technical reviews
  - `handsoff.md` - Session handoff notes
- `experiments/` - Research and experiments
- `TEMP_FAQ.md` - Comprehensive FAQ (4000+ lines)