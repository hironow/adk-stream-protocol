#!/usr/bin/env bash

# Unified test runner for ADK AI Data Protocol
# Manages tests across different dependency levels with optimized worker settings

set -euo pipefail

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default settings
WORKERS=""
SEQUENTIAL=false
VERBOSE=false
DRY_RUN=false
SKIP_PYTHON=false
SKIP_TYPESCRIPT=false
SKIP_PLAYWRIGHT=false

# Test selection flags
RUN_ALL=false
RUN_NO_DEPS=false
RUN_BACKEND_ONLY=false
RUN_FULL=false
RUN_UNIT=false
RUN_INTEGRATION=false
RUN_E2E=false
RUN_SCENARIOS=false

# Results tracking
FAILED_TESTS=()
PASSED_TESTS=()

# Usage function
usage() {
    cat <<EOF
Usage: $0 [OPTIONS]

Unified test runner with dependency-based execution control.

DEPENDENCY LEVELS:
  --all                Run all tests (default if no flags specified)
  --no-deps            Tests with NO dependencies (mocks only)
                       - lib/tests/ (vitest unit/integration/e2e with MSW)
                       - app/tests/ (vitest)
                       - components/tests/ (vitest)
                       - tests/unit/ (pytest)
                       - tests/integration/ (pytest)
  --backend-only       Tests requiring REAL BACKEND only
                       - tests/e2e/ (pytest)
  --full               Tests requiring FULL STACK (backend + frontend + browser)
                       - scenarios/ (playwright)

TEST TYPE FILTERS:
  --unit               Run only unit tests
  --integration        Run only integration tests
  --e2e                Run only E2E tests (pytest e2e + playwright scenarios)
  --scenarios          Run only scenario tests (playwright)

EXECUTION CONTROL:
  --workers=N          Set number of workers (default: auto-detect)
                       - No-deps tests: CPU count
                       - Backend/Full: 1 (sequential)
  --sequential         Force sequential execution (--workers=1)

TEST SELECTION:
  --skip-python        Skip all Python tests (pytest)
  --skip-typescript    Skip all TypeScript tests (vitest)
  --skip-playwright    Skip all Playwright tests

OUTPUT CONTROL:
  --verbose            Show detailed output
  --dry-run            Show commands without executing
  --help               Show this help message

EXAMPLES:
  # Run all tests with no external dependencies (fast, parallel)
  $0 --no-deps

  # Run full E2E tests (requires running servers, sequential)
  $0 --full

  # Run only unit tests across all frameworks
  $0 --unit

  # Run backend E2E tests only (requires backend server)
  $0 --backend-only

  # Run everything (all dependency levels)
  $0 --all

  # Dry run to see what would be executed
  $0 --all --dry-run

DEPENDENCY MATRIX:
  Test Category              | Server | Frontend | Browser | Default Workers
  ---------------------------|--------|----------|---------|----------------
  lib/tests/ (vitest)        | No     | No       | No      | CPU count
  app/tests/ (vitest)        | No     | No       | No      | CPU count
  components/tests/ (vitest) | No     | No       | No      | CPU count
  tests/unit/ (pytest)       | No     | No       | No      | CPU count
  tests/integration/ (pytest)| No     | No       | No      | CPU count
  tests/e2e/ (pytest)        | Yes    | No       | No      | 1 (sequential)
  scenarios/ (playwright)    | Yes    | Yes      | Yes     | 1 (sequential)

EOF
}

# Logging functions
log_info() {
    echo -e "${BLUE}ℹ${NC} $*"
}

log_success() {
    echo -e "${GREEN}✓${NC} $*"
}

log_warning() {
    echo -e "${YELLOW}⚠${NC} $*"
}

log_error() {
    echo -e "${RED}✗${NC} $*"
}

log_section() {
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}▸${NC} $*"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

# Execute command with optional dry-run
execute() {
    local description="$1"
    shift
    local cmd="$*"

    if [ "$VERBOSE" = true ]; then
        log_info "Running: $description"
        log_info "Command: $cmd"
    else
        log_info "Running: $description"
    fi

    if [ "$DRY_RUN" = true ]; then
        echo "  [DRY RUN] $cmd"
        return 0
    fi

    if $cmd; then
        log_success "$description"
        PASSED_TESTS+=("$description")
        return 0
    else
        log_error "$description FAILED"
        FAILED_TESTS+=("$description")
        return 1
    fi
}

# Get optimal worker count
get_worker_count() {
    local dependency_level="$1"

    # If user specified workers, use that
    if [ -n "$WORKERS" ]; then
        echo "$WORKERS"
        return
    fi

    # If sequential flag is set
    if [ "$SEQUENTIAL" = true ]; then
        echo "1"
        return
    fi

    # Auto-detect based on dependency level
    case "$dependency_level" in
        no-deps)
            # Parallel execution for mock-based tests
            nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo "4"
            ;;
        backend-only|full)
            # Sequential execution for tests with real dependencies
            echo "1"
            ;;
        *)
            echo "1"
            ;;
    esac
}

# Run no-dependency tests (mocks only)
run_no_deps_tests() {
    log_section "NO DEPENDENCIES TESTS (Mocks Only)"

    local workers
    workers=$(get_worker_count "no-deps")
    log_info "Worker count: $workers (parallel execution)"

    local failed=0

    # TypeScript tests (vitest)
    if [ "$SKIP_TYPESCRIPT" = false ]; then
        if [ "$RUN_UNIT" = true ] || [ "$RUN_ALL" = true ] || [ "$RUN_NO_DEPS" = true ]; then
            execute "lib/tests/ (vitest)" \
                pnpm vitest run lib/ --reporter=verbose || failed=$((failed + 1))

            execute "app/tests/ (vitest)" \
                pnpm vitest run app/ --reporter=verbose || failed=$((failed + 1))

            execute "components/tests/ (vitest)" \
                pnpm vitest run components/ --reporter=verbose || failed=$((failed + 1))
        fi
    fi

    # Python tests (pytest)
    if [ "$SKIP_PYTHON" = false ]; then
        if [ "$RUN_UNIT" = true ] || [ "$RUN_ALL" = true ] || [ "$RUN_NO_DEPS" = true ]; then
            execute "tests/unit/ (pytest)" \
                uv run pytest tests/unit/ -v || failed=$((failed + 1))
        fi

        if [ "$RUN_INTEGRATION" = true ] || [ "$RUN_ALL" = true ] || [ "$RUN_NO_DEPS" = true ]; then
            execute "tests/integration/ (pytest)" \
                uv run pytest tests/integration/ -v || failed=$((failed + 1))
        fi
    fi

    return $failed
}

# Run backend-only tests (requires real backend server)
run_backend_only_tests() {
    log_section "BACKEND-ONLY TESTS (Real Backend Required)"

    local workers
    workers=$(get_worker_count "backend-only")
    log_info "Worker count: $workers (sequential execution - real backend)"

    local failed=0

    if [ "$SKIP_PYTHON" = false ]; then
        if [ "$RUN_E2E" = true ] || [ "$RUN_ALL" = true ] || [ "$RUN_BACKEND_ONLY" = true ]; then
            log_warning "Requires: Backend server running on port 8000"
            execute "tests/e2e/ (pytest - backend E2E)" \
                uv run pytest tests/e2e/ -v --workers="$workers" || failed=$((failed + 1))
        fi
    fi

    return $failed
}

# Run full-stack tests (requires backend + frontend + browser)
run_full_stack_tests() {
    log_section "FULL STACK TESTS (Backend + Frontend + Browser)"

    local workers
    workers=$(get_worker_count "full")
    log_info "Worker count: $workers (sequential execution - real servers)"

    local failed=0

    if [ "$SKIP_PLAYWRIGHT" = false ]; then
        if [ "$RUN_E2E" = true ] || [ "$RUN_SCENARIOS" = true ] || [ "$RUN_ALL" = true ] || [ "$RUN_FULL" = true ]; then
            log_warning "Requires: Backend (port 8000) + Frontend (port 3000) servers running"
            execute "scenarios/ (playwright - full E2E)" \
                pnpm exec playwright test --workers="$workers" --global-timeout=600000 || failed=$((failed + 1))
        fi
    fi

    return $failed
}

# Parse command line arguments
parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --all)
                RUN_ALL=true
                shift
                ;;
            --no-deps)
                RUN_NO_DEPS=true
                shift
                ;;
            --backend-only)
                RUN_BACKEND_ONLY=true
                shift
                ;;
            --full)
                RUN_FULL=true
                shift
                ;;
            --unit)
                RUN_UNIT=true
                shift
                ;;
            --integration)
                RUN_INTEGRATION=true
                shift
                ;;
            --e2e)
                RUN_E2E=true
                shift
                ;;
            --scenarios)
                RUN_SCENARIOS=true
                shift
                ;;
            --workers=*)
                WORKERS="${1#*=}"
                shift
                ;;
            --sequential)
                SEQUENTIAL=true
                shift
                ;;
            --skip-python)
                SKIP_PYTHON=true
                shift
                ;;
            --skip-typescript)
                SKIP_TYPESCRIPT=true
                shift
                ;;
            --skip-playwright)
                SKIP_PLAYWRIGHT=true
                shift
                ;;
            --verbose)
                VERBOSE=true
                shift
                ;;
            --dry-run)
                DRY_RUN=true
                shift
                ;;
            --help)
                usage
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                usage
                exit 1
                ;;
        esac
    done

    # If no test selection flags, run all
    if [ "$RUN_ALL" = false ] && \
       [ "$RUN_NO_DEPS" = false ] && \
       [ "$RUN_BACKEND_ONLY" = false ] && \
       [ "$RUN_FULL" = false ] && \
       [ "$RUN_UNIT" = false ] && \
       [ "$RUN_INTEGRATION" = false ] && \
       [ "$RUN_E2E" = false ] && \
       [ "$RUN_SCENARIOS" = false ]; then
        RUN_ALL=true
    fi
}

# Print summary
print_summary() {
    echo ""
    log_section "TEST EXECUTION SUMMARY"

    if [ ${#PASSED_TESTS[@]} -gt 0 ]; then
        echo -e "${GREEN}Passed Tests (${#PASSED_TESTS[@]}):${NC}"
        for test in "${PASSED_TESTS[@]}"; do
            echo "  ✓ $test"
        done
    fi

    if [ ${#FAILED_TESTS[@]} -gt 0 ]; then
        echo ""
        echo -e "${RED}Failed Tests (${#FAILED_TESTS[@]}):${NC}"
        for test in "${FAILED_TESTS[@]}"; do
            echo "  ✗ $test"
        done
        echo ""
        log_error "Some tests failed!"
        return 1
    else
        echo ""
        log_success "All tests passed!"
        return 0
    fi
}

# Main execution
main() {
    parse_args "$@"

    log_section "ADK AI Data Protocol - Unified Test Runner"

    if [ "$DRY_RUN" = true ]; then
        log_warning "DRY RUN MODE - Commands will not be executed"
    fi

    local total_failed=0

    # Run tests based on dependency level
    if [ "$RUN_NO_DEPS" = true ] || [ "$RUN_ALL" = true ] || \
       [ "$RUN_UNIT" = true ] || [ "$RUN_INTEGRATION" = true ]; then
        run_no_deps_tests || total_failed=$((total_failed + 1))
    fi

    if [ "$RUN_BACKEND_ONLY" = true ] || [ "$RUN_ALL" = true ] || [ "$RUN_E2E" = true ]; then
        run_backend_only_tests || total_failed=$((total_failed + 1))
    fi

    if [ "$RUN_FULL" = true ] || [ "$RUN_ALL" = true ] || \
       [ "$RUN_E2E" = true ] || [ "$RUN_SCENARIOS" = true ]; then
        run_full_stack_tests || total_failed=$((total_failed + 1))
    fi

    # Print summary
    print_summary

    exit $?
}

# Run main
main "$@"
