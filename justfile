# Development tasks for ADK Stream Protocol project

default: help

help:
    @just --list


# Define specific commands
MARKDOWNLINT := "bun x markdownlint-cli2"
PDOC := "uv run pdoc"


# Install all dependencies (both Python and Node.js)
[group("setup")]
install:
    uv sync
    bun install

# Run Python backend server
[group("development")]
server port="8000" host="0.0.0.0":
    @echo "Starting backend server at http://localhost:{{port}}"
    uv run uvicorn server:app --reload --host {{host}} --port {{port}}

[group("development")]
pdoc port="8888":
    @echo "Starting pdoc documentation server at http://localhost:{{port}}"
    {{PDOC}} --port {{port}} ./adk_stream_protocol

# Run Next.js frontend development server
[group("development")]
frontend:
    @echo "Starting frontend server at http://localhost:3000"
    bun run dev

# Run both frontend and backend in parallel
[group("development")]
dev:
    @echo "Starting backend and frontend servers..."
    @echo "Backend: http://localhost:8000"
    @echo "Frontend: http://localhost:3000"
    @echo "Press Ctrl+C to stop both servers"
    (trap 'kill 0' INT; uv run uvicorn server:app --reload --host 0.0.0.0 --port 8000 & bun run dev & wait)

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
    bun run lint

# Format frontend code (Biome)
[group("development")]
format-frontend:
    bun run format

# Run Semgrep for security/static analysis
[group("development")]
semgrep:
    uv run semgrep --config .semgrep/ --error


# Run Markdown linting and auto-fix
[group("development")]
md-lint:
    @{{MARKDOWNLINT}} --fix "docs/**/*.md" "README.md" "experiments/**/*.md" "!node_modules/**" "!agents/**"


# Install Playwright browsers
[group("setup")]
install-browsers:
    bunx playwright install chromium

# Run all Python checks
[group("development")]
check-python: lint-python typecheck-python
    uv run pytest --collect-only -q

# Run all TypeScript checks
[group("development")]
check-typescript: lint-frontend
    bunx vitest list

# Check ADK agents can be loaded (simulates adk web)
[group("development")]
check-agents:
    uv run python scripts/check_adk_agents.py

# Run all checks
[group("development")]
check: check-python check-typescript md-lint check-agents
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
[group("hardercleaner")]
delete-gen:
    @echo "Cleaning up generated files..."
    rm -rf .next
    rm -rf .mypy_cache
    rm -rf .pytest_cache
    rm -rf .ruff_cache
    rm -rf __pycache__
    rm -rf test_chunks
    find . -type d -name "*.egg-info" -exec rm -rf {} +
    find . -type d -name "__pycache__" -exec rm -rf {} +
    @echo "Generated files cleaned."

# Delete installed dependencies
[group("hardercleaner")]
delete-deps:
    @echo "Cleaning up installed dependencies..."
    rm -rf .venv
    rm -rf node_modules
    @echo "Dependencies cleaned."

# Delete lock files
[group("hardercleaner")]
delete-lock:
    @echo "Cleaning up lock files..."
    rm -f bun.lock
    rm -f uv.lock
    @echo "Lock files cleaned."

# Clean up log files
[group("hardercleaner")]
delete-logs:
    @echo "Cleaning up log files..."
    rm -rf logs
    rm -rf chunk_logs
    rm -rf test_chunks
    @echo "Log files cleaned."

# Kill expected ports for a harder clean
[group("hardercleaner")]
kill:
    @echo "Stopping any existing servers on ports 3000, 3001, 3002 and 8000, 8001, 8002..."
    -lsof -ti:3000 | xargs kill -9 2>/dev/null || true
    -lsof -ti:3001 | xargs kill -9 2>/dev/null || true
    -lsof -ti:3002 | xargs kill -9 2>/dev/null || true
    -lsof -ti:8000 | xargs kill -9 2>/dev/null || true
    -lsof -ti:8001 | xargs kill -9 2>/dev/null || true
    -lsof -ti:8002 | xargs kill -9 2>/dev/null || true
    @echo "Servers stopped."

# Run all cleaning tasks
[group("hardercleaner")]
delete-all: delete-gen delete-logs
    @echo "All cleaning tasks completed."


# ============================================================================
# Python Test Commands (pytest)
# ============================================================================

# Run Python tests without server dependencies (parallel execution)
[group("testing-python")]
test-py-fast:
    @echo "Running Python tests (no server required, parallel)..."
    uv run pytest tests/unit/ tests/integration/ -n auto

# Run all Python tests including E2E (requires backend server)
[group("testing-python")]
test-py-all:
    @echo "Running all Python tests..."
    uv run pytest -n auto

# Run Python E2E tests requiring server (BIDI/SSE endpoints)
[group("testing-python")]
test-py-e2e:
    @echo "Running Python E2E tests (requires backend server on localhost:8000)..."
    uv run pytest tests/e2e/requires_server/ -n auto


# ============================================================================
# Unified Test Runner (scripts/run-tests.sh)
# ============================================================================

# Run fast tests only (no external dependencies - parallel execution)
[group("testing-unified")]
test-fast:
    @echo "Running fast tests (no dependencies, parallel)..."
    ./scripts/run-tests.sh --no-deps

# Run tests requiring backend server
[group("testing-unified")]
test-with-backend:
    @echo "Running tests with backend dependencies..."
    ./scripts/run-tests.sh --no-deps --backend-only

# Run full stack tests (backend + frontend + browser)
[group("testing-unified")]
test-full-stack:
    @echo "Running full stack tests (sequential, requires servers)..."
    ./scripts/run-tests.sh --full

# Run all tests (unified test runner)
[group("testing-unified")]
test-unified-all:
    @echo "Running all tests through unified runner..."
    ./scripts/run-tests.sh --all

# Run only unit tests across all frameworks
[group("testing-unified")]
test-unified-unit:
    @echo "Running all unit tests..."
    ./scripts/run-tests.sh --unit

# Run only integration tests across all frameworks
[group("testing-unified")]
test-unified-integration:
    @echo "Running all integration tests..."
    ./scripts/run-tests.sh --integration

# Run only E2E tests (pytest + playwright)
[group("testing-unified")]
test-unified-e2e:
    @echo "Running all E2E tests..."
    ./scripts/run-tests.sh --e2e

# Show what tests would run (dry-run)
[group("testing-unified")]
test-dry-run:
    @echo "Dry run - showing test execution plan..."
    ./scripts/run-tests.sh --all --dry-run
