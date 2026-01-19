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

# ============================================================================
# Code Quality Commands
# ============================================================================

# Format all code (Python + TypeScript)
[group("code")]
format: format-py format-ts
    @echo "Code formatted successfully."

# Run linting for all code (Python + TypeScript)
[group("code")]
lint: lint-py lint-ts
    @echo "Linting completed."

# Run all checks (lint + typecheck + agents)
[group("code")]
check: check-py check-ts md-lint check-agents
    @echo "All checks passed."


# ============================================================================
# Python Code Quality (ruff + mypy)
# ============================================================================

# Format Python code
[group("code-py")]
format-py:
    uv run ruff format .

# Lint Python code
[group("code-py")]
lint-py:
    uv run ruff check --fix .

# Type check Python code
[group("code-py")]
typecheck-py:
    uv run mypy .

# Run all Python checks (lint + typecheck + collect tests)
[group("code-py")]
check-py: lint-py typecheck-py
    uv run pytest --collect-only -q


# ============================================================================
# TypeScript Code Quality (biome)
# ============================================================================

# Format TypeScript code
[group("code-ts")]
format-ts:
    bun run format

# Lint TypeScript code
[group("code-ts")]
lint-ts:
    bun run lint

# Run all TypeScript checks (lint + list tests)
[group("code-ts")]
check-ts: lint-ts
    bunx vitest list


# ============================================================================
# Other Quality Checks
# ============================================================================

# Lint Markdown files
[group("docs")]
md-lint:
    @{{MARKDOWNLINT}} --fix "docs/**/*.md" "README.md" "experiments/**/*.md" "!node_modules/**" "!agents/**"

# Check ADK agents can be loaded (simulates adk web)
[group("code")]
check-agents:
    uv run python scripts/check_adk_agents.py

# Run Semgrep for security/static analysis
[group("security")]
semgrep:
    uv run semgrep --config .semgrep/ --error

# Install Playwright browsers
[group("setup")]
install-browsers:
    bunx playwright install chromium

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
# Test Commands
# ============================================================================

# Run fast tests (no server required) - pytest + vitest unit/integration
[group("test")]
test:
    @echo "Running fast tests (no server required)..."
    uv run pytest tests/unit/ tests/integration/ -n auto
    bunx vitest run lib/tests/unit lib/tests/integration

# Run all tests (requires servers for e2e/browser)
[group("test")]
test-all: test-py test-py-e2e test-ts test-browser
    @echo "All tests completed."


# ============================================================================
# Python Tests (pytest)
# ============================================================================

# Run Python unit + integration tests (no server required)
[group("test-py")]
test-py:
    @echo "Running Python tests (no server required)..."
    uv run pytest tests/unit/ tests/integration/ -n auto

# Run Python E2E tests (requires backend server on localhost:8000)
[group("test-py")]
test-py-e2e:
    @echo "Running Python E2E tests (requires backend server)..."
    uv run pytest tests/e2e/requires_server/ -n auto


# ============================================================================
# TypeScript Tests (vitest)
# ============================================================================

# Run Vitest unit + integration + e2e tests
[group("test-ts")]
test-ts:
    @echo "Running Vitest tests..."
    bunx vitest run

# Run Vitest E2E tests only
[group("test-ts")]
test-ts-e2e:
    @echo "Running Vitest E2E tests..."
    bunx vitest run lib/tests/e2e


# ============================================================================
# Browser Tests (playwright) - UI-specific tests only
# ============================================================================

# Run Playwright UI tests (requires frontend + backend servers)
[group("test-browser")]
test-browser:
    @echo "Running Playwright browser tests (requires servers)..."
    bunx playwright test scenarios/

# Update Playwright snapshots
[group("test-browser")]
test-browser-update:
    @echo "Updating Playwright snapshots..."
    bunx playwright test scenarios/ --update-snapshots
