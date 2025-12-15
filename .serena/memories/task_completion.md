# Task Completion Guidelines

## Before Committing Any Code

### 1. Run All Tests
```bash
just test-python   # Python unit tests must pass
pnpm exec vitest   # TypeScript tests must pass
```

### 2. Code Quality Checks
```bash
just lint          # Fix all linting issues
just format        # Format all code
just typecheck     # Ensure type safety (Python)
```

### 3. Verify Field Coverage (if changing protocol)
```bash
just check-coverage-validate  # Ensure coverage config is accurate
```

### 4. TDD Cycle Verification
- ✅ Did you write the test FIRST? (RED phase)
- ✅ Did you write minimal code to pass? (GREEN phase)
- ✅ Did you refactor if needed? (REFACTOR phase)

### 5. Commit Discipline
- Separate structural changes from behavioral changes
- Clear commit message describing what changed
- No commits with failing tests or linter warnings

## After Feature Implementation

### 1. Update Documentation
- Update agents/tasks.md if completing a tracked task
- Update relevant docs/ files if architecture changed
- Consider creating an experiment note in experiments/

### 2. E2E Testing (for UI/API changes)
```bash
just test-e2e-clean  # Run E2E tests with fresh servers
```

### 3. Coverage Check (for protocol changes)
```bash
just check-coverage --verbose  # Review field mapping coverage
```

## Darwin/macOS Specific Notes
- Use `lsof -ti:PORT` to find processes on ports
- Use `just kill` to clean up all development ports
- File system is case-insensitive by default

## Mandatory Conventions
- ALWAYS use `.yaml` extension (never `.yml`)
- ALWAYS use `uv` for Python (never pip)
- ALWAYS use `pnpm` for Node.js (never npm/yarn)
- ALWAYS use `just` for complex tasks (never make)