# Development tasks for ADK-AI Data Protocol project

# Install all dependencies (both Python and Node.js)
install:
    uv sync
    pnpm install

# Run Python backend server
server:
    uv run uvicorn server:app --reload --host 0.0.0.0 --port 8000

# Run Next.js frontend development server
frontend:
    pnpm dev

# Run both frontend and backend in parallel (requires 'just' with --jobs flag)
dev:
    @echo "Starting backend and frontend servers..."
    @echo "Backend: http://localhost:8000"
    @echo "Frontend: http://localhost:3000"
    just --jobs 2 server frontend

# Run linting for Python
lint-python:
    uv run ruff check .

# Format Python code
fmt-python:
    uv run ruff format .

# Run type checking for Python
typecheck-python:
    uv run mypy .

# Run Python tests
test-python:
    PYTHONPATH=. uv run pytest tests/unit/ -v

# Run E2E tests (Playwright) - uses existing servers if running
test-e2e:
    pnpm exec playwright test

# Run E2E tests with clean server restart - guarantees fresh servers
test-e2e-clean:
    @echo "Stopping any existing servers on ports 3000 and 8000..."
    -lsof -ti:3000 | xargs kill -9 2>/dev/null || true
    -lsof -ti:8000 | xargs kill -9 2>/dev/null || true
    @echo "Playwright will start fresh servers automatically..."
    @echo "Running E2E tests..."
    pnpm exec playwright test

# Run E2E tests with UI (headed mode)
test-e2e-ui:
    pnpm exec playwright test --ui

# Run E2E tests in headed mode (show browser) with clean servers
test-e2e-headed:
    @echo "Stopping any existing servers on ports 3000 and 8000..."
    -lsof -ti:3000 | xargs kill -9 2>/dev/null || true
    -lsof -ti:8000 | xargs kill -9 2>/dev/null || true
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

# Run Next.js linting
lint-frontend:
    pnpm lint

# Run all checks
check: check-python lint-frontend

# Clean up generated files
clean:
    rm -rf .next
    rm -rf node_modules
    rm -rf .venv
    rm -rf __pycache__
    find . -type d -name "*.egg-info" -exec rm -rf {} +
    find . -type d -name "__pycache__" -exec rm -rf {} +

# Show project info
info:
    @echo "ADK-AI Data Protocol Project"
    @echo "============================="
    @echo "Python version: $(cat .python-version)"
    @echo "Backend port: 8000"
    @echo "Frontend port: 3000"
    @echo ""
    @echo "Available commands:"
    @just --list
