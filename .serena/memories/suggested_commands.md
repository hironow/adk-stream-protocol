# Suggested Commands

## Task Runner (just)
All primary commands are defined in `justfile`. Run `just` or `just --list` to see all available commands.

## Development Workflow

### Initial Setup
```bash
# Install Python dependencies
uv sync

# Install Node.js dependencies
pnpm install

# Setup E2E fixture symlinks
just setup-e2e-fixtures
```

### Testing
```bash
# Run all tests (Python + TypeScript)
just test

# Python tests only
just test-python                    # All Python tests
uv run pytest tests/                # Direct pytest
uv run pytest tests/unit/           # Unit tests only
uv run pytest tests/integration/    # Integration tests only
uv run pytest tests/e2e/            # E2E tests only

# TypeScript tests only
just test-typescript                # All TypeScript tests
pnpm test:lib                       # Frontend library tests
pnpm test:components                # Component tests
pnpm test:app                       # App tests
pnpm exec vitest run lib/tests/ --max-concurrency=1  # With single concurrency
```

### Code Quality
```bash
# Format all code
just format                         # Python (ruff) + TypeScript (biome)
uv run ruff format .                # Python only
pnpm run format                     # TypeScript only

# Lint all code
just lint                           # Python (ruff) + TypeScript (biome)
uv run ruff check .                 # Python only
uv run ruff check --fix .           # Python with auto-fix
pnpm run lint                       # TypeScript only

# Type checking
just check                          # All checks (format, lint, typecheck, markdown)
uv run mypy .                       # Python type checking
pnpm exec tsc --noEmit              # TypeScript type checking

# Security analysis
just semgrep                        # Run Semgrep security rules
```

### Cleanup
```bash
# Clean all generated files and caches
just delete-all

# Clean specific items
rm -rf .next                        # Next.js build cache
rm -rf .mypy_cache                  # mypy cache
rm -rf .pytest_cache                # pytest cache
rm -rf .ruff_cache                  # ruff cache
rm -rf logs chunk_logs              # Log files
```

### Running the Application
```bash
# Backend server (FastAPI)
uv run uvicorn server:app --reload --port 8000

# Frontend development (Next.js)
pnpm dev                            # Runs on http://localhost:3000

# Full stack
# Terminal 1: uv run uvicorn server:app --reload --port 8000
# Terminal 2: pnpm dev
```

## Git Workflow
```bash
# Check status
git status

# Stage changes
git add .

# Commit (ensure all tests pass first!)
git commit -m "type(scope): message"

# Push
git push origin <branch-name>
```

## Debugging Commands
```bash
# View Python logs
tail -f logs/app.log

# Check chunk logs (E2E testing)
ls -lh chunk_logs/
cat chunk_logs/<session-id>/backend/*.jsonl
cat chunk_logs/<session-id>/frontend/*.jsonl

# Check test fixtures
ls -lh fixtures/backend/
ls -lh fixtures/frontend/
```

## System-Specific (macOS/Darwin)
```bash
# Find files
find . -name "*.py" -type f

# Search in files
grep -r "pattern" --include="*.py" .

# List directory tree
tree -L 2 -I 'node_modules|.next|__pycache__|.pytest_cache'

# Check port usage
lsof -i :8000                       # Check if port 8000 is in use
lsof -i :3000                       # Check if port 3000 is in use

# Kill process by port
kill -9 $(lsof -t -i:8000)
```

## Package Management
```bash
# Python (uv)
uv add <package>                    # Add dependency
uv add --dev <package>              # Add dev dependency
uv sync                             # Install all dependencies
uv run <command>                    # Run command in uv environment

# Node.js (pnpm)
pnpm add <package>                  # Add dependency
pnpm add -D <package>               # Add dev dependency
pnpm install                        # Install all dependencies
pnpm run <script>                   # Run package.json script
```

## Documentation
```bash
# Lint markdown files
just check                          # Includes markdownlint
pnpm exec markdownlint-cli2 "docs/**/*.md" "README.md"

# View documentation
open docs/ARCHITECTURE.md           # macOS
cat docs/ARCHITECTURE.md            # Terminal
```
