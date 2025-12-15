# ADK Stream Protocol

AI SDK v6 and Google ADK integration example demonstrating SSE and WebSocket streaming implementation.

## Project Overview

This project demonstrates the integration between:

- **Frontend**: Next.js 16 with AI SDK v6 beta
- **Backend**: Google ADK with FastAPI

The project provides **three streaming modes** with real-time mode switching:

1. **Gemini Direct** - Direct Gemini API via AI SDK
2. **ADK SSE** - ADK backend with Server-Sent Events
3. **ADK BIDI** ⚡ - ADK backend with WebSocket bidirectional streaming

**Key Insight:** All three modes use the same **AI SDK v6 Data Stream Protocol** format, ensuring consistent frontend behavior regardless of backend implementation.

## Current Status

**Phase 1: Gemini Direct** ✅ Production Ready

- Frontend: Next.js app with AI SDK v6 using `useChat` hook
- Direct connection to Gemini API (no backend needed)
- Built-in AI SDK v6 streaming support
- Tool calling: `get_weather`, `calculate`, `get_current_time`

**Phase 2: ADK SSE Streaming** ✅ Production Ready

- Backend: FastAPI server with Google ADK integration
- SSE streaming endpoint using ADK's `run_async()`
- Full AI SDK v6 Data Stream Protocol compatibility
- Real-time token-by-token streaming
- Tool calling via ADK agent

**Phase 3: ADK BIDI Streaming** ✅ Production Ready

- Backend: WebSocket endpoint using ADK's `run_live()`
- Bidirectional streaming via WebSocket
- Custom `WebSocketChatTransport` for AI SDK v6 `useChat`
- Real-time voice agent with native-audio models (Gemini 2.5 Flash)
- Audio transcription: input (user) and output (AI) speech-to-text
- Same tool calling support as SSE mode
- Multimodal support: images, audio, PCM streaming
- **Architecture:** "SSE format over WebSocket" (100% protocol reuse)

**Phase 4: E2E Test Infrastructure** ✅ Production Ready

- Chunk Logger & Player for recording and replaying actual data
- Frontend: ChunkPlayerTransport for mock transport layer
- Backend: ChunkPlayerManager for E2E mode detection
- 4 Test Patterns: Gemini Direct, ADK SSE, ADK BIDI, Mode Switching
- Golden File Testing: Regression testing with real recorded chunks

**Test Coverage** ✅ 100% Field Coverage Achieved

- Python: 112 unit tests (all passing)
- TypeScript: Integration tests with parametrized testing
- E2E: Playwright + pytest tests for all three modes
- **Field Coverage:** 12/12 Event fields, 7/7 Part fields (100%)
- **Critical Coverage:** Error handling, BIDI turn completion, message metadata

## Key Features

### Multimodal Capabilities

- **Text I/O**: Token-by-token streaming with AI SDK v6
- **Image Input/Output**: PNG, JPEG, WebP via `data-image` custom events
- **Audio Input**: Microphone recording (16kHz PCM) with CMD key push-to-talk
- **Audio Output**: PCM streaming (24kHz) with WAV playback
- **Audio Transcription**: Input and output speech-to-text with native-audio models
- **Tool Calling**: Full ADK integration with user approval flow

### Architecture Highlights

- **StreamProtocolConverter**: Converts ADK events to AI SDK v6 Data Stream Protocol
- **SSE format over WebSocket**: Backend sends SSE format via WebSocket for BIDI mode
- **Frontend Transparency**: Same `useChat` hook works across all three modes
- **Tool Approval Flow**: Frontend-delegated execution with AI SDK v6 approval APIs

## Tech Stack

**Frontend:**
- Next.js 16 (App Router)
- React 19
- AI SDK v6 beta (`ai`, `@ai-sdk/react`, `@ai-sdk/google`)
- TypeScript 5.7

**Backend:**
- Python 3.13
- Google ADK >=1.20.0
- FastAPI >=0.115.0
- Pydantic v2

**Development Tools:**
- pnpm (Node.js packages)
- uv (Python packages)
- just (task automation)

## Quick Start

### Prerequisites

- Python 3.13+
- Node.js 18+
- pnpm, uv, just

### Installation

```bash
# Install all dependencies
just install

# Or manually:
uv sync
pnpm install
```

### Environment Setup

Copy the example file:

```bash
cp .env.example .env.local
```

Edit `.env.local`:

**For Gemini Direct:**
```
GOOGLE_GENERATIVE_AI_API_KEY=your_api_key_here
BACKEND_MODE=gemini
NEXT_PUBLIC_BACKEND_MODE=gemini
```

**For ADK SSE/BIDI:**
```
GOOGLE_API_KEY=your_api_key_here
BACKEND_MODE=adk-sse
NEXT_PUBLIC_BACKEND_MODE=adk-sse
ADK_BACKEND_URL=http://localhost:8000
NEXT_PUBLIC_ADK_BACKEND_URL=http://localhost:8000
```

### Running

**Gemini Direct (frontend only):**
```bash
pnpm dev
```

**ADK SSE/BIDI (backend + frontend):**
```bash
# Run both concurrently:
just dev

# Or separately:
just server  # Backend on :8000
pnpm dev     # Frontend on :3000
```

For all available commands:
```bash
just --list
```

## Testing

**Python Unit Tests:**
```bash
just test-python
```

**TypeScript Integration Tests:**
```bash
pnpm exec vitest run
```

**End-to-End Tests:**
```bash
just test-e2e-clean  # Recommended: clean server restart
just test-e2e-ui     # Interactive UI mode
```

**Field Coverage Validation:**
```bash
just check-coverage           # Show field mapping coverage
just check-coverage-validate  # CI/CD validation
```

## Documentation

Comprehensive documentation is available in the `docs/` directory:

- **[Getting Started Guide](docs/GETTING_STARTED.md)** - Detailed setup, usage examples, troubleshooting, AI SDK v6 migration notes
- **[Architecture Documentation](docs/ARCHITECTURE.md)** - Complete architecture diagrams, protocol flows, tool approval system, multimodal implementation
- **[Implementation Status](docs/IMPLEMENTATION.md)** - ADK field mapping, AI SDK v6 protocol coverage, feature parity status
- **[E2E Testing Guide](docs/E2E_GUIDE.md)** - Frontend and backend E2E testing, chunk logger/player system, golden file testing
- **[Test Coverage Audit](docs/TEST_COVERAGE_AUDIT.md)** - Detailed test coverage report, parametrized test status
- **[Architecture Decision Records](docs/adr/)** - ADR 0001: Per-Connection State Management

Additional resources:

- **[Experiments](experiments/README.md)** - Research notes, protocol investigations, multimodal support experiments
- **[E2E Fixtures](tests/fixtures/e2e-chunks/README.md)** - E2E test chunks and recording guide

## Experiments & Research

All experiment notes and architectural investigations are documented in `experiments/`:

- Bidirectional protocol investigations
- Multimodal support (images, audio, video)
- Tool approval flow implementations
- Test coverage investigations
- ADK field mapping completeness

See `experiments/README.md` for the complete experiment index and results.

## License

MIT License. See LICENSE file for details.

## References

- [BGM](https://www.loopbgm.com/)
