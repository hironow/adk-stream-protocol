# Tech Stack

## Backend (Python)
- **Framework**: FastAPI 0.115+
- **Language**: Python 3.13+ with type annotations
- **Package Manager**: uv (modern pip replacement)
- **Google ADK**: google-genai 1.0+ for AI interactions
- **Async Runtime**: asyncio with aiohttp for HTTP requests
- **Logging**: loguru (replaces standard logging)
- **Testing**: pytest, pytest-asyncio
- **Linting**: ruff (replaces flake8, black, isort)
- **Type Checking**: mypy with strict mode
- **Security**: semgrep for static analysis

## Frontend (TypeScript/React)
- **Framework**: Next.js 15 (App Router)
- **Language**: TypeScript 5.7+ with strict mode
- **Package Manager**: pnpm (replaces npm)
- **UI Library**: React 19
- **AI SDK**: @ai-sdk/react (Vercel AI SDK v6)
- **Styling**: Tailwind CSS
- **Testing**: Vitest, @testing-library/react
- **E2E Testing**: MSW (Mock Service Worker) for HTTP/WebSocket mocking
- **Linting**: Biome (replaces ESLint, Prettier)
- **Type Checking**: TypeScript compiler (tsc)

## Development Tools
- **Task Runner**: just (justfile, replaces Makefile)
- **Git Hooks**: Manual (pre-commit checks in justfile)
- **Documentation**: Markdown with markdownlint-cli2
- **Code Coverage**: pytest-cov for backend, vitest coverage for frontend

## Key Dependencies
- **AI Models**: Google Gemini via ADK
- **WebSocket**: FastAPI WebSocket + MSW for testing
- **SSE**: FastAPI EventSourceResponse + fetch API
- **Audio**: PCM streaming (backend) + Web Audio API (frontend)
- **Images**: PIL/Pillow (backend) + Next.js Image (frontend)

## Development Requirements
- **Python**: 3.13+ (managed by uv)
- **Node.js**: 18+ (managed by pnpm)
- **System**: macOS (Darwin) - primary development platform
