# Scripts Directory

This directory contains utility scripts for the ADK AI Data Protocol project.

## run-tests.sh

Unified test runner that manages tests across different dependency levels with optimized worker settings.

### Quick Start

```bash
# Run fast tests only (no external dependencies - parallel)
./scripts/run-tests.sh --no-deps

# Or use the justfile shortcut
just test-fast

# Run all tests
./scripts/run-tests.sh --all
just test-unified-all

# See what would be executed (dry run)
./scripts/run-tests.sh --all --dry-run
just test-dry-run
```

### Dependency Levels

The test runner categorizes tests by their external dependencies:

#### 1. No Dependencies (`--no-deps`)
**Fastest execution, parallel workers**

- `lib/tests/` - Vitest unit/integration/e2e with MSW mocks
- `app/tests/` - Vitest unit/integration tests
- `components/tests/` - Vitest component tests
- `tests/unit/` - Python unit tests
- `tests/integration/` - Python integration tests

**Worker count:** CPU count (parallel execution)
**Requirements:** None - uses mocks only

```bash
./scripts/run-tests.sh --no-deps
just test-fast
```

#### 2. Backend Only (`--backend-only`)
**Requires real backend server, sequential execution**

- `tests/e2e/` - Python E2E tests with real backend

**Worker count:** 1 (sequential)
**Requirements:** Backend server running on port 8000

```bash
# Start backend first
just server

# Then run tests (in another terminal)
./scripts/run-tests.sh --backend-only
```

#### 3. Full Stack (`--full`)
**Slowest, requires all servers, sequential execution**

- `scenarios/` - Playwright E2E tests with real servers and browser

**Worker count:** 1 (sequential)
**Requirements:** Backend (port 8000) + Frontend (port 3000) + Browser

```bash
# Start servers first
just dev  # Starts both backend and frontend

# Then run tests (in another terminal)
./scripts/run-tests.sh --full
just test-full-stack
```

### Test Type Filters

Run specific test types across all frameworks:

```bash
# Unit tests only (Python + TypeScript)
./scripts/run-tests.sh --unit
just test-unified-unit

# Integration tests only
./scripts/run-tests.sh --integration
just test-unified-integration

# E2E tests only (pytest e2e + playwright scenarios)
./scripts/run-tests.sh --e2e
just test-unified-e2e

# Scenario tests only (playwright)
./scripts/run-tests.sh --scenarios
```

### Worker Control

```bash
# Auto-detect workers (default)
./scripts/run-tests.sh --no-deps
# → Uses CPU count for no-deps tests
# → Uses 1 worker for backend-only and full stack

# Force sequential execution
./scripts/run-tests.sh --no-deps --sequential
./scripts/run-tests.sh --no-deps --workers=1

# Custom worker count
./scripts/run-tests.sh --no-deps --workers=4
```

### Selective Execution

```bash
# Skip Python tests
./scripts/run-tests.sh --all --skip-python

# Skip TypeScript tests
./scripts/run-tests.sh --all --skip-typescript

# Skip Playwright tests
./scripts/run-tests.sh --all --skip-playwright

# Run only Python E2E tests
./scripts/run-tests.sh --backend-only

# Run only TypeScript tests
./scripts/run-tests.sh --no-deps --skip-python
```

### Output Control

```bash
# Verbose output (shows commands and details)
./scripts/run-tests.sh --all --verbose

# Dry run (show what would be executed)
./scripts/run-tests.sh --all --dry-run
just test-dry-run

# Help message
./scripts/run-tests.sh --help
```

### Usage with justfile

The `justfile` provides convenient shortcuts:

```bash
# Fast tests (no dependencies)
just test-fast

# Tests with backend
just test-with-backend

# Full stack tests
just test-full-stack

# All tests
just test-unified-all

# Test type filters
just test-unified-unit
just test-unified-integration
just test-unified-e2e

# Dry run
just test-dry-run
```

### Legacy Commands

Existing `just` commands now use the unified runner internally:

```bash
# Python tests
just test-server-unit        # → ./scripts/run-tests.sh --unit --skip-typescript --skip-playwright
just test-server-integration # → ./scripts/run-tests.sh --integration --skip-typescript --skip-playwright
just test-server-e2e         # → ./scripts/run-tests.sh --backend-only
just test-server-all         # → ./scripts/run-tests.sh --all --skip-typescript --skip-playwright

# TypeScript tests
just test-frontend-lib       # → bun run test:lib (direct vitest call)
just test-frontend-app       # → bun run test:app (direct vitest call)
just test-frontend-components # → bun run test:components (direct vitest call)
just test-frontend-all       # → ./scripts/run-tests.sh --all --skip-python --skip-playwright

# E2E tests
just test-e2e                # → ./scripts/run-tests.sh --full
just test-e2e-clean          # → clean-port + ./scripts/run-tests.sh --full

# All tests
just test-all                # → ./scripts/run-tests.sh --all
```

### Dependency Matrix

| Test Category                 | Real Server | Real Frontend | Real Browser | Default Workers | API Key |
|-------------------------------|-------------|---------------|--------------|-----------------|---------|
| `lib/tests/` (vitest)         | No          | No            | No           | CPU count       | No      |
| `app/tests/` (vitest)         | No          | No            | No           | CPU count       | No      |
| `components/tests/` (vitest)  | No          | No            | No           | CPU count       | No      |
| `tests/unit/` (pytest)        | No          | No            | No           | CPU count       | No      |
| `tests/integration/` (pytest) | No          | No            | No           | CPU count       | No      |
| `tests/e2e/` (pytest)         | Yes         | No            | No           | 1 (sequential)  | Depends |
| `scenarios/` (playwright)     | Yes         | Yes           | Yes          | 1 (sequential)  | Depends |

### CI/CD Usage

```bash
# Run all tests in CI (respects dependencies)
./scripts/run-tests.sh --all

# Run fast tests for PR checks
./scripts/run-tests.sh --no-deps

# Run specific test types
./scripts/run-tests.sh --unit --integration
```

### Common Workflows

#### Local Development (Fast Feedback)
```bash
# During development, run fast tests only
just test-fast
# or
./scripts/run-tests.sh --no-deps
```

#### Pre-Commit (Quick Validation)
```bash
# Run unit and integration tests
./scripts/run-tests.sh --unit --integration
```

#### Pre-Push (Comprehensive)
```bash
# Run all tests except full E2E
./scripts/run-tests.sh --no-deps --backend-only
```

#### Full Validation (Before Merge)
```bash
# Start servers
just dev

# In another terminal, run all tests
just test-all
# or
./scripts/run-tests.sh --all
```

### Troubleshooting

#### Tests Fail with "Connection Refused"
- **Backend-only tests:** Ensure backend server is running on port 8000
  ```bash
  just server
  ```
- **Full stack tests:** Ensure both servers are running
  ```bash
  just dev
  ```

#### Worker Count Issues
- **Too many workers:** Reduce with `--workers=N`
- **Force sequential:** Use `--sequential` or `--workers=1`

#### Skip Specific Test Frameworks
Use `--skip-python`, `--skip-typescript`, or `--skip-playwright` if certain frameworks are not available.

### Exit Codes

- `0` - All tests passed
- `Non-zero` - One or more test suites failed

The summary at the end shows which test suites passed/failed.

### Examples

```bash
# Example 1: Fast feedback during development
./scripts/run-tests.sh --no-deps
# → Runs all mock-based tests in parallel

# Example 2: Test backend changes
just server  # Terminal 1
./scripts/run-tests.sh --backend-only  # Terminal 2

# Example 3: Full validation before PR
just dev  # Terminal 1
./scripts/run-tests.sh --all  # Terminal 2

# Example 4: Debug test execution plan
./scripts/run-tests.sh --all --dry-run --verbose

# Example 5: Run only Python unit tests
./scripts/run-tests.sh --unit --skip-typescript --skip-playwright

# Example 6: Run TypeScript tests with custom workers
./scripts/run-tests.sh --no-deps --skip-python --workers=4
```

## Other Scripts

(Document other scripts in this directory as they are added)
