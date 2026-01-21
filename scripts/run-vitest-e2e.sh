#!/usr/bin/env bash

# Run vitest for specified path and handle msw WebSocket cleanup errors
# Returns 0 if all tests passed, regardless of Worker exit errors
#
# Usage: run-vitest-e2e.sh [path]
#   path: Test directory to run (defaults to lib/tests/e2e/)

set -o pipefail

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get test path from argument or default
TEST_PATH="${1:-lib/tests/e2e/}"

# Run vitest and capture output
echo -e "${YELLOW}Running $TEST_PATH (vitest)...${NC}"
echo -e "${YELLOW}Note: Worker exit errors are expected due to msw WebSocket cleanup issues${NC}"
echo ""

OUTPUT=$(bun vitest run "$TEST_PATH" --reporter=verbose 2>&1)
EXIT_CODE=$?

# Show output
echo "$OUTPUT"

# Strip ANSI color codes for parsing
CLEAN_OUTPUT=$(echo "$OUTPUT" | sed 's/\x1b\[[0-9;]*m//g')

# Check for actual test failures
if echo "$CLEAN_OUTPUT" | grep -qE "Test Files.*[0-9]+ failed"; then
    echo ""
    echo -e "${RED}Test files failed${NC}"
    exit 1
fi

if echo "$CLEAN_OUTPUT" | grep -qE "Tests.*[0-9]+ failed"; then
    echo ""
    echo -e "${RED}Tests failed${NC}"
    exit 1
fi

# Check if test files passed (pattern: "Test Files  X passed")
if echo "$CLEAN_OUTPUT" | grep -qE "Test Files[[:space:]]+[0-9]+ passed"; then
    echo ""
    echo -e "${GREEN}✓ All tests passed (Worker exit errors are expected msw cleanup issue)${NC}"
    exit 0
fi

# If vitest ran but we couldn't parse the output, return original exit code
echo ""
echo -e "${YELLOW}Could not determine test result, returning original exit code: $EXIT_CODE${NC}"
exit $EXIT_CODE
