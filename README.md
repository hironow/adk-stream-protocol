# ADK Stream Protocol

AI SDK v6 and Google ADK integration example demonstrating SSE and WebSocket streaming implementation.

## ⚠️ Development Status

This project is under **active development** and contains experimental features with known issues.

### Current Status

**✅ Stable Features**

- Gemini Direct mode (AI SDK v6 only)
- ADK SSE streaming with tool calling
- Frontend/Backend E2E test infrastructure

**🚧 Experimental Features**

- ADK BIDI (WebSocket) streaming - See known issues below

### Known Issues

**Critical: ADK BIDI Mode Limitations**

BIDI mode (`run_live()`) has two significant issues that limit production use:

1. **Tool Confirmation Not Working** 🔴
   - Tools with `require_confirmation=True` do not trigger approval UI
   - Root cause: ADK `FunctionTool._call_live()` TODO - "tool confirmation not yet supported for live mode"
   - Status: Known ADK limitation, awaiting upstream fix
   - Workaround: Use SSE mode for tools requiring confirmation

2. **Missing Text Responses After Tool Execution** 🟡
   - Tools execute successfully but AI generates no explanatory text
   - Only raw JSON output shown to user
   - Status: Under investigation
   - Workaround: Use SSE mode for full tool support

**See:** [docs/BUG-ADK-BIDI-TOOL-CONFIRMATION.md](docs/BUG-ADK-BIDI-TOOL-CONFIRMATION.md) for detailed analysis

**Recent Fixes**

- ✅ Fixed infinite loop in tool confirmation auto-send logic (2025-12-17)

## Project Overview

This project demonstrates the integration between:

- **Frontend**: Next.js 16 with AI SDK v6 beta
- **Backend**: Google ADK with FastAPI

The project provides **three streaming modes** with real-time mode switching:

1. **Gemini Direct** - Direct Gemini API via AI SDK (stable)
2. **ADK SSE** - ADK backend with Server-Sent Events (stable)
3. **ADK BIDI** ⚡ - ADK backend with WebSocket bidirectional streaming (experimental)

**Key Insight:** All three modes use the same **AI SDK v6 Data Stream Protocol** format, ensuring consistent frontend behavior regardless of backend implementation.

## Key Features

### Streaming Modes

- **Gemini Direct**: Built-in AI SDK v6 streaming support
- **ADK SSE**: Token-by-token streaming via Server-Sent Events
- **ADK BIDI**: Bidirectional WebSocket streaming for voice agents

### Multimodal Capabilities

- **Text I/O**: Token-by-token streaming with AI SDK v6
- **Image Input/Output**: PNG, JPEG, WebP via `data-image` custom events
- **Audio Input**: Microphone recording (16kHz PCM) with CMD key push-to-talk
- **Audio Output**: PCM streaming (24kHz) with WAV playback
- **Audio Transcription**: Input and output speech-to-text with native-audio models
- **Tool Calling**: ADK integration with user approval flow (SSE mode)

### Architecture Highlights

- **StreamProtocolConverter**: Converts ADK events to AI SDK v6 Data Stream Protocol
- **SSE format over WebSocket**: Backend sends SSE format via WebSocket for BIDI mode
- **Frontend Transparency**: Same `useChat` hook works across all three modes
- **Custom Transport**: `WebSocketChatTransport` for AI SDK v6 WebSocket support
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
# Expected: 231 passed
```

**TypeScript Unit Tests:**

```bash
pnpm run test:lib
# Expected: 255 passed
```

**End-to-End Tests:**

```bash
just test-e2e-clean  # Recommended: clean server restart
just test-e2e-ui     # Interactive UI mode
```

**Code Quality:**

```bash
just format  # Format code
just lint    # Run linters
just check   # Run type checks
```

## Documentation

Comprehensive documentation is available in the `docs/` directory:

### Core Documentation

- **[Getting Started Guide](docs/GETTING_STARTED.md)** - Detailed setup, usage examples, troubleshooting, AI SDK v6 migration notes
- **[Architecture Documentation](docs/ARCHITECTURE.md)** - Complete architecture diagrams, protocol flows, tool approval system, multimodal implementation
- **[Implementation Status](docs/IMPLEMENTATION.md)** - ADK field mapping, AI SDK v6 protocol coverage, feature parity status

### Testing & Quality

- **[E2E Testing Guide](docs/E2E_GUIDE.md)** - Frontend and backend E2E testing, chunk logger/player system, golden file testing
- **[Test Coverage Audit](docs/TEST_COVERAGE_AUDIT.md)** - Detailed test coverage report, parametrized test status

### Technical Notes

- **[React Memoization](docs/REACT_MEMOIZATION.md)** - React performance optimization patterns
- **[Bug Report: ADK BIDI Tool Confirmation](docs/BUG-ADK-BIDI-TOOL-CONFIRMATION.md)** - Known BIDI mode issues analysis

### Architecture Decision Records

- **[ADR 0001: Per-Connection State Management](docs/adr/0001-per-connection-state-management.md)**
- **[ADR 0002: Tool Approval Architecture](docs/adr/0002-tool-approval-architecture.md)**

### Additional Resources

- **[Experiments](experiments/README.md)** - Research notes, protocol investigations, multimodal support experiments
- **[E2E Fixtures](tests/fixtures/e2e-chunks/README.md)** - E2E test chunks and recording guide

## Experiments & Research

All experiment notes and architectural investigations are documented in `experiments/`:

- Bidirectional protocol investigations
- Multimodal support (images, audio, video)
- Tool approval flow implementations
- Test coverage investigations
- ADK field mapping completeness

See [experiments/README.md](experiments/README.md) for the complete experiment index and results.

## License

MIT License. See LICENSE file for details.

## References

- [AI SDK Documentation](https://sdk.vercel.ai/docs)
- [Google ADK Documentation](https://ai.google.dev/adk)
- [BGM](https://www.loopbgm.com/)
