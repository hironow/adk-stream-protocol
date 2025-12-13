# Development tasks for ADK-AI Data Protocol project

default: info

# Install all dependencies (both Python and Node.js)
install:
    uv sync
    pnpm install

# Run Python backend server
server:
    @echo "Starting backend server at http://localhost:8000"
    uv run uvicorn server:app --reload --host 0.0.0.0 --port 8000

# Run Next.js frontend development server
frontend:
    @echo "Starting frontend server at http://localhost:3000"
    pnpm dev

# Run both frontend and backend in parallel (requires 'just' with --jobs flag)
dev:
    @echo "Starting backend and frontend servers..."
    @echo "Backend: http://localhost:8000"
    @echo "Frontend: http://localhost:3000"
    just --jobs 2 server frontend

# Format all code (Python + frontend)
format: format-python format-frontend
    @echo "Code formatted successfully."

# Run linting for all code (Python + frontend)
lint: lint-python lint-frontend
    @echo "Linting completed."

# Run type checking for all code (Python only)
typecheck: typecheck-python
    @echo "Type checking completed."

# Run linting for Python
lint-python:
    uv run ruff check --fix .

# Format Python code
format-python:
    uv run ruff format .

# Run type checking for Python
typecheck-python:
    uv run mypy .

# Run linting for frontend (Biome)
lint-frontend:
    pnpm run lint

# Format frontend code (Biome)
format-frontend:
    pnpm run format

# Run Python tests
test-python:
    PYTHONPATH=. uv run pytest tests/unit/ -v

# Setup E2E fixture symlinks (public/ -> tests/fixtures/)
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
test-e2e:
    pnpm exec playwright test

# Run E2E tests with clean server restart - guarantees fresh servers
test-e2e-clean: clean-port
    @echo "Playwright will start fresh servers automatically..."
    @echo "Running E2E tests..."
    pnpm exec playwright test

# Run E2E tests with UI (headed mode)
test-e2e-ui:
    pnpm exec playwright test --ui

# Run E2E tests in headed mode (show browser) with clean servers
test-e2e-headed: clean-port
    @echo "Playwright will start fresh servers automatically..."
    @echo "Running E2E tests in headed mode..."
    pnpm exec playwright test --headed

# Install Playwright browsers
install-browsers:
    pnpm exec playwright install chromium

# Run all tests
test: test-python test-e2e

# Run all Python checks
check-python: lint-python typecheck-python test-python

# Run all checks
check: check-python lint-frontend

# Check coverage (unified command - shows both ADK and AI SDK coverage)
check-coverage:
    uv run python scripts/check-coverage.py
    @echo ""
    @echo "💡 For detailed report with field locations, run:"
    @echo "   uv run python scripts/check-coverage.py --verbose"

# Validate field_coverage_config.yaml against actual implementation (CI/CD ready)
check-coverage-validate:
    uv run python scripts/check-coverage.py --validate

# Check coverage with config-based priority grouping
check-coverage-config:
    uv run python scripts/check-coverage.py --use-config
    @echo ""
    @echo "💡 For detailed report with field locations, run:"
    @echo "   uv run python scripts/check-coverage.py --use-config --verbose"

# Extract all type definitions (both ADK and AI SDK)
extract-all-types:
    uv run python scripts/check-coverage.py --extract-only all

# Clean up any running servers on ports 3000 and 8000
clean-port:
    @echo "Stopping any existing servers on ports 3000 and 8000..."
    -lsof -ti:3000 | xargs kill -9 2>/dev/null || true
    -lsof -ti:8000 | xargs kill -9 2>/dev/null || true
    @echo "Ports stopped."

# Clean up generated files
clean-gen:
    @echo "Cleaning up generated files..."
    rm -rf .next
    rm -rf __pycache__
    find . -type d -name "*.egg-info" -exec rm -rf {} +
    find . -type d -name "__pycache__" -exec rm -rf {} +

# Clean up installed dependencies
clean-deps:
    @echo "Cleaning up installed dependencies..."
    rm -rf .venv
    rm -rf node_modules

# Clean up lock files
clean-lock:
    @echo "Cleaning up lock files..."
    rm -f pnpm-lock.yaml
    rm -f uv.lock

# Run E2E tests with clean server restart - guarantees fresh servers
kill:
    @echo "Stopping any existing servers on ports 3000, 3001, 3002 and 8000, 8001, 8002..."
    -lsof -ti:3000 | xargs kill -9 2>/dev/null || true
    -lsof -ti:3001 | xargs kill -9 2>/dev/null || true
    -lsof -ti:3002 | xargs kill -9 2>/dev/null || true
    -lsof -ti:8000 | xargs kill -9 2>/dev/null || true
    -lsof -ti:8001 | xargs kill -9 2>/dev/null || true
    -lsof -ti:8002 | xargs kill -9 2>/dev/null || true

# Show project info
info:
    @echo "ADK-AI Data Protocol Project"
    @echo "============================="
    @echo "Python version: $(cat .python-version)"
    @echo "Backend port: 8000"
    @echo "Frontend port: 3000"
    @echo ""
    @echo "Available commands:"
    @just --list --unsorted
