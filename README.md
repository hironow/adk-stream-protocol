# ADK Stream Protocol

AI SDK v6 and Google ADK integration demonstrating SSE and WebSocket streaming implementation.

---

## ⚠️ Development Status

This project is under **active development** and contains experimental features with known issues.

### Current Status

**✅ Stable Features**

- Gemini Direct mode (AI SDK v6 only)
- ADK SSE streaming with tool calling
- Complete E2E test infrastructure (Frontend, Backend, Playwright)

**🚧 Experimental Features**

- ADK BIDI (WebSocket) streaming - See known issues below

### Known Issues

**Critical: ADK BIDI Mode Limitations**

BIDI mode (`run_live()`) has two significant issues:

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

**Recent Fixes**

- ✅ Fixed infinite loop in tool confirmation auto-send logic (2025-12-17)

---

## 🎯 Project Overview

This project demonstrates the integration between:

- **Frontend**: Next.js 16 with AI SDK v6 beta
- **Backend**: Google ADK with FastAPI

### Three Streaming Modes

1. **Gemini Direct** - Direct Gemini API via AI SDK (stable)
2. **ADK SSE** - ADK backend with Server-Sent Events (stable)
3. **ADK BIDI** ⚡ - ADK backend with WebSocket bidirectional streaming (experimental)

**Key Insight:** All three modes use the same **AI SDK v6 Data Stream Protocol** format, ensuring consistent frontend behavior regardless of backend implementation.

---

## ✨ Key Features

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

---

## 🛠️ Tech Stack

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

---

## 🚀 Quick Start

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

```env
GOOGLE_GENERATIVE_AI_API_KEY=your_api_key_here
BACKEND_MODE=gemini
NEXT_PUBLIC_BACKEND_MODE=gemini
```

**For ADK SSE/BIDI:**

```env
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

---

## 🧪 Testing

**Python Backend Tests:**

```bash
just test-python
# Expected: ~200 passed (unit + integration + e2e)
```

**TypeScript Frontend Tests:**

```bash
pnpm test:lib
# Expected: ~565 passed (unit + integration + e2e)
```

**Playwright E2E Tests:**

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

---

## 📚 Documentation

Complete documentation is available in the `docs/` directory:

### Quick Start

- **[Getting Started Guide](docs/00_GETTING_STARTED.md)** - Detailed setup, usage, troubleshooting, AI SDK v6 migration
- **[Glossary](docs/00_GLOSSARY.md)** - Key terms, concepts, and patterns

### Architecture & Specs

- **[Architecture Overview](docs/spec_ARCHITECTURE.md)** - Complete system architecture
    - AudioWorklet PCM Streaming
    - Tool Approval Flow (Frontend Delegation Pattern)
    - Per-Connection State Management
    - Multimodal Support Architecture

- **[Protocol Implementation](docs/spec_PROTOCOL.md)** - ADK ↔ AI SDK v6 protocol
    - Event/Part field mapping
    - Implementation status
    - Custom extensions (data-pcm, data-image, etc.)

### Backend (Python)

- **[Result Type Pattern](docs/backend_RESULT_TYPE.md)** - `Ok(value)` / `Error(value)` error handling

### Frontend (TypeScript)

- **[Library Structure](docs/frontend_LIB_STRUCTURE.md)** - `lib/` organization and module dependencies
- **[React Optimization](docs/frontend_REACT_OPTIMIZATION.md)** - Memoization and performance patterns
- **[Vitest Tests](docs/frontend_TESTING_VITEST.md)** - `lib/tests/` structure (unit, integration, e2e)

### Testing

- **[Testing Strategy](docs/testing_STRATEGY.md)** - Overall test architecture (pytest, Vitest, Playwright)
- **[E2E Testing Guide](docs/testing_E2E.md)** - Complete E2E testing documentation
    - Backend E2E (pytest golden files)
    - Frontend E2E (Vitest browser tests)
    - Fixtures management
    - Chunk Logger debugging
- **[Coverage Audit](docs/testing_COVERAGE_AUDIT.md)** - Test coverage verification

### Architecture Decision Records

- **[ADR-0001](docs/adr/0001-per-connection-state-management.md)** - Per-Connection State Management
- **[ADR-0002](docs/adr/0002-tool-approval-architecture.md)** - Tool Approval Architecture
- **[ADR-0003](docs/adr/0003-sse-vs-bidi-confirmation-protocol.md)** - SSE vs BIDI Confirmation Protocol
- **[ADR-0004](docs/adr/0004-multi-tool-response-timing.md)** - Multi-Tool Response Timing
- **[ADR-0005](docs/adr/0005-frontend-execute-pattern-and-done-timing.md)** - Frontend Execute Pattern and [DONE] Timing
- **[ADR-0006](docs/adr/0006-send-automatically-when-decision-logic-order.md)** - sendAutomaticallyWhen Decision Logic Order
- **[ADR-0007](docs/adr/0007-approval-value-independence-in-auto-submit.md)** - Approval Value Independence
- **[ADR-0008](docs/adr/0008-sse-mode-pattern-a-only-for-frontend-tools.md)** - SSE Mode Pattern A Only
- **[ADR-0009](docs/adr/0009-phase12-blocking-mode-for-approval.md)** - Phase 12 Blocking Mode
- **[ADR-0010](docs/adr/0010-bidi-confirmation-chunk-generation.md)** - BIDI Confirmation Chunk Generation

### Additional Resources

- **[Experiments](experiments/README.md)** - Research notes, protocol investigations, multimodal experiments

---

## 🔬 Experiments & Research

All experiment notes and architectural investigations are documented in `experiments/`:

- Bidirectional protocol investigations
- Multimodal support (images, audio, video)
- Tool approval flow implementations
- Test coverage investigations
- ADK field mapping completeness

See [experiments/README.md](experiments/README.md) for the complete experiment index and results.

---

## 📄 License

MIT License. See LICENSE file for details.

---

## 🔗 References

- [AI SDK Documentation](https://sdk.vercel.ai/docs)
- [Google ADK Documentation](https://ai.google.dev/adk)
- [BGM](https://www.loopbgm.com/)

---

**Last Updated:** 2025-12-29
