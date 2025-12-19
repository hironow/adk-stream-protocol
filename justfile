# Development tasks for ADK Stream Protocol project

default: help

help:
    @just --list

# Install all dependencies (both Python and Node.js)
[group("setup")]
install:
    uv sync
    pnpm install

# Run Python backend server
[group("development")]
server:
    @echo "Starting backend server at http://localhost:8000"
    uv run uvicorn server:app --reload --host 0.0.0.0 --port 8000

# Run Next.js frontend development server
[group("development")]
frontend:
    @echo "Starting frontend server at http://localhost:3000"
    pnpm dev

# Run both frontend and backend in parallel (requires 'just' with --jobs flag)
[group("development")]
dev:
    @echo "Starting backend and frontend servers..."
    @echo "Backend: http://localhost:8000"
    @echo "Frontend: http://localhost:3000"
    just --jobs 2 server frontend

# Format all code (Python + frontend)
[group("development")]
format: format-python format-frontend
    @echo "Code formatted successfully."

# Run linting for all code (Python + frontend)
[group("development")]
lint: lint-python lint-frontend
    @echo "Linting completed."

# Run type checking for all code (Python only)
[group("development")]
typecheck: typecheck-python
    @echo "Type checking completed."

# Run linting for Python
[group("development")]
lint-python:
    uv run ruff check --fix .

# Format Python code
[group("development")]
format-python:
    uv run ruff format .

# Run type checking for Python
[group("development")]
typecheck-python:
    uv run mypy .

# Run linting for frontend (Biome)
[group("development")]
lint-frontend:
    pnpm run lint

# Format frontend code (Biome)
[group("development")]
format-frontend:
    pnpm run format

[group("testing")]
test-server-unit:
    uv run pytest tests/unit/

[group("testing")]
test-server-integration:
    uv run pytest tests/integration/

[group("testing")]
test-server-e2e:
    uv run pytest tests/e2e/

# Run server-side tests (pytest)
[group("testing")]
test-server-all: test-server-unit test-server-integration test-server-e2e

[group("testing")]
test-frontend-lib:
    pnpm run test:lib

[group("testing")]
test-frontend-app:
    pnpm run test:app

[group("testing")]
test-frontend-components:
    pnpm run test:components

[group("testing")]
test-frontend-e2e:
    pnpm run test:e2e

# Run frontend tests (Vitest)
[group("testing")]
test-frontend-all: test-frontend-lib test-frontend-app test-frontend-components test-frontend-e2e

# Setup E2E fixture symlinks (public/ -> tests/fixtures/)
[group("setup")]
setup-e2e-fixtures:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "Setting up E2E fixture symlinks..."
    mkdir -p public/fixtures/e2e-chunks
    cd public/fixtures/e2e-chunks
    for pattern in pattern1-gemini-only pattern2-adk-sse-only pattern3-adk-bidi-only pattern4-mode-switching; do
        if [ ! -L "$pattern" ]; then
            echo "Creating symlink: $pattern"
            ln -sf ../../../tests/fixtures/e2e-chunks/$pattern $pattern
        else
            echo "Symlink already exists: $pattern"
        fi
    done
    echo "E2E fixture symlinks ready."

# Run E2E tests (Playwright) - uses existing servers if running
[group("testing")]
test-e2e:
    pnpm run test:e2e

# Run E2E baseline tests (Playwright) - tools only with timeouts
[group("testing-baseline")]
test-baseline-e2e:
    @echo "Running E2E baseline tests..."
    pnpm exec playwright test e2e/tools/ --project=chromium --workers=1 --timeout=120000 --global-timeout=600000

# Run E2E tests with clean server restart - guarantees fresh servers
[group("testing")]
test-e2e-clean: clean-port
    @echo "Playwright will start fresh servers automatically..."
    @echo "Running E2E tests..."
    pnpm run test:e2e

# Install Playwright browsers
[group("setup")]
install-browsers:
    pnpm exec playwright install chromium

# Run all tests
[group("testing")]
test-all: test-server-all test-frontend-all test-e2e

# Run all Python checks
[group("development")]
check-python: lint-python typecheck-python

# Run all checks
[group("development")]
check: check-python
    @echo "All checks passed."

# Tail the latest chunk logs (for development debugging)
[group("development")]
tail-chunk-logs:
    tail -F $(ls -1dt chunk_logs/*/ | head -n 1)*.jsonl | jq --unbuffered -R 'fromjson? // .' -C


# Check coverage (unified command - shows both ADK and AI SDK coverage)
[group("compatibility")]
check-coverage:
    uv run python scripts/check-coverage.py
    @echo ""
    @echo "💡 For detailed report with field locations, run:"
    @echo "   uv run python scripts/check-coverage.py --verbose"

# Validate field_coverage_config.yaml against actual implementation (CI/CD ready)
[group("compatibility")]
check-coverage-validate:
    uv run python scripts/check-coverage.py --validate

# Check coverage with config-based priority grouping
[group("compatibility")]
check-coverage-config:
    uv run python scripts/check-coverage.py --use-config
    @echo ""
    @echo "💡 For detailed report with field locations, run:"
    @echo "   uv run python scripts/check-coverage.py --use-config --verbose"

# Extract all type definitions (both ADK and AI SDK)
[group("compatibility")]
extract-all-types:
    uv run python scripts/check-coverage.py --extract-only all

# Clean up any running servers on ports 3000 and 8000
[group("cleaner")]
clean-port:
    @echo "Stopping any existing servers on ports 3000 and 8000..."
    -lsof -ti:3000 | xargs kill -9 2>/dev/null || true
    -lsof -ti:8000 | xargs kill -9 2>/dev/null || true
    @echo "Ports stopped."

# Clean up generated files
[group("cleaner")]
clean-gen:
    @echo "Cleaning up generated files..."
    rm -rf .next
    rm -rf __pycache__
    find . -type d -name "*.egg-info" -exec rm -rf {} +
    find . -type d -name "__pycache__" -exec rm -rf {} +
    @echo "Generated files cleaned."

# Clean up installed dependencies
[group("cleaner")]
clean-deps:
    @echo "Cleaning up installed dependencies..."
    rm -rf .venv
    rm -rf node_modules
    @echo "Dependencies cleaned."

# Clean up lock files
[group("cleaner")]
clean-lock:
    @echo "Cleaning up lock files..."
    rm -f pnpm-lock.yaml
    rm -f uv.lock
    @echo "Lock files cleaned."

# Clean up log files
[group("cleaner")]
clean-logs:
    @echo "Cleaning up log files..."
    rm -rf logs
    rm -rf chunk_logs
    @echo "Log files cleaned."

# Run E2E tests with clean server restart - guarantees fresh servers
[group("cleaner")]
kill:
    @echo "Stopping any existing servers on ports 3000, 3001, 3002 and 8000, 8001, 8002..."
    -lsof -ti:3000 | xargs kill -9 2>/dev/null || true
    -lsof -ti:3001 | xargs kill -9 2>/dev/null || true
    -lsof -ti:3002 | xargs kill -9 2>/dev/null || true
    -lsof -ti:8000 | xargs kill -9 2>/dev/null || true
    -lsof -ti:8001 | xargs kill -9 2>/dev/null || true
    -lsof -ti:8002 | xargs kill -9 2>/dev/null || true
    @echo "Servers stopped."
