# Suggested Commands

## Installation & Setup
```bash
just install        # Install all dependencies (Python + Node.js)
cp .env.example .env.local  # Setup environment
```

## Development
```bash
just dev           # Run both backend (8000) and frontend (3000)
just server        # Backend only (FastAPI on :8000)
pnpm dev          # Frontend only (Next.js on :3000)
```

## Code Quality
```bash
just lint          # Lint all code (Python + TypeScript)
just format        # Format all code
just typecheck     # Type check Python code
just check         # Run all checks
```

## Testing
```bash
just test-python   # Python unit tests
pnpm exec vitest   # TypeScript tests
just test-e2e-clean  # E2E tests with clean servers
just test-e2e-ui  # E2E tests with UI
just check-coverage  # Check field mapping coverage
```

## Python-specific
```bash
uv sync           # Install Python dependencies
uv run pytest tests/unit/ -v  # Run Python tests
uv run ruff check --fix .  # Lint Python
uv run ruff format .  # Format Python
uv run mypy .     # Type check Python
```

## TypeScript-specific
```bash
pnpm install      # Install Node dependencies
pnpm run lint     # Lint TypeScript (Biome)
pnpm run format   # Format TypeScript (Biome)
pnpm run build    # Build Next.js app
```

## Utility Commands (Darwin/macOS)
```bash
just kill         # Stop all servers on ports 3000-3002, 8000-8002
just clean-port   # Clean ports 3000 and 8000
lsof -ti:8000    # Find process on port 8000
```

## Git Commands (Standard)
```bash
git status
git add .
git commit -m "message"
git push origin branch-name
git pull
```

## Environment Variables
Key variables in .env.local:
- GOOGLE_GENERATIVE_AI_API_KEY (for Gemini Direct)
- GOOGLE_API_KEY (for ADK modes)
- BACKEND_MODE (gemini, adk-sse, adk-bidi)
- ADK_BACKEND_URL (http://localhost:8000)