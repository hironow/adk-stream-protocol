# Task Completion Checklist

## Before Committing

When you complete a task, ALWAYS run these commands in order:

### 1. Clean Up
```bash
just delete-all
```
- Removes generated files, caches, and logs
- Ensures clean state for testing

### 2. Format Code
```bash
just format
```
- Runs `uv run ruff format .` (Python)
- Runs `pnpm run format` (TypeScript/Biome)
- Auto-fixes formatting issues

### 3. Lint Code
```bash
just lint
```
- Runs `uv run ruff check --fix .` (Python)
- Runs `pnpm run lint` (TypeScript/Biome)
- Auto-fixes linting issues where possible

### 4. Run All Checks
```bash
just check
```
- Format checking
- Linting
- Type checking (mypy for Python, tsc for TypeScript)
- Markdown linting
- All must pass with zero errors

### 5. Security Analysis
```bash
just semgrep
```
- Runs Semgrep static analysis
- Must have 0 findings (0 blocking)

### 6. Run Tests
```bash
# Python tests (must pass with 0 failures, 6 skips allowed for fixture recording)
uv run pytest tests/ -v

# TypeScript tests (must pass with 0 failures, 0 skips)
pnpm exec vitest run lib/tests/ --max-concurrency=1
```

## Commit Requirements

ALL of the following must be true before committing:

- ✅ All tests passing (Python: 390 passed, TypeScript: 458 passed)
- ✅ All linting passing (ruff, biome)
- ✅ All type checking passing (mypy, tsc)
- ✅ Semgrep security analysis passing (0 findings)
- ✅ Markdown linting passing
- ✅ Code formatted consistently

## Commit Message Format
```
type(scope): subject

- Detailed description if needed
- Use bullet points for multiple changes

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

**Types**: feat, fix, docs, style, refactor, test, chore

## Tidy First Principle

**Structural vs Behavioral Changes**:
- Structural: Renaming, moving, extracting (no behavior change)
- Behavioral: Adding/modifying functionality

**Rules**:
1. NEVER mix structural and behavioral changes in same commit
2. ALWAYS do structural changes first (separate commit)
3. Verify structural changes don't alter behavior (tests pass before/after)

## Skip Policy

**Allowed Skips**:
- Python: 6 skipped tests (fixture recording pending)
- TypeScript: 0 skipped tests allowed

**If new skips appear**: Investigate immediately, do NOT commit.
